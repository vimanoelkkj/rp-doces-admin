/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../lib/auth";
import { reconcilePedidosEmBackground } from "../../../lib/adminPedidos/maintenance";
import type { Env } from "../../../lib/adminPedidos/types";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    await reconcilePedidosEmBackground(env);
  } catch (err) {
    console.error("Falha ao executar reconciliação de pedidos", err);
  }

  return Response.json({ ok: true });
};
