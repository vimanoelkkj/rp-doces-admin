/// <reference types="@cloudflare/workers-types" />

import { getRefundMp, postRefundMp, type MpRefundCriado, type MpRefundResultado } from "./mpRefund";
import {
  buscarOperacao, chaveReembolso, conflitoOperacao, FINGERPRINT_VERSAO,
  type IdentidadeEsperada,
} from "./operacoes";
import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";

export type PixMpRefundIntentStatus =
  | "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "RECUSADO" | "INCONCLUSIVO";

export interface PixMpRefundIntentView {
  id: number;
  status: PixMpRefundIntentStatus;
  tentativas: number;
  mpRefundId: string | null;
  mpStatus: string | null;
  ultimoErro: string | null;
  pedidoReembolsoId: number | null;
}

interface IntentRow {
  id: number; operacao_id: number; pedido_id: number; pagamento_id: number;
  pagamento_alocacao_id: number; pedido_item_cancelamento_id: number | null;
  pedido_item_troca_id: number | null; valor_centavos: number;
  status: PixMpRefundIntentStatus; mp_payment_id: string; mp_idempotency_key: string;
  mp_request: string; mp_refund_id: string | null; mp_status: string | null;
  pedido_reembolso_id: number | null; tentativas: number; ultimo_erro: string | null;
  operation_key: string; ator_usuario_id: number | null;
}

export type PixMpRefundIntentResult =
  | { ok: true; intencao: PixMpRefundIntentView; reembolsoId?: number; replay?: boolean }
  | { ok: false; erro: "OPERACAO_CONFLITO_TIPO" | "OPERACAO_CONFLITO_ESCOPO" |
      "OPERACAO_CONFLITO_PAYLOAD" | "REFUND_REMOTO_EM_ANDAMENTO" };

export interface PixMpRefundIntentParams {
  pedidoId: number;
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  cancellationId?: number;
  exchangeId?: number;
  usuarioId: number;
  operationKey: string;
  fingerprint: string;
  valorCentavos: number;
  accessToken: string;
}

const columns = `i.id,i.operacao_id,i.pedido_id,i.pagamento_id,i.pagamento_alocacao_id,
  i.pedido_item_cancelamento_id,i.pedido_item_troca_id,i.valor_centavos,i.status,
  i.mp_payment_id,i.mp_idempotency_key,i.mp_request,i.mp_refund_id,i.mp_status,
  i.pedido_reembolso_id,i.tentativas,i.ultimo_erro,o.operation_key,o.ator_usuario_id`;

function view(row: IntentRow): PixMpRefundIntentView {
  return { id: Number(row.id), status: row.status, tentativas: Number(row.tentativas),
    mpRefundId: row.mp_refund_id, mpStatus: row.mp_status, ultimoErro: row.ultimo_erro,
    pedidoReembolsoId: row.pedido_reembolso_id == null ? null : Number(row.pedido_reembolso_id) };
}

