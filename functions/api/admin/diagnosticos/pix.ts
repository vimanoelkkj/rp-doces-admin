import {
  decimalToCents,
  orderIdempotencyKey,
  type PixOrderBody
} from "../../../lib/mp/orders/types";
import {
  diagnosticPaymentId,
  diagnosticExternalReference,
  createDiagnosticPixOrderBody
} from "../../../lib/mp/orders/diagnosticId";

// Admin > Loja > Diagnósticos permanentes — "Pix real de diagnóstico".
//
// Generates a R$ 0.01 diagnostic Pix through Mercado Pago Orders API.
// (mesma integração/credenciais do resto do projeto — reaproveita
// `postPagamentoMp`, o helper de A1 que já classifica sucesso, recusa
// definitiva e resultado ambíguo, sem duplicar essa lógica) para confirmar
// que a integração bancária está de pé.
//
// ISOLAMENTO DELIBERADO: este endpoint NUNCA escreve em tabelas de vendas,
// estoque ou faturamento. Não cria pedido, não cria linha em `pedido_pagamentos`,
// não toca `produtos` nem `pedido_operacoes`. Sem escrita no domínio de vendas,
// é estruturalmente impossível que o diagnóstico apareça na listagem de pedidos,
// altere estoque ou polua o Dashboard.
//
// IDEMPOTÊNCIA DURÁVEL: a `operationKey` gerada pelo cliente é preservada durante
// retries da mesma tentativa. Para evitar HTTP 409 na Orders API por divergência
// de timestamp/payload em retries, a expiração e o body original são estabilizados
// na tabela isolada `admin_diagnostico_pix` (migration 0038). A key deriva a
// `X-Idempotency-Key` e assegura body estritamente idêntico em todas as tentativas.
//
// NUNCA finge sucesso: resultado ambíguo (timeout, 5xx, transporte) e
// recusa definitiva são devolvidos como erro explícito ao operador, nunca
// como um QR Code inventado.

import { requireUser, sameOrigin } from "../../../lib/auth";
import { parseOperationKey } from "../../../lib/operacoes";
import { postPagamentoMp } from "../../../lib/mpPost";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
  MP_TEST_MODE?: string;
}

interface DiagnosticoPixInput {
  operationKey?: unknown;
}

const VALOR_DIAGNOSTICO_CENTAVOS = 1;
const PIX_EXPIRATION_MINUTES = 30;

const MENSAGENS: Record<string, string> = {
  OPERATION_KEY_INVALIDA: "Identificação da operação ausente ou inválida",
  MERCADO_PAGO_NAO_CONFIGURADO: "Mercado Pago não está configurado neste ambiente",
  MERCADO_PAGO_RECUSOU: "O Mercado Pago recusou o Pix de diagnóstico",
  MERCADO_PAGO_INDISPONIVEL:
    "Não foi possível confirmar com o Mercado Pago se o Pix foi criado. Tente novamente em instantes."
};

