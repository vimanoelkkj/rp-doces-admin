import { json, bodyJson, sameOrigin } from "../../../../../../lib/http.js";
import { requireUser } from "../../../../../../lib/auth.js";
import { ensureLegacyPaymentMaterialized, recalculateComanda } from "../../../../../../lib/comandaLedger.js";
import { mpRequest } from "../../../../../../lib/mercadoPago.js";
import { logEvent } from "../../../../../../lib/logger.js";

const REFUND_METHODS = new Set(["PIX_EXTERNO", "DINHEIRO", "CARTAO", "OUTRO"]);
const CONFIRMED_MP_REFUND_STATUSES = new Set(["processed", "refunded"]);

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function automaticRefundAllocation(allocations, refundCents) {
  if (refundCents <= 0 || !Array.isArray(allocations) || allocations.length === 0) return null;
  const paymentIds = new Set(allocations.map(item => Number(item.pagamento_id)).filter(Number.isInteger));
  if (paymentIds.size !== 1) return null;
  const paymentId = [...paymentIds][0];
  const samePayment = allocations.filter(item => Number(item.pagamento_id) === paymentId);
  const allocated = samePayment.reduce((sum, item) => sum + Number(item.valor_centavos || 0), 0);
  const eligible =
    allocated >= refundCents &&
    samePayment.every(item =>
      upper(item.metodo) === "PIX_MP" && Boolean(item.mp_order_id) && Boolean(item.mp_payment_id)
    );
  return eligible ? samePayment[0] : null;
}

function automaticRefundKey({ pedidoId, item, produtoId, quantidade, refundCents, pagamentoId }) {
  return `exchange-mp:${pedidoId}:${item.id}:${item.produto_id}:${produtoId}:${quantidade}:${refundCents}:${pagamentoId}`;
}

function providerRefundKey(localKey) {
  return `${localKey}:orders-v2`.slice(0, 128);
}

function centsFromProviderAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}

function matchingOrderRefund(order, transactionId, refundCents) {
  const refunds = Array.isArray(order?.transactions?.refunds) ? order.transactions.refunds : [];
  return refunds.find(refund =>
    String(refund?.transaction_id || "") === String(transactionId || "") &&
    centsFromProviderAmount(refund?.amount) === refundCents
  ) || null;
}

function confirmedOrderRefund(refund) {
  return Boolean(refund?.id) && CONFIRMED_MP_REFUND_STATUSES.has(lower(refund?.status));
}

function promotionPrice(product, now = Date.now()) {
  const inicioOk = !product.promocao_inicio || Date.parse(product.promocao_inicio) <= now;
  const fimOk = !product.promocao_fim || Date.parse(product.promocao_fim) > now;
  const promo = Boolean(product.promocao_ativa) && Number(product.preco_promocional_centavos) > 0 && inicioOk && fimOk;
  return promo ? Number(product.preco_promocional_centavos) : Number(product.preco_centavos);
}

function productAvailability(product) {
  return Number(product?.estoque || 0) - Number(product?.estoque_reservado || 0);
}

