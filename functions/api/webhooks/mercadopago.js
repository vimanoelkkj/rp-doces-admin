import { json } from "../../lib/http.js";
import { mpRequest, validateMpWebhook, mpOrderToLocalStatus, paymentFromOrder } from "../../lib/mercadoPago.js";
import { syncOrderPayment } from "../../lib/paymentSync.js";
import { syncComandaPixCharge } from "../../lib/comandaLedger.js";
import { baixarEstoquePedido } from "../../lib/stock.js";
import { notifyPaidOrder } from "../../lib/push.js";
import { logEvent } from "../../lib/logger.js";

function getBodyDataId(body) {
  const value = body?.data?.id ?? body?.data_id ?? body?.id ?? null;
  return value === null || value === undefined ? "" : String(value);
}

function pedidoIdFromExternalReference(value) {
  const match = /^RP-(\d+)(?:-P\d+)?$/.exec(String(value || "").trim());
  return match ? Number(match[1]) : null;
}

function isDiagnosticReference(value) {
  return /^RP-DIAG-/.test(String(value || "").trim());
}

function isMissingPaymentLedgerTable(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("no such table") && message.includes("pedido_pagamentos");
}

function isMissingDiagnosticTable(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("no such table") && message.includes("pix_diagnosticos");
}

async function findLedgerLink(env, dataId) {
  try {
    return await env.DB.prepare(
      `SELECT pedido_id AS id, mp_order_id
       FROM pedido_pagamentos
       WHERE mp_order_id = ? OR mp_payment_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
      .bind(dataId, dataId)
      .first();
  } catch (error) {
    if (isMissingPaymentLedgerTable(error)) return null;
    throw error;
  }
}

async function findLedgerCharge(env, pedidoId, orderId) {
  try {
    return await env.DB.prepare(
      `SELECT id, origem
       FROM pedido_pagamentos
       WHERE pedido_id = ? AND mp_order_id = ?
       LIMIT 1`
    )
      .bind(pedidoId, orderId)
      .first();
  } catch (error) {
    if (isMissingPaymentLedgerTable(error)) return null;
    throw error;
  }
}

async function findDiagnostic(env, dataId) {
  try {
    return await env.DB.prepare(
      `SELECT id, external_reference, mp_order_id, mp_payment_id
       FROM pix_diagnosticos
       WHERE mp_order_id = ? OR mp_payment_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
      .bind(dataId, dataId)
      .first();
  } catch (error) {
    if (isMissingDiagnosticTable(error)) return null;
    throw error;
  }
}

async function syncDiagnosticWebhook(env, request, dataId, type) {
  const accessToken = String(env?.MP_DIAGNOSTIC_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    logEvent("error", "webhook.diagnostic_error", {
      http_status: 503,
      reason: "DIAGNOSTIC_TOKEN_MISSING"
    });
    return json({ erro: "Credencial do diagnóstico não configurada." }, 503);
  }

  let diagnostic = await findDiagnostic(env, dataId);
  let order = null;
  let orderId = diagnostic?.mp_order_id ? String(diagnostic.mp_order_id) : null;

  if (!orderId && (!type || type === "order" || type === "orders")) {
    try {
      order = await mpRequest(env, `/v1/orders/${encodeURIComponent(dataId)}`, { accessToken });
    } catch (error) {
      if (error?.status === 404) return json({ ok: true, diagnostico: true, rastreado: false });
      throw error;
    }

    if (!isDiagnosticReference(order?.external_reference)) {
      return json({ ok: true, diagnostico: true, rastreado: false });
    }
    orderId = order?.id ? String(order.id) : String(dataId);
    diagnostic = await findDiagnostic(env, orderId);
  }

  if (!diagnostic || !orderId) {
    return json({ ok: true, diagnostico: true, rastreado: false });
  }

  if (!order) order = await mpRequest(env, `/v1/orders/${encodeURIComponent(orderId)}`, { accessToken });
  if (!isDiagnosticReference(order?.external_reference || diagnostic.external_reference)) {
    return json({ ok: true, diagnostico: true, rastreado: false });
  }

  const payment = paymentFromOrder(order);
  const status = mpOrderToLocalStatus(order);
  const requestId = String(request.headers.get("x-request-id") || "").trim() || null;

  await env.DB.prepare(
    `UPDATE pix_diagnosticos
     SET mp_payment_id = COALESCE(?, mp_payment_id),
         status = ?,
         mp_status = ?,
         mp_status_detail = ?,
         pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, CURRENT_TIMESTAMP) ELSE pago_em END,
         webhook_recebido_em = COALESCE(webhook_recebido_em, CURRENT_TIMESTAMP),
         webhook_data_id = ?,
         webhook_request_id = ?,
         atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      payment.paymentId,
      status,
      order?.status || null,
      order?.status_detail || null,
      status,
      dataId,
      requestId,
      diagnostic.id
    )
    .run();

  logEvent("info", "webhook.diagnostic_received", {
    mp_order_id: orderId,
    reason: status
  });

  return json({ ok: true, diagnostico: true, rastreado: true });
}

export async function onRequestPost({ request, env, waitUntil }) {
  const url = new URL(request.url);

  let body = null;
  try {
    body = await request.clone().json();
  } catch {
    body = null;
  }

  const dataId =
    url.searchParams.get("data.id") || url.searchParams.get("data_id") || getBodyDataId(body);

  const type = String(
    url.searchParams.get("type") || url.searchParams.get("topic") || body?.type || body?.topic || ""
  ).toLowerCase();

  const supportedType = !type || ["order", "orders", "payment", "payments"].includes(type);
  if (!dataId || !supportedType) return json({ ok: true });

  const diagnosticSecret = String(env?.MP_DIAGNOSTIC_WEBHOOK_SECRET || "").trim();
  const commercialSecret = String(env?.MP_WEBHOOK_SECRET || "").trim();

  if (!diagnosticSecret && !commercialSecret) {
    logEvent("error", "webhook.error", {
      http_status: 503,
      reason: "MP_HTTP_ERROR"
    });
    return json({ erro: "Webhook não configurado." }, 503);
  }

  if (diagnosticSecret) {
    const diagnosticValid = await validateMpWebhook(request, diagnosticSecret, dataId);
    if (diagnosticValid) {
      try {
        return await syncDiagnosticWebhook(env, request, dataId, type);
      } catch (error) {
        logEvent("error", "webhook.diagnostic_error", {
          mp_order_id: undefined,
          http_status: error?.status || 502,
          reason: error?.status ? "MP_HTTP_ERROR" : "UNKNOWN_ERROR"
        });
        return json({ erro: "Falha ao sincronizar diagnóstico Pix." }, 502);
      }
    }
  }

  if (!commercialSecret) {
    logEvent("warn", "webhook.invalid_signature", {
      http_status: 401,
      reason: "HMAC_MISMATCH"
    });
    return json({ erro: "Assinatura inválida." }, 401);
  }

  const valid = await validateMpWebhook(request, commercialSecret, dataId);
  if (!valid) {
    logEvent("warn", "webhook.invalid_signature", {
      http_status: 401,
      reason: "HMAC_MISMATCH"
    });
    return json({ erro: "Assinatura inválida." }, 401);
  }

  let local = null;
  let orderId = null;

  try {
    local = await env.DB.prepare(
      `SELECT id, mp_order_id
       FROM pedidos
       WHERE mp_order_id = ? OR mp_payment_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
      .bind(dataId, dataId)
      .first();

    if (!local) {
      const ledgerLink = await findLedgerLink(env, dataId);
      if (ledgerLink) local = ledgerLink;
    }

    orderId = local?.mp_order_id ? String(local.mp_order_id) : null;
    let order = null;

    if (!orderId && (!type || type === "order" || type === "orders")) {
      try {
        order = await mpRequest(env, `/v1/orders/${encodeURIComponent(dataId)}`);
        orderId = order?.id ? String(order.id) : String(dataId);

        if (!local) {
          const pedidoId = pedidoIdFromExternalReference(order?.external_reference);
          if (pedidoId) {
            local = await env.DB.prepare("SELECT id, mp_order_id FROM pedidos WHERE id = ? LIMIT 1")
              .bind(pedidoId)
              .first();
          }
        }
      } catch (err) {
        if (err?.status === 404) return json({ ok: true });
        throw err;
      }
    }

    if (!local || !orderId) return json({ ok: true });
    if (!order) order = await mpRequest(env, `/v1/orders/${encodeURIComponent(orderId)}`);

    const ledgerCharge = await findLedgerCharge(env, local.id, orderId);

    if (ledgerCharge?.origem === "ADMIN") {
      const payment = paymentFromOrder(order);
      const status = mpOrderToLocalStatus(order);
      const synced = await syncComandaPixCharge(env, {
        pedidoId: local.id,
        mpOrderId: orderId,
        status,
        mpPaymentId: payment.paymentId,
        mpStatus: order?.status || null,
        mpStatusDetail: order?.status_detail || null,
        ticketUrl: payment.ticketUrl,
        qrCode: payment.qrCode,
        qrCodeBase64: payment.qrCodeBase64
      });

      if (!synced.ok) throw new Error(synced.erro || "COMANDA_PAYMENT_SYNC_FAILED");
      if (synced.status_financeiro === "PAGO") {
        await baixarEstoquePedido(env, local.id);
        if (synced.transitioned_to_paid) {
          const pushTask = notifyPaidOrder(env, local.id).catch(() => {
            logEvent("warn", "push.failed", { pedido_id: local.id, reason: "PUSH_FAILED" });
          });
          if (typeof waitUntil === "function") waitUntil(pushTask);
          else await pushTask;
        }
      }
    } else {
      await syncOrderPayment(
        env,
        { pedidoId: local.id, order, mpOrderId: orderId },
        { waitUntil }
      );
    }

    return json({ ok: true });
  } catch (err) {
    logEvent("error", "webhook.error", {
      pedido_id: local?.id || undefined,
      mp_order_id: orderId || undefined,
      http_status: err?.status || 502,
      reason: err?.status ? "MP_HTTP_ERROR" : "UNKNOWN_ERROR"
    });
    return json({ erro: "Falha ao sincronizar pagamento." }, 502);
  }
}
