from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path, old, new, count=1):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, count), encoding="utf-8")


def replace_between(path, start, end, replacement):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    a = text.find(start)
    if a < 0:
        raise SystemExit(f"start not found in {path}: {start!r}")
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f"end not found in {path}: {end!r}")
    p.write_text(text[:a] + replacement + text[b:], encoding="utf-8")


# Multiple completed partial refunds must be allowed for the same payment row.
(ROOT / "migrations/036_reembolsos_parciais.sql").write_text(
    "DROP INDEX IF EXISTS uq_pedido_reembolsos_pagamento_concluido;\n",
    encoding="utf-8",
)

refunds_path = "functions/api/admin/orders/[id]/refunds.js"

patch(
    refunds_path,
    '''function refundIdFromOrder(order) {
  const refunds = order?.transactions?.refunds || [];
  return refunds[0]?.id ? String(refunds[0].id) : null;
}

function orderRefundConfirmed(order) {
  if (normalizeStatus(order?.status) === "refunded") return true;
  return (order?.transactions?.refunds || []).some(refund =>
    CONFIRMED_MP_STATUSES.has(normalizeStatus(refund?.status))
  );
}
''',
    '''function centsFromProviderAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}

function providerRefunds(order) {
  return Array.isArray(order?.transactions?.refunds) ? order.transactions.refunds : [];
}

function providerRefundConfirmed(refund) {
  return Boolean(refund?.id) && CONFIRMED_MP_STATUSES.has(normalizeStatus(refund?.status));
}

function matchingOrderRefund(order, transactionId, refundCents, { preferredId = null, excludedIds = new Set() } = {}) {
  const refunds = providerRefunds(order);
  if (preferredId) {
    const preferred = refunds.find(item => String(item?.id || "") === String(preferredId));
    if (preferred && String(preferred?.transaction_id || "") === String(transactionId || "") &&
        centsFromProviderAmount(preferred?.amount) === refundCents) {
      return preferred;
    }
  }
  return refunds.find(item =>
    String(item?.transaction_id || "") === String(transactionId || "") &&
    centsFromProviderAmount(item?.amount) === refundCents &&
    !excludedIds.has(String(item?.id || ""))
  ) || null;
}

function matchingPaymentRefund(refunds, refundCents, { preferredId = null, excludedIds = new Set() } = {}) {
  const items = Array.isArray(refunds) ? refunds : [];
  if (preferredId) {
    const preferred = items.find(item => String(item?.id || "") === String(preferredId));
    if (preferred && centsFromProviderAmount(preferred?.amount) === refundCents) return preferred;
  }
  return items.find(item =>
    centsFromProviderAmount(item?.amount) === refundCents &&
    !excludedIds.has(String(item?.id || ""))
  ) || null;
}

async function claimedProviderRefundIds(env, pagamentoId, currentRefundId) {
  const { results } = await env.DB.prepare(
    `SELECT mp_refund_id
     FROM pedido_reembolsos
     WHERE pagamento_id = ?
       AND id <> ?
       AND status = 'REEMBOLSADO'
       AND mp_refund_id IS NOT NULL`
  ).bind(pagamentoId, currentRefundId).all();
  return new Set((results || []).map(item => String(item.mp_refund_id)).filter(Boolean));
}

function providerIdempotencyKey(localKey, family) {
  return `${localKey}:${family}`.slice(0, 128);
}
'''
)

# Guard against finalizing a stale amount after the payment changed concurrently.
patch(
    refunds_path,
    '''async function finalizeRefund(env, refund, payment, { mpRefundId = null, mpStatus = null } = {}) {
  const remaining = await remainingPaidCount(env, Number(payment.pedido_id), Number(payment.id));
''',
    '''async function finalizeRefund(env, refund, payment, { mpRefundId = null, mpStatus = null } = {}) {
  if (Number(refund.valor_centavos || 0) !== Number(payment.valor_centavos || 0)) {
    return { ok: false, erro: "VALOR_REEMBOLSO_DESATUALIZADO", httpStatus: 409 };
  }

  const remaining = await remainingPaidCount(env, Number(payment.pedido_id), Number(payment.id));
'''
)

