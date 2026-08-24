import { json, bodyJson, sameOrigin } from "../lib/http.js";
import { hashPassword, validatePassword } from "../lib/auth.js";

export async function onRequestGet({ env }) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM usuarios_admin").first();
  return json({ needsSetup: Number(row?.total || 0) === 0 });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM usuarios_admin").first();
  if (Number(count?.total || 0) !== 0)
    return json({ erro: "Configuração inicial já realizada." }, 409);

  const data = await bodyJson(request);
  if (!data) return json({ erro: "Dados inválidos." }, 400);
  if (!env.SETUP_KEY || data.setupKey !== env.SETUP_KEY)
    return json({ erro: "Chave de configuração inválida." }, 403);

  const nome = String(data.nome || "").trim();
  const username = String(data.username || "")
    .trim()
    .toLowerCase();
  const email = String(data.email || "")
    .trim()
    .toLowerCase();
  const passwordError = validatePassword(data.senha);

  if (nome.length < 2 || !/^[a-z0-9._-]{3,30}$/.test(username) || !email.includes("@"))
    return json({ erro: "Nome, usuário ou e-mail inválido." }, 400);
  if (passwordError) return json({ erro: passwordError }, 400);

  const hash = await hashPassword(data.senha);
  await env.DB.prepare(
    `
    INSERT INTO usuarios_admin (nome, username, email, senha_hash, ativo, papel)
    VALUES (?, ?, ?, ?, 1, 'OWNER')
  `
  )
    .bind(nome, username, email, hash)
    .run();

  return json({ ok: true });
}
