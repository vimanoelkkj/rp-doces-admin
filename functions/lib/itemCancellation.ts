/// <reference types="@cloudflare/workers-types" />

import {
  getItemCancellationPreview,
  type AcaoEstoqueCancelamento,
  type ItemCancellationPreview,
  ItemCancellationPreviewError,
} from "./itemCancellationPreview";
import {
  buscarOperacao,
  chaveReembolso,
  conflitoOperacao,
  fingerprint,
  fonteCancelamentoCriado,
  fonteReembolso,
  parseOperationKey,
  prepareClaimOperacao,
  type ConflitoOperacao,
  type IdentidadeEsperada,
  type OperacaoRow,
} from "./operacoes";
import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";
import { preparePedidoPhysicalProjection } from "./stock";

export type CancellationStatus =
  | "SOLICITADO"
  | "AGUARDANDO_REEMBOLSO"
  | "INCONCLUSIVO"
  | "CONCLUIDO"
  | "FALHOU";

export interface CancellationLeg {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorCentavos: number;
  confirmacaoManualPermitida: boolean;
}

export interface CancellationView {
  id: number;
  pedidoId: number;
  itemId: number;
  status: CancellationStatus;
  estoqueAcao: AcaoEstoqueCancelamento | "REPOR";
  reembolsoPendenteCentavos: number;
  pernasPendentes: CancellationLeg[];
}

type CancellationError =
  | "OPERATION_KEY_INVALIDA"
  | "PREVIEW_OBSOLETO"
  | "ESTOQUE_ACAO_INVALIDA"
  | "PIX_PENDENTE"
  | "CANCELAMENTO_NAO_ENCONTRADO"
  | "CANCELAMENTO_NAO_AGUARDANDO"
  | "PAGAMENTO_ALOCACAO_INVALIDA"
  | "PIX_MP_REFUND_REMOTO_PENDENTE"
  | "VALOR_REFUND_DIVERGENTE"
  | "OPERACAO_INCOMPLETA"
  | ConflitoOperacao;

export type CancellationResult =
  | { ok: true; cancelamento: CancellationView; replay?: boolean; reembolsoId?: number }
  | { ok: false; erro: CancellationError; preview?: ItemCancellationPreview };

interface CancellationRow {
  id: number;
  pedido_id: number;
  pedido_item_id: number;
  status: CancellationStatus;
  estoque_acao: AcaoEstoqueCancelamento | "REPOR";
}

const METODOS_MANUAIS = new Set(["DINHEIRO", "CARTAO", "PIX_EXTERNO"]);

function acaoValida(estado: string, acao: string): acao is AcaoEstoqueCancelamento | "REPOR" {
  if (estado === "RESERVADO") return acao === "LIBERAR_RESERVA";
  if (estado === "BAIXADO") return acao === "NAO_REPOR" || acao === "REPOR";
  return acao === "NENHUMA";
}

function refundSomadoSql(alias: string): string {
  return `COALESCE((
    SELECT SUM(x.valor_centavos) FROM (
      SELECT ra.reembolso_id, ra.valor_centavos
      FROM pedido_reembolso_alocacoes ra WHERE ra.pagamento_alocacao_id = ${alias}.id
      UNION ALL
      SELECT ra.reembolso_id, ra.valor_centavos
      FROM pedido_item_troca_reembolso_alocacoes ra WHERE ra.pagamento_alocacao_id = ${alias}.id
    ) x JOIN pedido_reembolsos r ON r.id = x.reembolso_id
    WHERE r.status = 'REEMBOLSADO'
  ), 0)`;
}

async function readCancellationView(
  db: D1Database,
  row: CancellationRow,
): Promise<CancellationView> {
  if (row.status === "CONCLUIDO" || row.status === "FALHOU") {
    return {
      id: Number(row.id), pedidoId: Number(row.pedido_id), itemId: Number(row.pedido_item_id),
      status: row.status, estoqueAcao: row.estoque_acao,
      reembolsoPendenteCentavos: 0, pernasPendentes: [],
    };
  }
  const preview = await getItemCancellationPreview(
    db, Number(row.pedido_id), Number(row.pedido_item_id),
    { permitirCancelamentoExistente: true },
  );
  const pernasPendentes = preview.pagamentos
    .filter((p) => p.reembolsoPropostoCentavos > 0)
    .map((p) => ({
      pagamentoId: p.pagamentoId,
      pagamentoAlocacaoId: p.pagamentoAlocacaoId,
      metodo: p.metodo,
      valorCentavos: p.reembolsoPropostoCentavos,
      confirmacaoManualPermitida: METODOS_MANUAIS.has(p.metodo),
    }));
  return {
    id: Number(row.id), pedidoId: Number(row.pedido_id), itemId: Number(row.pedido_item_id),
    status: row.status, estoqueAcao: row.estoque_acao,
    reembolsoPendenteCentavos: pernasPendentes.reduce((s, p) => s + p.valorCentavos, 0),
    pernasPendentes,
  };
}

