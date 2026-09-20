/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../lib/auth";
import { createAdminPixCharge } from "../../../../lib/comandaPix";
import {
  OPERACAO_HTTP_STATUS,
  OPERACAO_MENSAGENS,
  parseOperationKey,
} from "../../../../lib/operacoes";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface GerarPixInput {
  valorCentavos?: number;
  substituiId?: number;
  operationKey?: string;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

const MENSAGENS: Record<string, string> = {
  PEDIDO_NAO_ENCONTRADO: "Pedido não encontrado",
  COMANDA_ENCERRADA: "Esta comanda já foi encerrada",
  VALOR_INVALIDO: "Valor inválido",
  CAPACIDADE_INSUFICIENTE: "Valor acima da capacidade disponível para novas cobranças Pix",
  PIX_PARA_SUBSTITUIR_INVALIDO:
    "O Pix informado para substituir não está mais disponível (já foi substituído, pago ou não pertence a este pedido)",
  ESTOQUE_INSUFICIENTE: "Um ou mais itens não possuem estoque suficiente disponível.",
  MERCADO_PAGO_RECUSOU: "O Mercado Pago recusou o pagamento Pix",
  MERCADO_PAGO_INDISPONIVEL:
    "Não foi possível confirmar com o Mercado Pago se o Pix foi criado. Verifique novamente em instantes.",
  ...OPERACAO_MENSAGENS,
};

const STATUS_HTTP: Record<string, number> = {
  PEDIDO_NAO_ENCONTRADO: 404,
  COMANDA_ENCERRADA: 409,
  VALOR_INVALIDO: 400,
  CAPACIDADE_INSUFICIENTE: 409,
  PIX_PARA_SUBSTITUIR_INVALIDO: 409,
  ESTOQUE_INSUFICIENTE: 409,
  MERCADO_PAGO_RECUSOU: 502,
  MERCADO_PAGO_INDISPONIVEL: 502,
  ...OPERACAO_HTTP_STATUS,
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: GerarPixInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (
    body.valorCentavos !== undefined &&
    (!Number.isSafeInteger(body.valorCentavos) || body.valorCentavos <= 0)
  ) {
    return jsonError("Valor inválido", 400);
  }
  if (
    body.substituiId !== undefined &&
    (!Number.isSafeInteger(body.substituiId) || body.substituiId <= 0)
  ) {
    return jsonError("Id do Pix a substituir inválido", 400);
  }

  // A1: obrigatória. Sem ela, um retry de "Gerar Pix"/"Regenerar" criaria
  // outra cobrança pagável com outra identidade no Mercado Pago.
  const chave = parseOperationKey(body.operationKey);
  if (!chave.ok) {
    return jsonError(MENSAGENS.OPERATION_KEY_INVALIDA, 400, chave.erro);
  }

  try {
    const resultado = await createAdminPixCharge(env, {
      pedidoId: id,
      valorCentavos: body.valorCentavos,
      usuarioId: auth.user.id,
      substituiId: body.substituiId,
      operationKey: chave.key,
    });

    if (!resultado.ok) {
      return jsonError(
        MENSAGENS[resultado.erro] ?? "Não foi possível gerar o Pix",
        STATUS_HTTP[resultado.erro] ?? 500,
        resultado.erro,
      );
    }

    return Response.json(
      {
        ok: true,
        pagamentoId: resultado.pagamentoId,
        valorCentavos: resultado.valorCentavos,
        mpPaymentId: resultado.mpPaymentId,
        status: resultado.mpStatus,
        qrCode: resultado.qrCode,
        qrCodeBase64: resultado.qrCodeBase64,
        ticketUrl: resultado.ticketUrl,
        expiresAt: resultado.expiresAt,
        ...(resultado.replay ? { replay: true } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Erro ao gerar Pix administrativo", err);
    return jsonError("Erro interno ao gerar Pix", 500);
  }
};
