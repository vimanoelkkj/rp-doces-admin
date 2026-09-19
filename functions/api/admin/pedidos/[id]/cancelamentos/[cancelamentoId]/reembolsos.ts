/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../../../lib/auth";
import { confirmCancellationRefund } from "../../../../../../lib/itemCancellation";
import { OPERACAO_HTTP_STATUS, OPERACAO_MENSAGENS } from "../../../../../../lib/operacoes";

interface Env { DB: D1Database }

const MESSAGES: Record<string, string> = {
  CANCELAMENTO_NAO_ENCONTRADO: "Cancelamento não encontrado.",
  CANCELAMENTO_NAO_AGUARDANDO: "Este cancelamento não aguarda devolução.",
  PAGAMENTO_ALOCACAO_INVALIDA: "A perna financeira não pertence a este cancelamento.",
  PIX_MP_REFUND_REMOTO_PENDENTE: "O estorno do Pix Mercado Pago será tratado em uma fase futura.",
  VALOR_REFUND_DIVERGENTE: "O valor deve ser exatamente o saldo indicado pelo servidor.",
  ...OPERACAO_MENSAGENS,
};

const fail = (message: string, status: number, code?: string) =>
  Response.json({ error: message, ...(code ? { code } : {}) }, { status });

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  const pedidoId = Number(params.id);
  const cancellationId = Number(params.cancelamentoId);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0
      || !Number.isInteger(cancellationId) || cancellationId <= 0) {
    return fail("Identificador inválido", 400, "ID_INVALIDO");
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("JSON inválido", 400); }
  const pagamentoId = Number(body.pagamentoId);
  const pagamentoAlocacaoId = Number(body.pagamentoAlocacaoId);
  const valorCentavos = Number(body.valorCentavos);
  if (![pagamentoId, pagamentoAlocacaoId, valorCentavos].every(Number.isSafeInteger)) {
    return fail("Dados financeiros inválidos", 400, "DADOS_INVALIDOS");
  }
  try {
    const result = await confirmCancellationRefund(env.DB, {
      pedidoId, cancellationId, usuarioId: auth.user.id,
      operationKey: body.operationKey, pagamentoId, pagamentoAlocacaoId,
      valorCentavos, confirmacao: body.confirmacao === true,
    });
    if (result.ok === false) {
      return fail(MESSAGES[result.erro] ?? "Não foi possível registrar a devolução",
        OPERACAO_HTTP_STATUS[result.erro] ?? 409, result.erro);
    }
    return Response.json(result, { status: result.replay ? 200 : 201 });
  } catch (error) {
    console.error("Erro ao registrar devolução do cancelamento", error);
    return fail("Erro interno ao registrar a devolução", 500);
  }
};
