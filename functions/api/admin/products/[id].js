import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const id = Number(params.id);
  const p = await bodyJson(request);
  const nome = String(p?.nome || "").trim();
  const categoria = String(p?.categoria || "");
  const descricao = String(p?.descricao || "").trim();
  const preco = Number(p?.preco_centavos);
  const emoji = String(p?.emoji || "").trim().slice(0, 8);
  const nomeValido = nome.length >= 1 && nome.length <= 100;
  const descricaoValida = descricao.length <= 500;
  const precoValido = Number.isInteger(preco) && preco >= 0 && preco <= 10000000; // até R$ 100.000,00

  if (!Number.isInteger(id) || !nomeValido || !descricaoValida ||
      !["BOLO_NO_POTE","MINI_PUDIM"].includes(categoria) || !precoValido)
    return json({ erro: "Dados inválidos." }, 400);

  await env.DB.prepare(`
    UPDATE produtos
    SET nome=?, categoria=?, descricao=?, preco_centavos=?, disponivel=?, ativo=?, destaque=?, emoji=?,
        atualizado_em=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    nome, categoria, descricao, preco,
    p.disponivel ? 1 : 0, p.ativo ? 1 : 0, p.destaque ? 1 : 0,
    emoji, id
  ).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ erro: "ID inválido." }, 400);
  const permanent = new URL(request.url).searchParams.get("permanent") === "1";
  if (permanent) {
    await env.DB.prepare("DELETE FROM produtos WHERE id = ?").bind(id).run();
  } else {
    await env.DB.prepare("UPDATE produtos SET ativo = 0, disponivel = 0, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
  }
  return json({ ok: true });
}
