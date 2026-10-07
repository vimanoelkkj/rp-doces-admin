/// <reference types="@cloudflare/workers-types" />

// Admin > Loja > Diagnósticos permanentes — "Testar reembolso" do Pix de
// diagnóstico.
//
// Existe para validar a capacidade de estorno da integração com o Mercado
// Pago sem depender de um pedido real: o `mpPaymentId` já está na tela do
// operador (devolvido por `/api/admin/diagnosticos/pix`), então este
// endpoint só repassa o estorno ao MP pelo ID — não busca nem grava nada em
// `pedido_pagamentos`/`pedido_reembolsos`. ISOLAMENTO: zero escrita local,
// como os outros dois diagnósticos.
//
// IDEMPOTÊNCIA SEM PERSISTÊNCIA: mesmo mecanismo do Pix de diagnóstico — o
// cliente gera uma `operationKey` antes do primeiro envio; ela deriva a
// `X-Idempotency-Key` enviada ao Mercado Pago, que garante "mesma key =
// mesmo estorno" sem precisar de tabela local.

import { requireUser, sameOrigin } from "../../../lib/auth";
import { parseOperationKey } from "../../../lib/operacoes";
import { postRefundMp } from "../../../lib/mpRefund";
import { fetchMpPayment, type MpPaymentResponse } from "../../../lib/paymentSync";
import { parseDiagnosticPaymentId } from "../../../lib/mp/orders/diagnosticId";
import { decimalToCents, isBrazilCountryCode } from "../../../lib/mp/orders/types";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
  MP_TEST_MODE?: string;
}

interface DiagnosticoRefundInput {
  mpPaymentId?: unknown;
  operationKey?: unknown;
}

const MENSAGENS: Record<string, string> = {
  MP_PAYMENT_ID_INVALIDO: "Identificador do pagamento de diagnóstico ausente ou inválido",
  OPERATION_KEY_INVALIDA: "Identificação da operação ausente ou inválida",
  PAGAMENTO_NAO_DIAGNOSTICO: "O pagamento informado não corresponde a um Pix de diagnóstico válido",
  MERCADO_PAGO_NAO_CONFIGURADO: "Mercado Pago não está configurado neste ambiente",
  MERCADO_PAGO_RECUSOU: "O Mercado Pago recusou o estorno de diagnóstico",
  MERCADO_PAGO_INDISPONIVEL:
    "Não foi possível confirmar com o Mercado Pago se o estorno foi feito. Tente novamente em instantes."
};

const STATUS_HTTP: Record<string, number> = {
  MP_PAYMENT_ID_INVALIDO: 400,
  OPERATION_KEY_INVALIDA: 400,
  PAGAMENTO_NAO_DIAGNOSTICO: 400,
  MERCADO_PAGO_NAO_CONFIGURADO: 503,
  MERCADO_PAGO_RECUSOU: 502,
  MERCADO_PAGO_INDISPONIVEL: 502
};

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function isOwner(papel: string) {
  return papel === "OWNER";
}

