/// <reference types="@cloudflare/workers-types" />

// Passo 6: webhook do Mercado Pago (Payments API). Nunca aplica o payload
// recebido diretamente — só usa `data.id` para decidir o que reconsultar
// fresco em /v1/payments/:id, e delega toda a decisão de transição ao
// helper central `syncPaymentFromMp` (mesmo caminho usado pela
// reconciliação oportunista do admin e pelo polling público).

import { fetchMpPayment, resolveWebhookPayment, syncPaymentFromMp, validateMpWebhookSignature } from "../../lib/paymentSync";

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
  const dataId =
    url.searchParams.get("data.id") || url.searchParams.get("data_id") || getBodyDataId(body);

  const type = String(
    url.searchParams.get("type") || url.searchParams.get("topic") || body?.type || body?.topic || "",
  ).toLowerCase();

  const secret = String(env.MP_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    console.error("MP_WEBHOOK_SECRET não configurado");
    return Response.json({ erro: "Webhook não configurado." }, { status: 503 });
  }

  const valid = await validateMpWebhookSignature(request, secret, dataId);
  if (!valid) {
    return Response.json({ erro: "Assinatura inválida." }, { status: 401 });
  }

  const supportedType = !type || type === "payment" || type === "payments";
  if (!dataId || !supportedType) {
    return ok();
  }

  try {
    let payment;
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
        external_reference: payment.external_reference || null,
      });
      return ok();
    }

    await syncPaymentFromMp(env.DB, resolved.pagamentoId, payment);

    return ok();
  } catch (err) {
    console.error("Erro ao sincronizar webhook do Mercado Pago", err);
    return Response.json({ erro: "Falha ao sincronizar pagamento." }, { status: 502 });
  }
};
