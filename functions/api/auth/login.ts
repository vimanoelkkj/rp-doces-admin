/// <reference types="@cloudflare/workers-types" />

import { verifyPassword, createSession, sameOrigin } from "../../lib/auth";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from "../../lib/rateLimit";

interface Env {
  DB: D1Database;
}

interface LoginBody {
  username?: string;
  senha?: string;
}

interface UsuarioRow {
  id: number;
  nome: string;
  username: string;
  email: string;
  senha_hash: string;
  ativo: number;
}

// Hash PBKDF2 dummy fixo e válido (100.000 iterações) para equalizar timing de verificação
// quando o usuário não existe ou está inativo, mitigando enumeração por canal lateral de tempo.
const DUMMY_PASSWORD_HASH =
  "pbkdf2_sha256$100000$e5b19327f233004815af503c254fe388$c4b75d9d1d61ac77144801ab6f9e742ad509bba8757d29912da5dc0ac2eea41f";

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }

  let body: LoginBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const username = (body.username ?? "").trim().toLowerCase();
  const senha = body.senha ?? "";

  if (!username || username.length > 80 || senha.length > 256) {
    return jsonError("Credenciais inválidas", 400);
  }

  const rate = await checkLoginRateLimit(env.DB, request, username);
  if (!rate.allowed) {
    return jsonError(
      "Muitas tentativas. Tente novamente em alguns minutos",
      429,
      { "retry-after": String(rate.retryAfter) },
    );
  }

  const user = await env.DB.prepare(
    `SELECT id, nome, username, email, senha_hash, ativo
     FROM usuarios_admin WHERE username = ? LIMIT 1`,
  )
    .bind(username)
    .first<UsuarioRow>();

  const hashParaVerificar =
    user && user.ativo
      ? user.senha_hash
      : DUMMY_PASSWORD_HASH;

  const senhaCorreta = await verifyPassword(senha, hashParaVerificar);

  if (!user || !user.ativo || !senhaCorreta) {
    await recordLoginFailure(env.DB, rate.key);
    await new Promise((r) => setTimeout(r, 350));
    return jsonError("Usuário ou senha incorretos", 401);
  }

  await clearLoginFailures(env.DB, rate.key);

  await env.DB.prepare(`DELETE FROM admin_sessoes WHERE expira_em <= ?`)
    .bind(new Date().toISOString())
    .run();

  const session = await createSession(env.DB, user.id);

  return Response.json(
    {
      ok: true,
      usuario: {
        id: user.id,
        nome: user.nome,
        username: user.username,
        email: user.email,
      },
    },
    { headers: { "Set-Cookie": session.cookie } },
  );
};
