/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../lib/auth";

interface Env {
  DB: D1Database;
}

interface UnsubscribeInput {
  endpoint?: unknown;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: UnsubscribeInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido no corpo da requisição", 400);
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) {
    return jsonError("Endpoint não informado", 400);
  }

  try {
    await env.DB.prepare(
      "DELETE FROM push_inscricoes WHERE endpoint = ? AND usuario_id = ?",
    )
      .bind(endpoint, auth.user.id)
      .run();

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover push subscription", err);
    return jsonError("Erro interno ao remover inscrição de notificação", 500);
  }
};
