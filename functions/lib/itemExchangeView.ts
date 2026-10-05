/// <reference types="@cloudflare/workers-types" />

import { getFinanceiroPedido, type FinanceiroPedido } from "./comandaLedger";
import { CONFIRMED_REFUNDS_BY_ALLOCATION_CTE, financialLineageCte } from "./financialCoverage";
import { MANUAL_METHODS } from "./itemExchangePreview";
import type {
  AllocationRow,
  ExchangeRow,
  ExchangeRefundLeg,
  ItemExchangePreview,
  ExchangeView
} from "./itemExchangeTypes";
import { getPixMpRefundIntentForLeg, type PixMpRefundIntentView } from "./mpRefundIntent";

interface PendingExchangeRefundData {
  allocation: AllocationRow;
  amount: number;
  remote: PixMpRefundIntentView | null;
}

interface ExchangeStockRow {
  id: number;
  estoque_estado: string;
}
interface ExchangeRefundRow {
  id: number;
  metodo: string;
  valor_centavos: number;
  origem: string;
  mp_refund_id: string | null;
}

export interface ExchangeViewData {
  row: ExchangeRow;
  pending: PendingExchangeRefundData[];
  stocks: ExchangeStockRow[];
  refunds: ExchangeRefundRow[];
  financeiro: FinanceiroPedido;
}

export async function exchangeById(db: D1Database, id: number): Promise<ExchangeRow | null> {
  return db
    .prepare(
      `SELECT id,pedido_id,item_origem_id,item_destino_id,status,estoque_acao_origem,snapshot_financeiro
    FROM pedido_item_trocas WHERE id=? LIMIT 1`
    )
    .bind(id)
    .first<ExchangeRow>();
}

export async function getExchangeView(
  db: D1Database,
  pedidoId: number,
  itemId: number
): Promise<ExchangeView | null> {
  const row = await db
    .prepare(
      `SELECT id,pedido_id,item_origem_id,item_destino_id,status,estoque_acao_origem,snapshot_financeiro
    FROM pedido_item_trocas WHERE pedido_id=? AND item_origem_id=? AND status<>'FALHOU' ORDER BY id DESC LIMIT 1`
    )
    .bind(pedidoId, itemId)
    .first<ExchangeRow>();
  return row ? exchangeView(db, row) : null;
}

function projectedExchangeTotal(row: ExchangeRow): number {
  let projectedTotal = 0;
  try {
    projectedTotal = (JSON.parse(row.snapshot_financeiro) as ItemExchangePreview).financeiro
      .totalProjetadoCentavos;
  } catch {
    projectedTotal = 0;
  }
  return projectedTotal;
}

function selectPendingExchangeRefunds(
  allocations: AllocationRow[],
  required: number
): Array<Omit<PendingExchangeRefundData, "remote">> {
  const selected: Array<Omit<PendingExchangeRefundData, "remote">> = [];
  for (const allocation of allocations) {
    if (required <= 0) break;
    const effective = Math.max(
      0,
      Number(allocation.valorAlocadoCentavos) - Number(allocation.valorReembolsadoCentavos)
    );
    const amount = Math.min(required, effective);
    if (amount > 0) selected.push({ allocation, amount });
    required -= amount;
  }
  return selected;
}

function composeExchangeRefundLeg({
  allocation,
  amount,
  remote
}: PendingExchangeRefundData): ExchangeRefundLeg {
  return {
    pagamentoId: Number(allocation.pagamentoId),
    pagamentoAlocacaoId: Number(allocation.pagamentoAlocacaoId),
    metodo: allocation.metodo,
    valorCentavos: amount,
    confirmacaoManualPermitida: MANUAL_METHODS.has(allocation.metodo),
    ...(remote
      ? {
          refundRemoto: {
            status: remote.status,
            tentativas: remote.tentativas,
            mpRefundId: remote.mpRefundId,
            ultimoErro: remote.ultimoErro,
            operationKey: remote.operationKey,
            atualizadoEm: remote.atualizadoEm,
            podeVerificar: remote.podeVerificar
          }
        }
      : {})
  };
}

