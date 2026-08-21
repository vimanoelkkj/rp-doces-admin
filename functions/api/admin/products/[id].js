import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { validarProduto } from "../../../lib/productValidation.js";

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

  await env.DB.prepare(`
    UPDATE produtos
    SET nome=?, categoria=?, descricao=?, preco_centavos=?, disponivel=?, ativo=?, destaque=?, emoji=?, estoque=?, promocao_ativa=?, preco_promocional_centavos=?, promocao_inicio=?, promocao_fim=?,
        atualizado_em=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    p.nome, p.categoria, p.descricao, p.preco_centavos,
    p.disponivel ? 1 : 0, p.ativo ? 1 : 0, p.destaque ? 1 : 0,
    p.emoji, p.estoque, p.promocao_ativa ? 1 : 0, p.preco_promocional_centavos, p.promocao_inicio, p.promocao_fim, id
  ).run();

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
    ).bind(id).first();

    await env.DB.prepare("DELETE FROM produtos WHERE id = ?").bind(id).run();

    return json({
      ok: true,
      pedidos_preservados: Number(vinculos?.total || 0)
    });
  } else {
    await env.DB.prepare("UPDATE produtos SET ativo = 0, disponivel = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  }
  return json({ ok: true });
}