async function cancellationById(db: D1Database, id: number): Promise<CancellationRow | null> {
  return db.prepare(`SELECT id,pedido_id,pedido_item_id,status,estoque_acao
    FROM pedido_item_cancelamentos WHERE id=? LIMIT 1`).bind(id).first<CancellationRow>();
}

export async function getCancellationView(
  db: D1Database,
  pedidoId: number,
  itemId: number,
): Promise<CancellationView | null> {
  const row = await db.prepare(`SELECT id,pedido_id,pedido_item_id,status,estoque_acao
    FROM pedido_item_cancelamentos
    WHERE pedido_id=? AND pedido_item_id=? AND status<>'FALHOU'
    ORDER BY id DESC LIMIT 1`).bind(pedidoId, itemId).first<CancellationRow>();
  return row ? readCancellationView(db, row) : null;
}

async function replayCancellation(
  db: D1Database,
  op: OperacaoRow,
  identity: IdentidadeEsperada,
): Promise<CancellationResult> {
  const conflict = conflitoOperacao(op, identity);
  if (conflict) return { ok: false, erro: conflict };
  if (!op.pedido_item_cancelamento_id) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  const row = await cancellationById(db, op.pedido_item_cancelamento_id);
  if (!row) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  return { ok: true, cancelamento: await readCancellationView(db, row), replay: true };
}

function snapshotGuard(preview: ItemCancellationPreview): { sql: string; args: unknown[] } {
  const legs = preview.pagamentos;
  const args: unknown[] = [legs.length];
  const checks = legs.map((leg) => {
    args.push(
      leg.pagamentoAlocacaoId, leg.pagamentoId, leg.metodo,
      leg.valorAlocadoCentavos, leg.valorJaReembolsadoDaAlocacaoCentavos,
    );
    return `EXISTS (
      SELECT 1 FROM pedido_pagamento_alocacoes a
      JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
      WHERE a.id=? AND pp.id=? AND pp.metodo=? AND pp.status='PAGO'
        AND a.valor_centavos=? AND ${refundSomadoSql("a")}=?
    )`;
  });
  return {
    sql: `(SELECT COUNT(*) FROM pedido_pagamento_alocacoes a
           JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
           WHERE a.pedido_item_id=pi.id AND pp.pedido_id=p.id AND pp.status='PAGO')=?
          ${checks.map((c) => `AND ${c}`).join(" ")}`,
    args,
  };
}

