/// <reference types="@cloudflare/workers-types" />

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
  if (accessToken) await recoverPixMpRefundIntentsForPedido(db, accessToken, pedidoId, 4);
  await reconcileCancellationFinalizationsForPedido(db, pedidoId, 8);
  await reconcileExchangeFinalizationsForPedido(db, pedidoId, 8);
  await reconcileExchangeCharges(db, pedidoId);
}