function defaultRefundMethod(paymentMethod) {
  const method = upper(paymentMethod);
  if (method === "DINHEIRO") return "DINHEIRO";
  if (method === "CARTAO") return "CARTAO";
  if (method === "PIX_MP" || method === "PIX_EXTERNO") return "PIX_EXTERNO";
  return "OUTRO";
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  const itemId = Number(params.itemId);
  const body = await bodyJson(request);
  const produtoId = Number(body?.produto_id);
  const quantidade = Number(body?.quantidade);

  if (
    !Number.isInteger(pedidoId) || pedidoId < 1 ||
    !Number.isInteger(itemId) || itemId < 1 ||
    !Number.isInteger(produtoId) || produtoId < 1 ||
    !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50
  ) {
    return json({ erro: "Dados da troca inválidos." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, status_pedido, status_comanda, reserva_status
     FROM pedidos WHERE id = ? LIMIT 1`
  ).bind(pedidoId).first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (upper(pedido.status_comanda || "ABERTA") !== "ABERTA") {
    return json({ erro: "Reabra a comanda antes de trocar um produto pago." }, 409);
  }
  if (upper(pedido.status_pedido) === "CANCELADO") {
    return json({ erro: "Pedido cancelado não pode ter produto trocado." }, 409);
  }

  await ensureLegacyPaymentMaterialized(env, pedidoId);

  const item = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_unitario_centavos, valor_total_centavos, estoque_baixado_em
     FROM pedido_itens
     WHERE id = ? AND pedido_id = ? LIMIT 1`
  ).bind(itemId, pedidoId).first();
  if (!item) return json({ erro: "Item do pedido não encontrado." }, 404);
  if (!Number(item.produto_id || 0)) {
    return json({ erro: "O produto original não existe mais no estoque e precisa ser reconciliado manualmente." }, 409);
  }

  const { results: allocations } = await env.DB.prepare(
    `SELECT a.id, a.pagamento_id, a.valor_centavos,
            p.metodo, p.valor_centavos AS pagamento_valor_centavos,
            p.valor_original_centavos, p.mp_order_id, p.mp_payment_id
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos p ON p.id = a.pagamento_id
     WHERE a.pedido_item_id = ? AND p.status = 'PAGO'
     ORDER BY a.id DESC`
  ).bind(itemId).all();

  const paidAllocations = allocations || [];
  const paidCents = paidAllocations.reduce((sum, allocation) => sum + Number(allocation.valor_centavos || 0), 0);
  if (paidCents <= 0) {
    return json({ erro: "Este item não possui pagamento confirmado. Use a troca normal do pedido." }, 409);
  }

  const product = await env.DB.prepare(
    `SELECT id, nome, preco_centavos, disponivel, ativo, estoque, estoque_reservado,
            promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
     FROM produtos WHERE id = ? LIMIT 1`
  ).bind(produtoId).first();
  if (!product || !product.ativo) return json({ erro: "Produto novo não encontrado ou arquivado." }, 404);

  const sameProduct = Number(item.produto_id) === produtoId;
  const sourceDeducted = Boolean(item.estoque_baixado_em);
  const reservationActive = upper(pedido.reserva_status) === "ATIVA" && !sourceDeducted;
  if (!sourceDeducted && !reservationActive) {
    return json({
      erro: "O item pago está sem baixa ou reserva de estoque. Reconcilie o estoque antes de realizar a troca."
    }, 409);
  }

  const currentQuantity = Number(item.quantidade || 0);
  const availabilityCredit = sameProduct ? currentQuantity : 0;
  const available = productAvailability(product) + availabilityCredit;
  if (available < quantidade) {
    return json({ erro: `${product.nome}: estoque disponível insuficiente para a troca.` }, 409);
  }

  const unitCents = sameProduct ? Number(item.valor_unitario_centavos || 0) : promotionPrice(product);
  const subtotal = unitCents * quantidade;
  if (!Number.isSafeInteger(unitCents) || unitCents <= 0 || !Number.isSafeInteger(subtotal) || subtotal <= 0) {
    return json({ erro: "Valor do novo produto inválido." }, 400);
  }

  const refundCents = Math.max(0, paidCents - subtotal);
  const automaticAllocation = automaticRefundAllocation(paidAllocations, refundCents);
  const automaticRefund = Boolean(automaticAllocation);
  const refundMethod = automaticRefund
    ? "PIX_MP"
    : upper(body?.devolucao_metodo) || defaultRefundMethod(paidAllocations[0]?.metodo);

  if (refundCents > 0 && !automaticRefund) {
    if (upper(body?.confirmacao_devolucao) !== "DEVOLVIDO") {
      return json({
        erro: `Confirme a devolução de R$ ${(refundCents / 100).toFixed(2).replace(".", ",")} antes de concluir a troca.`
      }, 409);
    }
    if (!REFUND_METHODS.has(refundMethod)) {
      return json({ erro: "Forma de devolução inválida." }, 400);
    }
  }

  let automaticRefundRecord = null;
  if (automaticRefund) {
    const idempotencyKey = automaticRefundKey({
      pedidoId,
      item,
      produtoId,
      quantidade,
      refundCents,
      pagamentoId: Number(automaticAllocation.pagamento_id)
    });

    automaticRefundRecord = await env.DB.prepare(
      "SELECT * FROM pedido_reembolsos WHERE idempotency_key = ? LIMIT 1"
    ).bind(idempotencyKey).first();

    if (!automaticRefundRecord) {
      const inserted = await env.DB.prepare(
        `INSERT INTO pedido_reembolsos (
           pedido_id, pagamento_id, origem, metodo, valor_centavos, status,
           idempotency_key, registrado_por_usuario_id, motivo, devolveu_estoque
         ) VALUES (?, ?, 'MERCADO_PAGO', 'PIX_MP', ?, 'PENDENTE', ?, ?, ?, 0)`
      ).bind(
        pedidoId,
        Number(automaticAllocation.pagamento_id),
        refundCents,
        idempotencyKey,
        auth.user.id,
        `Estorno automático da diferença na troca de ${item.produto_nome || "produto"} por ${product.nome}`
      ).run();
      automaticRefundRecord = {
        id: Number(inserted?.meta?.last_row_id || 0),
        pedido_id: pedidoId,
        pagamento_id: Number(automaticAllocation.pagamento_id),
        origem: "MERCADO_PAGO",
        metodo: "PIX_MP",
        valor_centavos: refundCents,
        status: "PENDENTE",
        idempotency_key: idempotencyKey,
        mp_refund_id: null,
        mp_status: null
      };
    } else if (upper(automaticRefundRecord.status) === "FALHOU") {
      await env.DB.prepare(
        "UPDATE pedido_reembolsos SET status = 'PENDENTE', atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND status = 'FALHOU'"
      ).bind(automaticRefundRecord.id).run();
      automaticRefundRecord.status = "PENDENTE";
    }

    const alreadyConfirmed =
      upper(automaticRefundRecord.status) === "REEMBOLSADO" ||
      (Boolean(automaticRefundRecord.mp_refund_id) && CONFIRMED_MP_REFUND_STATUSES.has(lower(automaticRefundRecord.mp_status)));

    if (!alreadyConfirmed) {
      try {
        // Primeiro reconcilia a Order. Isto protege retries depois de uma resposta ambígua:
        // se o provedor já devolveu o valor, não disparamos um segundo estorno.
        const orderState = await mpRequest(
          env,
          `/v1/orders/${encodeURIComponent(automaticAllocation.mp_order_id)}`
        );
        let providerRefund = matchingOrderRefund(
          orderState,
          automaticAllocation.mp_payment_id,
          refundCents
        );

        if (!confirmedOrderRefund(providerRefund)) {
          const response = await mpRequest(
            env,
            `/v1/orders/${encodeURIComponent(automaticAllocation.mp_order_id)}/refund`,
            {
              method: "POST",
              idempotencyKey: providerRefundKey(idempotencyKey),
              body: {
                transactions: [{
                  id: String(automaticAllocation.mp_payment_id),
                  amount: (refundCents / 100).toFixed(2)
                }]
              }
            }
          );
          providerRefund = matchingOrderRefund(
            response,
            automaticAllocation.mp_payment_id,
            refundCents
          );
        }

        const providerConfirmed = confirmedOrderRefund(providerRefund);
        const mpRefundId = providerRefund?.id ? String(providerRefund.id) : null;
        const providerStatus = lower(providerRefund?.status || "");

        await env.DB.prepare(
          `UPDATE pedido_reembolsos
           SET mp_refund_id = COALESCE(?, mp_refund_id),
               mp_status = ?, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(mpRefundId, providerStatus || null, automaticRefundRecord.id).run();

        automaticRefundRecord.mp_refund_id = mpRefundId;
        automaticRefundRecord.mp_status = providerStatus;

        if (!providerConfirmed) {
          return json({
            erro: "O Mercado Pago recebeu o pedido de estorno, mas ainda não confirmou a devolução. A troca não foi concluída.",
            codigo: "EXCHANGE_REFUND_PENDING",
            mp_refund_id: mpRefundId
          }, 409);
        }
      } catch (error) {
        await env.DB.prepare(
          `UPDATE pedido_reembolsos
           SET status = 'FALHOU', mp_status = ?, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'PENDENTE'`
        ).bind(`HTTP_${Number(error?.status || 0) || 0}`, automaticRefundRecord.id).run();

        logEvent("warn", "comanda.exchange_refund_failed", {
          pedido_id: pedidoId,
          item_id: itemId,
          mp_order_id: automaticAllocation.mp_order_id || undefined,
          http_status: Number(error?.status || 0) || undefined,
          reason: "EXCHANGE_REFUND_PROVIDER_FAILED"
        });
        return json({
          erro: "O Mercado Pago não confirmou o estorno. O produto, o estoque e o financeiro não foram alterados.",
          codigo: "EXCHANGE_REFUND_FAILED"
        }, 502);
      }
    }
  }

  const statements = [];
  let remainingRefund = refundCents;
  const operationId = crypto.randomUUID();

  for (const allocation of paidAllocations) {
    if (remainingRefund <= 0) break;
    const allocated = Number(allocation.valor_centavos || 0);
    const slice = Math.min(allocated, remainingRefund);
    if (slice <= 0) continue;

    if (slice === allocated) {
      statements.push(env.DB.prepare(
        "DELETE FROM pedido_pagamento_alocacoes WHERE id = ?"
      ).bind(allocation.id));
    } else {
      statements.push(env.DB.prepare(
        "UPDATE pedido_pagamento_alocacoes SET valor_centavos = valor_centavos - ? WHERE id = ? AND valor_centavos > ?"
      ).bind(slice, allocation.id, slice));
    }

    const paymentCurrent = Number(allocation.pagamento_valor_centavos || 0);
    if (slice >= paymentCurrent) {
      statements.push(env.DB.prepare(
        `UPDATE pedido_pagamentos
         SET valor_original_centavos = COALESCE(valor_original_centavos, valor_centavos),
             status = 'REEMBOLSADO', atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'PAGO'`
      ).bind(allocation.pagamento_id));
    } else {
      statements.push(env.DB.prepare(
        `UPDATE pedido_pagamentos
         SET valor_original_centavos = COALESCE(valor_original_centavos, valor_centavos),
             valor_centavos = valor_centavos - ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'PAGO' AND valor_centavos > ?`
      ).bind(slice, allocation.pagamento_id, slice));
    }

    if (!automaticRefund) {
      statements.push(env.DB.prepare(
        `INSERT INTO pedido_reembolsos (
           pedido_id, pagamento_id, origem, metodo, valor_centavos, status,
           idempotency_key, registrado_por_usuario_id, motivo, devolveu_estoque,
           concluido_em
         ) VALUES (?, ?, 'MANUAL', ?, ?, 'REEMBOLSADO', ?, ?, ?, 0, CURRENT_TIMESTAMP)`
      ).bind(
        pedidoId,
        allocation.pagamento_id,
        refundMethod,
        slice,
        `exchange:${pedidoId}:${itemId}:${operationId}:${allocation.pagamento_id}`,
        auth.user.id,
        `Devolução de diferença na troca de ${item.produto_nome || "produto"} por ${product.nome}`
      ));
    }

    remainingRefund -= slice;
  }

  if (remainingRefund > 0) {
    return json({ erro: "Não foi possível vincular toda a devolução aos pagamentos do item." }, 409);
  }

  if (automaticRefund && automaticRefundRecord?.id) {
    statements.push(env.DB.prepare(
      `UPDATE pedido_reembolsos
       SET status = 'REEMBOLSADO',
           concluido_em = COALESCE(concluido_em, CURRENT_TIMESTAMP),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('PENDENTE', 'REEMBOLSADO')`
    ).bind(automaticRefundRecord.id));
  }

  if (sourceDeducted) {
    if (sameProduct) {
      const stockDelta = currentQuantity - quantidade;
      if (stockDelta !== 0) {
        statements.push(env.DB.prepare(
          `UPDATE produtos
           SET estoque = estoque + ?,
               disponivel = CASE WHEN ativo = 1 AND (estoque + ?) - estoque_reservado > 0 THEN 1 ELSE 0 END,
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(stockDelta, stockDelta, produtoId));
      }
    } else {
      statements.push(env.DB.prepare(
        `UPDATE produtos
         SET estoque = estoque + ?,
             disponivel = CASE WHEN ativo = 1 AND (estoque + ?) - estoque_reservado > 0 THEN 1 ELSE 0 END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(currentQuantity, currentQuantity, item.produto_id));
      statements.push(env.DB.prepare(
        `UPDATE produtos
         SET estoque = estoque - ?,
             disponivel = CASE WHEN ativo = 1 AND (estoque - ?) - estoque_reservado > 0 THEN 1 ELSE 0 END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND estoque - estoque_reservado >= ?`
      ).bind(quantidade, quantidade, produtoId, quantidade));
    }
  } else if (reservationActive) {
    if (sameProduct) {
      const reserveDelta = quantidade - currentQuantity;
      if (reserveDelta !== 0) {
        statements.push(env.DB.prepare(
          `UPDATE produtos
           SET estoque_reservado = estoque_reservado + ?,
               disponivel = CASE WHEN ativo = 1 AND estoque - (estoque_reservado + ?) > 0 THEN 1 ELSE 0 END,
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(reserveDelta, reserveDelta, produtoId));
      }
    } else {
      statements.push(env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado - ?,
             disponivel = CASE WHEN ativo = 1 AND estoque - (estoque_reservado - ?) > 0 THEN 1 ELSE 0 END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND estoque_reservado >= ?`
      ).bind(currentQuantity, currentQuantity, item.produto_id, currentQuantity));
      statements.push(env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = estoque_reservado + ?,
             disponivel = CASE WHEN ativo = 1 AND estoque - (estoque_reservado + ?) > 0 THEN 1 ELSE 0 END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND estoque - estoque_reservado >= ?`
      ).bind(quantidade, quantidade, produtoId, quantidade));
    }
  }

  statements.push(env.DB.prepare(
    `UPDATE pedido_itens
     SET produto_id = ?, produto_nome = ?, quantidade = ?,
         valor_unitario_centavos = ?, valor_total_centavos = ?
     WHERE id = ? AND pedido_id = ?`
  ).bind(produtoId, product.nome, quantidade, unitCents, subtotal, itemId, pedidoId));

  statements.push(env.DB.prepare(
    `INSERT INTO pedido_item_correcoes (
       pedido_id, item_origem_id, produto_origem_id, produto_origem_nome,
       quantidade_origem, valor_origem_centavos,
       item_destino_id, produto_destino_id, produto_destino_nome,
       quantidade_destino, valor_destino_centavos,
       valor_realocado_centavos, credito_gerado_centavos,
       estoque_origem_reposto, reserva_origem_liberada,
       estoque_destino_baixado, realizado_por_usuario_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  ).bind(
    pedidoId,
    itemId,
    item.produto_id,
    item.produto_nome || "Produto",
    currentQuantity,
    Number(item.valor_total_centavos || 0),
    itemId,
    produtoId,
    product.nome,
    quantidade,
    subtotal,
    Math.min(paidCents, subtotal),
    sourceDeducted && !sameProduct ? 1 : 0,
    reservationActive && !sameProduct ? 1 : 0,
    sourceDeducted ? 1 : 0,
    auth.user.id
  ));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error?.message || "").includes("CHECK")) {
      return json({ erro: "O estoque ou o financeiro mudou durante a troca. Atualize e tente novamente." }, 409);
    }
    throw error;
  }

  const state = await recalculateComanda(env, pedidoId);

  logEvent("info", "comanda.paid_item_exchanged", {
    pedido_id: pedidoId,
    item_id: itemId,
    produto_anterior_id: Number(item.produto_id),
    produto_id: produtoId,
    valor_anterior_centavos: Number(item.valor_total_centavos || 0),
    valor_novo_centavos: subtotal,
    devolucao_centavos: refundCents,
    devolucao_metodo: refundCents > 0 ? refundMethod : undefined,
    devolucao_automatica: automaticRefund,
    estoque_origem_reposto: sourceDeducted && !sameProduct,
    estoque_destino_baixado: sourceDeducted,
    usuario_id: auth.user.id
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    item_id: itemId,
    produto_anterior_id: Number(item.produto_id),
    produto_id: produtoId,
    produto_nome: product.nome,
    quantidade,
    valor_total_centavos: subtotal,
    valor_pago_preservado_centavos: Math.min(paidCents, subtotal),
    devolucao_centavos: refundCents,
    devolucao_metodo: refundCents > 0 ? refundMethod : null,
    devolucao_automatica: automaticRefund,
    mp_refund_id: automaticRefund ? automaticRefundRecord?.mp_refund_id || null : null,
    estoque_original_reposto: sourceDeducted && !sameProduct,
    reserva_original_liberada: reservationActive && !sameProduct,
    estoque_novo_baixado: sourceDeducted,
    status_financeiro: state?.status_financeiro || "PENDENTE",
    total_centavos: state?.total_centavos || 0,
    pago_centavos: state?.pago_centavos || 0,
    saldo_centavos: state?.saldo_centavos || 0,
    credito_centavos: state?.credito_centavos || 0
  });
}