function finalizationStatements(
  db: D1Database,
  pedidoId: number,
  itemId: number,
  cancellationId: number | null,
  operationKey: string | null,
  action: AcaoEstoqueCancelamento | "REPOR",
): D1PreparedStatement[] {
  const owner = cancellationId !== null
    ? `c.id = ${Number(cancellationId)}`
    : `EXISTS (SELECT 1 FROM pedido_operacoes o
               WHERE o.operation_key = '${operationKey!.replace(/'/g, "''")}'
                 AND o.pedido_item_cancelamento_id = c.id)`;
  const noCoverage = `NOT EXISTS (
    SELECT 1 FROM pedido_pagamento_alocacoes a
    JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
    WHERE a.pedido_item_id=pi.id AND pp.status='PAGO'
      AND a.valor_centavos > ${refundSomadoSql("a")}
  )`;
  const eligible = `EXISTS (
    SELECT 1 FROM pedido_item_cancelamentos c
    JOIN pedido_itens pi ON pi.id=c.pedido_item_id
    WHERE ${owner} AND c.pedido_id=${pedidoId} AND pi.id=${itemId}
      AND c.status IN ('SOLICITADO','AGUARDANDO_REEMBOLSO','INCONCLUSIVO')
      AND pi.status_item='ATIVO' AND ${noCoverage}
      AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos px
                      WHERE px.pedido_id=c.pedido_id AND px.metodo='PIX_MP' AND px.status='PENDENTE')
  )`;
  const statements: D1PreparedStatement[] = [];
  if (action === "LIBERAR_RESERVA") {
    statements.push(db.prepare(`UPDATE produtos SET estoque_reservado=estoque_reservado-(
      SELECT quantidade FROM pedido_itens WHERE id=?), atualizado_em=CURRENT_TIMESTAMP
      WHERE id=(SELECT produto_id FROM pedido_itens WHERE id=?) AND ${eligible}`)
      .bind(itemId, itemId));
  } else if (action === "REPOR") {
    statements.push(db.prepare(`UPDATE produtos SET estoque=estoque+(
      SELECT quantidade FROM pedido_itens WHERE id=?), atualizado_em=CURRENT_TIMESTAMP,
      disponivel=CASE WHEN ativo=1 THEN 1 ELSE disponivel END
      WHERE id=(SELECT produto_id FROM pedido_itens WHERE id=?) AND ${eligible}`)
      .bind(itemId, itemId));
  }
  statements.push(db.prepare(`UPDATE pedido_itens SET status_item='CANCELADO',
      estoque_estado=CASE WHEN ?='LIBERAR_RESERVA' THEN 'LIBERADO'
                          WHEN ?='REPOR' THEN 'REPOSTO' ELSE estoque_estado END,
      estoque_liberado_em=CASE WHEN ?='LIBERAR_RESERVA' THEN COALESCE(estoque_liberado_em,CURRENT_TIMESTAMP) ELSE estoque_liberado_em END,
      estoque_reposto_em=CASE WHEN ?='REPOR' THEN COALESCE(estoque_reposto_em,CURRENT_TIMESTAMP) ELSE estoque_reposto_em END
    WHERE id=? AND pedido_id=? AND status_item='ATIVO' AND ${eligible}`)
    .bind(action, action, action, action, itemId, pedidoId));
  statements.push(db.prepare(`UPDATE pedidos SET valor_total_centavos=(
      SELECT COALESCE(SUM(valor_total_centavos),0) FROM pedido_itens
      WHERE pedido_id=? AND status_item='ATIVO'), atualizado_em=CURRENT_TIMESTAMP
    WHERE id=? AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=? AND status_item='CANCELADO')`)
    .bind(pedidoId, pedidoId, itemId));
  statements.push(preparePedidoFinancialProjection(db, pedidoId));
  statements.push(preparePedidoPhysicalProjection(db, pedidoId));
  statements.push(db.prepare(`UPDATE pedido_item_cancelamentos SET status='CONCLUIDO',
      concluido_em=COALESCE(concluido_em,CURRENT_TIMESTAMP)
    WHERE pedido_id=? AND pedido_item_id=? AND status<>'CONCLUIDO'
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=? AND status_item='CANCELADO')`)
    .bind(pedidoId, itemId, itemId));
  return statements;
}

