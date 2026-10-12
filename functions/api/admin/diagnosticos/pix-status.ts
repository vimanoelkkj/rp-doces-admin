/// <reference types="@cloudflare/workers-types" />

// Admin > Loja > Diagnósticos permanentes — status do "Pix real de diagnóstico".
//
// Consulta apenas: reaproveita `fetchMpPayment`/`mapMpStatus` de
// `paymentSync.ts` (mesmo GET autoritativo usado pelo webhook, pela
// reconciliação B3 e pelo polling público) — nunca chama
// `syncPaymentFromMp`, que grava em `pedido_pagamentos`. Este diagnóstico
// não tem pagamento local para sincronizar; ISOLAMENTO: zero escrita no
// banco, exatamente como o endpoint que cria o Pix de diagnóstico.

import { fetchMpOrder } from "../../../lib/mp/orders/client";
import { decimalToCents } from "../../../lib/mp/orders/types";
import { requireUser, sha256 } from "../../../lib/auth";
import { fetchMpPayment, mapMpStatus } from "../../../lib/paymentSync";
import { parseDiagnosticPaymentId } from "../../../lib/mp/orders/diagnosticId";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
  APP_ENV?: string;
  MP_TEST_MODE?: string;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function isOwner(papel: string) {
  return papel === "OWNER";
}

// Isolation is verified by the publication gates, not by introspecting env.DB.
// No runtime D1 UUID API exists. These checks do not attest the binding identity.
async function readLinkedOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (
    env.APP_ENV !== "staging" ||
    env.MP_TEST_MODE !== "orders_pix" ||
    new URL(request.url).origin !== "https://staging.rpdoces.com.br"
  ) {
    return json({ code: "DIAGNOSTIC_ORDER_LOOKUP_FORBIDDEN" }, 403);
  }
  try {
    const linked = await env.DB.prepare(
      `SELECT pp.id FROM pedido_pagamentos pp
       JOIN pedidos p ON p.id = pp.pedido_id
       WHERE pp.mp_order_id = ? AND pp.metodo = 'PIX_MP' LIMIT 1`
    )
      .bind(orderId)
      .first();
    if (!linked) return json({ code: "DIAGNOSTIC_ORDER_NOT_LINKED" }, 404);
    if (!env.MP_ACCESS_TOKEN) return json({ code: "MERCADO_PAGO_NAO_CONFIGURADO" }, 503);
    const order = await fetchMpOrder(env.MP_ACCESS_TOKEN, orderId);
    const status = (value: unknown) => {
      if (value == null) return null;
      if (typeof value !== "string" || !/^[a-z_]{1,64}$/.test(value))
        throw new Error("RESPOSTA_ORDER_INVALIDA");
      return value;
    };
    const amount = (value: unknown) => {
      if (value == null) return null;
      if (decimalToCents(value) === null) throw new Error("RESPOSTA_ORDER_INVALIDA");
      return value;
    };
    return json({
      ok: true,
      order: {
        id: order.order_id,
        status: status(order.order_status),
        status_detail: status(order.order_status_detail),
        // References may be public order access tokens or contain personal data.
        external_reference:
          order.external_reference === null
            ? null
            : {
                sha256: await sha256(order.external_reference)
              },
        total_amount: amount(order.total_amount),
        paid_amount: amount(order.order_paid_amount)
      },
      payment: {
        id: order.id,
        status: status(order.transaction_status),
        status_detail: status(order.transaction_status_detail),
        amount: amount(order.transaction_amount),
        paid_amount: amount(order.paid_amount)
      }
    });
  } catch {
    // Never log a provider payload, exception or credential from this lookup.
    console.error("DIAGNOSTIC_ORDER_LOOKUP_FAILED");
    return json({ code: "DIAGNOSTIC_ORDER_LOOKUP_FAILED" }, 502);
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  if (!isOwner(auth.user.papel)) {
    return jsonError("Apenas o proprietário pode consultar diagnósticos", 403);
  }

  const mpPaymentId = new URL(request.url).searchParams.get("mpPaymentId") || "";
  const identity = parseDiagnosticPaymentId(mpPaymentId);
  if (!identity && /^ORD[A-Za-z0-9]{1,128}$/.test(mpPaymentId)) {
    return readLinkedOrder(request, env, mpPaymentId);
  }
  if (!identity) {
    return jsonError("mpPaymentId inválido", 400);
  }

  if (!env.MP_ACCESS_TOKEN) {
    return jsonError(
      "Mercado Pago não está configurado neste ambiente",
      503,
      "MERCADO_PAGO_NAO_CONFIGURADO"
    );
  }

  try {
    const payment = await fetchMpPayment(env.MP_ACCESS_TOKEN, identity.orderId);
    if (payment.id !== identity.paymentId) throw new Error("DIAGNOSTIC_PAYMENT_ID_MISMATCH");
    return Response.json({
      ok: true,
      // "PENDENTE" cobre pending/in_process/authorized — mapMpStatus só
      // nomeia estados finais; não inventamos um vocabulário próprio aqui.
      status: mapMpStatus(payment.status) ?? "PENDENTE"
    });
  } catch (err) {
    console.error("Falha ao consultar status do Pix de diagnóstico", err);
    return jsonError(
      "Não foi possível confirmar o status com o Mercado Pago. Tente novamente.",
      502,
      "MERCADO_PAGO_INDISPONIVEL"
    );
  }
};
