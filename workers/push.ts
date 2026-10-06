import {
  processarPushEventoPersistido,
  reconciliarPushEventosFalhos,
  type PushEnv
} from "../functions/lib/pushNotifier";
import { sanitizePushError } from "../functions/lib/pushError";
import { requestLogger } from "../functions/lib/requestContext";
import { reconstruirPushEventosAusentes, type PushQueueMessage } from "../functions/lib/pushOutbox";

function isMessage(body: unknown): body is PushQueueMessage {
  if (!body || typeof body !== "object") return false;
  const value = body as Partial<PushQueueMessage>;
  return (
    value.evento === "PEDIDO_PAGO" &&
    Number.isSafeInteger(value.pedidoId) &&
    Number(value.pedidoId) > 0
  );
}

export default {
  async queue(batch: MessageBatch<unknown>, env: PushEnv): Promise<void> {
    for (const message of batch.messages) {
      if (!isMessage(message.body)) {
        message.ack();
        continue;
      }
      try {
        // Persisted business failures, active claims and backoff are owned by D1.
        // Only infrastructure exceptions need Queue redelivery. Cron also repairs
        // abandoned claims after expiry, including messages whose retries run out.
        await processarPushEventoPersistido(env.DB, env, message.body.pedidoId);
        message.ack();
      } catch (error) {
        requestLogger.error("Push consumer infrastructure failure", sanitizePushError(error));
        // A caught infrastructure error may already have been persisted as FALHA.
        // Avoid a second retry policy if a coherent state can be observed.
        try {
          const row = await env.DB.prepare(
            "SELECT status FROM push_eventos WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'"
          )
            .bind(message.body.pedidoId)
            .first<{ status: string }>();
          if (row?.status === "FALHA" || row?.status === "ENVIADO") message.ack();
          else message.retry();
        } catch {
          message.retry();
        }
      }
    }
  },
  async scheduled(_controller: ScheduledController, env: PushEnv): Promise<void> {
    await reconstruirPushEventosAusentes(env.DB);
    await reconciliarPushEventosFalhos(env.DB, env);
  }
} satisfies ExportedHandler<PushEnv>;
