import { json, bodyJson, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import { recalculateComanda } from "../../../../lib/comandaLedger.js";
import { localTestMode, mpRequest } from "../../../../lib/mercadoPago.js";
import { logEvent } from "../../../../lib/logger.js";

const MANUAL_METHODS = new Set(["PIX_EXTERNO", "DINHEIRO", "CARTAO", "OUTRO"]);
const CONFIRMED_MP_STATUSES = new Set(["approved", "processed", "refunded"]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function refundIdFromOrder(order) {
  const refunds = order?.transactions?.refunds || [];
  return refunds[0]?.id ? String(refunds[0].id) : null;
}

function orderRefundConfirmed(order) {
  if (normalizeStatus(order?.status) === "refunded") return true;
  return (order?.transactions?.refunds || []).some(refund =>
    CONFIRMED_MP_STATUSES.has(normalizeStatus(refund?.status))
  );
}

async function paymentForRefund(env, pedidoId, pagamentoId) {
  return env.DB.prepare(
    `SELECT pp.id, pp.pedido_id, pp.metodo, pp.valor_centavos, pp.status,
            pp.mp_order_id, pp.mp_payment_id,
            p.status_pedido, p.status_comanda
     FROM pedido_pagamentos pp
     JOIN pedidos p ON p.id = pp.pedido_id
     WHERE pp.id = ? AND pp.pedido_id = ?
     LIMIT 1`
  )
    .bind(pagamentoId, pedidoId)
    .first();
}

async function remainingPaidCount(env, pedidoId, exceptPaymentId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM pedido_pagamentos
     WHERE pedido_id = ? AND status = 'PAGO' AND id <> ?`
  )
    .bind(pedidoId, exceptPaymentId)
    .first();
  return Number(row?.total || 0);
}

async function restoreStock(env, pedidoId) {
  const { results } = await env.DB.prepare(
    `SELECT produto_id, SUM(quantidade) AS quantidade
     FROM pedido_itens
     WHERE pedido_id = ?
       AND produto_id IS NOT NULL
       AND estoque_baixado_em IS NOT NULL
     GROUP BY produto_id`
  )
    .bind(pedidoId)
    .all();

  const items = results || [];
  if (!items.length) return { ok: true, restored: false };

  const statements = items.map(item =>
    env.DB.prepare(
      `UPDATE produtos
       SET estoque = estoque + ?,
           disponivel = CASE WHEN ativo = 1 THEN 1 ELSE disponivel END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(Number(item.quantidade || 0), item.produto_id)
  );

  statements.push(
    env.DB.prepare(
      `UPDATE pedido_itens
       SET estoque_baixado_em = NULL
       WHERE pedido_id = ? AND estoque_baixado_em IS NOT NULL`
    ).bind(pedidoId)
  );
  statements.push(
    env.DB.prepare(
      `UPDATE pedidos
       SET estoque_baixado_em = NULL,
           reserva_status = 'LIBERADA',
           reserva_liberada_em = COALESCE(reserva_liberada_em, CURRENT_TIMESTAMP),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(pedidoId)
  );

  await env.DB.batch(statements);
  return { ok: true, restored: true };
}

async function finalizeRefund(env, refund, payment, { mpRefundId = null, mpStatus = null } = {}) {
  const remaining = await remainingPaidCount(env, Number(payment.pedido_id), Number(payment.id));
  if (Number(refund.devolveu_estoque || 0) === 1 && remaining > 0) {
    return { ok: false, erro: "ESTOQUE_EXIGE_REEMBOLSO_TOTAL", httpStatus: 409 };
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE pedido_reembolsos
       SET status = 'REEMBOLSADO',
           mp_refund_id = COALESCE(?, mp_refund_id),
           mp_status = COALESCE(?, mp_status),
           atualizado_em = CURRENT_TIMESTAMP,
           concluido_em = COALESCE(concluido_em, CURRENT_TIMESTAMP)
       WHERE id = ?`
    ).bind(mpRefundId, mpStatus, refund.id),
    env.DB.prepare(
      `UPDATE pedido_pagamentos
       SET status = 'REEMBOLSADO',
           mp_status = COALESCE(?, mp_status),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PAGO'`
    ).bind(mpStatus, payment.id)
  ]);

  await recalculateComanda(env, Number(payment.pedido_id));

  const paidLeft = await remainingPaidCount(env, Number(payment.pedido_id), 0);
  if (paidLeft === 0) {
    await env.DB.prepare(
      `UPDATE pedidos
       SET status_pagamento = 'REEMBOLSADO', pago_em = NULL, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(payment.pedido_id).run();
  }

  let estoqueRestaurado = false;
  let aviso = null;
  if (Number(refund.devolveu_estoque || 0) === 1) {
    try {
      const stock = await restoreStock(env, Number(payment.pedido_id));
      estoqueRestaurado = Boolean(stock.restored);
    } catch (error) {
      aviso = "Reembolso confirmado, mas a devolução ao estoque precisa ser reconciliada.";
      logEvent("error", "payment.refund_stock_failed", {
        pedido_id: Number(payment.pedido_id),
        reason: "REFUND_STOCK_RESTORE_FAILED",
        error_message: String(error?.message || "REFUND_STOCK_RESTORE_FAILED")
      });
    }
  }

  logEvent("info", "payment.refunded", {
    pedido_id: Number(payment.pedido_id),
    mp_order_id: payment.mp_order_id || undefined,
    status: "REEMBOLSADO"
  });

  return { ok: true, estoque_restaurado: estoqueRestaurado, aviso };
}

async function syncPendingRefund(env, refund) {
  if (refund.status !== "PENDENTE" || refund.origem !== "MERCADO_PAGO") return refund;
  const payment = await paymentForRefund(env, Number(refund.pedido_id), Number(refund.pagamento_id));
  if (!payment) return refund;

  try {
    if (localTestMode(env)) {
      await finalizeRefund(env, refund, payment, {
        mpRefundId: `local_refund_${payment.id}`,
        mpStatus: "processed"
      });
      return { ...refund, status: "REEMBOLSADO", mp_refund_id: `local_refund_${payment.id}`, mp_status: "processed" };
    }

    if (payment.mp_order_id) {
      const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(payment.mp_order_id)}`);
      if (!orderRefundConfirmed(order)) return refund;
      const mpRefundId = refundIdFromOrder(order) || refund.mp_refund_id || null;
      await finalizeRefund(env, refund, payment, { mpRefundId, mpStatus: "processed" });
      return { ...refund, status: "REEMBOLSADO", mp_refund_id: mpRefundId, mp_status: "processed" };
    }

    if (payment.mp_payment_id) {
      const refunds = await mpRequest(env, `/v1/payments/${encodeURIComponent(payment.mp_payment_id)}/refunds`);
      const match = Array.isArray(refunds)
        ? refunds.find(item => Number(item?.amount || 0) === Number(payment.valor_centavos || 0) / 100) || refunds[0]
        : null;
      if (!match) return refund;
      const status = normalizeStatus(match.status || "processed");
      if (!CONFIRMED_MP_STATUSES.has(status)) return refund;
      await finalizeRefund(env, refund, payment, {
        mpRefundId: match.id ? String(match.id) : null,
        mpStatus: status
      });
      return { ...refund, status: "REEMBOLSADO", mp_refund_id: match.id ? String(match.id) : null, mp_status: status };
    }
  } catch (error) {
    logEvent("warn", "payment.refund_sync_failed", {
      pedido_id: Number(refund.pedido_id),
      http_status: Number(error?.status || 0) || undefined,
      reason: "REFUND_SYNC_FAILED"
    });
  }
  return refund;
}

