/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../lib/auth";
import { registerManualRefund } from "../../../../lib/comandaLedger";
import {
  OPERACAO_HTTP_STATUS,
  OPERACAO_MENSAGENS,
  parseOperationKey,
} from "../../../../lib/operacoes";

interface Env {
  DB: D1Database;
}

interface ReembolsoInput {
  pagamentoId?: number;
  valorCentavos?: number;
  motivo?: string;
  operationKey?: string;
}

const MENSAGENS: Record<string, string> = {
  PEDIDO_NAO_ENCONTRADO: "Pedido não encontrado",
  STATUS_PEDIDO_NAO_REEMBOLSAVEL:
    "Pedidos entregues ou cancelados não podem ser reembolsados",
  REFUND_REQUER_FLUXO_COMANDA:
    "Reembolsos de uma comanda aberta devem ser feitos pelo cancelamento ou troca do item correspondente.",
  PAGAMENTO_NAO_ENCONTRADO: "Pagamento não encontrado ou não confirmado",
  METODO_NAO_REEMBOLSAVEL_MANUALMENTE:
    "O método deste pagamento não permite registrar estorno manual",
  VALOR_INVALIDO: "Valor inválido",
  SALDO_REEMBOLSAVEL_INSUFICIENTE:
    "O saldo reembolsável mudou antes da confirmação. Atualize e tente novamente.",
  REFUND_PIX_MP_REMOTO_EM_ANDAMENTO:
    "Existe um estorno Mercado Pago em andamento para este pagamento.",
  ...OPERACAO_MENSAGENS,
};

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: ReembolsoInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (!Number.isInteger(body.pagamentoId) || body.pagamentoId! <= 0) {
    return jsonError("Pagamento inválido", 400);
  }
  if (!Number.isInteger(body.valorCentavos) || body.valorCentavos! <= 0) {
    return jsonError("Valor inválido", 400);
  }

  // A1: obrigatória. Um refund duplicado registra uma devolução que não
  // aconteceu — é o caso mais sensível junto com o pagamento manual.
  const chave = parseOperationKey(body.operationKey);
  if (!chave.ok) {
    return jsonError(MENSAGENS.OPERATION_KEY_INVALIDA, 400, chave.erro);
  }

  try {
    const resultado = await registerManualRefund(env.DB, {
      pedidoId: id,
      pagamentoId: body.pagamentoId!,
      valorCentavos: body.valorCentavos!,
      usuarioId: auth.user.id,
      motivo: body.motivo,
      operationKey: chave.key,
    });

    if (!resultado.ok) {
      const status =
        resultado.erro === "PEDIDO_NAO_ENCONTRADO"
          ? 404
          : OPERACAO_HTTP_STATUS[resultado.erro ?? ""] ?? 409;
      return jsonError(
        MENSAGENS[resultado.erro ?? ""] ?? "Não foi possível registrar o reembolso",
        status,
        resultado.erro,
      );
    }

    return Response.json(
      {
        ok: true,
        reembolsoId: resultado.reembolsoId,
        statusFinanceiro: resultado.statusFinanceiro,
        saldoCentavos: resultado.saldoCentavos,
        ...(resultado.replay ? { replay: true } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Erro ao registrar reembolso manual (admin)", err);
    return jsonError("Erro interno ao registrar reembolso", 500);
  }
};
