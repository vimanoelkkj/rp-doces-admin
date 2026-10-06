import type { NotificarPushOptions, PushEnv } from "./pushNotifier";
import { sanitizePushError } from "./pushError";
import { requestLogger } from "./requestContext";

export interface PushQueueMessage {
  pedidoId: number;
  evento: "PEDIDO_PAGO";
}

export interface PushProducerEnv extends PushEnv {
  PUSH_QUEUE?: Queue<PushQueueMessage>;
}

// The first durable event owns its recipient policy. Replays cannot overwrite it.
export async function registrarEventoPedidoPago(
  db: D1Database,
  pedidoId: number,
  options?: NotificarPushOptions
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_eventos (pedido_id, evento, status, claim_expires_at, exclude_usuario_id)
       VALUES (?, 'PEDIDO_PAGO', 'PENDENTE', CURRENT_TIMESTAMP, ?)
       ON CONFLICT(pedido_id, evento) DO NOTHING`
    )
    .bind(pedidoId, options?.excludeUsuarioId ?? null)
    .run();
}

// Reconstruct only explicit intents atomically recorded by the notifying flows.
// Never infer an intent from the aggregate PAGO status or from historical payments.
export async function reconstruirPushEventosAusentes(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO push_eventos (pedido_id, evento, status, claim_expires_at, exclude_usuario_id)
       SELECT pp.pedido_id, 'PEDIDO_PAGO', 'PENDENTE', CURRENT_TIMESTAMP, pp.push_exclude_usuario_id
       FROM pedido_pagamentos pp
       WHERE pp.push_pedido_pago = 1 AND pp.status = 'PAGO'
         AND NOT EXISTS (SELECT 1 FROM push_eventos pe
           WHERE pe.pedido_id = pp.pedido_id AND pe.evento = 'PEDIDO_PAGO')
       ORDER BY pp.id ASC LIMIT 5
       ON CONFLICT(pedido_id, evento) DO NOTHING`
    )
    .run();
  return Number(result.meta?.changes ?? 0);
}

// Await durability and publication, never Web Push. Cron repairs missing messages.
// Financial success remains independent even if D1/publication is unavailable.
export async function enfileirarNovoPedidoPagoSafe(
  db: D1Database,
  env: PushProducerEnv,
  pedidoId: number,
  options?: NotificarPushOptions
): Promise<void> {
  try {
    await registrarEventoPedidoPago(db, pedidoId, options);
    if (!env.PUSH_QUEUE) {
      requestLogger.warn("Push queue unavailable; durable event awaits recovery", pedidoId);
      return;
    }
    await env.PUSH_QUEUE.send({ pedidoId, evento: "PEDIDO_PAGO" });
  } catch (error) {
    requestLogger.error(
      "Non-blocking push outbox registration/publication failure",
      pedidoId,
      sanitizePushError(error)
    );
  }
}
