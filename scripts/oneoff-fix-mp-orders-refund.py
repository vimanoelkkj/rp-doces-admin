from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:200]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Mercado Pago local fake: model the Orders API refund used by this integration.
replace_once(
    "functions/lib/mercadoPago.js",
    '''  const paymentRefundMatch = path.match(/^\\/v1\\/payments\\/([^/]+)\\/refunds$/);\n  if (method === "POST" && paymentRefundMatch) {\n    const paymentId = decodeURIComponent(paymentRefundMatch[1]);\n    const amount = Number(body?.amount || 0);\n    return {\n      id: `local_refund_${fakeOrderId(idempotencyKey)}`,\n      payment_id: paymentId,\n      amount,\n      status: "approved"\n    };\n  }\n\n''',
    '''  const orderRefundMatch = path.match(/^\\/v1\\/orders\\/([^/]+)\\/refund$/);\n  if (method === "POST" && orderRefundMatch) {\n    const orderId = decodeURIComponent(orderRefundMatch[1]);\n    const transaction = body?.transactions?.[0] || {};\n    return {\n      id: orderId,\n      status: "processed",\n      status_detail: "partially_refunded",\n      transactions: {\n        refunds: [{\n          id: `local_refund_${fakeOrderId(idempotencyKey)}`,\n          transaction_id: String(transaction.id || ""),\n          amount: String(transaction.amount || "0.00"),\n          status: "processed"\n        }]\n      }\n    };\n  }\n\n'''
)

# Financial hydration only advertises automatic refund when both Order and transaction IDs exist.
replace_once(
    "functions/lib/orderLedger.js",
    '''    `SELECT a.pagamento_id, a.pedido_item_id, a.valor_centavos, p.pedido_id, p.status,\n            p.metodo, p.mp_payment_id\n''',
    '''    `SELECT a.pagamento_id, a.pedido_item_id, a.valor_centavos, p.pedido_id, p.status,\n            p.metodo, p.mp_order_id, p.mp_payment_id\n'''
)
replace_once(
    "functions/lib/orderLedger.js",
    '''        sources.every(source => source.metodo === "PIX_MP" && Boolean(source.mp_payment_id));\n''',
    '''        sources.every(source =>\n          source.metodo === "PIX_MP" && Boolean(source.mp_order_id) && Boolean(source.mp_payment_id)\n        );\n'''
)
replace_once(
    "functions/lib/orderLedger.js",
    '''        orderPayments[0]?.metodo === "PIX_MP" &&\n        Boolean(orderPayments[0]?.mp_payment_id);\n''',
    '''        orderPayments[0]?.metodo === "PIX_MP" &&\n        Boolean(orderPayments[0]?.mp_order_id) &&\n        Boolean(orderPayments[0]?.mp_payment_id);\n'''
)

# Paid-item exchange: use the Orders API refund endpoint, not the legacy Payments refund endpoint.
replace_once(
    "functions/api/admin/orders/[id]/items/[itemId]/exchange.js",
    '''const REFUND_METHODS = new Set(["PIX_EXTERNO", "DINHEIRO", "CARTAO", "OUTRO"]);\nconst CONFIRMED_MP_REFUND_STATUSES = new Set(["approved", "processed", "refunded"]);\n''',
    '''const REFUND_METHODS = new Set(["PIX_EXTERNO", "DINHEIRO", "CARTAO", "OUTRO"]);\nconst CONFIRMED_MP_REFUND_STATUSES = new Set(["processed", "refunded"]);\n'''
)
replace_once(
    "functions/api/admin/orders/[id]/items/[itemId]/exchange.js",
    '''function automaticRefundAllocation(allocations, refundCents) {\n  if (refundCents <= 0 || !Array.isArray(allocations) || allocations.length === 0) return null;\n  const paymentIds = new Set(allocations.map(item => Number(item.pagamento_id)).filter(Number.isInteger));\n  if (paymentIds.size !== 1) return null;\n  const paymentId = [...paymentIds][0];\n  const samePayment = allocations.filter(item => Number(item.pagamento_id) === paymentId);\n  const allocated = samePayment.reduce((sum, item) => sum + Number(item.valor_centavos || 0), 0);\n  const eligible =\n    allocated >= refundCents &&\n    samePayment.every(item => upper(item.metodo) === "PIX_MP" && Boolean(item.mp_payment_id));\n  return eligible ? samePayment[0] : null;\n}\n\nfunction automaticRefundKey({ pedidoId, item, produtoId, quantidade, refundCents, pagamentoId }) {\n  return `exchange-mp:${pedidoId}:${item.id}:${item.produto_id}:${produtoId}:${quantidade}:${refundCents}:${pagamentoId}`;\n}\n\n''',
    '''function automaticRefundAllocation(allocations, refundCents) {\n  if (refundCents <= 0 || !Array.isArray(allocations) || allocations.length === 0) return null;\n  const paymentIds = new Set(allocations.map(item => Number(item.pagamento_id)).filter(Number.isInteger));\n  if (paymentIds.size !== 1) return null;\n  const paymentId = [...paymentIds][0];\n  const samePayment = allocations.filter(item => Number(item.pagamento_id) === paymentId);\n  const allocated = samePayment.reduce((sum, item) => sum + Number(item.valor_centavos || 0), 0);\n  const eligible =\n    allocated >= refundCents &&\n    samePayment.every(item =>\n      upper(item.metodo) === "PIX_MP" && Boolean(item.mp_order_id) && Boolean(item.mp_payment_id)\n    );\n  return eligible ? samePayment[0] : null;\n}\n\nfunction automaticRefundKey({ pedidoId, item, produtoId, quantidade, refundCents, pagamentoId }) {\n  return `exchange-mp:${pedidoId}:${item.id}:${item.produto_id}:${produtoId}:${quantidade}:${refundCents}:${pagamentoId}`;\n}\n\nfunction providerRefundKey(localKey) {\n  return `${localKey}:orders-v2`.slice(0, 128);\n}\n\nfunction centsFromProviderAmount(value) {\n  const amount = Number(value);\n  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;\n}\n\nfunction matchingOrderRefund(order, transactionId, refundCents) {\n  const refunds = Array.isArray(order?.transactions?.refunds) ? order.transactions.refunds : [];\n  return refunds.find(refund =>\n    String(refund?.transaction_id || "") === String(transactionId || "") &&\n    centsFromProviderAmount(refund?.amount) === refundCents\n  ) || null;\n}\n\nfunction confirmedOrderRefund(refund) {\n  return Boolean(refund?.id) && CONFIRMED_MP_REFUND_STATUSES.has(lower(refund?.status));\n}\n\n'''
)

