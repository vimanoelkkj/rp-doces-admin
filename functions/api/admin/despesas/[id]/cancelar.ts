/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../lib/auth";
import { cancelarDespesa } from "../../../../lib/despesas";

interface Env {
  DB: D1Database;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// "Excluir despesa" na UI: nunca DELETE físico. Idempotente — cancelar duas
// vezes é seguro e devolve o mesmo resultado lógico (replay).
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = parseId(params.id);
  if (!id) return jsonError("Id inválido", 400);

  try {
    const resultado = await cancelarDespesa(env.DB, { id, usuarioId: auth.user.id });
    if (!resultado.ok) return jsonError("Despesa não encontrada", 404, resultado.erro);
    return Response.json(resultado);
  } catch (err) {
    console.error("Erro ao cancelar despesa (admin)", err);
    return jsonError("Erro interno ao cancelar despesa", 500);
  }
};
