import { json } from "../lib/http.js";
import { limparReservasExpiradas } from "../lib/stock.js";

async function queryProducts(env, { withCategories = true, withImage = true } = {}) {
  const imageColumn = withImage ? ", p.image_key" : "";
  const categoryColumns = withCategories
    ? ", c.nome AS categoria_nome, c.emoji AS categoria_emoji, c.ordem AS categoria_ordem"
    : "";
  const join = withCategories ? "LEFT JOIN categorias c ON c.id = p.categoria" : "";
  const where = withCategories
    ? "WHERE p.ativo = 1 AND COALESCE(c.ativo, 1) = 1"
    : "WHERE p.ativo = 1";
  const order = withCategories
    ? "ORDER BY COALESCE(c.ordem, 9999), p.ordem, p.nome"
    : "ORDER BY p.categoria, p.ordem, p.nome";

  const { results } = await env.DB.prepare(
    `
    SELECT p.id, p.nome, p.categoria, p.descricao, p.preco_centavos, p.disponivel, p.destaque,
           p.ordem, p.emoji, p.estoque, p.estoque_reservado, p.promocao_ativa,
           p.preco_promocional_centavos, p.promocao_inicio, p.promocao_fim${imageColumn}${categoryColumns}
    FROM produtos p
    ${join}
    ${where}
    ${order}
  `
  ).all();

  return (results || []).map(product => ({
    ...product,
    image_key: withImage ? product.image_key ?? null : null
  }));
}

async function loadProducts(env) {
  try {
    return await queryProducts(env, { withCategories: true, withImage: true });
  } catch (error) {
    const message = String(error?.message || "");

    if (message.includes("no such column: p.image_key") || message.includes("no such column: image_key")) {
      try {
        return await queryProducts(env, { withCategories: true, withImage: false });
      } catch (categoryError) {
        if (!String(categoryError?.message || "").includes("no such table: categorias")) {
          throw categoryError;
        }
        return queryProducts(env, { withCategories: false, withImage: false });
      }
    }

    if (message.includes("no such table: categorias")) {
      try {
        return await queryProducts(env, { withCategories: false, withImage: true });
      } catch (imageError) {
        if (
          !String(imageError?.message || "").includes("no such column: p.image_key") &&
          !String(imageError?.message || "").includes("no such column: image_key")
        ) {
          throw imageError;
        }
        return queryProducts(env, { withCategories: false, withImage: false });
      }
    }

    throw error;
  }
}

export async function onRequestGet({ env }) {
  try {
    await limparReservasExpiradas(env);
    const results = await loadProducts(env);
    const agora = Date.now();

    return json(
      {
        produtos: results.map(p => {
          const inicioOk = !p.promocao_inicio || Date.parse(p.promocao_inicio) <= agora;
          const fimOk = !p.promocao_fim || Date.parse(p.promocao_fim) > agora;
          const promo =
            Boolean(p.promocao_ativa) &&
            Number(p.preco_promocional_centavos) > 0 &&
            inicioOk &&
            fimOk;
          const normal = Number(p.preco_centavos);
          const disponivelLiquido = Number(p.estoque) - Number(p.estoque_reservado || 0) > 0;

          return {
            ...p,
            image_url: p.image_key ? `/api/images/${p.image_key}` : null,
            preco_original_centavos: normal,
            preco_centavos: promo ? Number(p.preco_promocional_centavos) : normal,
            promocao_vigente: promo,
            disponivel: Boolean(p.disponivel) && disponivelLiquido,
            destaque: Boolean(p.destaque)
          };
        })
      },
      200,
      { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" }
    );
  } catch (e) {
    console.error("products:", e);
    return json({ produtos: [], erro: "Cardápio temporariamente indisponível." }, 500, {
      "cache-control": "no-store"
    });
  }
}
