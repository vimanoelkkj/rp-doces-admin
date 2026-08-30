import { json } from "../lib/http.js";
import { limparReservasExpiradas } from "../lib/stock.js";

async function loadProducts(env) {
  try {
    const { results } = await env.DB.prepare(
      `
      SELECT p.id, p.nome, p.categoria, p.descricao, p.preco_centavos, p.disponivel, p.destaque,
             p.ordem, p.emoji, p.estoque, p.estoque_reservado, p.promocao_ativa,
             p.preco_promocional_centavos, p.promocao_inicio, p.promocao_fim,
             c.nome AS categoria_nome, c.emoji AS categoria_emoji, c.ordem AS categoria_ordem
      FROM produtos p
      LEFT JOIN categorias c ON c.id = p.categoria
      WHERE p.ativo = 1 AND COALESCE(c.ativo, 1) = 1
      ORDER BY COALESCE(c.ordem, 9999), p.ordem, p.nome
    `
    ).all();
    return results || [];
  } catch (error) {
    if (!String(error?.message || "").includes("no such table: categorias")) throw error;

    const { results } = await env.DB.prepare(
      `
      SELECT id, nome, categoria, descricao, preco_centavos, disponivel, destaque, ordem, emoji,
             estoque, estoque_reservado, promocao_ativa, preco_promocional_centavos,
             promocao_inicio, promocao_fim
      FROM produtos
      WHERE ativo = 1
      ORDER BY categoria, ordem, nome
    `
    ).all();
    return results || [];
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