old_block = '''    const alreadyConfirmed =\n      upper(automaticRefundRecord.status) === "REEMBOLSADO" ||\n      (Boolean(automaticRefundRecord.mp_refund_id) && CONFIRMED_MP_REFUND_STATUSES.has(lower(automaticRefundRecord.mp_status)));\n\n    if (!alreadyConfirmed) {\n      try {\n        const response = await mpRequest(\n          env,\n          `/v1/payments/${encodeURIComponent(automaticAllocation.mp_payment_id)}/refunds`,\n          {\n            method: "POST",\n            idempotencyKey,\n            body: { amount: Number((refundCents / 100).toFixed(2)) }\n          }\n        );\n        const providerStatus = lower(response?.status || "");\n        const providerConfirmed = Boolean(response?.id) && CONFIRMED_MP_REFUND_STATUSES.has(providerStatus);\n        const mpRefundId = response?.id ? String(response.id) : null;\n\n        await env.DB.prepare(\n          `UPDATE pedido_reembolsos\n           SET mp_refund_id = COALESCE(?, mp_refund_id),\n               mp_status = ?, atualizado_em = CURRENT_TIMESTAMP\n           WHERE id = ?`\n        ).bind(mpRefundId, providerStatus || null, automaticRefundRecord.id).run();\n\n        automaticRefundRecord.mp_refund_id = mpRefundId;\n        automaticRefundRecord.mp_status = providerStatus;\n\n        if (!providerConfirmed) {\n          return json({\n            erro: "O Mercado Pago recebeu o pedido de estorno, mas ainda não confirmou a devolução. A troca não foi concluída.",\n            codigo: "EXCHANGE_REFUND_PENDING",\n            mp_refund_id: mpRefundId\n          }, 409);\n        }\n      } catch (error) {\n        await env.DB.prepare(\n          `UPDATE pedido_reembolsos\n           SET status = 'FALHOU', mp_status = ?, atualizado_em = CURRENT_TIMESTAMP\n           WHERE id = ? AND status = 'PENDENTE'`\n        ).bind(`HTTP_${Number(error?.status || 0) || 0}`, automaticRefundRecord.id).run();\n\n        logEvent("warn", "comanda.exchange_refund_failed", {\n          pedido_id: pedidoId,\n          item_id: itemId,\n          mp_order_id: automaticAllocation.mp_order_id || undefined,\n          http_status: Number(error?.status || 0) || undefined,\n          reason: "EXCHANGE_REFUND_PROVIDER_FAILED"\n        });\n        return json({\n          erro: "O Mercado Pago não confirmou o estorno. O produto, o estoque e o financeiro não foram alterados.",\n          codigo: "EXCHANGE_REFUND_FAILED"\n        }, 502);\n      }\n    }\n'''