export async function createItemCancellation(
  db: D1Database,
  params: {
    pedidoId: number; itemId: number; usuarioId: number; operationKey: unknown;
    motivo?: string; estoqueAcao: string; previewFingerprint: string;
  },
): Promise<CancellationResult> {
  const parsed = parseOperationKey(params.operationKey);
  if (parsed.ok === false) return { ok: false, erro: parsed.erro };
  const motivo = String(params.motivo ?? "").trim().slice(0, 300);
  const identity: IdentidadeEsperada = {
    tipo: "ITEM_CANCELAMENTO_ADMIN", escopo: "ADMIN", atorUsuarioId: params.usuarioId,
    fingerprint: fingerprint({
      pedidoId: params.pedidoId, itemId: params.itemId, motivo,
      estoqueAcao: params.estoqueAcao, previewFingerprint: params.previewFingerprint,
    }),
  };
  const existing = await buscarOperacao(db, parsed.key);
  if (existing) return replayCancellation(db, existing, identity);

  let preview: ItemCancellationPreview;
  try {
    preview = await getItemCancellationPreview(db, params.pedidoId, params.itemId);
  } catch (error) {
    if (error instanceof ItemCancellationPreviewError && error.code === "CANCELAMENTO_JA_EXISTENTE") {
      return { ok: false, erro: "PREVIEW_OBSOLETO" };
    }
    throw error;
  }
  if (preview.previewFingerprint !== params.previewFingerprint) {
    return { ok: false, erro: "PREVIEW_OBSOLETO", preview };
  }
  if (preview.bloqueios.some((b) => b.codigo === "PIX_PENDENTE")) {
    return { ok: false, erro: "PIX_PENDENTE", preview };
  }
  if (!preview.cancelamentoExecutavel) return { ok: false, erro: "PREVIEW_OBSOLETO", preview };
  if (!acaoValida(preview.item.estoqueEstado, params.estoqueAcao)) {
    return { ok: false, erro: "ESTOQUE_ACAO_INVALIDA", preview };
  }

  const guard = snapshotGuard(preview);
  const status: CancellationStatus = preview.financeiro.reembolsoNecessarioCentavos > 0
    ? "AGUARDANDO_REEMBOLSO" : "SOLICITADO";
  const snapshot = JSON.stringify(preview);
  const insert = db.prepare(`INSERT INTO pedido_item_cancelamentos(
      pedido_id,pedido_item_id,status,valor_item_centavos,
      valor_pago_associado_centavos,valor_reembolso_necessario_centavos,
      estoque_acao,motivo,registrado_por_usuario_id,snapshot_financeiro)
    SELECT ?,pi.id,?,?,?,?,?,?,?,? FROM pedido_itens pi
    JOIN pedidos p ON p.id=pi.pedido_id
    WHERE p.id=? AND pi.id=? AND pi.status_item='ATIVO'
      AND pi.estoque_estado=? AND pi.valor_total_centavos=?
      AND p.status_comanda='ABERTA' AND p.status_pedido IN ('NOVO','PREPARANDO')
      AND NOT EXISTS(SELECT 1 FROM pedido_item_cancelamentos c
                     WHERE c.pedido_item_id=pi.id AND c.status<>'FALHOU')
      AND NOT EXISTS(SELECT 1 FROM pedido_item_trocas t
                     WHERE t.item_origem_id=pi.id AND t.status<>'FALHOU')
      AND NOT EXISTS(SELECT 1 FROM pedido_pagamentos px
                     WHERE px.pedido_id=p.id AND px.metodo='PIX_MP' AND px.status='PENDENTE')
      AND ${guard.sql}`)
    .bind(
      params.pedidoId, status, preview.item.valorCentavos,
      preview.financeiro.coberturaConfirmadaCentavos,
      preview.financeiro.reembolsoNecessarioCentavos,
      params.estoqueAcao, motivo, params.usuarioId, snapshot,
      params.pedidoId, params.itemId, preview.item.estoqueEstado,
      preview.item.valorCentavos, ...guard.args,
    );
  const claim = prepareClaimOperacao(db, {
    key: parsed.key, ...identity, fase: "CONCLUIDA",
    fonte: fonteCancelamentoCriado(params.pedidoId, params.itemId),
  });
  const statements = [insert, claim];
  if (status === "SOLICITADO") {
    statements.push(...finalizationStatements(
      db, params.pedidoId, params.itemId, null, parsed.key, params.estoqueAcao,
    ));
  }
  try {
    const results = await db.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      const atual = await getItemCancellationPreview(db, params.pedidoId, params.itemId)
        .catch(() => undefined);
      return { ok: false, erro: "PREVIEW_OBSOLETO", preview: atual };
    }
  } catch (error) {
    const winner = await buscarOperacao(db, parsed.key);
    if (winner) return replayCancellation(db, winner, identity);
    if (await getCancellationView(db, params.pedidoId, params.itemId)) {
      return { ok: false, erro: "PREVIEW_OBSOLETO" };
    }
    throw error;
  }
  const op = await buscarOperacao(db, parsed.key);
  if (!op) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  return replayCancellation(db, op, identity);
}

