/// <reference types="@cloudflare/workers-types" />

import { sendPushNotification } from "@mmmike/web-push/send";

export interface PushEnv {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface NotificarPushOptions {
  excludeUsuarioId?: number;
}

export interface NotificarPushResult {
  ok: boolean;
  enviado?: boolean;
  motivo?: string;
  destinatarios?: number;
  sucessos?: number;
  falhas?: number;
  stale?: number;
  ultimoErro?: string | null;
}

export interface ReconciliarPushResult {
  ok: boolean;
  processados: number;
  sucessos: number;
  falhas: number;
}

export const RETRY_BACKOFF_SECONDS = 30;
export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_BATCH_SIZE = 5;

function formatarMoedaCentavos(centavos: number): string {
  const valor = (centavos / 100).toFixed(2).replace(".", ",");
  return `R$ ${valor}`;
}

interface PedidoBasico {
  id: number;
  valor_total_centavos: number;
}

/**
 * Núcleo de envio a todas as subscriptions elegíveis.
 */
async function despacharParaInscricoes(
  db: D1Database,
  env: PushEnv,
  pedido: PedidoBasico,
  tentativasAtuais: number,
  options?: NotificarPushOptions,
): Promise<NotificarPushResult> {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || "mailto:contato@rpdoces.com.br";

  if (!publicKey || !privateKey) {
    console.warn("VAPID keys não configuradas. Web push não enviado para pedido", pedido.id);
    return { ok: false, motivo: "VAPID_NAO_CONFIGURADO" };
  }

  // 1. Subscriptions ativas elegíveis
  let query = "SELECT id, endpoint, p256dh, auth, usuario_id FROM push_inscricoes";
  const params: unknown[] = [];
  if (options?.excludeUsuarioId) {
    query += " WHERE usuario_id != ?";
    params.push(options.excludeUsuarioId);
  }

  const { results: inscricoes } = await db
    .prepare(query)
    .bind(...params)
    .all<{
      id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      usuario_id: number;
    }>();

  if (!inscricoes || inscricoes.length === 0) {
    const novaTentativa = tentativasAtuais + 1;
    await db
      .prepare(
        `UPDATE push_eventos
         SET status = 'ENVIADO', tentativas = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'`,
      )
      .bind(novaTentativa, pedido.id)
      .run();
    return { ok: true, enviado: false, destinatarios: 0 };
  }

  // 2. Payload mínimo sem PII
  const payload = {
    title: "Novo pedido 🍰",
    body: `Pedido RP-${pedido.id} · ${formatarMoedaCentavos(pedido.valor_total_centavos)}`,
    tag: `pedido-${pedido.id}`,
    url: `/admin/pedidos?pedido=${pedido.id}`,
    pedidoId: pedido.id,
  };

  let sucessos = 0;
  let falhas = 0;
  let ultimoErro: string | null = null;
  const staleIds: number[] = [];

  for (const sub of inscricoes) {
    try {
      const delivered = await sendPushNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payload,
        {
          publicKey,
          privateKey,
          subject,
        },
      );

      if (!delivered) {
        // 404 / 410 Gone: subscription expirada
        staleIds.push(sub.id);
      } else {
        sucessos++;
      }
    } catch (err: unknown) {
      falhas++;
      ultimoErro = err instanceof Error ? err.message : String(err);
      console.error("Erro ao despachar Web Push para inscrição", sub.id, err);
    }
  }

  // 3. Limpeza de inscrições expiradas (404/410)
  if (staleIds.length > 0) {
    for (const id of staleIds) {
      await db.prepare("DELETE FROM push_inscricoes WHERE id = ?").bind(id).run();
    }
  }

  const novaTentativa = tentativasAtuais + 1;

  // 4. Conclusão do evento
  if (sucessos > 0 || (falhas === 0 && staleIds.length > 0)) {
    await db
      .prepare(
        `UPDATE push_eventos
         SET status = 'ENVIADO', tentativas = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'`,
      )
      .bind(novaTentativa, pedido.id)
      .run();
    return { ok: true, enviado: true, sucessos, stale: staleIds.length };
  } else {
    await db
      .prepare(
        `UPDATE push_eventos
         SET status = 'FALHA', tentativas = ?, ultimo_erro = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'`,
      )
      .bind(novaTentativa, ultimoErro, pedido.id)
      .run();
    return { ok: false, motivo: "FALHA_PUSH_SERVICE", ultimoErro };
  }
}

/**
 * Despacha notificação Web Push para novos pedidos confirmados (PAGO).
 *
 * Invariantes:
 * 1. Não bloqueia confirmação financeira.
 * 2. Deduplicação estrita via push_eventos (PRIMARY KEY: pedido_id, evento='PEDIDO_PAGO').
 * 3. Falha do push service grava status='FALHA' e permite retry sem perder o evento.
 * 4. Remove subscriptions 404/410 Gone automaticamente.
 * 5. Exclui o próprio operador se excludeUsuarioId for especificado (pedido de balcão).
 */
