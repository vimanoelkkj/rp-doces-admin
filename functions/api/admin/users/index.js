import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser, hashPassword, validatePassword } from "../../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const { results } = await env.DB.prepare(
    "SELECT id, nome, username, email, ativo, criado_em FROM usuarios_admin ORDER BY nome"
  ).all();
  return json({ usuarios: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const d = await bodyJson(request);
  const nome = String(d?.nome || "").trim();
  const username = String(d?.username || "").trim().toLowerCase();
  const email = String(d?.email || "").trim().toLowerCase();
  const senha = String(d?.senha || "");
  const err = validatePassword(senha);

  if (nome.length < 2 || !/^[a-z0-9._-]{3,30}$/.test(username) || !email.includes("@") || err) return json({ erro: err || "Usuário deve ter 3 a 30 caracteres e usar apenas letras minúsculas, números, ponto, _ ou -." }, 400);

  try {
    await env.DB.prepare(`
      INSERT INTO usuarios_admin (nome, username, email, senha_hash, ativo)
      VALUES (?, ?, ?, ?, 1)
    `).bind(nome, username, email, await hashPassword(senha)).run();
  } catch {
    return json({ erro: "Esse nome de usuário ou e-mail já está cadastrado." }, 409);
  }
  return json({ ok: true }, 201);
}
