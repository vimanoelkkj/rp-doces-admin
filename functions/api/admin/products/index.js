import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { validarProduto } from "../../../lib/productValidation.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const { results } = await env.DB.prepare(`
    SELECT id, nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji, estoque, criado_em, atualizado_em
    FROM produtos ORDER BY categoria, ordem, nome
  `).all();
  return json({ produtos: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const payload = await bodyJson(request);
  const validacao = validarProduto(payload);
  if (!validacao.ok) return json({ erro: "Dados do produto inválidos." }, 400);
  const p = validacao.produto;

  const ordemRow = await env.DB.prepare("SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM produtos WHERE categoria = ?").bind(p.categoria).first();
  const ordem = Number(ordemRow?.proxima ?? 0);
  const result = await env.DB.prepare(`
    INSERT INTO produtos (nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji, estoque)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    p.nome, p.categoria, p.descricao, p.preco_centavos,
    p.disponivel ? 1 : 0,
    p.ativo ? 1 : 0,
    p.destaque ? 1 : 0,
    ordem,
    p.emoji,
    p.estoque
  ).run();

  return json({ ok: true, id: result.meta?.last_row_id }, 201);
}