export async function notificarNovoPedidoPago(
  db: D1Database,
  env: PushEnv,
  pedidoId: number,
  options?: NotificarPushOptions,
): Promise<NotificarPushResult> {
  const pedido = await db
    .prepare("SELECT id, valor_total_centavos FROM pedidos WHERE id = ?")
    .bind(pedidoId)
    .first<PedidoBasico>();

  if (!pedido) {
    return { ok: false, motivo: "PEDIDO_NAO_ENCONTRADO" };
  }

  // 1. Registro atômico ou preservação do evento
  await db
    .prepare(
      `INSERT INTO push_eventos (pedido_id, evento, status)
       VALUES (?, 'PEDIDO_PAGO', 'PENDENTE')
       ON CONFLICT(pedido_id, evento) DO NOTHING`,
    )
    .bind(pedidoId)
    .run();

  const eventoRow = await db
    .prepare(
      `SELECT status, tentativas FROM push_eventos WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'`,
    )
    .bind(pedidoId)
    .first<{ status: string; tentativas: number }>();

  if (!eventoRow) {
    return { ok: false, motivo: "EVENTO_NAO_REGISTRADO" };
  }

  if (eventoRow.status === "ENVIADO") {
    return { ok: true, enviado: false, motivo: "JA_ENVIADO" };
  }

  if (eventoRow.status === "FALHA" && eventoRow.tentativas >= RETRY_MAX_ATTEMPTS) {
    return { ok: false, motivo: "LIMITE_TENTATIVAS_EXCEDIDO" };
  }

  return despacharParaInscricoes(db, env, pedido, eventoRow.tentativas, options);
}

/**
 * Invoca a notificação de forma totalmente segura e assíncrona, garantindo que
 * nenhuma falha ou exceção não tratada interfira no fluxo chamador.
 */
export async function notificarNovoPedidoPagoSafe(
  db: D1Database,
  env: PushEnv,
  pedidoId: number,
  options?: NotificarPushOptions,
): Promise<void> {
  try {
    await notificarNovoPedidoPago(db, env, pedidoId, options);
  } catch (err) {
    console.error("Erro não-bloqueante ao despachar Web Push para pedido", pedidoId, err);
  }
}

/**
 * Reconciliação oportunista de eventos push em FALHA.
 *
 * Regras:
 * - Apenas evento 'PEDIDO_PAGO'
 * - Apenas status 'FALHA'
 * - Tentativas < 3 (impede retry infinito)
 * - Backoff mínimo configurável (default 30 segundos)
 * - Lote limitado (default 5)
 * - CAS atômico para garantir que apenas um worker processe cada evento
 */
export async function reconciliarPushEventosFalhos(
  db: D1Database,
  env: PushEnv,
  options?: { backoffSeconds?: number; batchSize?: number },
): Promise<ReconciliarPushResult> {
  const backoff = options?.backoffSeconds ?? RETRY_BACKOFF_SECONDS;
  const batchSize = options?.batchSize ?? RETRY_BATCH_SIZE;

  // 1. Busca candidatos em FALHA respeitando backoff e limite de tentativas
  const { results: candidatos } = await db
    .prepare(
      `SELECT pedido_id, tentativas
       FROM push_eventos
       WHERE evento = 'PEDIDO_PAGO'
         AND status = 'FALHA'
         AND tentativas < ?
         AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
       ORDER BY atualizado_em ASC
       LIMIT ?`,
    )
    .bind(RETRY_MAX_ATTEMPTS, backoff, batchSize)
    .all<{ pedido_id: number; tentativas: number }>();

  if (!candidatos || candidatos.length === 0) {
    return { ok: true, processados: 0, sucessos: 0, falhas: 0 };
  }

  let sucessos = 0;
  let falhas = 0;

  for (const cand of candidatos) {
    // 2. CAS atômico: adquire o claim do evento impedindo execução simultânea
    const claim = await db
      .prepare(
        `UPDATE push_eventos
         SET status = 'PENDENTE',
             atualizado_em = CURRENT_TIMESTAMP
         WHERE pedido_id = ?
           AND evento = 'PEDIDO_PAGO'
           AND status = 'FALHA'
           AND tentativas < ?`,
      )
      .bind(cand.pedido_id, RETRY_MAX_ATTEMPTS)
      .run();

    if (!claim.meta?.changes || claim.meta.changes === 0) {
      // Outro worker obteve o claim concorrentemente
      continue;
    }

    const pedido = await db
      .prepare("SELECT id, valor_total_centavos FROM pedidos WHERE id = ?")
      .bind(cand.pedido_id)
      .first<PedidoBasico>();

    if (!pedido) {
      await db
        .prepare(
          `UPDATE push_eventos
           SET status = 'FALHA', ultimo_erro = 'PEDIDO_INEXISTENTE', atualizado_em = CURRENT_TIMESTAMP
           WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'`,
        )
        .bind(cand.pedido_id)
        .run();
      falhas++;
      continue;
    }

    try {
      const res = await despacharParaInscricoes(db, env, pedido, cand.tentativas);
      if (res.ok) {
        sucessos++;
      } else {
        falhas++;
      }
    } catch (err) {
      falhas++;
      console.error("Erro na retentativa de push para pedido", cand.pedido_id, err);
    }
  }

  return { ok: true, processados: candidatos.length, sucessos, falhas };
}

export async function reconciliarPushEventosFalhosSafe(
  db: D1Database,
  env: PushEnv,
  options?: { backoffSeconds?: number; batchSize?: number },
): Promise<void> {
  try {
    await reconciliarPushEventosFalhos(db, env, options);
  } catch (err) {
    console.error("Erro não-bloqueante na reconciliação de push falho", err);
  }
}
