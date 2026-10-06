/// <reference types="@cloudflare/workers-types" />

import { requestLogger } from "./requestContext";
import { sanitizePushError } from "./pushError";
import { criarPayloadPedidoPago, enviarPush } from "./pushTransport";

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

// At-least-once: remote acceptance followed by a local crash can be replayed.
// 120 seconds covers one 30-second transport call plus 90 seconds of margin.
// Renew before each sequential send, not once for the entire recipient batch.
export const PUSH_CLAIM_LEASE_SECONDS = 120;
interface PushClaim {
  token: string;
  tentativas: number;
}
const CLAIM_ELIGIBILITY = `(
  (status = 'FALHA' AND tentativas < ?
    AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
    AND (claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now')))
  OR (status = 'PENDENTE' AND claim_expires_at IS NOT NULL
    AND datetime(claim_expires_at) <= datetime('now'))
)`;

async function adquirirClaim(
  db: D1Database,
  pedidoId: number,
  tentativas: number,
  backoff: number
): Promise<PushClaim | null> {
  const token = crypto.randomUUID();
  const result = await db
    .prepare(
      `UPDATE push_eventos
    SET status = 'PENDENTE', claim_token = ?,
        claim_expires_at = datetime('now', '+' || ? || ' seconds')
    WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO' AND tentativas = ?
      AND ${CLAIM_ELIGIBILITY}`
    )
    .bind(token, PUSH_CLAIM_LEASE_SECONDS, pedidoId, tentativas, RETRY_MAX_ATTEMPTS, backoff)
    .run();
  return result.meta?.changes ? { token, tentativas } : null;
}

async function renovarClaim(db: D1Database, pedidoId: number, claim: PushClaim): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE push_eventos
    SET claim_expires_at = datetime('now', '+' || ? || ' seconds')
    WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO' AND status = 'PENDENTE'
      AND claim_token = ? AND datetime(claim_expires_at) > datetime('now')`
    )
    .bind(PUSH_CLAIM_LEASE_SECONDS, pedidoId, claim.token)
    .run();
  return Boolean(result.meta?.changes);
}

async function concluirClaim(
  db: D1Database,
  pedidoId: number,
  claim: PushClaim,
  status: "ENVIADO" | "FALHA",
  erro?: string | null
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE push_eventos
    SET status = ?, tentativas = ?,
        ultimo_erro = CASE WHEN ? = 'FALHA' THEN ? ELSE ultimo_erro END,
        atualizado_em = CURRENT_TIMESTAMP, claim_token = NULL, claim_expires_at = NULL
    WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO' AND status = 'PENDENTE'
      AND claim_token = ? AND datetime(claim_expires_at) > datetime('now')`
    )
    .bind(status, claim.tentativas + 1, status, erro ?? null, pedidoId, claim.token)
    .run();
  return Boolean(result.meta?.changes);
}

const claimPerdido = (): NotificarPushResult => ({ ok: false, motivo: "CLAIM_PERDIDO" });