replace_between(
    refunds_path,
    "async function syncPendingRefund(env, refund) {",
    "async function listRefunds(env, pedidoId, { sync = false } = {}) {",
    '''async function syncPendingRefund(env, refund) {
  if (refund.status !== "PENDENTE" || refund.origem !== "MERCADO_PAGO") return refund;
  const payment = await paymentForRefund(env, Number(refund.pedido_id), Number(refund.pagamento_id));
  if (!payment || String(payment.status || "").toUpperCase() !== "PAGO") return refund;

  const refundCents = Number(refund.valor_centavos || 0);
  const excludedIds = await claimedProviderRefundIds(env, Number(refund.pagamento_id), Number(refund.id));

  try {
    if (localTestMode(env)) {
      const localId = `local_refund_${refund.id}`;
      await finalizeRefund(env, refund, payment, { mpRefundId: localId, mpStatus: "processed" });
      return { ...refund, status: "REEMBOLSADO", mp_refund_id: localId, mp_status: "processed" };
    }

    if (payment.mp_order_id && payment.mp_payment_id) {
      const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(payment.mp_order_id)}`);
      const match = matchingOrderRefund(order, payment.mp_payment_id, refundCents, {
        preferredId: refund.mp_refund_id,
        excludedIds
      });
      if (!providerRefundConfirmed(match)) return refund;
      const mpRefundId = String(match.id);
      const mpStatus = normalizeStatus(match.status || "processed");
      const finalized = await finalizeRefund(env, refund, payment, { mpRefundId, mpStatus });
      if (!finalized.ok) return refund;
      return { ...refund, status: "REEMBOLSADO", mp_refund_id: mpRefundId, mp_status: mpStatus };
    }

    if (payment.mp_payment_id) {
      const providerState = await mpRequest(env, `/v1/payments/${encodeURIComponent(payment.mp_payment_id)}/refunds`);
      const match = matchingPaymentRefund(providerState, refundCents, {
        preferredId: refund.mp_refund_id,
        excludedIds
      });
      if (!providerRefundConfirmed(match)) return refund;
      const mpRefundId = String(match.id);
      const mpStatus = normalizeStatus(match.status || "processed");
      const finalized = await finalizeRefund(env, refund, payment, { mpRefundId, mpStatus });
      if (!finalized.ok) return refund;
      return { ...refund, status: "REEMBOLSADO", mp_refund_id: mpRefundId, mp_status: mpStatus };
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

'''
)

# A retry must be idempotent for the current remaining balance, while a later smaller balance gets a new operation.
patch(
    refunds_path,
    '  const idempotencyKey = `refund:${pedidoId}:${pagamentoId}`;\n',
    '  const idempotencyKey = `refund:v2:${pedidoId}:${pagamentoId}:${Number(payment.valor_centavos || 0)}`;\n'
)

patch(
    refunds_path,
    '''  if (!refund) return json({ erro: "Não foi possível iniciar o reembolso." }, 500);
  if (refund.status === "REEMBOLSADO") return json({ ok: true, reembolso: refund, ja_reembolsado: true });

  if (!automatic) {
''',
    '''  if (!refund) return json({ erro: "Não foi possível iniciar o reembolso." }, 500);
  if (refund.status === "REEMBOLSADO") return json({ ok: true, reembolso: refund, ja_reembolsado: true });
  if (refund.status === "FALHOU") {
    await env.DB.prepare(
      "UPDATE pedido_reembolsos SET status = 'PENDENTE', atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND status = 'FALHOU'"
    ).bind(refund.id).run();
    refund.status = "PENDENTE";
  }

  if (!automatic) {
'''
)