async function listRefunds(env, pedidoId, { sync = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.pedido_id, r.pagamento_id, r.origem, r.metodo,
            r.valor_centavos, r.status, r.mp_refund_id, r.mp_status,
            r.registrado_por_usuario_id, r.motivo, r.devolveu_estoque,
            r.criado_em, r.atualizado_em, r.concluido_em,
            u.nome AS registrado_por_nome
     FROM pedido_reembolsos r
     LEFT JOIN usuarios_admin u ON u.id = r.registrado_por_usuario_id
     WHERE r.pedido_id = ?
     ORDER BY r.id ASC`
  )
    .bind(pedidoId)
    .all();

  const refunds = results || [];
  if (!sync) return refunds;
  return Promise.all(refunds.map(refund => syncPendingRefund(env, refund)));
}

export async function onRequestGet({ request, env, params }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  if (!Number.isInteger(pedidoId) || pedidoId < 1) return json({ erro: "Pedido inválido." }, 400);
  const sync = new URL(request.url).searchParams.get("sync") === "1";
  return json({ reembolsos: await listRefunds(env, pedidoId, { sync }) });
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  const body = await bodyJson(request);
  const pagamentoId = Number(body?.pagamento_id);
  if (!Number.isInteger(pedidoId) || pedidoId < 1 || !Number.isInteger(pagamentoId) || pagamentoId < 1) {
    return json({ erro: "Pagamento inválido." }, 400);
  }

  const payment = await paymentForRefund(env, pedidoId, pagamentoId);
  if (!payment) return json({ erro: "Pagamento não encontrado." }, 404);
  if (String(payment.status || "").toUpperCase() === "REEMBOLSADO") {
    const existing = (await listRefunds(env, pedidoId)).find(item => Number(item.pagamento_id) === pagamentoId && item.status === "REEMBOLSADO");
    return json({ ok: true, reembolso: existing || null, ja_reembolsado: true });
  }
  if (String(payment.status || "").toUpperCase() !== "PAGO") {
    return json({ erro: "Somente pagamentos confirmados podem ser reembolsados." }, 409);
  }

  const automatic = payment.metodo === "PIX_MP" && Boolean(payment.mp_order_id || payment.mp_payment_id);
  const requestedOrigin = String(body?.origem || (automatic ? "MERCADO_PAGO" : "MANUAL")).toUpperCase();
  if (automatic && requestedOrigin !== "MERCADO_PAGO") {
    return json({ erro: "Este Pix deve ser reembolsado pelo Mercado Pago para haver confirmação do provedor." }, 400);
  }
  if (!automatic && requestedOrigin !== "MANUAL") {
    return json({ erro: "Este pagamento exige registro manual do reembolso." }, 400);
  }

  const manualMethod = String(body?.metodo || payment.metodo || "OUTRO").toUpperCase();
  if (!automatic && !MANUAL_METHODS.has(manualMethod)) {
    return json({ erro: "Forma do reembolso manual inválida." }, 400);
  }

  const returnStock = Boolean(body?.devolver_estoque);
  if (returnStock && await remainingPaidCount(env, pedidoId, pagamentoId) > 0) {
    return json({ erro: "Reembolse os outros pagamentos antes de devolver os itens ao estoque." }, 409);
  }

  const idempotencyKey = `refund:${pedidoId}:${pagamentoId}`;
  let refund = await env.DB.prepare(
    `SELECT * FROM pedido_reembolsos WHERE idempotency_key = ? LIMIT 1`
  ).bind(idempotencyKey).first();

  if (!refund) {
    const inserted = await env.DB.prepare(
      `INSERT INTO pedido_reembolsos (
         pedido_id, pagamento_id, origem, metodo, valor_centavos, status,
         idempotency_key, registrado_por_usuario_id, motivo, devolveu_estoque
       ) VALUES (?, ?, ?, ?, ?, 'PENDENTE', ?, ?, ?, ?)`
    )
      .bind(
        pedidoId,
        pagamentoId,
        automatic ? "MERCADO_PAGO" : "MANUAL",
        automatic ? "PIX_MP" : manualMethod,
        Number(payment.valor_centavos),
        idempotencyKey,
        auth.user.id,
        String(body?.motivo || "").trim().slice(0, 300),
        returnStock ? 1 : 0
      )
      .run();
    refund = await env.DB.prepare("SELECT * FROM pedido_reembolsos WHERE id = ?")
      .bind(Number(inserted?.meta?.last_row_id || 0))
      .first();
  }

  if (!refund) return json({ erro: "Não foi possível iniciar o reembolso." }, 500);
  if (refund.status === "REEMBOLSADO") return json({ ok: true, reembolso: refund, ja_reembolsado: true });

  if (!automatic) {
    const finalized = await finalizeRefund(env, refund, payment);
    if (!finalized.ok) return json({ erro: "Não foi possível concluir o reembolso manual." }, finalized.httpStatus || 409);
    const current = await env.DB.prepare("SELECT * FROM pedido_reembolsos WHERE id = ?").bind(refund.id).first();
    return json({ ok: true, reembolso: current, confirmado_por: "ADMIN", ...finalized });
  }

  let providerConfirmed = false;
  try {
    let response;
    if (localTestMode(env)) {
      response = {
        id: payment.mp_order_id || `local_order_${pedidoId}`,
        status: "refunded",
        transactions: { refunds: [{ id: `local_refund_${pagamentoId}`, status: "processed" }] }
      };
    } else if (payment.mp_order_id) {
      response = await mpRequest(
        env,
        `/v1/orders/${encodeURIComponent(payment.mp_order_id)}/refund`,
        { method: "POST", idempotencyKey }
      );
    } else {
      response = await mpRequest(
        env,
        `/v1/payments/${encodeURIComponent(payment.mp_payment_id)}/refunds`,
        { method: "POST", idempotencyKey }
      );
    }

    const confirmed = payment.mp_order_id
      ? orderRefundConfirmed(response)
      : Boolean(response?.id) && CONFIRMED_MP_STATUSES.has(normalizeStatus(response?.status || "processed"));
    providerConfirmed = confirmed;
    const mpRefundId = payment.mp_order_id
      ? refundIdFromOrder(response)
      : response?.id ? String(response.id) : null;
    const mpStatus = payment.mp_order_id
      ? normalizeStatus(response?.transactions?.refunds?.[0]?.status || response?.status)
      : normalizeStatus(response?.status || "processed");

    await env.DB.prepare(
      `UPDATE pedido_reembolsos
       SET mp_refund_id = COALESCE(?, mp_refund_id), mp_status = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(mpRefundId, mpStatus || null, refund.id).run();

    if (!confirmed) {
      return json({
        ok: true,
        pendente: true,
        mensagem: "O Mercado Pago recebeu o pedido de reembolso. A confirmação ainda está pendente.",
        reembolso: { ...refund, mp_refund_id: mpRefundId, mp_status: mpStatus }
      }, 202);
    }

    const finalized = await finalizeRefund(env, refund, payment, { mpRefundId, mpStatus });
    if (!finalized.ok) return json({ erro: "O provedor confirmou o reembolso, mas houve uma inconsistência local." }, finalized.httpStatus || 409);
    const current = await env.DB.prepare("SELECT * FROM pedido_reembolsos WHERE id = ?").bind(refund.id).first();
    return json({ ok: true, reembolso: current, confirmado_por: "MERCADO_PAGO", ...finalized });
  } catch (error) {
    if (providerConfirmed) {
      logEvent("error", "payment.refund_local_finalize_failed", {
        pedido_id: pedidoId,
        mp_order_id: payment.mp_order_id || undefined,
        reason: "REFUND_CONFIRMED_LOCAL_FINALIZE_FAILED",
        error_message: String(error?.message || "REFUND_CONFIRMED_LOCAL_FINALIZE_FAILED")
      });
      return json({
        erro: "O Mercado Pago confirmou o reembolso, mas o registro local ainda precisa ser reconciliado. Não repita o reembolso.",
        codigo: "REFUND_CONFIRMED_LOCAL_PENDING"
      }, 500);
    }

    await env.DB.prepare(
      `UPDATE pedido_reembolsos
       SET status = 'FALHOU', mp_status = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDENTE'`
    ).bind(`HTTP_${Number(error?.status || 0) || 0}`, refund.id).run();

    logEvent("warn", "payment.refund_failed", {
      pedido_id: pedidoId,
      mp_order_id: payment.mp_order_id || undefined,
      http_status: Number(error?.status || 0) || undefined,
      reason: "REFUND_PROVIDER_FAILED"
    });
    return json({ erro: "O Mercado Pago não confirmou o reembolso. Nenhum estorno foi marcado como concluído no sistema." }, 502);
  }
}
