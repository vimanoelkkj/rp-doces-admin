/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../lib/auth";
import { reconciliarPushEventosFalhos, type PushEnv } from "../../../lib/pushNotifier";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPost: PagesFunction<PushEnv> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    const result = await reconciliarPushEventosFalhos(env.DB, env);
    return Response.json(result);
  } catch (err) {
    console.error("Erro ao reconciliar push eventos falhos (admin)", err);
    return jsonError("Erro interno ao reconciliar eventos de push", 500);
  }
};
