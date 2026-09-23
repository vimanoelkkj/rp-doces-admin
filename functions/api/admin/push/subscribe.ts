/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../lib/auth";

interface Env {
  DB: D1Database;
}

interface SubscribeInput {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
  userAgent?: unknown;
}

const MAX_ENDPOINT_LENGTH = 1024;
const MAX_P256DH_LENGTH = 200;
const MAX_AUTH_LENGTH = 100;
const MAX_USER_AGENT_LENGTH = 500;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: SubscribeInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido no corpo da requisição", 400);
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const authSecret = typeof body.keys?.auth === "string" ? body.keys.auth.trim() : "";
  const userAgent =
    typeof body.userAgent === "string"
      ? body.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
      : (request.headers.get("User-Agent") || "").slice(0, MAX_USER_AGENT_LENGTH);

  if (!endpoint || !endpoint.startsWith("https://") || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return jsonError("Endpoint inválido ou ausente (deve iniciar com https://)", 400);
  }

  if (!p256dh || p256dh.length < 10 || p256dh.length > MAX_P256DH_LENGTH) {
    return jsonError("Chave pública p256dh inválida", 400);
  }

  if (!authSecret || authSecret.length < 5 || authSecret.length > MAX_AUTH_LENGTH) {
    return jsonError("Segredo de autenticação auth inválido", 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO push_inscricoes
         (usuario_id, endpoint, p256dh, auth, user_agent, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(endpoint) DO UPDATE SET
         usuario_id = excluded.usuario_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         atualizado_em = CURRENT_TIMESTAMP`,
    )
      .bind(auth.user.id, endpoint, p256dh, authSecret, userAgent)
      .run();

    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("Erro ao registrar push subscription", err);
    return jsonError("Erro interno ao registrar inscrição de notificação", 500);
  }
};