export async function confirmCancellationRefund(
  db: D1Database,
  params: {
    pedidoId: number; cancellationId: number; usuarioId: number; operationKey: unknown;
    pagamentoId: number; pagamentoAlocacaoId: number; valorCentavos: number; confirmacao: boolean;
  },
): Promise<CancellationResult> {
  const parsed = parseOperationKey(params.operationKey);
  if (parsed.ok === false) return { ok: false, erro: parsed.erro };
  const identity: IdentidadeEsperada = {
    tipo: "REFUND_ADMIN", escopo: "ADMIN", atorUsuarioId: params.usuarioId,
    fingerprint: fingerprint({
      pedidoId: params.pedidoId, cancellationId: params.cancellationId,
      pagamentoId: params.pagamentoId, pagamentoAlocacaoId: params.pagamentoAlocacaoId,
      valorCentavos: params.valorCentavos, confirmacao: params.confirmacao,
    }),
  };
  const existing = await buscarOperacao(db, parsed.key);
  if (existing) {
    const conflict = conflitoOperacao(existing, identity);
    if (conflict) return { ok: false, erro: conflict };
    const cancellation = await cancellationById(db, params.cancellationId);
    if (!cancellation || !existing.reembolso_id) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
    await tryFinalizeCancellation(db, cancellation);
    return { ok: true, cancelamento: await readCancellationView(db, cancellation), replay: true,
      reembolsoId: existing.reembolso_id };
  }
  const cancellation = await cancellationById(db, params.cancellationId);
  if (!cancellation || Number(cancellation.pedido_id) !== params.pedidoId) {
    return { ok: false, erro: "CANCELAMENTO_NAO_ENCONTRADO" };
  }
  if (cancellation.status !== "AGUARDANDO_REEMBOLSO" && cancellation.status !== "INCONCLUSIVO") {
    return { ok: false, erro: "CANCELAMENTO_NAO_AGUARDANDO" };
  }
  const view = await readCancellationView(db, cancellation);
  const leg = view.pernasPendentes.find((p) =>
    p.pagamentoId === params.pagamentoId && p.pagamentoAlocacaoId === params.pagamentoAlocacaoId,
  );
  if (!leg) return { ok: false, erro: "PAGAMENTO_ALOCACAO_INVALIDA" };
  if (!leg.confirmacaoManualPermitida) return { ok: false, erro: "PIX_MP_REFUND_REMOTO_PENDENTE" };
  if (!params.confirmacao || params.valorCentavos !== leg.valorCentavos) {
    return { ok: false, erro: "VALOR_REFUND_DIVERGENTE" };
  }
  const refundKey = chaveReembolso(parsed.key);
  const insertRefund = db.prepare(`INSERT INTO pedido_reembolsos(
      pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,
      registrado_por_usuario_id,motivo,devolveu_estoque,concluido_em)
    SELECT ?,pp.id,'MANUAL',pp.metodo,?,'REEMBOLSADO',?,?,'Cancelamento de item',0,CURRENT_TIMESTAMP
    FROM pedido_pagamentos pp JOIN pedido_pagamento_alocacoes a ON a.pagamento_id=pp.id
    WHERE pp.id=? AND a.id=? AND a.pedido_item_id=? AND pp.status='PAGO'
      AND pp.metodo IN ('DINHEIRO','CARTAO','PIX_EXTERNO')
      AND a.valor_centavos-${refundSomadoSql("a") }=?`)
    .bind(params.pedidoId, params.valorCentavos, refundKey, params.usuarioId,
      params.pagamentoId, params.pagamentoAlocacaoId, cancellation.pedido_item_id,
      params.valorCentavos);
  const claim = prepareClaimOperacao(db, {
    key: parsed.key, ...identity, fase: "CONCLUIDA", fonte: fonteReembolso(refundKey),
  });
  const allocate = db.prepare(`INSERT INTO pedido_reembolso_alocacoes(
      reembolso_id,pagamento_alocacao_id,pedido_item_cancelamento_id,valor_centavos)
    SELECT r.id,?,?,? FROM pedido_reembolsos r WHERE r.idempotency_key=?`)
    .bind(params.pagamentoAlocacaoId, params.cancellationId, params.valorCentavos, refundKey);
  try {
    await db.batch([insertRefund, claim, allocate, preparePedidoFinancialProjection(db, params.pedidoId)]);
  } catch (error) {
    const winner = await buscarOperacao(db, parsed.key);
    if (!winner) {
      const current = await readCancellationView(db, cancellation);
      if (!current.pernasPendentes.some((p) => p.pagamentoAlocacaoId === params.pagamentoAlocacaoId)) {
        return { ok: false, erro: "PAGAMENTO_ALOCACAO_INVALIDA" };
      }
      throw error;
    }
    const conflict = conflitoOperacao(winner, identity);
    if (conflict) return { ok: false, erro: conflict };
  }
  try {
    await tryFinalizeCancellation(db, cancellation);
  } catch (error) {
    console.error("Refund persistido; finalizacao de cancelamento pendente", params.cancellationId, error);
    await db.prepare(`UPDATE pedido_item_cancelamentos SET status='INCONCLUSIVO'
      WHERE id=? AND status='AGUARDANDO_REEMBOLSO'`).bind(params.cancellationId).run().catch(() => undefined);
  }
  const updated = await cancellationById(db, params.cancellationId);
  const op = await buscarOperacao(db, parsed.key);
  if (!updated || !op?.reembolso_id) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  return { ok: true, cancelamento: await readCancellationView(db, updated), reembolsoId: op.reembolso_id };
}

async function tryFinalizeCancellation(db: D1Database, row: CancellationRow): Promise<void> {
  const view = await readCancellationView(db, row);
  if (view.reembolsoPendenteCentavos > 0) return;
  await db.batch(finalizationStatements(
    db, Number(row.pedido_id), Number(row.pedido_item_id), Number(row.id), null, row.estoque_acao,
  ));
}