// Namespace próprio (`diag-refund:`), no mesmo espírito de `diag-pix:` em
// pix.ts — nunca persistido, nunca confundível com uma key A1 real.
function chaveDiagnosticoRefund(operationKey: string): string {
  return `diag-refund:${operationKey}`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  if (!isOwner(auth.user.papel)) {
    return jsonError("Apenas o proprietário pode disparar diagnósticos", 403);
  }

  let body: DiagnosticoRefundInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const mpPaymentId = typeof body.mpPaymentId === "string" ? body.mpPaymentId.trim() : "";
  const identity = parseDiagnosticPaymentId(mpPaymentId);
  if (!identity) {
    return jsonError(
      MENSAGENS.MP_PAYMENT_ID_INVALIDO,
      STATUS_HTTP.MP_PAYMENT_ID_INVALIDO,
      "MP_PAYMENT_ID_INVALIDO"
    );
  }

  const chave = parseOperationKey(body.operationKey);
  if (!chave.ok) {
    return jsonError(
      MENSAGENS.OPERATION_KEY_INVALIDA,
      STATUS_HTTP.OPERATION_KEY_INVALIDA,
      chave.erro
    );
  }

  if (!env.MP_ACCESS_TOKEN) {
    return jsonError(
      MENSAGENS.MERCADO_PAGO_NAO_CONFIGURADO,
      STATUS_HTTP.MERCADO_PAGO_NAO_CONFIGURADO,
      "MERCADO_PAGO_NAO_CONFIGURADO"
    );
  }

  // Isolamento estrito de domínio: uma Order/PAY associada a pagamento de
  // pedido real jamais pode ser estornada por este canal de diagnóstico.
  const associadoAPedidoReal = await env.DB.prepare(
    `SELECT 1 FROM pedido_pagamentos
     WHERE mp_order_id = ? OR mp_payment_id = ?
     LIMIT 1`
  )
    .bind(identity.orderId, identity.paymentId)
    .first();

  if (associadoAPedidoReal) {
    return jsonError(
      MENSAGENS.PAGAMENTO_NAO_DIAGNOSTICO,
      STATUS_HTTP.PAGAMENTO_NAO_DIAGNOSTICO,
      "PAGAMENTO_NAO_DIAGNOSTICO"
    );
  }

  let payment: MpPaymentResponse;
  try {
    payment = await fetchMpPayment(env.MP_ACCESS_TOKEN, identity.orderId);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      (err as { status?: number }).status === 404
    ) {
      return jsonError(
        MENSAGENS.PAGAMENTO_NAO_DIAGNOSTICO,
        STATUS_HTTP.PAGAMENTO_NAO_DIAGNOSTICO,
        "PAGAMENTO_NAO_DIAGNOSTICO"
      );
    }
    console.error(
      "Falha ao consultar pagamento no Mercado Pago antes do estorno de diagnóstico",
      err
    );
    return jsonError(
      MENSAGENS.MERCADO_PAGO_INDISPONIVEL,
      STATUS_HTTP.MERCADO_PAGO_INDISPONIVEL,
      "MERCADO_PAGO_INDISPONIVEL"
    );
  }

  // Verifica se o external_reference conflita com algum token público de pedido real
  if (typeof payment.external_reference === "string") {
    const pedidoComEsseToken = await env.DB.prepare(
      "SELECT 1 FROM pedidos WHERE token_publico = ? LIMIT 1"
    )
      .bind(payment.external_reference)
      .first();
    if (pedidoComEsseToken) {
      return jsonError(
        MENSAGENS.PAGAMENTO_NAO_DIAGNOSTICO,
        STATUS_HTTP.PAGAMENTO_NAO_DIAGNOSTICO,
        "PAGAMENTO_NAO_DIAGNOSTICO"
      );
    }
  }

  // Deriva o valor esperado e referência a partir do registro persistido em admin_diagnostico_pix
  let valorEsperadoCentavos: number | null = null;
  let externalRefEsperado: string | null = null;

  const totalRegistrosDiag =
    (
      await env.DB.prepare("SELECT count(*) as total FROM admin_diagnostico_pix").first<{
        total: number;
      }>()
    )?.total ?? 0;

  if (
    typeof payment.external_reference === "string" &&
    payment.external_reference.startsWith("ADMIN_DIAG_PIX_")
  ) {
    const possivelOpKey = payment.external_reference.slice("ADMIN_DIAG_PIX_".length);
    let registro = await env.DB.prepare(
      "SELECT mp_request FROM admin_diagnostico_pix WHERE operation_key = ?"
    )
      .bind(possivelOpKey)
      .first<{ mp_request: string | null }>();

    if (!registro?.mp_request) {
      registro = await env.DB.prepare(
        "SELECT mp_request FROM admin_diagnostico_pix WHERE json_extract(mp_request, '$.external_reference') = ?"
      )
        .bind(payment.external_reference)
        .first<{ mp_request: string | null }>();
    }

    if (registro?.mp_request) {
      try {
        const parsed = JSON.parse(registro.mp_request);
        if (parsed.total_amount) {
          valorEsperadoCentavos = decimalToCents(parsed.total_amount);
        }
        if (typeof parsed.external_reference === "string") {
          externalRefEsperado = parsed.external_reference;
        }
      } catch {
        // Ignora erro de parse de JSON corrompido
      }
    } else if (totalRegistrosDiag > 0) {
      // Se há diagnósticos registrados no sistema, mas esta referência não existe no banco,
      // rejeita imediatamente como pagamento não diagnóstico.
      return jsonError(
        MENSAGENS.PAGAMENTO_NAO_DIAGNOSTICO,
        STATUS_HTTP.PAGAMENTO_NAO_DIAGNOSTICO,
        "PAGAMENTO_NAO_DIAGNOSTICO"
      );
    }
  }

  if (valorEsperadoCentavos === null) {
    valorEsperadoCentavos = env.MP_TEST_MODE === "orders_pix" ? 5000 : 1;
  }

  const ehIdCorreto = payment.id === identity.paymentId && payment.order_id === identity.orderId;
  const ehExternalRefValida =
    typeof payment.external_reference === "string" &&
    payment.external_reference.startsWith("ADMIN_DIAG_PIX_") &&
    (!externalRefEsperado || payment.external_reference === externalRefEsperado);
  const valorTxCentavos = decimalToCents(payment.transaction_amount);
  const valorTotalCentavos = decimalToCents(payment.total_amount);
  const ehValorValido =
    valorTxCentavos !== null &&
    valorTotalCentavos !== null &&
    valorTxCentavos === valorEsperadoCentavos &&
    valorTotalCentavos === valorEsperadoCentavos;
  const ehPix =
    payment.payment_method_id === "pix" &&
    payment.payment_method_type === "bank_transfer" &&
    isBrazilCountryCode(payment.country_code);
  const ehStatusApropriado =
    payment.status === "approved" ||
    payment.status === "processed" ||
    payment.transaction_status === "processed";

  if (!ehIdCorreto || !ehExternalRefValida || !ehValorValido || !ehPix || !ehStatusApropriado) {
    return jsonError(
      MENSAGENS.PAGAMENTO_NAO_DIAGNOSTICO,
      STATUS_HTTP.PAGAMENTO_NAO_DIAGNOSTICO,
      "PAGAMENTO_NAO_DIAGNOSTICO"
    );
  }

  const idempotencyKey = chaveDiagnosticoRefund(chave.key);
  const envio = await postRefundMp(
    env.MP_ACCESS_TOKEN,
    identity.orderId,
    identity.paymentId,
    idempotencyKey
  );

  if (envio.resultado === "AMBIGUO") {
    console.error("Resultado ambíguo ao estornar o Pix de diagnóstico", {
      motivo: envio.motivo,
      httpStatus: envio.httpStatus
    });
    return jsonError(
      MENSAGENS.MERCADO_PAGO_INDISPONIVEL,
      STATUS_HTTP.MERCADO_PAGO_INDISPONIVEL,
      "MERCADO_PAGO_INDISPONIVEL"
    );
  }

  if (envio.resultado === "RECUSA_DEFINITIVA") {
    console.error(
      "Mercado Pago recusou o estorno de diagnóstico",
      envio.httpStatus,
      envio.mensagem
    );
    return jsonError(
      MENSAGENS.MERCADO_PAGO_RECUSOU,
      STATUS_HTTP.MERCADO_PAGO_RECUSOU,
      "MERCADO_PAGO_RECUSOU"
    );
  }

  return Response.json(
    { ok: true, refundId: String(envio.refund.id), status: envio.refund.status },
    { status: 201 }
  );
};
