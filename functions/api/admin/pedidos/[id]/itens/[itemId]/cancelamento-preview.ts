/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../../../lib/auth";
import {
  getItemCancellationPreview,
  ItemCancellationPreviewError,
} from "../../../../../../lib/itemCancellationPreview";

interface Env {
  DB: D1Database;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const pedidoId = Number(params.id);
  const itemId = Number(params.itemId);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
    return jsonError("Id do pedido inválido", 400, "PEDIDO_ID_INVALIDO");
  }
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return jsonError("Id do item inválido", 400, "ITEM_ID_INVALIDO");
  }

  try {
    return Response.json(await getItemCancellationPreview(env.DB, pedidoId, itemId));
  } catch (error) {
    if (error instanceof ItemCancellationPreviewError) {
      return jsonError(error.message, error.status, error.code);
    }
    console.error("Erro ao calcular preview de cancelamento do item", error);
    return jsonError("Erro interno ao calcular o cancelamento", 500);
  }
};
