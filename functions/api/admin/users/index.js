import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser, hashPassword, validatePassword } from "../../../lib/auth.js";

const PAPEIS = new Set(["OWNER", "ADMIN"]);
const isOwner = user => user?.papel === "OWNER";
const withAvatarUrl = user =>
  user
    ? {
        ...user,
        avatar_url: user.avatar_key ? `/api/images/${encodeURIComponent(user.avatar_key)}` : null
      }
    : null;

async function selectSelf(env, id) {
  try {
    return await env.DB.prepare(
      "SELECT id, nome, username, email, ativo, papel, criado_em, avatar_key FROM usuarios_admin WHERE id=? LIMIT 1"
    )
      .bind(id)
      .first();
  } catch (error) {
    if (!String(error?.message || "").includes("no such column: avatar_key")) throw error;
    return env.DB.prepare(
      "SELECT id, nome, username, email, ativo, papel, criado_em FROM usuarios_admin WHERE id=? LIMIT 1"
    )
      .bind(id)
      .first();
  }
}

async function selectAll(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, nome, username, email, ativo, papel, criado_em, avatar_key FROM usuarios_admin ORDER BY nome"
    ).all();
    return results || [];
  } catch (error) {
    if (!String(error?.message || "").includes("no such column: avatar_key")) throw error;
    const { results } = await env.DB.prepare(
      "SELECT id, nome, username, email, ativo, papel, criado_em FROM usuarios_admin ORDER BY nome"
    ).all();
    return results || [];
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!isOwner(auth.user)) {
    const self = withAvatarUrl(await selectSelf(env, auth.user.id));
    return json({ usuarios: self ? [self] : [] });
  }

  return json({ usuarios: (await selectAll(env)).map(withAvatarUrl) });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!isOwner(auth.user))
    return json({ erro: "Apenas um administrador mestre pode criar administradores." }, 403);

  const d = await bodyJson(request);
  if (!d || typeof d !== "object" || Array.isArray(d))
    return json({ erro: "Dados inválidos." }, 400);
  const permitidos = new Set(["nome", "username", "email", "senha", "papel"]);
  if (Object.keys(d).some(k => !permitidos.has(k))) return json({ erro: "Dados inválidos." }, 400);

  const nome = typeof d.nome === "string" ? d.nome.trim() : "";
  const username = typeof d.username === "string" ? d.username.trim().toLowerCase() : "";
  const email = typeof d.email === "string" ? d.email.trim().toLowerCase() : "";
  const senha = typeof d.senha === "string" ? d.senha : "";
  const papel = typeof d.papel === "string" ? d.papel : "ADMIN";
  const err = validatePassword(senha);

  if (
    nome.length < 2 ||
    nome.length > 100 ||
    !/^[a-z0-9._-]{3,30}$/.test(username) ||
    email.length > 254 ||
    !email.includes("@") ||
    !PAPEIS.has(papel) ||
    err
  ) {
    return json({ erro: err || "Dados do administrador inválidos." }, 400);
  }

  try {
    await env.DB.prepare(
      `
      INSERT INTO usuarios_admin (nome, username, email, senha_hash, ativo, papel)
      VALUES (?, ?, ?, ?, 1, ?)
    `
    )
      .bind(nome, username, email, await hashPassword(senha), papel)
      .run();
  } catch {
    return json({ erro: "Esse nome de usuário ou e-mail já está cadastrado." }, 409);
  }
  return json({ ok: true }, 201);
}
