/// <reference types="@cloudflare/workers-types" />

import { destroySession, sameOrigin } from "../../lib/auth";

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  }

  const cookie = await destroySession(env.DB, request);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
};