new_block = '''    const alreadyConfirmed =\n      upper(automaticRefundRecord.status) === "REEMBOLSADO" ||\n      (Boolean(automaticRefundRecord.mp_refund_id) && CONFIRMED_MP_REFUND_STATUSES.has(lower(automaticRefundRecord.mp_status)));\n\n    if (!alreadyConfirmed) {\n      try {\n        // Primeiro reconcilia a Order. Isto protege retries depois de uma resposta ambígua:\n        // se o provedor já devolveu o valor, não disparamos um segundo estorno.\n        const orderState = await mpRequest(\n          env,\n          `/v1/orders/${encodeURIComponent(automaticAllocation.mp_order_id)}`\n        );\n        let providerRefund = matchingOrderRefund(\n          orderState,\n          automaticAllocation.mp_payment_id,\n          refundCents\n        );\n\n        if (!confirmedOrderRefund(providerRefund)) {\n          const response = await mpRequest(\n            env,\n            `/v1/orders/${encodeURIComponent(automaticAllocation.mp_order_id)}/refund`,\n            {\n              method: "POST",\n              idempotencyKey: providerRefundKey(idempotencyKey),\n              body: {\n                transactions: [{\n                  id: String(automaticAllocation.mp_payment_id),\n                  amount: (refundCents / 100).toFixed(2)\n                }]\n              }\n            }\n          );\n          providerRefund = matchingOrderRefund(\n            response,\n            automaticAllocation.mp_payment_id,\n            refundCents\n          );\n        }\n\n        const providerConfirmed = confirmedOrderRefund(providerRefund);\n        const mpRefundId = providerRefund?.id ? String(providerRefund.id) : null;\n        const providerStatus = lower(providerRefund?.status || "");\n\n        await env.DB.prepare(\n          `UPDATE pedido_reembolsos\n           SET mp_refund_id = COALESCE(?, mp_refund_id),\n               mp_status = ?, atualizado_em = CURRENT_TIMESTAMP\n           WHERE id = ?`\n        ).bind(mpRefundId, providerStatus || null, automaticRefundRecord.id).run();\n\n        automaticRefundRecord.mp_refund_id = mpRefundId;\n        automaticRefundRecord.mp_status = providerStatus;\n\n        if (!providerConfirmed) {\n          return json({\n            erro: "O Mercado Pago recebeu o pedido de estorno, mas ainda não confirmou a devolução. A troca não foi concluída.",\n            codigo: "EXCHANGE_REFUND_PENDING",\n            mp_refund_id: mpRefundId\n          }, 409);\n        }\n      } catch (error) {\n        await env.DB.prepare(\n          `UPDATE pedido_reembolsos\n           SET status = 'FALHOU', mp_status = ?, atualizado_em = CURRENT_TIMESTAMP\n           WHERE id = ? AND status = 'PENDENTE'`\n        ).bind(`HTTP_${Number(error?.status || 0) || 0}`, automaticRefundRecord.id).run();\n\n        logEvent("warn", "comanda.exchange_refund_failed", {\n          pedido_id: pedidoId,\n          item_id: itemId,\n          mp_order_id: automaticAllocation.mp_order_id || undefined,\n          http_status: Number(error?.status || 0) || undefined,\n          reason: "EXCHANGE_REFUND_PROVIDER_FAILED"\n        });\n        return json({\n          erro: "O Mercado Pago não confirmou o estorno. O produto, o estoque e o financeiro não foram alterados.",\n          codigo: "EXCHANGE_REFUND_FAILED"\n        }, 502);\n      }\n    }\n'''
replace_once("functions/api/admin/orders/[id]/items/[itemId]/exchange.js", old_block, new_block)

# Tests now assert the Orders API semantics through the local fake and require mp_order_id for eligibility.
replace_once(
    "tests/paid-item-exchange.test.mjs",
    '''function buildDb({ targetPrice = 3500, paymentMethod = "PIX_EXTERNO", mpPaymentId = null } = {}) {\n''',
    '''function buildDb({ targetPrice = 3500, paymentMethod = "PIX_EXTERNO", mpPaymentId = null, mpOrderId = null } = {}) {\n'''
)
replace_once(
    "tests/paid-item-exchange.test.mjs",
    '''              mp_order_id: mpPaymentId ? "ord_123" : null,\n              mp_payment_id: mpPaymentId\n''',
    '''              mp_order_id: mpOrderId || (mpPaymentId ? "ord_123" : null),\n              mp_payment_id: mpPaymentId\n'''
)
replace_once(
    "tests/paid-item-exchange.test.mjs",
    '''test("troca mais barata paga por Pix Mercado Pago estorna automaticamente", async () => {\n  const memory = buildDb({ targetPrice: 3500, paymentMethod: "PIX_MP", mpPaymentId: "pay_123" });\n''',
    '''test("troca mais barata paga por Pix Mercado Pago estorna automaticamente via Orders API", async () => {\n  const memory = buildDb({\n    targetPrice: 3500,\n    paymentMethod: "PIX_MP",\n    mpPaymentId: "pay_123",\n    mpOrderId: "ord_123"\n  });\n'''
)
replace_once(
    "tests/paid-item-exchange.test.mjs",
    '''test("falha no estorno Mercado Pago não altera produto nem estoque", async () => {\n  const memory = buildDb({ targetPrice: 3500, paymentMethod: "PIX_MP", mpPaymentId: "pay_123" });\n''',
    '''test("falha no estorno Mercado Pago não altera produto nem estoque", async () => {\n  const memory = buildDb({\n    targetPrice: 3500,\n    paymentMethod: "PIX_MP",\n    mpPaymentId: "pay_123",\n    mpOrderId: "ord_123"\n  });\n'''
)
