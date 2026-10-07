/// <reference types="@cloudflare/workers-types" />

// Mercado Pago Orders webhook. Never applies the received payload directly.
// recebido diretamente — só usa `data.id` para decidir o que reconsultar
// GET /v1/orders/:id supplies authority; the shared transition core decides.
// helper central `syncPaymentFromMp` (mesmo caminho usado pela
// reconciliação oportunista do admin e pelo polling público).

import {
  fetchMpPayment,
  type MpPaymentResponse,
  resolveWebhookPayment,
  syncPaymentFromMp,
  validateMpWebhookSignature
} from "../../lib/paymentSync";
import { requestLogger } from "../../lib/requestContext";
import { describeWebhookSignatureInput } from "../../lib/mpWebhookSignatureShape";

// Mesmo formato que fetchMpOrder exige; qualquer outro id não tem o que consultar.
const ORDER_ID_PATTERN = /^ORD[A-Za-z0-9]+$/;

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
  MP_WEBHOOK_SECRET?: string;
}

interface WebhookBody {
  type?: string;
  topic?: string;
  data?: { id?: string | number };
  data_id?: string | number;
  id?: string | number;
}

function ok() {
  return Response.json({ ok: true });
}

function getBodyDataId(body: WebhookBody | null): string {
  const value = body?.data?.id ?? body?.data_id ?? body?.id ?? null;
  return value === null || value === undefined ? "" : String(value);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: WebhookBody | null = null;
  try {
    body = await request.clone().json();
  } catch {
    body = null;
  }

  const url = new URL(request.url);
  const queryDataId = url.searchParams.get("data.id");
  const queryDataIdLegacy = url.searchParams.get("data_id");
  // O corpo só é consultado sem data.id na query, como antes.
  const bodyDataId = queryDataId || queryDataIdLegacy ? "" : getBodyDataId(body);
  const dataId = queryDataId || queryDataIdLegacy || bodyDataId;

  const type = String(
    url.searchParams.get("type") || url.searchParams.get("topic") || body?.type || body?.topic || ""
  ).toLowerCase();

  const secret = String(env.MP_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    console.error("MP_WEBHOOK_SECRET não configurado");
    return Response.json({ erro: "Webhook não configurado." }, { status: 503 });
  }

  const valid = await validateMpWebhookSignature(request, secret, dataId);
  if (!valid) {
    // Diagnóstico temporário do 401: só a estrutura da entrada, nunca valores.
    const dataIdSource = queryDataId
      ? "query-data.id"
      : queryDataIdLegacy
        ? "query-data_id"
        : bodyDataId
          ? "body"
          : "none";
    requestLogger.warnMeta("Webhook do Mercado Pago: assinatura inválida", {
      httpStatus: 401,
      webhookSignature: describeWebhookSignatureInput(request, dataId, dataIdSource)
    });
    return Response.json({ erro: "Assinatura inválida." }, { status: 401 });
  }

  const supportedType = type === "order";
  if (!dataId || !supportedType) {
    return ok();
  }

  // Assinatura já validada acima. O simulador oficial do MP assina `type=order` com um data.id
  // fictício (ex.: "123456"): sem formato de ORD não há o que consultar e fetchMpOrder lançaria
  // ORDER_ID_INVALIDO (502). Responde 200 sem GET e sem efeito. O aviso (só status e código fixo,
  // nunca o valor recebido) evita que um id real fora do formato seja ignorado em silêncio.
  if (!ORDER_ID_PATTERN.test(dataId)) {
    requestLogger.warnMeta("Webhook do Mercado Pago ignorado: data.id fora do formato Orders", {
      httpStatus: 200,
      code: "ORDER_ID_FORMAT_INVALID"
    });
    return ok();
  }

  try {
    let payment: MpPaymentResponse;
    try {
      payment = await fetchMpPayment(env.MP_ACCESS_TOKEN, dataId);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) return ok();
      throw err;
    }

    const resolved = await resolveWebhookPayment(env.DB, payment);
    if (resolved.kind === "not_found") return ok();
    if (resolved.kind === "ambiguous") {
      console.error("Webhook do Mercado Pago: pagamento ambíguo, nenhuma linha alterada", {
        mp_payment_id: String(payment.id),
        external_reference: payment.external_reference || null
      });
      return ok();
    }

    await syncPaymentFromMp(env.DB, resolved.pagamentoId, payment, env);

    return ok();
  } catch (err) {
    console.error("Erro ao sincronizar webhook do Mercado Pago", err);
    return Response.json({ erro: "Falha ao sincronizar pagamento." }, { status: 502 });
  }
};
