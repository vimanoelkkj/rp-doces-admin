/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../lib/auth";

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  if (!env.VAPID_PUBLIC_KEY) {
    return jsonError("Chave VAPID pública não configurada no servidor", 503);
  }

  return Response.json({ ok: true, publicKey: env.VAPID_PUBLIC_KEY });
};
