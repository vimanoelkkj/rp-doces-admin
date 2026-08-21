import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const { results } = await env.DB.prepare(`
    SELECT id, nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji, criado_em, atualizado_em
    FROM produtos ORDER BY categoria, ordem, nome
  `).all();
  return json({ produtos: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const p = await bodyJson(request);
  const nome = String(p?.nome || "").trim();
  const categoria = String(p?.categoria || "");
  const descricao = String(p?.descricao || "").trim();
  const preco = Number(p?.preco_centavos);
  const emoji = String(p?.emoji || "").trim().slice(0, 8);
  const nomeValido = nome.length >= 1 && nome.length <= 100;
  const descricaoValida = descricao.length <= 500;
  const precoValido = Number.isInteger(preco) && preco >= 0 && preco <= 10000000; // até R$ 100.000,00

  if (!nomeValido || !descricaoValida || !["BOLO_NO_POTE","MINI_PUDIM"].includes(categoria) || !precoValido)
    return json({ erro: "Dados do produto inválidos." }, 400);

  const ordemRow = await env.DB.prepare("SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM produtos WHERE categoria = ?").bind(categoria).first();
  const ordem = Number(ordemRow?.proxima ?? 0);
  const result = await env.DB.prepare(`
    INSERT INTO produtos (nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    nome, categoria, descricao, preco,
    p.disponivel === false ? 0 : 1,
    p.ativo === false ? 0 : 1,
    p.destaque ? 1 : 0,
    ordem,
    emoji
  ).run();

  return json({ ok: true, id: result.meta?.last_row_id }, 201);
}