async function remoteKey(operationKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`rp-doces:pix-mp-refund:v1:${operationKey}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function byOperation(db: D1Database, operationKey: string): Promise<IntentRow | null> {
  return db.prepare(`SELECT ${columns} FROM pedido_reembolso_pix_mp_intencoes i
    JOIN pedido_operacoes o ON o.id=i.operacao_id WHERE o.operation_key=? LIMIT 1`)
    .bind(operationKey).first<IntentRow>();
}

async function activeByLeg(db: D1Database, params: PixMpRefundIntentParams): Promise<IntentRow | null> {
  const parentColumn = params.cancellationId !== undefined
    ? "pedido_item_cancelamento_id" : "pedido_item_troca_id";
  const parentId = params.cancellationId ?? params.exchangeId;
  return db.prepare(`SELECT ${columns} FROM pedido_reembolso_pix_mp_intencoes i
    JOIN pedido_operacoes o ON o.id=i.operacao_id
    WHERE i.${parentColumn}=? AND i.pagamento_alocacao_id=? AND i.status<>'RECUSADO'
    ORDER BY i.id DESC LIMIT 1`).bind(parentId, params.pagamentoAlocacaoId).first<IntentRow>();
}

async function ensureIntent(
  db: D1Database,
  params: PixMpRefundIntentParams,
): Promise<IntentRow | PixMpRefundIntentResult> {
  const identity: IdentidadeEsperada = {
    tipo: "REFUND_ADMIN", escopo: "ADMIN", atorUsuarioId: params.usuarioId,
    fingerprint: params.fingerprint,
  };
  const existingOperation = await buscarOperacao(db, params.operationKey);
  if (existingOperation) {
    const conflict = conflitoOperacao(existingOperation, identity);
    if (conflict) return { ok: false, erro: conflict };
    const existingIntent = await byOperation(db, params.operationKey);
    if (existingIntent) return existingIntent;
  }

  const key = await remoteKey(params.operationKey);
  const request = JSON.stringify({ amount: params.valorCentavos / 100 });
  const cancellationId = params.cancellationId ?? null;
  const exchangeId = params.exchangeId ?? null;
  try {
    await db.batch([
      db.prepare(`INSERT INTO pedido_operacoes(
          operation_key,tipo,escopo,ator_usuario_id,fingerprint_versao,fingerprint,fase,
          pedido_id,pagamento_id,pedido_item_cancelamento_id,pedido_item_troca_id,
          mp_idempotency_key,mp_request,mp_payment_id)
        SELECT ?,'REFUND_ADMIN','ADMIN',?,?,?,'LOCAL_CRIADA',pp.pedido_id,pp.id,?,?,?, ?,pp.mp_payment_id
        FROM pedido_pagamentos pp WHERE pp.id=? AND pp.pedido_id=? AND pp.metodo='PIX_MP'
          AND pp.status='PAGO' AND pp.mp_payment_id IS NOT NULL`)
        .bind(params.operationKey, params.usuarioId, FINGERPRINT_VERSAO, params.fingerprint,
          cancellationId, exchangeId, key, request, params.pagamentoId, params.pedidoId),
      db.prepare(`INSERT INTO pedido_reembolso_pix_mp_intencoes(
          operacao_id,pedido_id,pagamento_id,pagamento_alocacao_id,
          pedido_item_cancelamento_id,pedido_item_troca_id,valor_centavos,
          mp_payment_id,mp_idempotency_key,mp_request)
        SELECT o.id,?,?,?, ?,?,?,o.mp_payment_id,o.mp_idempotency_key,o.mp_request
        FROM pedido_operacoes o WHERE o.operation_key=?`)
        .bind(params.pedidoId, params.pagamentoId, params.pagamentoAlocacaoId,
          cancellationId, exchangeId, params.valorCentavos, params.operationKey),
    ]);
  } catch (error) {
    const winnerForKey = await byOperation(db, params.operationKey);
    if (winnerForKey) return winnerForKey;
    const winnerForLeg = await activeByLeg(db, params);
    if (winnerForLeg) {
      if (Number(winnerForLeg.pagamento_id) !== params.pagamentoId
          || Number(winnerForLeg.valor_centavos) !== params.valorCentavos) {
        return { ok: false, erro: "REFUND_REMOTO_EM_ANDAMENTO" };
      }
      return winnerForLeg;
    }
    throw error;
  }
  const created = await byOperation(db, params.operationKey);
  if (!created) throw new Error("PIX_MP_REFUND_INTENCAO_NAO_CRIADA");
  return created;
}

async function markInconclusive(db: D1Database, row: IntentRow, error: string): Promise<IntentRow> {
  await db.batch([
    db.prepare(`UPDATE pedido_reembolso_pix_mp_intencoes
      SET status='INCONCLUSIVO',ultimo_erro=?,atualizado_em=CURRENT_TIMESTAMP
      WHERE id=? AND status NOT IN ('CONFIRMADO','RECUSADO')`).bind(error.slice(0, 500), row.id),
    db.prepare(`UPDATE pedido_operacoes SET fase='ENVIO_INCONCLUSIVO',erro=?,atualizado_em=CURRENT_TIMESTAMP
      WHERE id=? AND fase NOT IN ('CONCLUIDA','RECUSADA')`).bind(error.slice(0, 500), row.operacao_id),
  ]).catch(() => undefined);
  return (await byOperation(db, row.operation_key)) ?? row;
}

async function materialize(
  db: D1Database,
  row: IntentRow,
  refund: MpRefundCriado,
  usuarioId: number | null,
): Promise<IntentRow> {
  const localKey = chaveReembolso(row.operation_key);
  const refundId = String(refund.id);
  const allocation = row.pedido_item_cancelamento_id !== null
    ? db.prepare(`INSERT INTO pedido_reembolso_alocacoes(
        reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos)
      SELECT r.id,?,?,? FROM pedido_reembolsos r WHERE r.idempotency_key=?
        AND NOT EXISTS(SELECT 1 FROM pedido_reembolso_alocacoes x
          WHERE x.reembolso_id=r.id AND x.pagamento_alocacao_id=?)`)
      .bind(row.pagamento_alocacao_id, row.pedido_item_cancelamento_id,
        row.valor_centavos, localKey, row.pagamento_alocacao_id)
    : db.prepare(`INSERT INTO pedido_item_troca_reembolso_alocacoes(
        reembolso_id,pagamento_alocacao_id,pedido_item_troca_id,valor_centavos)
      SELECT r.id,?,?,? FROM pedido_reembolsos r WHERE r.idempotency_key=?
        AND NOT EXISTS(SELECT 1 FROM pedido_item_troca_reembolso_alocacoes x
          WHERE x.reembolso_id=r.id AND x.pagamento_alocacao_id=?)`)
      .bind(row.pagamento_alocacao_id, row.pedido_item_troca_id,
        row.valor_centavos, localKey, row.pagamento_alocacao_id);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO pedido_reembolsos(
        pedido_id,pagamento_id,origem,metodo,valor_centavos,status,mp_refund_id,mp_status,
        idempotency_key,registrado_por_usuario_id,motivo,devolveu_estoque,concluido_em)
      SELECT ?,?,'MERCADO_PAGO','PIX_MP',?,'REEMBOLSADO',?,?,?,?,'Refund parcial Mercado Pago',0,CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM pedido_reembolso_pix_mp_intencoes
                   WHERE id=? AND status<>'RECUSADO')`)
      .bind(row.pedido_id, row.pagamento_id, row.valor_centavos, refundId,
        refund.status, localKey, usuarioId, row.id),
    allocation,
    db.prepare(`UPDATE pedido_operacoes SET fase='CONCLUIDA',reembolso_id=(
        SELECT id FROM pedido_reembolsos WHERE idempotency_key=?),resultado=?,erro=NULL,
        atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND fase<>'RECUSADA'`)
      .bind(localKey, JSON.stringify({ refundId, status: refund.status }), row.operacao_id),
    db.prepare(`UPDATE pedido_reembolso_pix_mp_intencoes SET status='CONFIRMADO',
        mp_refund_id=?,mp_status=?,pedido_reembolso_id=(
          SELECT id FROM pedido_reembolsos WHERE idempotency_key=?),ultimo_erro=NULL,
        confirmado_em=COALESCE(confirmado_em,CURRENT_TIMESTAMP),atualizado_em=CURRENT_TIMESTAMP
      WHERE id=? AND status<>'RECUSADO'`).bind(refundId, refund.status, localKey, row.id),
    preparePedidoFinancialProjection(db, row.pedido_id),
  ]);
  return (await byOperation(db, row.operation_key)) ?? row;
}