export async function loadExchangeViewData(
  db: D1Database,
  row: ExchangeRow
): Promise<ExchangeViewData> {
  const projectedTotal = projectedExchangeTotal(row);
  const pending: PendingExchangeRefundData[] = [];
  if (!["CONCLUIDA", "AGUARDANDO_COBRANCA", "FALHOU"].includes(row.status)) {
    const financial = await getFinanceiroPedido(db, row.pedido_id);
    const required = Math.max(0, financial.liquidoCentavos - projectedTotal);
    const { results: allocations } = await db
      .prepare(
        `WITH RECURSIVE ${financialLineageCte("?")},
        ${CONFIRMED_REFUNDS_BY_ALLOCATION_CTE}
      SELECT pp.id AS pagamentoId,a.id AS pagamentoAlocacaoId,
        pp.metodo AS metodo,a.valor_centavos AS valorAlocadoCentavos,
        COALESCE(rf.valor_centavos,0) AS valorReembolsadoCentavos
      FROM pedido_pagamento_alocacoes a JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
      LEFT JOIN refunds_confirmados rf ON rf.pagamento_alocacao_id=a.id
      WHERE a.pedido_item_id IN (SELECT item_id FROM linhagem_financeira) AND pp.status='PAGO'
      ORDER BY a.id DESC`
      )
      .bind(row.item_origem_id)
      .all<AllocationRow>();

    for (const { allocation, amount } of selectPendingExchangeRefunds(allocations, required)) {
      const remote =
        allocation.metodo === "PIX_MP"
          ? await getPixMpRefundIntentForLeg(db, {
              exchangeId: Number(row.id),
              pagamentoAlocacaoId: Number(allocation.pagamentoAlocacaoId)
            })
          : null;
      pending.push({ allocation, amount, remote });
    }
  }
  const [stocks, refunds, financeiro] = await Promise.all([
    db
      .prepare(`SELECT id,estoque_estado FROM pedido_itens WHERE id IN (?,?)`)
      .bind(row.item_origem_id, row.item_destino_id ?? -1)
      .all<{ id: number; estoque_estado: string }>(),
    db
      .prepare(
        `SELECT r.id,r.metodo,r.valor_centavos,r.origem,r.mp_refund_id
      FROM pedido_item_troca_reembolso_alocacoes ra JOIN pedido_reembolsos r ON r.id=ra.reembolso_id
      WHERE ra.pedido_item_troca_id=? AND r.status='REEMBOLSADO' ORDER BY r.id`
      )
      .bind(row.id)
      .all<{
        id: number;
        metodo: string;
        valor_centavos: number;
        origem: string;
        mp_refund_id: string | null;
      }>(),
    getFinanceiroPedido(db, Number(row.pedido_id))
  ]);
  return { row, pending, stocks: stocks.results, refunds: refunds.results, financeiro };
}

export function buildExchangeView({
  row,
  pending: loadedPending,
  stocks,
  refunds,
  financeiro
}: ExchangeViewData): ExchangeView {
  const pending = loadedPending.map(composeExchangeRefundLeg);
  const originStock = stocks.find(item => Number(item.id) === Number(row.item_origem_id));
  const destinationStock = stocks.find(item => Number(item.id) === Number(row.item_destino_id));
  return {
    id: Number(row.id),
    pedidoId: Number(row.pedido_id),
    itemOrigemId: Number(row.item_origem_id),
    itemDestinoId: row.item_destino_id == null ? null : Number(row.item_destino_id),
    status: row.status,
    reembolsoPendenteCentavos: pending.reduce((s, x) => s + x.valorCentavos, 0),
    refundsPendentes: pending,
    estoqueOrigemEstado: originStock?.estoque_estado ?? "DESCONHECIDO",
    estoqueDestinoEstado: destinationStock?.estoque_estado ?? null,
    reembolsosConfirmados: refunds.map(refund => ({
      id: Number(refund.id),
      metodo: refund.metodo,
      valorCentavos: Number(refund.valor_centavos),
      origem: refund.origem,
      mpRefundId: refund.mp_refund_id
    })),
    financeiro: {
      status: financeiro.status,
      totalCentavos: financeiro.totalCentavos,
      liquidoCentavos: financeiro.liquidoCentavos,
      saldoCentavos: financeiro.saldoCentavos
    }
  };
}

export async function exchangeView(db: D1Database, row: ExchangeRow): Promise<ExchangeView> {
  return buildExchangeView(await loadExchangeViewData(db, row));
}
