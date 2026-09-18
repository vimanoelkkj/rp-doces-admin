/// <reference types="@cloudflare/workers-types" />

// Admin > Loja > Diagnósticos permanentes — "Pix real de diagnóstico".
//
// Gera uma cobrança Pix REAL de R$ 0,01 na Payments API do Mercado Pago
// (mesma integração/credenciais do resto do projeto — reaproveita
// `postPagamentoMp`, o helper de A1 que já classifica sucesso, recusa
// definitiva e resultado ambíguo, sem duplicar essa lógica) para confirmar
// que a integração bancária está de pé.
//
// ISOLAMENTO DELIBERADO: este endpoint NUNCA escreve no banco. Não cria
// pedido, não cria linha em `pedido_pagamentos`, não toca `produtos` nem
// `pedido_operacoes`. Sem escrita local, é estruturalmente impossível que o
// diagnóstico apareça na listagem de pedidos, altere estoque ou polua o
// Dashboard — essas telas leem tabelas que este endpoint nunca grava.
//
// IDEMPOTÊNCIA SEM PERSISTÊNCIA: o cliente gera uma `operationKey` (mesmo
// helper de A1, `parseOperationKey`) antes do primeiro envio e a preserva
// enquanto durar a MESMA tentativa (retry). A key deriva a
// `X-Idempotency-Key` enviada ao Mercado Pago — é o próprio provedor que
// garante "mesma key = mesmo recurso", exatamente o mecanismo que a
// Payments API já oferece e que o projeto já usa em todos os outros
// writers. Não é preciso uma tabela local para isso: não há pedido/reserva
// para proteger, só um clique administrativo de baixíssimo risco.
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
    "Não foi possível confirmar com o Mercado Pago se o Pix foi criado. Tente novamente em instantes.",
};

const STATUS_HTTP: Record<string, number> = {
  OPERATION_KEY_INVALIDA: 400,
  MERCADO_PAGO_NAO_CONFIGURADO: 503,
  MERCADO_PAGO_RECUSOU: 502,
  MERCADO_PAGO_INDISPONIVEL: 502,
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
    return jsonError(MENSAGENS.OPERATION_KEY_INVALIDA, STATUS_HTTP.OPERATION_KEY_INVALIDA, chave.erro);
  }

  if (!env.MP_ACCESS_TOKEN) {
    return jsonError(
      MENSAGENS.MERCADO_PAGO_NAO_CONFIGURADO,
      STATUS_HTTP.MERCADO_PAGO_NAO_CONFIGURADO,
      "MERCADO_PAGO_NAO_CONFIGURADO",
    );
  }

  const idempotencyKey = chaveDiagnosticoMp(chave.key);
  const expiresAtEstimado = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60 * 1000).toISOString();

  const mpRequest = {
    transaction_amount: VALOR_DIAGNOSTICO_CENTAVOS / 100,
    description: "Diagnóstico R&P Doces (não é um pedido)",
    payment_method_id: "pix",
    date_of_expiration: expiresAtEstimado,
    // Referência estruturalmente distinta de token_publico/idempotency_key
    // de tentativas reais: nunca resolve por engano em `resolveWebhookPayment`
    // caso o evento chegue pelo webhook (cai em "not_found", sem efeito).
    external_reference: `ADMIN_DIAG_PIX:${chave.key}`,
    payer: { email: "diagnostico@rpdoces.com.br", first_name: "Diagnostico" },
  };

  const envio = await postPagamentoMp(env.MP_ACCESS_TOKEN, idempotencyKey, mpRequest);

  if (envio.resultado === "AMBIGUO") {
    // Nunca vira sucesso nem rejeição inventados — só o erro explícito.
    console.error("Resultado ambíguo ao gerar Pix de diagnóstico", {
      motivo: envio.motivo,
      httpStatus: envio.httpStatus,
    });
    return jsonError(
      MENSAGENS.MERCADO_PAGO_INDISPONIVEL,
      STATUS_HTTP.MERCADO_PAGO_INDISPONIVEL,
      "MERCADO_PAGO_INDISPONIVEL",
    );
  }

  if (envio.resultado === "RECUSA_DEFINITIVA") {
    // `mensagem`/`detalhe` são a explicação do MP sobre a REQUISIÇÃO
    // recusada (ex.: parâmetro inválido) — nunca QR/copia-e-cola/token.
    console.error("Mercado Pago recusou o Pix de diagnóstico", envio.httpStatus, envio.mensagem);
    return jsonError(
      MENSAGENS.MERCADO_PAGO_RECUSOU,
      STATUS_HTTP.MERCADO_PAGO_RECUSOU,
      "MERCADO_PAGO_RECUSOU",
    );
  }

  const payment = envio.payment;
  const txData = payment.point_of_interaction?.transaction_data;

  return Response.json(
    {
      ok: true,
      valorCentavos: VALOR_DIAGNOSTICO_CENTAVOS,
      mpPaymentId: String(payment.id),
      qrCode: txData?.qr_code ?? null,
      qrCodeBase64: txData?.qr_code_base64 ?? null,
      ticketUrl: txData?.ticket_url ?? null,
      expiresAt: payment.date_of_expiration,
    },
    { status: 201 },
  );
};
