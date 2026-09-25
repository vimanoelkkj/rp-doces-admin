/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../lib/auth";
import { reconcileLiveTabPedido } from "../../../../lib/liveTabRecovery";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  try {
    await reconcileLiveTabPedido(env.DB, env.MP_ACCESS_TOKEN, id);
  } catch (recoveryError) {
    console.error(
      "Recuperacao oportunista da comanda ficou pendente",
      { pedidoId: id },
      recoveryError,
    );
  }

  return Response.json({ ok: true });
};