async function processarClaim(
  db: D1Database,
  env: PushEnv,
  pedidoId: number,
  claim: PushClaim,
  options?: NotificarPushOptions
): Promise<NotificarPushResult> {
  try {
    if (!(await renovarClaim(db, pedidoId, claim))) return claimPerdido();
    const pedido = await db
      .prepare("SELECT id, valor_total_centavos FROM pedidos WHERE id = ?")
      .bind(pedidoId)
      .first<PedidoBasico>();
    if (!pedido) {
      await concluirClaim(db, pedidoId, claim, "FALHA", "PEDIDO_INEXISTENTE");
      return { ok: false, motivo: "PEDIDO_NAO_ENCONTRADO" };
    }
    return await despacharParaInscricoes(db, env, pedido, claim, options);
  } catch (error) {
    // Ownership fencing also covers an ambiguous delivery followed by a failed
    // success write. If persistence stays unavailable, leave the lease to expire.
    try {
      await concluirClaim(db, pedidoId, claim, "FALHA", JSON.stringify(sanitizePushError(error)));
    } catch {
      /* The original sanitized error is logged by the caller. */
    }
    throw error;
  }
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
  claim: PushClaim,
  options?: NotificarPushOptions
): Promise<NotificarPushResult> {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || "mailto:contato@rpdoces.com.br";

  if (!publicKey || !privateKey) {
    requestLogger.warn("VAPID keys não configuradas. Web push não enviado para pedido", pedido.id);
    if (
      !(await concluirClaim(
        db,
        pedido.id,
        claim,
        "FALHA",
        JSON.stringify({ category: "CONFIGURATION", code: "VAPID_NAO_CONFIGURADO" })
      ))
    )
      return claimPerdido();
    return { ok: false, motivo: "VAPID_NAO_CONFIGURADO" };
  }

  // 1. Subscriptions ativas elegíveis (pertencentes a administradores ativos)
  let query =
    "SELECT pi.id, pi.endpoint, pi.p256dh, pi.auth, pi.usuario_id " +
    "FROM push_inscricoes pi " +
    "JOIN usuarios_admin u ON u.id = pi.usuario_id " +
    "WHERE u.ativo = 1";
  const params: unknown[] = [];
  if (options?.excludeUsuarioId) {
    query += " AND pi.usuario_id != ?";
    params.push(options.excludeUsuarioId);
  }

  if (!(await renovarClaim(db, pedido.id, claim))) return claimPerdido();
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
    if (!(await concluirClaim(db, pedido.id, claim, "ENVIADO"))) return claimPerdido();
    return { ok: true, enviado: false, destinatarios: 0 };
  }

  // 2. Payload mínimo sem PII
  const payload = criarPayloadPedidoPago(pedido.id, pedido.valor_total_centavos);

  let sucessos = 0;
  let falhas = 0;
  let ultimoErro: string | null = null;
  const staleIds: number[] = [];

  for (const sub of inscricoes) {
    if (!(await renovarClaim(db, pedido.id, claim))) return claimPerdido();
    try {
      const delivered = await enviarPush(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        },
        payload,
        {
          publicKey,
          privateKey,
          subject
        }
      );

      if (!delivered) {
        // 404 / 410 Gone: subscription expirada
        staleIds.push(sub.id);
      } else {
        sucessos++;
      }
    } catch (err: unknown) {
      falhas++;
      const safeError = sanitizePushError(err);
      ultimoErro = JSON.stringify(safeError);
      requestLogger.error("Erro ao despachar Web Push para inscrição", sub.id, safeError);
    }
  }

  // 3. Limpeza de inscrições expiradas (404/410)
  if (staleIds.length > 0) {
    for (const id of staleIds) {
      if (!(await renovarClaim(db, pedido.id, claim))) return claimPerdido();
      await db
        .prepare(
          `DELETE FROM push_inscricoes WHERE id = ? AND EXISTS (
        SELECT 1 FROM push_eventos WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'
          AND status = 'PENDENTE' AND claim_token = ?
          AND datetime(claim_expires_at) > datetime('now'))`
        )
        .bind(id, pedido.id, claim.token)
        .run();
    }
  }

  // 4. Completion is fenced; old owners cannot overwrite a recovered event.
  if (sucessos > 0 || (falhas === 0 && staleIds.length > 0)) {
    if (!(await concluirClaim(db, pedido.id, claim, "ENVIADO"))) return claimPerdido();
    return { ok: true, enviado: true, sucessos, stale: staleIds.length };
  } else {
    if (!(await concluirClaim(db, pedido.id, claim, "FALHA", ultimoErro))) return claimPerdido();
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
  options?: NotificarPushOptions
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
      `INSERT INTO push_eventos (pedido_id, evento, status, claim_expires_at)
       VALUES (?, 'PEDIDO_PAGO', 'PENDENTE', CURRENT_TIMESTAMP)
       ON CONFLICT(pedido_id, evento) DO NOTHING`
    )
    .bind(pedidoId)
    .run();

  const eventoRow = await db
    .prepare(
      `SELECT status, tentativas FROM push_eventos WHERE pedido_id = ? AND evento = 'PEDIDO_PAGO'`
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

  const claim = await adquirirClaim(db, pedidoId, eventoRow.tentativas, RETRY_BACKOFF_SECONDS);
  if (!claim) return { ok: true, enviado: false, motivo: "EM_PROCESSAMENTO_OU_BACKOFF" };
  return processarClaim(db, env, pedidoId, claim, options);
}

/**
 * Invoca a notificação de forma totalmente segura e assíncrona, garantindo que
 * nenhuma falha ou exceção não tratada interfira no fluxo chamador.
 */
export async function notificarNovoPedidoPagoSafe(
  db: D1Database,
  env: PushEnv,
  pedidoId: number,
  options?: NotificarPushOptions
): Promise<void> {
  try {
    await notificarNovoPedidoPago(db, env, pedidoId, options);
  } catch (err) {
    requestLogger.error(
      "Erro não-bloqueante ao despachar Web Push para pedido",
      pedidoId,
      sanitizePushError(err)
    );
  }
}

/**
 * Reconciliação oportunista de eventos push em FALHA.
 *
 * Regras:
 * - Apenas evento 'PEDIDO_PAGO'
 * - Eligible FALHA or PENDENTE with an expired lease
 * - Tentativas < 3 (impede retry infinito)
 * - Backoff mínimo configurável (default 30 segundos)
 * - Lote limitado (default 5)
 * - CAS atômico para garantir que apenas um worker processe cada evento
 */
export async function reconciliarPushEventosFalhos(
  db: D1Database,
  env: PushEnv,
  options?: { backoffSeconds?: number; batchSize?: number }
): Promise<ReconciliarPushResult> {
  const backoff = options?.backoffSeconds ?? RETRY_BACKOFF_SECONDS;
  const batchSize = options?.batchSize ?? RETRY_BATCH_SIZE;

  // 1. Busca candidatos em FALHA respeitando backoff e limite de tentativas
  const { results: candidatos } = await db
    .prepare(
      `SELECT pedido_id, tentativas
       FROM push_eventos
       WHERE evento = 'PEDIDO_PAGO'
         AND ${CLAIM_ELIGIBILITY}
       ORDER BY atualizado_em ASC
       LIMIT ?`
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
    const claim = await adquirirClaim(db, cand.pedido_id, cand.tentativas, backoff);
    if (!claim) continue;

    try {
      const res = await processarClaim(db, env, cand.pedido_id, claim);
      if (res.ok) {
        sucessos++;
      } else {
        falhas++;
      }
    } catch (err) {
      falhas++;
      requestLogger.error(
        "Erro na retentativa de push para pedido",
        cand.pedido_id,
        sanitizePushError(err)
      );
    }
  }

  return { ok: true, processados: candidatos.length, sucessos, falhas };
}

export async function reconciliarPushEventosFalhosSafe(
  db: D1Database,
  env: PushEnv,
  options?: { backoffSeconds?: number; batchSize?: number }
): Promise<void> {
  try {
    await reconciliarPushEventosFalhos(db, env, options);
  } catch (err) {
    requestLogger.error(
      "Erro não-bloqueante na reconciliação de push falho",
      sanitizePushError(err)
    );
  }
}