replace_between(
    refunds_path,
    "  let providerConfirmed = false;",
    "  } catch (error) {\n    if (providerConfirmed) {",
    '''  let providerConfirmed = false;
  try {
    const refundCents = Number(refund.valor_centavos || 0);
    const excludedIds = await claimedProviderRefundIds(env, pagamentoId, Number(refund.id));
    let providerRefund = null;

    if (localTestMode(env)) {
      providerRefund = {
        id: `local_refund_${refund.id}`,
        transaction_id: payment.mp_payment_id || `local_payment_${pagamentoId}`,
        amount: (refundCents / 100).toFixed(2),
        status: "processed"
      };
    } else if (payment.mp_order_id && payment.mp_payment_id) {
      const currentOrder = await mpRequest(env, `/v1/orders/${encodeURIComponent(payment.mp_order_id)}`);
      providerRefund = matchingOrderRefund(currentOrder, payment.mp_payment_id, refundCents, {
        preferredId: refund.mp_refund_id,
        excludedIds
      });

      if (!providerRefundConfirmed(providerRefund)) {
        const response = await mpRequest(
          env,
          `/v1/orders/${encodeURIComponent(payment.mp_order_id)}/refund`,
          {
            method: "POST",
            idempotencyKey: providerIdempotencyKey(idempotencyKey, "orders-v2"),
            body: {
              transactions: [{
                id: String(payment.mp_payment_id),
                amount: (refundCents / 100).toFixed(2)
              }]
            }
          }
        );
        providerRefund = matchingOrderRefund(response, payment.mp_payment_id, refundCents, {
          preferredId: refund.mp_refund_id,
          excludedIds
        });
      }
    } else if (payment.mp_payment_id) {
      const providerState = await mpRequest(env, `/v1/payments/${encodeURIComponent(payment.mp_payment_id)}/refunds`);
      providerRefund = matchingPaymentRefund(providerState, refundCents, {
        preferredId: refund.mp_refund_id,
        excludedIds
      });

      if (!providerRefundConfirmed(providerRefund)) {
        const response = await mpRequest(
          env,
          `/v1/payments/${encodeURIComponent(payment.mp_payment_id)}/refunds`,
          {
            method: "POST",
            idempotencyKey: providerIdempotencyKey(idempotencyKey, "payments-v2"),
            body: { amount: Number((refundCents / 100).toFixed(2)) }
          }
        );
        providerRefund = response;
      }
    }

    const confirmed = providerRefundConfirmed(providerRefund);
    providerConfirmed = confirmed;
    const mpRefundId = providerRefund?.id ? String(providerRefund.id) : refund.mp_refund_id || null;
    const mpStatus = normalizeStatus(providerRefund?.status || "");

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
    if (!finalized.ok) {
      return json({
        erro: "O provedor confirmou o reembolso, mas houve uma inconsistência local. Não repita o reembolso.",
        codigo: "REFUND_CONFIRMED_LOCAL_PENDING"
      }, finalized.httpStatus || 409);
    }
    const current = await env.DB.prepare("SELECT * FROM pedido_reembolsos WHERE id = ?").bind(refund.id).first();
    return json({ ok: true, reembolso: current, confirmado_por: "MERCADO_PAGO", ...finalized });
'''
)

# The automatic flow needs the provider transaction id to target only the remaining amount safely.
patch(
    refunds_path,
    '  const automatic = payment.metodo === "PIX_MP" && Boolean(payment.mp_order_id || payment.mp_payment_id);\n',
    '  const automatic = payment.metodo === "PIX_MP" && Boolean(payment.mp_payment_id);\n'
)

# UI: multiple historical refunds may belong to one payment. Only a pending refund blocks a new one.
patch(
    "admin/src/orders/ComandaDialog.tsx",
    '''  const refundByPayment = useMemo(
    () => new Map(refunds.map(refund => [Number(refund.pagamento_id), refund])),
    [refunds]
  );
''',
    '''  const refundsByPayment = useMemo(() => {
    const map = new Map<number, OrderRefund[]>();
    refunds.forEach(refund => {
      const paymentId = Number(refund.pagamento_id);
      const entries = map.get(paymentId) || [];
      entries.push(refund);
      map.set(paymentId, entries);
    });
    return map;
  }, [refunds]);
'''
)

patch(
    "admin/src/orders/ComandaDialog.tsx",
    '''                  const paymentId = Number(payment.id || 0);
                  const existingRefund = paymentId ? refundByPayment.get(paymentId) : undefined;
                  const refundPending = existingRefund?.status === "PENDENTE";
                  const refundCompleted = existingRefund?.status === "REEMBOLSADO";
                  const canRefund = refundAllowedByStatus && payment.status === "PAGO" && paymentId > 0 && !refundPending && !refundCompleted;
                  const retryRefund = existingRefund?.status === "FALHOU";
''',
    '''                  const paymentId = Number(payment.id || 0);
                  const paymentRefunds = paymentId ? refundsByPayment.get(paymentId) || [] : [];
                  const refundPending = paymentRefunds.some(refund => refund.status === "PENDENTE");
                  const completedRefunds = paymentRefunds.filter(refund => refund.status === "REEMBOLSADO");
                  const latestRefund = paymentRefunds[paymentRefunds.length - 1];
                  const canRefund = refundAllowedByStatus && payment.status === "PAGO" && Number(payment.valor_centavos || 0) > 0 && paymentId > 0 && !refundPending;
                  const retryRefund = latestRefund?.status === "FALHOU";
                  const hasPartialRefundHistory = completedRefunds.length > 0;
'''
)