const STATUS_HTTP: Record<string, number> = {
  OPERATION_KEY_INVALIDA: 400,
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

// Namespace próprio (`diag-pix:`), deliberadamente diferente do `a1:` usado
// pelas operações reais em `functions/lib/operacoes.ts` — este Pix nunca é
// persistido nem tem replay via `pedido_operacoes`, então marcá-lo como uma
// key A1 seria enganoso em qualquer auditoria futura.
function chaveDiagnosticoMp(operationKey: string): string {
  return `diag-pix:${operationKey}`;
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

  let body: DiagnosticoPixInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
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

  const idempotencyKey = await orderIdempotencyKey(chaveDiagnosticoMp(chave.key));

  // Idempotência durável: reutiliza a expiração e o body calculados na primeira tentativa
  // para garantir que retries da mesma operação lógica enviem exatamente a mesma
  // X-Idempotency-Key e o mesmo body (evitando HTTP 409 na Orders API).
  const registroExistente = await env.DB.prepare(
    "SELECT expires_at, mp_request FROM admin_diagnostico_pix WHERE operation_key = ?"
  )
    .bind(chave.key)
    .first<{ expires_at: string; mp_request: string | null }>();

  let expiresAtEstimado: string;
  let mpRequest: PixOrderBody;

  if (registroExistente?.expires_at) {
    expiresAtEstimado = registroExistente.expires_at;
    if (registroExistente.mp_request) {
      try {
        mpRequest = JSON.parse(registroExistente.mp_request);
      } catch {
        mpRequest = await createDiagnosticPixOrderBody(
          await diagnosticExternalReference(chave.key),
          env.MP_TEST_MODE
        );
      }
    } else {
      mpRequest = await createDiagnosticPixOrderBody(
        await diagnosticExternalReference(chave.key),
        env.MP_TEST_MODE
      );
    }
  } else {
    expiresAtEstimado = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000).toISOString();
    mpRequest = await createDiagnosticPixOrderBody(
      await diagnosticExternalReference(chave.key),
      env.MP_TEST_MODE
    );

    await env.DB.prepare(
      `INSERT INTO admin_diagnostico_pix (operation_key, expires_at, mp_request)
         VALUES (?, ?, ?)
         ON CONFLICT (operation_key) DO NOTHING`
    )
      .bind(chave.key, expiresAtEstimado, JSON.stringify(mpRequest))
      .run();

    // Guarda de concorrência: se outro worker inseriu primeiro em corrida atômica,
    // garantimos o reaproveitamento do registro vencedor.
    const registroDefinitivo = await env.DB.prepare(
      "SELECT expires_at, mp_request FROM admin_diagnostico_pix WHERE operation_key = ?"
    )
      .bind(chave.key)
      .first<{ expires_at: string; mp_request: string | null }>();

    if (registroDefinitivo?.expires_at && registroDefinitivo.expires_at !== expiresAtEstimado) {
      expiresAtEstimado = registroDefinitivo.expires_at;
      if (registroDefinitivo.mp_request) {
        try {
          mpRequest = JSON.parse(registroDefinitivo.mp_request);
        } catch {
          mpRequest = await createDiagnosticPixOrderBody(
            await diagnosticExternalReference(chave.key),
            env.MP_TEST_MODE
          );
        }
      }
    }
  }

  const envio = await postPagamentoMp(env.MP_ACCESS_TOKEN, idempotencyKey, mpRequest);

  if (envio.resultado === "AMBIGUO") {
    // Nunca vira sucesso nem rejeição inventados — só o erro explícito.
    // Log estritamente sanitizado: apenas código de erro do MP / motivo, status HTTP e x-request-id
    console.error("Resultado ambíguo ao gerar Pix de diagnóstico", {
      httpStatus: envio.httpStatus,
      motivo: envio.motivo,
      requestId: envio.requestId ?? null
    });
    return jsonError(
      MENSAGENS.MERCADO_PAGO_INDISPONIVEL,
      STATUS_HTTP.MERCADO_PAGO_INDISPONIVEL,
      "MERCADO_PAGO_INDISPONIVEL"
    );
  }

  if (envio.resultado === "RECUSA_DEFINITIVA") {
    // Log estritamente sanitizado: apenas código de erro do MP, status HTTP e x-request-id
    console.error("Mercado Pago recusou o Pix de diagnóstico", {
      httpStatus: envio.httpStatus,
      mensagem: envio.mensagem,
      requestId: envio.requestId ?? null
    });
    return jsonError(
      MENSAGENS.MERCADO_PAGO_RECUSOU,
      STATUS_HTTP.MERCADO_PAGO_RECUSOU,
      "MERCADO_PAGO_RECUSOU"
    );
  }

  const payment = envio.payment;
  const txData = payment.point_of_interaction?.transaction_data;
  const valorCentavos = decimalToCents(mpRequest.total_amount) ?? VALOR_DIAGNOSTICO_CENTAVOS;
  const modoSimulador = env.MP_TEST_MODE === "orders_pix";

  return Response.json(
    {
      ok: true,
      valorCentavos,
      modoSimulador,
      mpPaymentId: diagnosticPaymentId(payment.order_id, payment.id),
      qrCode: txData?.qr_code ?? null,
      qrCodeBase64: txData?.qr_code_base64 ?? null,
      ticketUrl: txData?.ticket_url ?? null,
      expiresAt: payment.date_of_expiration
    },
    { status: 201 }
  );
};
