/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../../../lib/auth";
import {
  createItemCancellation,
  getCancellationView,
} from "../../../../../../lib/itemCancellation";
import { reconcileLiveTabParent } from "../../../../../../lib/liveTabRecovery";
import { ItemCancellationPreviewError } from "../../../../../../lib/itemCancellationPreview";
import { OPERACAO_HTTP_STATUS, OPERACAO_MENSAGENS } from "../../../../../../lib/operacoes";

interface Env { DB: D1Database; MP_ACCESS_TOKEN?: string }

const MESSAGES: Record<string, string> = {
  PREVIEW_OBSOLETO: "O pedido mudou. Revise o impacto atualizado antes de confirmar novamente.",
  ESTOQUE_ACAO_INVALIDA: "A ação de estoque não corresponde ao estado atual do item.",
  PIX_PENDENTE: "Há um Pix pendente. Aguarde sua resolução antes de cancelar o item.",
  ...OPERACAO_MENSAGENS,
};

const errorJson = (message: string, status: number, code?: string, extra: object = {}) =>
  Response.json({ error: message, ...(code ? { code } : {}), ...extra }, { status });

function ids(params: Record<string, string | string[] | undefined>) {
  return { pedidoId: Number(params.id), itemId: Number(params.itemId) };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  const value = ids(params);
  if (!Number.isInteger(value.pedidoId) || !Number.isInteger(value.itemId)) {
    return errorJson("Identificador inválido", 400, "ID_INVALIDO");
  }
  let cancelamento = await getCancellationView(env.DB, value.pedidoId, value.itemId);
  if (cancelamento) {
    try {
      await reconcileLiveTabParent(env.DB, env.MP_ACCESS_TOKEN,
        { cancellationId: cancelamento.id });
      cancelamento = await getCancellationView(env.DB, value.pedidoId, value.itemId);
    } catch (error) { console.error("Recuperacao oportunista de refund MP pendente", error); }
  }
  return cancelamento
    ? Response.json({ cancelamento })
    : errorJson("Cancelamento não encontrado", 404, "CANCELAMENTO_NAO_ENCONTRADO");
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  const value = ids(params);
  if (!Number.isInteger(value.pedidoId) || value.pedidoId <= 0
      || !Number.isInteger(value.itemId) || value.itemId <= 0) {
    return errorJson("Identificador inválido", 400, "ID_INVALIDO");
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return errorJson("JSON inválido", 400); }
  try {
    const result = await createItemCancellation(env.DB, {
      ...value,
      usuarioId: auth.user.id,
      operationKey: body.operationKey,
      motivo: typeof body.motivo === "string" ? body.motivo : "",
      estoqueAcao: String(body.estoqueAcao ?? ""),
      previewFingerprint: String(body.previewFingerprint ?? ""),
    });
    if (result.ok === false) {
      const status = result.erro === "OPERATION_KEY_INVALIDA" ? 400
        : OPERACAO_HTTP_STATUS[result.erro] ?? 409;
      return errorJson(MESSAGES[result.erro] ?? "Não foi possível cancelar o item", status,
        result.erro, result.preview ? { preview: result.preview } : {});
    }
    return Response.json(result, { status: result.replay ? 200 : 201 });
  } catch (error) {
    if (error instanceof ItemCancellationPreviewError) {
      return errorJson(error.message, error.status, error.code);
    }
    console.error("Erro ao executar cancelamento de item", error);
    return errorJson("Erro interno ao cancelar o item", 500);
  }
};
