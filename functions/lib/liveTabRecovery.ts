/// <reference types="@cloudflare/workers-types" />

import { getPedidoAnulacao } from "./pedidoValido";

import {
  reconcileCancellationFinalization,
  reconcileCancellationFinalizationsForPedido
} from "./itemCancellation";
import {
  reconcileExchangeCharges,
  reconcileExchangeFinalization,
  reconcileExchangeFinalizationsForPedido
} from "./itemExchange";
import {
  recoverPixMpRefundIntentsForParent,
  recoverPixMpRefundIntentsForPedido
} from "./mpRefundIntent";

export async function reconcileLiveTabParent(
  db: D1Database,
  accessToken: string | undefined,
  parent: { cancellationId?: number; exchangeId?: number }
): Promise<void> {
  const parentTable = parent.cancellationId !== undefined ? "pedido_item_cancelamentos" : "pedido_item_trocas";
  const parentId = parent.cancellationId ?? parent.exchangeId;
  if (parentId === undefined) return;
  const row = await db.prepare(`SELECT pedido_id FROM ${parentTable} WHERE id=?`)
    .bind(parentId).first<{ pedido_id: number }>();
  if (row && await getPedidoAnulacao(db, row.pedido_id)) return;
  if (accessToken) await recoverPixMpRefundIntentsForParent(db, accessToken, parent);
  if (parent.cancellationId !== undefined) {
    await reconcileCancellationFinalization(db, parent.cancellationId);
  } else if (parent.exchangeId !== undefined) {
    await reconcileExchangeFinalization(db, parent.exchangeId);
  }
}

export async function reconcileLiveTabPedido(
  db: D1Database,
  accessToken: string | undefined,
  pedidoId: number
): Promise<void> {
  if (await getPedidoAnulacao(db, pedidoId)) return;
  if (accessToken) await recoverPixMpRefundIntentsForPedido(db, accessToken, pedidoId, 4);
  await reconcileCancellationFinalizationsForPedido(db, pedidoId, 8);
  await reconcileExchangeFinalizationsForPedido(db, pedidoId, 8);
  await reconcileExchangeCharges(db, pedidoId);
}
