import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { mpRequest } from "../../../lib/mercadoPago.js";
import { baixarEstoquePedido } from "../../../lib/stock.js";
import { syncOrderPayment } from "../../../lib/paymentSync.js";
import { logEvent } from "../../../lib/logger.js";

const RECONCILE_AFTER_SECONDS = 15;
const RECONCILE_BATCH_SIZE = 4;

async function reconcilePaidOrdersWithoutStock(env) {
  const { results } = await env.DB.prepare(
    `
    SELECT id
    FROM pedidos
    WHERE status_pagamento = 'PAGO'
      AND estoque_baixado_em IS NULL
      AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
    ORDER BY atualizado_em ASC, id ASC
    LIMIT ?
  `
  )
    .bind(RECONCILE_AFTER_SECONDS, RECONCILE_BATCH_SIZE)
    .all();

  await Promise.allSettled(
    (results || []).map(async ({ id }) => {
      try {
        const estoque = await baixarEstoquePedido(env, id);
        if (estoque.ok && estoque.baixado) {
          logEvent("info", "reconciliation.recovered", { pedido_id: id, status: "PAGO" });
        } else if (!estoque.ok) {
          logEvent("error", "stock.conversion_failed", {
            pedido_id: id,
            reason: "STOCK_CONVERSION_FAILED"
          });
          await env.DB.prepare(
            `
          UPDATE pedidos SET atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ? AND estoque_baixado_em IS NULL
        `
          )
            .bind(id)
            .run();
        }
      } catch (err) {
        logEvent("error", "stock.conversion_failed", {
          pedido_id: id,
          reason: "STOCK_CONVERSION_FAILED"
        });
        await env.DB.prepare(
          `
        UPDATE pedidos SET atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ? AND estoque_baixado_em IS NULL
      `
        )
          .bind(id)
          .run();
      }
    })
  );
}

async function reconcilePendingOrders(env) {
  if (!env.MP_ACCESS_TOKEN) return;

  const { results } = await env.DB.prepare(
    `
    SELECT id, mp_order_id
    FROM pedidos
    WHERE status_pagamento = 'PENDENTE'
      AND mp_order_id IS NOT NULL
      AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
    ORDER BY atualizado_em ASC, id ASC
    LIMIT ?
  `
  )
    .bind(RECONCILE_AFTER_SECONDS, RECONCILE_BATCH_SIZE)
    .all();

  const pending = results || [];
  if (!pending.length) return;

  await Promise.allSettled(
    pending.map(async pedido => {
      try {
        const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}`);
        await syncOrderPayment(env, { pedidoId: pedido.id, order, mpOrderId: pedido.mp_order_id });
      } catch (err) {
        // A reconciliação é uma rede de segurança. Falha ao consultar o MP não
        // deve derrubar a tela administrativa nem gerar uma tempestade de retries.
        logEvent("warn", "payment.sync_failed", {
          pedido_id: pedido.id,
          mp_order_id: pedido.mp_order_id,
          http_status: err?.status || undefined,
          reason: err?.status ? "MP_HTTP_ERROR" : "MP_RECONCILIATION_FAILED"
        });
        await env.DB.prepare("UPDATE pedidos SET atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(pedido.id)
          .run();
      }
    })
  );
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  // O webhook continua sendo a via principal. Esta reconciliação cobre casos
  // em que o evento final do Mercado Pago não chega (especialmente sandbox),
  // sem depender da aba do cliente permanecer aberta.
  await reconcilePendingOrders(env);
  await reconcilePaidOrdersWithoutStock(env);

  const { results } = await env.DB.prepare(
    `
    SELECT id, token_publico, produto_id, produto_nome, quantidade,
      valor_unitario_centavos, valor_total_centavos, cliente_nome, cliente_email,
      cliente_whatsapp, tipo_entrega, observacao, metodo_pagamento, status_pagamento, status_pedido,
      mp_order_id, mp_payment_id, mp_status, mp_status_detail,
      criado_em, atualizado_em, pago_em, estoque_baixado_em
    FROM pedidos ORDER BY id DESC LIMIT 250
  `
  ).all();
  const pedidos = results || [];
  if (!pedidos.length) return json({ pedidos: [] });

  const { results: itemRows } = await env.DB.prepare(
    `
    SELECT pedido_id, produto_id, produto_nome, quantidade,
           valor_unitario_centavos, valor_total_centavos, estoque_baixado_em
    FROM pedido_itens
    WHERE pedido_id IN (SELECT id FROM pedidos ORDER BY id DESC LIMIT 250)
    ORDER BY pedido_id DESC, id
  `
  ).all();
  const porPedido = new Map();
  for (const item of itemRows || []) {
    if (!porPedido.has(Number(item.pedido_id))) porPedido.set(Number(item.pedido_id), []);
    porPedido.get(Number(item.pedido_id)).push(item);
  }
  for (const pedido of pedidos) pedido.itens = porPedido.get(Number(pedido.id)) || [];
  return json({ pedidos });
}
