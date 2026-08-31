import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { validarProduto } from "../../../lib/productValidation.js";

const LEGACY_CATEGORIES = new Set(["BOLO_NO_POTE", "MINI_PUDIM"]);

async function categoryExists(env, id) {
  try {
    return Boolean(
      await env.DB.prepare("SELECT id FROM categorias WHERE id = ? AND ativo = 1").bind(id).first()
    );
  } catch (error) {
    if (String(error?.message || "").includes("no such table: categorias")) {
      return LEGACY_CATEGORIES.has(id);
    }
    throw error;
  }
}

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ erro: "ID inválido." }, 400);

  const payload = await bodyJson(request);
  const validacao = validarProduto(payload);
  if (!validacao.ok) return json({ erro: "Dados inválidos." }, 400);
  const p = validacao.produto;

  if (!(await categoryExists(env, p.categoria))) {
    return json({ erro: "Categoria inexistente ou inativa." }, 400);
  }

  const atual = await env.DB.prepare("SELECT estoque_reservado FROM produtos WHERE id = ?")
    .bind(id)
    .first();
  if (atual && p.estoque < Number(atual.estoque_reservado || 0)) {
    return json(
      {
        erro: `Não é possível reduzir o estoque para ${p.estoque}, pois existem ${atual.estoque_reservado} unidade(s) reservada(s) em compras pendentes.`
      },
      409
    );
  }

  await env.DB.prepare(
    `
    UPDATE produtos
    SET nome=?, categoria=?, descricao=?, preco_centavos=?, disponivel=?, ativo=?, destaque=?, emoji=?, estoque=?, promocao_ativa=?, preco_promocional_centavos=?, promocao_inicio=?, promocao_fim=?,
        atualizado_em=CURRENT_TIMESTAMP
    WHERE id=?
  `
  )
    .bind(
      p.nome,
      p.categoria,
      p.descricao,
      p.preco_centavos,
      p.disponivel ? 1 : 0,
      p.ativo ? 1 : 0,
      p.destaque ? 1 : 0,
      p.emoji,
      p.estoque,
      p.promocao_ativa ? 1 : 0,
      p.preco_promocional_centavos,
      p.promocao_inicio,
      p.promocao_fim,
      id
    )
    .run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ erro: "ID inválido." }, 400);
  const permanent = new URL(request.url).searchParams.get("permanent") === "1";
  if (permanent) {
    const vinculos = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM pedidos WHERE produto_id = ?"
    )
      .bind(id)
      .first();
    const product = await env.DB.prepare("SELECT image_key FROM produtos WHERE id = ?")
      .bind(id)
      .first();

    await env.DB.prepare("DELETE FROM produtos WHERE id = ?").bind(id).run();
    if (product?.image_key && env.PRODUCT_IMAGES) {
      await env.PRODUCT_IMAGES.delete(product.image_key).catch(() => {});
    }

    return json({
      ok: true,
      pedidos_preservados: Number(vinculos?.total || 0)
    });
  } else {
    await env.DB.prepare(
      "UPDATE produtos SET ativo = 0, disponivel = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
    )
      .bind(id)
      .run();
  }
  return json({ ok: true });
}