function confirmed(status: string): boolean {
  return ["approved", "refunded"].includes(status.toLowerCase());
}
function refused(status: string): boolean {
  return ["rejected", "cancelled", "canceled", "failed"].includes(status.toLowerCase());
}

async function consumeRemoteResult(
  db: D1Database, row: IntentRow, result: MpRefundResultado, usuarioId: number | null,
  cameFromGet: boolean,
): Promise<IntentRow> {
  if (result.resultado === "AMBIGUO") {
    return markInconclusive(db, row, `${result.motivo}:${result.httpStatus ?? "SEM_HTTP"}`);
  }
  if (result.resultado === "RECUSA_DEFINITIVA") {
    if (cameFromGet) return markInconclusive(db, row, `GET_HTTP_${result.httpStatus}`);
    await db.batch([
      db.prepare(`UPDATE pedido_reembolso_pix_mp_intencoes SET status='RECUSADO',
        ultimo_erro=?,recusado_em=COALESCE(recusado_em,CURRENT_TIMESTAMP),atualizado_em=CURRENT_TIMESTAMP
        WHERE id=? AND status<>'CONFIRMADO'`)
        .bind(`HTTP_${result.httpStatus}:${result.mensagem ?? "RECUSADO"}`.slice(0, 500), row.id),
      db.prepare(`UPDATE pedido_operacoes SET fase='RECUSADA',erro=?,atualizado_em=CURRENT_TIMESTAMP
        WHERE id=? AND fase<>'CONCLUIDA'`).bind(result.mensagem ?? `HTTP_${result.httpStatus}`, row.operacao_id),
    ]);
    return (await byOperation(db, row.operation_key)) ?? row;
  }
  const refund = result.refund;
  try {
    await db.batch([
      db.prepare(`UPDATE pedido_reembolso_pix_mp_intencoes SET status='PROCESSANDO',
        mp_refund_id=?,mp_status=?,ultimo_erro=NULL,atualizado_em=CURRENT_TIMESTAMP
        WHERE id=? AND status NOT IN ('CONFIRMADO','RECUSADO')`)
        .bind(String(refund.id), refund.status, row.id),
      db.prepare(`UPDATE pedido_operacoes SET fase='REMOTO_CONHECIDO',erro=NULL,
        atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND fase NOT IN ('CONCLUIDA','RECUSADA')`)
        .bind(row.operacao_id),
    ]);
  } catch (error) {
    console.error("Refund MP conhecido; falha ao persistir identidade remota", row.id, error);
    return row;
  }
  const known = (await byOperation(db, row.operation_key)) ?? row;
  if (confirmed(refund.status)) {
    try { return await materialize(db, known, refund, usuarioId); }
    catch (error) {
      console.error("Refund MP confirmado; materializacao local pendente", row.id, error);
      return markInconclusive(db, known, "MATERIALIZACAO_LOCAL_PENDENTE");
    }
  }
  if (refused(refund.status)) {
    await db.batch([
      db.prepare(`UPDATE pedido_reembolso_pix_mp_intencoes SET status='RECUSADO',
        mp_status=?,ultimo_erro='PROVEDOR_RECUSOU',recusado_em=COALESCE(recusado_em,CURRENT_TIMESTAMP),
        atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND status<>'CONFIRMADO'`).bind(refund.status, row.id),
      db.prepare(`UPDATE pedido_operacoes SET fase='RECUSADA',erro='PROVEDOR_RECUSOU',
        atualizado_em=CURRENT_TIMESTAMP WHERE id=? AND fase<>'CONCLUIDA'`).bind(row.operacao_id),
    ]);
    return (await byOperation(db, row.operation_key)) ?? row;
  }
  if (refund.status.toLowerCase() === "in_process" || refund.status.toLowerCase() === "pending") return known;
  return markInconclusive(db, known, `STATUS_DESCONHECIDO:${refund.status}`);
}

