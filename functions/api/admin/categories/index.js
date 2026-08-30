import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";

const ID_PATTERN = /^[A-Z0-9][A-Z0-9_]{1,47}$/;

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const { results } = await env.DB.prepare(
    `
    SELECT c.id, c.nome, c.emoji, c.descricao, c.ordem, c.ativo, c.sistema,
           COUNT(p.id) AS produtos,
           SUM(CASE WHEN p.ativo = 1 THEN 1 ELSE 0 END) AS ativos,
           SUM(CASE WHEN p.ativo = 0 THEN 1 ELSE 0 END) AS arquivados
    FROM categorias c
    LEFT JOIN produtos p ON p.categoria = c.id
    GROUP BY c.id
    ORDER BY c.ordem, c.nome
  `
  ).all();

  return json({ categorias: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const payload = await bodyJson(request);
  const nome = String(payload?.nome || "").trim();
  const id = normalizeId(payload?.id || nome);
  const emoji = String(payload?.emoji || "🍰").trim();
  const descricao = String(payload?.descricao || "").trim();

  if (nome.length < 2 || nome.length > 60 || !ID_PATTERN.test(id)) {
    return json({ erro: "Dados da categoria inválidos." }, 400);
  }
  if ([...emoji].length > 16 || descricao.length > 240) {
    return json({ erro: "Dados da categoria inválidos." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM categorias WHERE id = ?").bind(id).first();
  if (existing) return json({ erro: "Já existe uma categoria com este identificador." }, 409);

  const orderRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM categorias"
  ).first();

  await env.DB.prepare(
    `INSERT INTO categorias (id, nome, emoji, descricao, ordem, ativo, sistema)
     VALUES (?, ?, ?, ?, ?, 1, 0)`
  )
    .bind(id, nome, emoji, descricao, Number(orderRow?.proxima ?? 0))
    .run();

  return json({ ok: true, id }, 201);
}