patch(
    "admin/src/orders/ComandaDialog.tsx",
    '''                              {retryRefund ? "Tentar reembolso novamente" : "Reembolsar"}
''',
    '''                              {retryRefund
                                ? "Tentar reembolso novamente"
                                : hasPartialRefundHistory
                                  ? `Reembolsar saldo restante · ${money(payment.valor_centavos)}`
                                  : "Reembolsar"}
'''
)

# Make it clear that the panel refunds the amount still present on the payment, not necessarily its original amount.
patch(
    "admin/src/orders/RefundPanel.tsx",
    '''          <span>Reembolso integral</span>
          <strong>{money(payment.valor_centavos)}{automatic ? " pelo Mercado Pago" : ""}</strong>
''',
    '''          <span>Saldo a reembolsar</span>
          <strong>{money(payment.valor_centavos)}{automatic ? " pelo Mercado Pago" : ""}</strong>
'''
)

patch(
    "admin/src/orders/RefundPanel.tsx",
    '''        {automatic
          ? "O sistema só marcará este pagamento como reembolsado depois que o Mercado Pago confirmar o estorno."
          : "Confirme somente depois de devolver o dinheiro ao cliente. O sistema registrará este estorno como manual."}
''',
    '''        {automatic
          ? "Este é o saldo ainda pago neste lançamento. O sistema só o marcará como reembolsado depois que o Mercado Pago confirmar o estorno."
          : "Este é o saldo ainda pago neste lançamento. Confirme somente depois de devolver o dinheiro ao cliente."}
'''
)

# Regression coverage for chained partial refunds.
(ROOT / "tests/refund-remaining-balance.test.mjs").write_text(
    '''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst refundsApi = fs.readFileSync("functions/api/admin/orders/[id]/refunds.js", "utf8");\nconst comandaDialog = fs.readFileSync("admin/src/orders/ComandaDialog.tsx", "utf8");\nconst refundPanel = fs.readFileSync("admin/src/orders/RefundPanel.tsx", "utf8");\nconst migration = fs.readFileSync("migrations/036_reembolsos_parciais.sql", "utf8");\n\ntest("permite vários reembolsos concluídos para o mesmo pagamento", () => {\n  assert.match(migration, /DROP INDEX IF EXISTS uq_pedido_reembolsos_pagamento_concluido/);\n  assert.match(refundsApi, /refund:v2:\\$\\{pedidoId\\}:\\$\\{pagamentoId\\}:\\$\\{Number\\(payment\\.valor_centavos/);\n});\n\ntest("estorno Orders API identifica a devolução atual sem reutilizar a anterior", () => {\n  assert.match(refundsApi, /claimedProviderRefundIds/);\n  assert.match(refundsApi, /excludedIds/);\n  assert.match(refundsApi, /matchingOrderRefund/);\n  assert.match(refundsApi, /transactions: \[\{/);\n  assert.match(refundsApi, /amount: \\(refundCents \\/ 100\\)\\.toFixed\\(2\\)/);\n});\n\ntest("comanda mantém reembolso disponível após devolução parcial anterior", () => {\n  assert.match(comandaDialog, /refundsByPayment/);\n  assert.match(comandaDialog, /paymentRefunds\\.some\\(refund => refund\\.status === "PENDENTE"\\)/);\n  assert.match(comandaDialog, /Reembolsar saldo restante/);\n  assert.doesNotMatch(comandaDialog, /!refundCompleted/);\n});\n\ntest("painel descreve o saldo atual e não o pagamento original como integral", () => {\n  assert.match(refundPanel, /Saldo a reembolsar/);\n  assert.match(refundPanel, /saldo ainda pago neste lançamento/);\n  assert.doesNotMatch(refundPanel, /Reembolso integral/);\n});\n''',
    encoding="utf-8",
)