export async function reconcilePixMpRefundIntent(
  db: D1Database,
  params: PixMpRefundIntentParams,
): Promise<PixMpRefundIntentResult> {
  const ensured = await ensureIntent(db, params);
  if ("ok" in ensured) return ensured;
  let row = ensured;
  if (row.status === "CONFIRMADO") {
    return { ok: true, intencao: view(row), reembolsoId: Number(row.pedido_reembolso_id), replay: true };
  }
  if (row.status === "RECUSADO") return { ok: true, intencao: view(row), replay: true };
  row = await processIntent(db, row, params.accessToken);
  return { ok: true, intencao: view(row),
    ...(row.pedido_reembolso_id == null ? {} : { reembolsoId: Number(row.pedido_reembolso_id) }) };
}

async function processIntent(db: D1Database, initial: IntentRow, accessToken: string): Promise<IntentRow> {
  let row = initial;
  await db.prepare(`UPDATE pedido_reembolso_pix_mp_intencoes SET status='PROCESSANDO',
      tentativas=tentativas+1,ultima_tentativa_em=CURRENT_TIMESTAMP,atualizado_em=CURRENT_TIMESTAMP
    WHERE id=? AND status NOT IN ('CONFIRMADO','RECUSADO')`).bind(row.id).run();
  row = (await byOperation(db, row.operation_key)) ?? row;
  const remote = row.mp_refund_id
    ? await getRefundMp(accessToken, row.mp_payment_id, row.mp_refund_id, row.valor_centavos)
    : await postRefundMp(accessToken, row.mp_payment_id, row.mp_idempotency_key,
      { amountCentavos: row.valor_centavos, renderInProcess: true });
  return consumeRemoteResult(db, row, remote, row.ator_usuario_id, row.mp_refund_id !== null);
}

export async function recoverPixMpRefundIntentsForParent(
  db: D1Database,
  accessToken: string,
  parent: { cancellationId?: number; exchangeId?: number },
): Promise<void> {
  const column = parent.cancellationId !== undefined
    ? "pedido_item_cancelamento_id" : "pedido_item_troca_id";
  const id = parent.cancellationId ?? parent.exchangeId;
  const { results } = await db.prepare(`SELECT ${columns}
    FROM pedido_reembolso_pix_mp_intencoes i JOIN pedido_operacoes o ON o.id=i.operacao_id
    WHERE i.${column}=? AND i.status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO')
    ORDER BY i.id LIMIT 4`).bind(id).all<IntentRow>();
  for (const row of results) await processIntent(db, row, accessToken);
}

export async function getPixMpRefundIntentForLeg(
  db: D1Database,
  parent: { cancellationId?: number; exchangeId?: number; pagamentoAlocacaoId: number },
): Promise<PixMpRefundIntentView | null> {
  const column = parent.cancellationId !== undefined
    ? "pedido_item_cancelamento_id" : "pedido_item_troca_id";
  const id = parent.cancellationId ?? parent.exchangeId;
  const row = await db.prepare(`SELECT i.*,o.operation_key FROM pedido_reembolso_pix_mp_intencoes i
    JOIN pedido_operacoes o ON o.id=i.operacao_id
    WHERE i.${column}=? AND i.pagamento_alocacao_id=?
    ORDER BY i.id DESC LIMIT 1`).bind(id, parent.pagamentoAlocacaoId).first<IntentRow>();
  return row ? view(row) : null;
}
