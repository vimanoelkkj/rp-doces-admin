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
import {
  requestLogger,
  webhookMpStatus,
  type WebhookOutcome,
  type WebhookResultMeta
} from "../../lib/requestContext";
import {
  type WebhookDataIdSource,
  dataIdFormat,
  describeWebhookSignatureInput
} from "../../lib/mpWebhookSignatureShape";

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

// Um resultado estruturado por requisição tratada. Só enums fechados e booleanos de estrutura
// (nunca secret, assinatura, ids recebidos, corpo ou dados do pagador). Nenhuma falha do registro
// pode alterar a resposta. A ausência desta linha NÃO prova ausência de entrega: só vale como
// evidência com coleta de logs comprovadamente ativa e contínua.
function finish(
  response: Response,
  outcome: WebhookOutcome,
  observed: { request: Request; dataId: string; dataIdSource: WebhookDataIdSource },
  extra: Omit<WebhookResultMeta, "outcome" | "dataIdFormat"> = {}
): Response {
  try {
    requestLogger.infoMeta("WEBHOOK_MP_RESULTADO", {
      httpStatus: response.status,
      webhookResult: { outcome, dataIdFormat: dataIdFormat(observed.dataId), ...extra },
      webhookSignature: describeWebhookSignatureInput(
        observed.request,
        observed.dataId,
        observed.dataIdSource
      )
    });
  } catch {
    // Observabilidade nunca altera a resposta do webhook.
  }
  return response;
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

  const dataIdSource: WebhookDataIdSource = queryDataId
    ? "query-data.id"
    : queryDataIdLegacy
      ? "query-data_id"
      : bodyDataId
        ? "body"
        : "none";
  const observed = { request, dataId, dataIdSource };

  const type = String(
    url.searchParams.get("type") || url.searchParams.get("topic") || body?.type || body?.topic || ""
  ).toLowerCase();

  const secret = String(env.MP_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    console.error("MP_WEBHOOK_SECRET não configurado");
    return finish(
      Response.json({ erro: "Webhook não configurado." }, { status: 503 }),
      "SEM_SEGREDO",
      observed
    );
  }

  const valid = await validateMpWebhookSignature(request, secret, dataId);
  if (!valid) {
    // Diagnóstico temporário do 401: só a estrutura da entrada, nunca valores.
    requestLogger.warnMeta("Webhook do Mercado Pago: assinatura inválida", {
      httpStatus: 401,
      webhookSignature: describeWebhookSignatureInput(request, dataId, dataIdSource)
    });
    return finish(
      Response.json({ erro: "Assinatura inválida." }, { status: 401 }),
      "ASSINATURA_INVALIDA",
      observed
    );
  }

  const supportedType = type === "order";
  if (!dataId || !supportedType) {
    return finish(ok(), !supportedType ? "IGNORADO_TIPO" : "IGNORADO_SEM_ID", observed);
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
    return finish(ok(), "IGNORADO_ID_FORA_DO_FORMATO", observed);
  }

  try {
    let payment: MpPaymentResponse;
    try {
      payment = await fetchMpPayment(env.MP_ACCESS_TOKEN, dataId);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) return finish(ok(), "IGNORADO_MP_404", observed);
      throw err;
    }

    const resolved = await resolveWebhookPayment(env.DB, payment);
    const mpStatus = webhookMpStatus(payment.status);
    if (resolved.kind === "not_found")
      return finish(ok(), "IGNORADO_NAO_ENCONTRADO", observed, { mpStatus });
    if (resolved.kind === "ambiguous") {
      // Sem external_reference: para pedido do site ele é o token_publico.
      console.error("Webhook do Mercado Pago: pagamento ambíguo, nenhuma linha alterada", {
        mp_payment_id: String(payment.id)
      });
      return finish(ok(), "IGNORADO_AMBIGUO", observed, { mpStatus });
    }

    const sincronizado = await syncPaymentFromMp(env.DB, resolved.pagamentoId, payment, env);

    // PROCESSADO só depois de a sincronização concluir; a transição efetiva é distinguida de
    // "sincronizou sem transição" (já PAGO, recusada pela matriz ou divergência de integridade).
    return finish(
      ok(),
      !sincronizado.ok
        ? "IGNORADO_NAO_ENCONTRADO"
        : sincronizado.transicionou
          ? "PROCESSADO"
          : "PROCESSADO_SEM_TRANSICAO",
      observed,
      {
        mpStatus,
        pagamentoId: resolved.pagamentoId,
        ...(sincronizado.status ? { statusFinal: sincronizado.status } : {})
      }
    );
  } catch (err) {
    console.error("Erro ao sincronizar webhook do Mercado Pago", err);
    return finish(
      Response.json({ erro: "Falha ao sincronizar pagamento." }, { status: 502 }),
      "FALHA_SINCRONIZACAO",
      observed
    );
  }
};
