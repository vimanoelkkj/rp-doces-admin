import {
  mpRequest,
  mpOrderToLocalStatus,
  paymentFromOrder,
  calculatePixExpiration
} from "./mercadoPago.js";
import { getComandaFinancialState, syncComandaPixCharge } from "./comandaLedger.js";

function money(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

export async function findPendingPixCharge(env, pedidoId) {
  return env.DB.prepare(
    `SELECT * FROM pedido_pagamentos
     WHERE pedido_id = ? AND metodo = 'PIX_MP' AND status = 'PENDENTE'
     ORDER BY id DESC LIMIT 1`
  )
    .bind(pedidoId)
    .first();
}

export async function reconcilePixCharge(env, pedidoId, charge) {
  if (!charge?.mp_order_id) return { ok: true, charge, status: charge?.status || "PENDENTE" };
  const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(charge.mp_order_id)}`);
  const payment = paymentFromOrder(order);
  const status = mpOrderToLocalStatus(order);
  const synced = await syncComandaPixCharge(env, {
    pedidoId,
    mpOrderId: charge.mp_order_id,
    status,
    mpPaymentId: payment.paymentId,
    mpStatus: order?.status || null,
    mpStatusDetail: order?.status_detail || null,
    ticketUrl: payment.ticketUrl,
    qrCode: payment.qrCode,
    qrCodeBase64: payment.qrCodeBase64
  });
  return { ok: synced.ok, charge, order, status, synced };
}

export async function cancelPendingPixCharge(env, pedidoId, charge) {
  if (!charge) return { ok: true, cancelado: false, inexistente: true };

  const reconciled = await reconcilePixCharge(env, pedidoId, charge);
  if (!reconciled.ok) return reconciled;
  if (reconciled.status === "PAGO") {
    return { ok: false, pago: true, status: "PAGO", erro: "PIX_JA_PAGO" };
  }
  if (["CANCELADO", "EXPIRADO", "REEMBOLSADO", "FALHOU"].includes(reconciled.status)) {
    return { ok: true, cancelado: false, status: reconciled.status };
  }

  const canceledOrder = await mpRequest(
    env,
    `/v1/orders/${encodeURIComponent(charge.mp_order_id)}/cancel`,
    { method: "POST", idempotencyKey: crypto.randomUUID() }
  );
  const payment = paymentFromOrder(canceledOrder);
  const status = mpOrderToLocalStatus(canceledOrder);
  const synced = await syncComandaPixCharge(env, {
    pedidoId,
    mpOrderId: charge.mp_order_id,
    status,
    mpPaymentId: payment.paymentId,
    mpStatus: canceledOrder?.status || null,
    mpStatusDetail: canceledOrder?.status_detail || null,
    ticketUrl: payment.ticketUrl,
    qrCode: payment.qrCode,
    qrCodeBase64: payment.qrCodeBase64
  });

  if (!synced.ok || status !== "CANCELADO") {
    return { ok: false, erro: "CANCELAMENTO_NAO_CONFIRMADO", status };
  }
  return { ok: true, cancelado: true, status };
}

export async function createPixCharge(env, {
  pedidoId,
  valorCentavos,
  usuarioId,
  clientRequestId,
  substituiPagamentoId = null
}) {
  if (!env.MP_ACCESS_TOKEN) return { ok: false, erro: "PIX_NAO_CONFIGURADO", httpStatus: 503 };

  const state = await getComandaFinancialState(env, pedidoId);
  if (!state) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO", httpStatus: 404 };
  if (String(state.pedido.status_comanda || "ABERTA").toUpperCase() !== "ABERTA") {
    return { ok: false, erro: "COMANDA_ENCERRADA", httpStatus: 409 };
  }

  const valor = Number(valorCentavos || 0);
  if (!Number.isSafeInteger(valor) || valor <= 0 || valor > state.saldo_centavos) {
    return { ok: false, erro: "VALOR_INVALIDO", saldo_centavos: state.saldo_centavos, httpStatus: 400 };
  }

  const key = String(clientRequestId || "").trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return { ok: false, erro: "CLIENT_REQUEST_ID_INVALIDO", httpStatus: 400 };
  }

  let ledger = await env.DB.prepare(
    `SELECT * FROM pedido_pagamentos
     WHERE pedido_id = ? AND idempotency_key = ? LIMIT 1`
  )
    .bind(pedidoId, key)
    .first();

  if (!ledger) {
    const inserted = await env.DB.prepare(
      `INSERT INTO pedido_pagamentos (
         pedido_id, metodo, origem, valor_centavos, status,
         idempotency_key, substitui_pagamento_id, registrado_por_usuario_id,
         pix_expira_em
       ) VALUES (?, 'PIX_MP', 'ADMIN', ?, 'PENDENTE', ?, ?, ?, datetime('now', '+30 minutes'))`
    )
      .bind(pedidoId, valor, key, substituiPagamentoId, usuarioId)
      .run();
    const paymentId = Number(inserted?.meta?.last_row_id || 0);
    ledger = await env.DB.prepare("SELECT * FROM pedido_pagamentos WHERE id = ? LIMIT 1")
      .bind(paymentId)
      .first();
  }

  if (!ledger || Number(ledger.valor_centavos) !== valor) {
    return { ok: false, erro: "IDEMPOTENCIA_DIVERGENTE", httpStatus: 409 };
  }

  if (ledger.mp_order_id && ledger.mp_qr_code) {
    return { ok: true, reused: true, pagamento: ledger };
  }

  const payerName = String(state.pedido.cliente_nome || "Cliente").trim();
  const payerFirstName =
    String(env.MP_TEST_MODE || "").toLowerCase() === "true"
      ? "APRO"
      : payerName.split(/\s+/)[0] || "Cliente";
  const payerEmail = String(state.pedido.cliente_email || "").trim() || "cliente@rpdoces.com.br";
  const totalAmount = money(valor);
  const externalReference = `RP-${pedidoId}-P${ledger.id}`;

  const order = await mpRequest(env, "/v1/orders", {
    method: "POST",
    idempotencyKey: key,
    body: {
      type: "online",
      processing_mode: "automatic",
      external_reference: externalReference,
      total_amount: totalAmount,
      payer: { email: payerEmail, first_name: payerFirstName },
      transactions: {
        payments: [
          {
            amount: totalAmount,
            payment_method: { id: "pix", type: "bank_transfer" },
            expiration_time: "PT30M"
          }
        ]
      }
    }
  });

  const payment = paymentFromOrder(order);
  const status = mpOrderToLocalStatus(order);
  const expiration = ledger.pix_expira_em || calculatePixExpiration(ledger.criado_em);

  await env.DB.prepare(
    `UPDATE pedido_pagamentos SET
       mp_order_id = ?, mp_payment_id = ?, mp_status = ?, mp_status_detail = ?,
       mp_ticket_url = ?, mp_qr_code = ?, mp_qr_code_base64 = ?, status = ?,
       pix_expira_em = COALESCE(pix_expira_em, ?), atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      order?.id || null,
      payment.paymentId,
      order?.status || null,
      order?.status_detail || null,
      payment.ticketUrl,
      payment.qrCode,
      payment.qrCodeBase64,
      status,
      expiration,
      ledger.id
    )
    .run();

  await env.DB.prepare(
    `UPDATE pedidos SET
       mp_order_id = ?, mp_payment_id = ?, mp_status = ?, mp_status_detail = ?,
       mp_ticket_url = ?, mp_qr_code = ?, mp_qr_code_base64 = ?,
       pix_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      order?.id || null,
      payment.paymentId,
      order?.status || null,
      order?.status_detail || null,
      payment.ticketUrl,
      payment.qrCode,
      payment.qrCodeBase64,
      expiration,
      pedidoId
    )
    .run();

  const synced = await syncComandaPixCharge(env, {
    pedidoId,
    mpOrderId: order?.id || "",
    status,
    mpPaymentId: payment.paymentId,
    mpStatus: order?.status || null,
    mpStatusDetail: order?.status_detail || null,
    ticketUrl: payment.ticketUrl,
    qrCode: payment.qrCode,
    qrCodeBase64: payment.qrCodeBase64
  });

  const saved = await env.DB.prepare("SELECT * FROM pedido_pagamentos WHERE id = ? LIMIT 1")
    .bind(ledger.id)
    .first();
  return { ok: true, reused: false, pagamento: saved, synced };
}
