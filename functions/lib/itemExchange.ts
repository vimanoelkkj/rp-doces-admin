/// <reference types="@cloudflare/workers-types" />

import { precoVigenteCentavos } from "../../shared/promocao";
import { getFinanceiroPedido } from "./comandaLedger";
import {
  buscarOperacao, chaveReembolso, conflitoOperacao, fingerprint,
  fonteReembolso, fonteTrocaCriada, parseOperationKey, prepareClaimOperacao,
  type ConflitoOperacao, type IdentidadeEsperada, type OperacaoRow,
} from "./operacoes";
import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";
import { preparePedidoPhysicalProjection } from "./stock";
import { getPixMpRefundIntentForLeg, reconcilePixMpRefundIntent,
  type PixMpRefundIntentStatus } from "./mpRefundIntent";

export type ExchangeStockAction = "LIBERAR_RESERVA" | "NAO_REPOR" | "REPOR" | "NENHUMA";
export type ExchangeStatus = "SOLICITADA" | "AGUARDANDO_COBRANCA" |
  "AGUARDANDO_REEMBOLSO" | "CONCLUIDA" | "INCONCLUSIVA" | "FALHOU";

export interface ExchangeRefundLeg {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorCentavos: number;
  confirmacaoManualPermitida: boolean;
  refundRemoto?: { status: PixMpRefundIntentStatus; tentativas: number; mpRefundId: string | null; ultimoErro: string | null };
}

export interface ItemExchangePreview {
  previewFingerprint: string;
  pedidoId: number;
  itemOrigem: { id: number; nome: string; valorCentavos: number; coberturaEfetivaCentavos: number; estoqueEstado: string };
  itemDestino: { produtoId: number; nome: string; quantidade: number; precoUnitarioCentavos: number; valorCentavos: number; estoqueDisponivel: number };
  financeiro: {
    totalAtualCentavos: number; liquidoAtualCentavos: number; totalProjetadoCentavos: number;
    diferencaCentavos: number; tipoDiferenca: "COBRAR" | "DEVOLVER" | "ZERO";
    saldoProjetadoCentavos: number; excessoProjetadoCentavos: number;
  };
  refundsPropostos: ExchangeRefundLeg[];
  estoque: { acaoOrigem: ExchangeStockAction; acoesOrigemPermitidas: ExchangeStockAction[]; estadoDestino: "RESERVADO" };
  bloqueios: Array<{ codigo: string; mensagem: string }>;
  trocaExecutavel: boolean;
}

export class ItemExchangePreviewError extends Error {
  constructor(public code: string, message: string, public status = 409,
    public extra: Record<string, unknown> = {}) { super(message); }
}

interface OriginRow {
  id: number; pedido_id: number; produto_nome: string; quantidade: number;
  valor_total_centavos: number; status_item: string; estoque_estado: string;
}
interface ProductRow {
  id: number; nome: string; preco_centavos: number; preco_promocional_centavos: number | null;
  promocao_inicio: string | null; promocao_fim: string | null; estoque: number;
  promocao_ativa: number;
  estoque_reservado: number; ativo: number; disponivel: number;
}
interface AllocationRow {
  pagamentoId: number; pagamentoAlocacaoId: number; metodo: string;
  valorAlocadoCentavos: number; valorReembolsadoCentavos: number;
}
interface ExchangeRow {
  id: number; pedido_id: number; item_origem_id: number; item_destino_id: number | null;
  status: ExchangeStatus; estoque_acao_origem: ExchangeStockAction; snapshot_financeiro: string;
}

const MANUAL_METHODS = new Set(["DINHEIRO", "CARTAO", "PIX_EXTERNO"]);
const refundsUnion = `(SELECT reembolso_id,pagamento_alocacao_id,valor_centavos FROM pedido_reembolso_alocacoes
  UNION ALL SELECT reembolso_id,pagamento_alocacao_id,valor_centavos FROM pedido_item_troca_reembolso_alocacoes)`;

function stockActions(state: string): ExchangeStockAction[] {
  if (state === "RESERVADO") return ["LIBERAR_RESERVA"];
  if (state === "BAIXADO") return ["NAO_REPOR", "REPOR"];
  return ["NENHUMA"];
}

export async function getItemExchangePreview(
  db: D1Database,
  params: {
    pedidoId: number; itemId: number; produtoDestinoId: number; quantidadeDestino: number;
    precoEsperadoCentavos: number; estoqueAcaoOrigem?: string;
    permitirTrocaExistente?: boolean;
  },
): Promise<ItemExchangePreview> {
  const pedido = await db.prepare(`SELECT id,valor_total_centavos,status_pedido,status_comanda,origem_pedido
    FROM pedidos WHERE id=? LIMIT 1`).bind(params.pedidoId).first<{
      id: number; valor_total_centavos: number; status_pedido: string; status_comanda: string; origem_pedido: string;
    }>();
  if (!pedido) throw new ItemExchangePreviewError("PEDIDO_NAO_ENCONTRADO", "Pedido não encontrado", 404);
  const origin = await db.prepare(`SELECT id,pedido_id,produto_nome,quantidade,valor_total_centavos,status_item,estoque_estado
    FROM pedido_itens WHERE id=? LIMIT 1`).bind(params.itemId).first<OriginRow>();
  if (!origin) throw new ItemExchangePreviewError("ITEM_NAO_ENCONTRADO", "Item não encontrado", 404);
  if (Number(origin.pedido_id) !== params.pedidoId) throw new ItemExchangePreviewError("ITEM_FORA_DO_PEDIDO", "Item fora do pedido");
  if (origin.status_item !== "ATIVO") throw new ItemExchangePreviewError("ITEM_NAO_ATIVO", "Somente item ativo pode ser trocado");
  if (!Number.isInteger(params.quantidadeDestino) || params.quantidadeDestino < 1 || params.quantidadeDestino > 50) {
    throw new ItemExchangePreviewError("QUANTIDADE_INVALIDA", "Quantidade inválida", 400);
  }
  if (!params.permitirTrocaExistente) {
    const existing = await db.prepare(`SELECT 1 FROM pedido_item_trocas
      WHERE item_origem_id=? AND status<>'FALHOU' LIMIT 1`).bind(params.itemId).first();
    if (existing) throw new ItemExchangePreviewError("TROCA_JA_EXISTENTE", "Já existe uma troca para este item");
  }
  const product = await db.prepare(`SELECT id,nome,preco_centavos,preco_promocional_centavos,promocao_ativa,
      promocao_inicio,promocao_fim,estoque,estoque_reservado,ativo,disponivel
    FROM produtos WHERE id=? LIMIT 1`).bind(params.produtoDestinoId).first<ProductRow>();
  if (!product || product.ativo !== 1) throw new ItemExchangePreviewError("PRODUTO_NAO_ENCONTRADO", "Produto de destino não encontrado", 404);
  const currentPrice = precoVigenteCentavos(product);
  if (currentPrice !== params.precoEsperadoCentavos) {
    throw new ItemExchangePreviewError("PRECO_ALTERADO", "O preço do produto mudou", 409,
      { precoAtualCentavos: currentPrice });
  }
  const allowed = stockActions(origin.estoque_estado);
  const selectedAction = (params.estoqueAcaoOrigem ?? allowed[0]) as ExchangeStockAction;
  if (!allowed.includes(selectedAction)) throw new ItemExchangePreviewError("ESTOQUE_ACAO_INVALIDA", "Ação de estoque inválida");

  const legacyRefund=await db.prepare(`SELECT r.id FROM pedido_reembolsos r
    LEFT JOIN ${refundsUnion} ra ON ra.reembolso_id=r.id
    WHERE r.pedido_id=? AND r.status='REEMBOLSADO'
    GROUP BY r.id,r.valor_centavos HAVING COALESCE(SUM(ra.valor_centavos),0)<>r.valor_centavos LIMIT 1`)
    .bind(params.pedidoId).first();
  if(legacyRefund)throw new ItemExchangePreviewError("COBERTURA_INDETERMINADA",
    "Há um reembolso histórico sem atribuição completa. A origem financeira da troca não pode ser determinada.");

  const { results: allocations } = await db.prepare(`SELECT pp.id AS pagamentoId,
      a.id AS pagamentoAlocacaoId,pp.metodo AS metodo,a.valor_centavos AS valorAlocadoCentavos,
      COALESCE(SUM(CASE WHEN r.status='REEMBOLSADO' THEN ra.valor_centavos ELSE 0 END),0) AS valorReembolsadoCentavos
    FROM pedido_pagamento_alocacoes a JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
    LEFT JOIN ${refundsUnion} ra ON ra.pagamento_alocacao_id=a.id
    LEFT JOIN pedido_reembolsos r ON r.id=ra.reembolso_id
    WHERE a.pedido_item_id=? AND pp.status='PAGO'
    GROUP BY a.id,pp.id,pp.metodo,a.valor_centavos ORDER BY a.id DESC`)
    .bind(params.itemId).all<AllocationRow>();
  const effective = allocations.map((a) => ({ ...a,
    efetivo: Math.max(0, Number(a.valorAlocadoCentavos) - Number(a.valorReembolsadoCentavos)),
  }));
  const originCoverage = effective.reduce((s, a) => s + a.efetivo, 0);
  const financeiroAtual = await getFinanceiroPedido(db, params.pedidoId);
  const destinationValue = currentPrice * params.quantidadeDestino;
  const projectedTotal = Number(pedido.valor_total_centavos) - Number(origin.valor_total_centavos) + destinationValue;
  const projectedBalance = Math.max(0, projectedTotal - financeiroAtual.liquidoCentavos);
  const projectedExcess = Math.max(0, financeiroAtual.liquidoCentavos - projectedTotal);
  const difference = projectedBalance > 0 ? projectedBalance : -projectedExcess;
  const differenceType: "COBRAR" | "DEVOLVER" | "ZERO" = difference > 0 ? "COBRAR" : difference < 0 ? "DEVOLVER" : "ZERO";
  let remainingRefund = projectedExcess;
  const proposedRefunds: ExchangeRefundLeg[] = [];
  for (const allocation of effective) {
    if (remainingRefund <= 0) break;
    const amount = Math.min(remainingRefund, allocation.efetivo);
    if (amount > 0) proposedRefunds.push({
      pagamentoId: Number(allocation.pagamentoId),
      pagamentoAlocacaoId: Number(allocation.pagamentoAlocacaoId),
      metodo: allocation.metodo,
      valorCentavos: amount,
      confirmacaoManualPermitida: MANUAL_METHODS.has(allocation.metodo),
    });
    remainingRefund -= amount;
  }
  const stockAvailable = Math.max(0, Number(product.estoque) - Number(product.estoque_reservado));
  const availableAfterOrigin = stockAvailable
    + (Number(params.produtoDestinoId) === Number((await db.prepare(`SELECT produto_id FROM pedido_itens WHERE id=?`).bind(params.itemId).first<{produto_id:number|null}>())?.produto_id)
      && origin.estoque_estado === "RESERVADO" && selectedAction === "LIBERAR_RESERVA" && projectedExcess === 0
      ? Number(origin.quantidade) : 0)
    + (Number(params.produtoDestinoId) === Number((await db.prepare(`SELECT produto_id FROM pedido_itens WHERE id=?`).bind(params.itemId).first<{produto_id:number|null}>())?.produto_id)
      && origin.estoque_estado === "BAIXADO" && selectedAction === "REPOR" && projectedExcess === 0
      ? Number(origin.quantidade) : 0);
  const blockers: Array<{ codigo: string; mensagem: string }> = [];
  if (pedido.origem_pedido !== "MANUAL" || pedido.status_comanda !== "ABERTA"
      || !["NOVO", "PREPARANDO", "PRONTO"].includes(pedido.status_pedido)) {
    blockers.push({ codigo: "PEDIDO_NAO_TROCAVEL", mensagem: "Este pedido não aceita troca nesta etapa." });
  } else if (pedido.status_pedido === "PRONTO") {
    blockers.push({ codigo: "STATUS_PEDIDO_PRONTO", mensagem: "Pedido pronto não pode ser reaberto nesta fase." });
  }
  const pendingPix = await db.prepare(`SELECT 1 FROM pedido_pagamentos
    WHERE pedido_id=? AND metodo='PIX_MP' AND status='PENDENTE' LIMIT 1`).bind(params.pedidoId).first();
  if (pendingPix) blockers.push({ codigo: "PIX_PENDENTE", mensagem: "Há um Pix pendente nesta comanda." });
  if (product.disponivel !== 1 || availableAfterOrigin < params.quantidadeDestino) {
    blockers.push({ codigo: "ESTOQUE_INSUFICIENTE", mensagem: "Estoque insuficiente para o produto de destino." });
  }
  if (remainingRefund > 0) blockers.push({ codigo: "COBERTURA_INSUFICIENTE", mensagem: "A origem financeira do excesso não pôde ser determinada." });

  const content = {
    pedidoId: params.pedidoId,
    itemOrigem: { id: Number(origin.id), nome: origin.produto_nome,
      valorCentavos: Number(origin.valor_total_centavos), coberturaEfetivaCentavos: originCoverage,
      estoqueEstado: origin.estoque_estado },
    itemDestino: { produtoId: Number(product.id), nome: product.nome, quantidade: params.quantidadeDestino,
      precoUnitarioCentavos: currentPrice, valorCentavos: destinationValue, estoqueDisponivel: stockAvailable },
    financeiro: { totalAtualCentavos: Number(pedido.valor_total_centavos),
      liquidoAtualCentavos: financeiroAtual.liquidoCentavos, totalProjetadoCentavos: projectedTotal,
      diferencaCentavos: difference, tipoDiferenca: differenceType,
      saldoProjetadoCentavos: projectedBalance, excessoProjetadoCentavos: projectedExcess },
    refundsPropostos: proposedRefunds,
    estoque: { acaoOrigem: selectedAction, acoesOrigemPermitidas: allowed, estadoDestino: "RESERVADO" as const },
    bloqueios: blockers,
    trocaExecutavel: blockers.length === 0,
  };
  return { previewFingerprint: fingerprint(content), ...content };
}

export interface ExchangeView {
  id: number; pedidoId: number; itemOrigemId: number; itemDestinoId: number | null;
  status: ExchangeStatus; reembolsoPendenteCentavos: number; refundsPendentes: ExchangeRefundLeg[];
}
type ExchangeError = "OPERATION_KEY_INVALIDA" | "PREVIEW_OBSOLETO" | "PRECO_ALTERADO" |
  "ESTOQUE_INSUFICIENTE" | "PIX_PENDENTE" | "TROCA_NAO_ENCONTRADA" |
  "TROCA_NAO_AGUARDANDO" | "PAGAMENTO_ALOCACAO_INVALIDA" |
  "PIX_MP_REFUND_REMOTO_PENDENTE" | "VALOR_REFUND_DIVERGENTE" |
  "MERCADO_PAGO_NAO_CONFIGURADO" | "REFUND_REMOTO_EM_ANDAMENTO" |
  "OPERACAO_INCOMPLETA" | ConflitoOperacao;
export type ExchangeResult = { ok: true; troca: ExchangeView; replay?: boolean; reembolsoId?: number; refundStatus?: PixMpRefundIntentStatus }
  | { ok: false; erro: ExchangeError; preview?: ItemExchangePreview; precoAtualCentavos?: number };

async function exchangeById(db: D1Database, id: number): Promise<ExchangeRow | null> {
  return db.prepare(`SELECT id,pedido_id,item_origem_id,item_destino_id,status,estoque_acao_origem,snapshot_financeiro
    FROM pedido_item_trocas WHERE id=? LIMIT 1`).bind(id).first<ExchangeRow>();
}

export async function getExchangeView(db:D1Database,pedidoId:number,itemId:number):Promise<ExchangeView|null>{
  const row=await db.prepare(`SELECT id,pedido_id,item_origem_id,item_destino_id,status,estoque_acao_origem,snapshot_financeiro
    FROM pedido_item_trocas WHERE pedido_id=? AND item_origem_id=? AND status<>'FALHOU' ORDER BY id DESC LIMIT 1`)
    .bind(pedidoId,itemId).first<ExchangeRow>();
  return row?exchangeView(db,row):null;
}

async function exchangeView(db: D1Database, row: ExchangeRow): Promise<ExchangeView> {
  let projectedTotal=0;
  try { projectedTotal=(JSON.parse(row.snapshot_financeiro) as ItemExchangePreview).financeiro.totalProjetadoCentavos; } catch { projectedTotal=0; }
  let pending:ExchangeRefundLeg[]=[];
  if(!["CONCLUIDA","AGUARDANDO_COBRANCA","FALHOU"].includes(row.status)){
    const financial=await getFinanceiroPedido(db,row.pedido_id);
    let required=Math.max(0,financial.liquidoCentavos-projectedTotal);
    const {results:allocations}=await db.prepare(`SELECT pp.id AS pagamentoId,a.id AS pagamentoAlocacaoId,
        pp.metodo AS metodo,a.valor_centavos AS valorAlocadoCentavos,
        COALESCE(SUM(CASE WHEN r.status='REEMBOLSADO' THEN ra.valor_centavos ELSE 0 END),0) AS valorReembolsadoCentavos
      FROM pedido_pagamento_alocacoes a JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
      LEFT JOIN ${refundsUnion} ra ON ra.pagamento_alocacao_id=a.id
      LEFT JOIN pedido_reembolsos r ON r.id=ra.reembolso_id
      WHERE a.pedido_item_id=? AND pp.status='PAGO'
      GROUP BY a.id,pp.id,pp.metodo,a.valor_centavos ORDER BY a.id DESC`).bind(row.item_origem_id).all<AllocationRow>();
    pending=[];
    for(const allocation of allocations){if(required<=0)break;const effective=Math.max(0,Number(allocation.valorAlocadoCentavos)-Number(allocation.valorReembolsadoCentavos));
      const amount=Math.min(required,effective);if(amount>0){const remote=allocation.metodo==="PIX_MP"
        ?await getPixMpRefundIntentForLeg(db,{exchangeId:Number(row.id),pagamentoAlocacaoId:Number(allocation.pagamentoAlocacaoId)}):null;
        pending.push({pagamentoId:Number(allocation.pagamentoId),pagamentoAlocacaoId:Number(allocation.pagamentoAlocacaoId),
        metodo:allocation.metodo,valorCentavos:amount,confirmacaoManualPermitida:MANUAL_METHODS.has(allocation.metodo),
        ...(remote?{refundRemoto:{status:remote.status,tentativas:remote.tentativas,mpRefundId:remote.mpRefundId,ultimoErro:remote.ultimoErro}}:{})});}required-=amount;}
  }
  return { id: Number(row.id), pedidoId: Number(row.pedido_id), itemOrigemId: Number(row.item_origem_id),
    itemDestinoId: row.item_destino_id == null ? null : Number(row.item_destino_id), status: row.status,
    reembolsoPendenteCentavos: pending.reduce((s, x) => s + x.valorCentavos, 0), refundsPendentes: pending };
}

async function replayExchange(db: D1Database, op: OperacaoRow, identity: IdentidadeEsperada): Promise<ExchangeResult> {
  const conflict = conflitoOperacao(op, identity);
  if (conflict) return { ok: false, erro: conflict };
  if (!op.pedido_item_troca_id) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  const row = await exchangeById(db, op.pedido_item_troca_id);
  return row ? { ok: true, troca: await exchangeView(db, row), replay: true }
    : { ok: false, erro: "OPERACAO_INCOMPLETA" };
}

function originPhysicalStatements(db: D1Database, itemId: number, action: ExchangeStockAction, extraGuard=""): D1PreparedStatement[] {
  if (action === "LIBERAR_RESERVA") return [db.prepare(`UPDATE produtos SET estoque_reservado=estoque_reservado-(SELECT quantidade FROM pedido_itens WHERE id=?),atualizado_em=CURRENT_TIMESTAMP
    WHERE id=(SELECT produto_id FROM pedido_itens WHERE id=?)
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=? AND status_item='ATIVO' AND estoque_estado='RESERVADO') ${extraGuard}`).bind(itemId, itemId,itemId)];
  if (action === "REPOR") return [db.prepare(`UPDATE produtos SET estoque=estoque+(SELECT quantidade FROM pedido_itens WHERE id=?),disponivel=CASE WHEN ativo=1 THEN 1 ELSE disponivel END,atualizado_em=CURRENT_TIMESTAMP
    WHERE id=(SELECT produto_id FROM pedido_itens WHERE id=?)
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=? AND status_item='ATIVO' AND estoque_estado='BAIXADO') ${extraGuard}`).bind(itemId, itemId,itemId)];
  return [];
}

function completeExchangeStatements(db: D1Database, row: ExchangeRow): D1PreparedStatement[] {
  let projectedTotal=0;try{projectedTotal=(JSON.parse(row.snapshot_financeiro) as ItemExchangePreview).financeiro.totalProjetadoCentavos;}catch{projectedTotal=-1;}
  const safe=`AND (COALESCE((SELECT SUM(valor_centavos) FROM pedido_pagamentos WHERE pedido_id=${Number(row.pedido_id)} AND status='PAGO'),0)
    -COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pedido_id=${Number(row.pedido_id)} AND status='REEMBOLSADO'),0))<=${Number(projectedTotal)}`;
  const statements = originPhysicalStatements(db, row.item_origem_id, row.estoque_acao_origem,safe);
  statements.push(db.prepare(`UPDATE pedido_itens SET status_item='CANCELADO',
      estoque_estado=CASE WHEN ?='LIBERAR_RESERVA' THEN 'LIBERADO' WHEN ?='REPOR' THEN 'REPOSTO' ELSE estoque_estado END,
      estoque_liberado_em=CASE WHEN ?='LIBERAR_RESERVA' THEN COALESCE(estoque_liberado_em,CURRENT_TIMESTAMP) ELSE estoque_liberado_em END,
      estoque_reposto_em=CASE WHEN ?='REPOR' THEN COALESCE(estoque_reposto_em,CURRENT_TIMESTAMP) ELSE estoque_reposto_em END
    WHERE id=? AND status_item='ATIVO' ${safe}`).bind(row.estoque_acao_origem,row.estoque_acao_origem,row.estoque_acao_origem,row.estoque_acao_origem,row.item_origem_id));
  statements.push(db.prepare(`UPDATE pedido_itens SET status_item='ATIVO',pedido_item_troca_id=NULL
    WHERE id=? AND pedido_item_troca_id=? AND status_item='TROCA_PENDENTE' ${safe}`).bind(row.item_destino_id,row.id));
  statements.push(db.prepare(`UPDATE pedidos SET valor_total_centavos=(SELECT COALESCE(SUM(valor_total_centavos),0)
    FROM pedido_itens WHERE pedido_id=? AND status_item='ATIVO'),atualizado_em=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(row.pedido_id,row.pedido_id));
  statements.push(preparePedidoFinancialProjection(db,row.pedido_id));
  statements.push(preparePedidoPhysicalProjection(db,row.pedido_id));
  statements.push(db.prepare(`UPDATE pedido_item_trocas SET status=CASE
      WHEN (SELECT MAX(0,p.valor_total_centavos-COALESCE((SELECT SUM(valor_centavos) FROM pedido_pagamentos WHERE pedido_id=p.id AND status='PAGO'),0)+COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pedido_id=p.id AND status='REEMBOLSADO'),0)) FROM pedidos p WHERE p.id=pedido_id)>0
      THEN 'AGUARDANDO_COBRANCA' ELSE 'CONCLUIDA' END,
      concluido_em=CASE WHEN (SELECT status_pagamento FROM pedidos WHERE id=pedido_id)='PAGO' THEN COALESCE(concluido_em,CURRENT_TIMESTAMP) ELSE concluido_em END
    WHERE id=? AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=item_origem_id AND status_item='CANCELADO')
      AND EXISTS(SELECT 1 FROM pedido_itens WHERE id=item_destino_id AND status_item='ATIVO')`).bind(row.id));
  return statements;
}

function completeInitialExchangeStatements(db:D1Database,params:{pedidoId:number;itemId:number;operationKey:string;
  action:ExchangeStockAction;projectedBalance:number}):D1PreparedStatement[]{
  const statements=originPhysicalStatements(db,params.itemId,params.action);
  statements.push(db.prepare(`UPDATE pedido_itens SET status_item='CANCELADO',
    estoque_estado=CASE WHEN ?='LIBERAR_RESERVA' THEN 'LIBERADO' WHEN ?='REPOR' THEN 'REPOSTO' ELSE estoque_estado END,
    estoque_liberado_em=CASE WHEN ?='LIBERAR_RESERVA' THEN COALESCE(estoque_liberado_em,CURRENT_TIMESTAMP) ELSE estoque_liberado_em END,
    estoque_reposto_em=CASE WHEN ?='REPOR' THEN COALESCE(estoque_reposto_em,CURRENT_TIMESTAMP) ELSE estoque_reposto_em END
    WHERE id=? AND status_item='ATIVO'`).bind(params.action,params.action,params.action,params.action,params.itemId));
  statements.push(db.prepare(`UPDATE pedido_itens SET status_item='ATIVO',pedido_item_troca_id=NULL
    WHERE pedido_item_troca_id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)
      AND status_item='TROCA_PENDENTE'`).bind(params.operationKey));
  statements.push(db.prepare(`UPDATE pedidos SET valor_total_centavos=(SELECT COALESCE(SUM(valor_total_centavos),0)
    FROM pedido_itens WHERE pedido_id=? AND status_item='ATIVO'),atualizado_em=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(params.pedidoId,params.pedidoId));
  statements.push(preparePedidoFinancialProjection(db,params.pedidoId));
  statements.push(preparePedidoPhysicalProjection(db,params.pedidoId));
  statements.push(db.prepare(`UPDATE pedido_item_trocas SET status=?,concluido_em=CASE WHEN ?='CONCLUIDA' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)`)
    .bind(params.projectedBalance>0?"AGUARDANDO_COBRANCA":"CONCLUIDA",params.projectedBalance>0?"AGUARDANDO_COBRANCA":"CONCLUIDA",params.operationKey));
  return statements;
}

function exchangeInvariant(db:D1Database,pedidoId:number,operationKey:string,pending:boolean):D1PreparedStatement{
  return db.prepare(`UPDATE pedidos AS p SET valor_total_centavos=-1 WHERE p.id=? AND NOT EXISTS(
    SELECT 1 FROM pedido_operacoes o JOIN pedido_item_trocas t ON t.id=o.pedido_item_troca_id
    JOIN pedido_itens origem ON origem.id=t.item_origem_id
    JOIN pedido_itens destino ON destino.id=t.item_destino_id
    WHERE o.operation_key=? AND t.pedido_id=p.id
      AND origem.status_item=? AND destino.status_item=?
      AND destino.estoque_estado='RESERVADO'
      AND p.valor_total_centavos=(SELECT COALESCE(SUM(valor_total_centavos),0) FROM pedido_itens
                                  WHERE pedido_id=p.id AND status_item='ATIVO')
      AND NOT EXISTS(
        SELECT 1 FROM produtos pr WHERE pr.id IN (origem.produto_id,destino.produto_id)
          AND pr.estoque_reservado<>(SELECT COALESCE(SUM(pi.quantidade),0) FROM pedido_itens pi
            WHERE pi.produto_id=pr.id AND pi.status_item IN ('ATIVO','TROCA_PENDENTE') AND pi.estoque_estado='RESERVADO')
      )
  )`).bind(pedidoId,operationKey,pending?"ATIVO":"CANCELADO",pending?"TROCA_PENDENTE":"ATIVO");
}

export async function createItemExchange(db: D1Database, params: {
  pedidoId: number; itemId: number; produtoDestinoId: number; quantidadeDestino: number;
  precoEsperadoCentavos: number; estoqueAcaoOrigem: string; previewFingerprint: string;
  motivo?: string; usuarioId: number; operationKey: unknown;
}): Promise<ExchangeResult> {
  const parsed = parseOperationKey(params.operationKey);
  if (parsed.ok === false) return { ok: false, erro: parsed.erro };
  const motivo = String(params.motivo ?? "").trim().slice(0,300);
  const identity: IdentidadeEsperada = { tipo:"ITEM_TROCA_ADMIN",escopo:"ADMIN",atorUsuarioId:params.usuarioId,
    fingerprint:fingerprint({pedidoId:params.pedidoId,itemOrigemId:params.itemId,
      produtoDestinoId:params.produtoDestinoId,quantidadeDestino:params.quantidadeDestino,
      precoEsperadoDestinoCentavos:params.precoEsperadoCentavos,estoqueAcaoOrigem:params.estoqueAcaoOrigem,
      motivo,previewFingerprint:params.previewFingerprint}) };
  const existing = await buscarOperacao(db, parsed.key);
  if (existing) return replayExchange(db, existing, identity);
  let preview: ItemExchangePreview;
  try { preview = await getItemExchangePreview(db, params); }
  catch (error) {
    if (error instanceof ItemExchangePreviewError && error.code === "PRECO_ALTERADO") {
      return {ok:false,erro:"PRECO_ALTERADO",precoAtualCentavos:Number(error.extra.precoAtualCentavos)};
    }
    throw error;
  }
  if (preview.previewFingerprint !== params.previewFingerprint) return {ok:false,erro:"PREVIEW_OBSOLETO",preview};
  if (!preview.trocaExecutavel) {
    const code = preview.bloqueios[0]?.codigo;
    return {ok:false,erro:code === "PIX_PENDENTE" ? "PIX_PENDENTE" : code === "ESTOQUE_INSUFICIENTE" ? "ESTOQUE_INSUFICIENTE" : "PREVIEW_OBSOLETO",preview};
  }
  const awaitingRefund = preview.financeiro.excessoProjetadoCentavos > 0;
  const initialStatus: ExchangeStatus = awaitingRefund ? "AGUARDANDO_REEMBOLSO" : "SOLICITADA";
  const insertExchange = db.prepare(`INSERT INTO pedido_item_trocas(pedido_id,item_origem_id,produto_destino_id,
      quantidade_destino,preco_unitario_destino_centavos,valor_origem_centavos,valor_destino_centavos,
      diferenca_centavos,tipo_diferenca,estoque_acao_origem,status,motivo,registrado_por_usuario_id,snapshot_financeiro)
    SELECT ?,pi.id,?,?,?,?,?,?,?,?,?,?,?,? FROM pedido_itens pi JOIN pedidos p ON p.id=pi.pedido_id
    JOIN produtos pr ON pr.id=? WHERE p.id=? AND pi.id=? AND pi.status_item='ATIVO'
      AND pi.estoque_estado=? AND pi.valor_total_centavos=? AND p.valor_total_centavos=?
      AND p.origem_pedido='MANUAL' AND p.status_comanda='ABERTA' AND p.status_pedido IN ('NOVO','PREPARANDO')
      AND pr.ativo=1 AND pr.disponivel=1 AND pr.id=? AND pr.preco_centavos>=0
      AND NOT EXISTS(SELECT 1 FROM pedido_pagamentos px WHERE px.pedido_id=p.id AND px.metodo='PIX_MP' AND px.status='PENDENTE')
      AND NOT EXISTS(SELECT 1 FROM pedido_item_trocas x WHERE x.item_origem_id=pi.id AND x.status<>'FALHOU')
      AND NOT EXISTS(SELECT 1 FROM pedido_item_cancelamentos c WHERE c.pedido_item_id=pi.id AND c.status<>'FALHOU')
      AND (COALESCE((SELECT SUM(valor_centavos) FROM pedido_pagamentos WHERE pedido_id=p.id AND status='PAGO'),0)
           -COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pedido_id=p.id AND status='REEMBOLSADO'),0))=?`)
    .bind(params.pedidoId,params.produtoDestinoId,params.quantidadeDestino,params.precoEsperadoCentavos,
      preview.itemOrigem.valorCentavos,preview.itemDestino.valorCentavos,preview.financeiro.diferencaCentavos,
      preview.financeiro.tipoDiferenca,params.estoqueAcaoOrigem,initialStatus,motivo,params.usuarioId,JSON.stringify(preview),
      params.produtoDestinoId,params.pedidoId,params.itemId,preview.itemOrigem.estoqueEstado,
      preview.itemOrigem.valorCentavos,preview.financeiro.totalAtualCentavos,params.produtoDestinoId,
      preview.financeiro.liquidoAtualCentavos);
  const claim = prepareClaimOperacao(db,{key:parsed.key,...identity,fase:"CONCLUIDA",fonte:fonteTrocaCriada(params.pedidoId,params.itemId)});
  const insertDestination = db.prepare(`INSERT INTO pedido_itens(pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,criado_em,adicionado_por_usuario_id,adicionado_em,
      status_item,estoque_estado,estoque_reservado_em,pedido_item_troca_id)
    SELECT t.pedido_id,pr.id,pr.nome,t.quantidade_destino,t.preco_unitario_destino_centavos,
      t.valor_destino_centavos,CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,'TROCA_PENDENTE','RESERVADO',CURRENT_TIMESTAMP,t.id
    FROM pedido_item_trocas t JOIN produtos pr ON pr.id=t.produto_destino_id
    WHERE t.id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)
      AND pr.estoque-pr.estoque_reservado>=t.quantidade_destino`)
    .bind(params.usuarioId,parsed.key);
  const linkDestination = db.prepare(`UPDATE pedido_item_trocas SET item_destino_id=(SELECT id FROM pedido_itens
    WHERE pedido_item_troca_id=pedido_item_trocas.id AND status_item='TROCA_PENDENTE')
    WHERE id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)`).bind(parsed.key);
  const reserveDestination = db.prepare(`UPDATE produtos SET estoque_reservado=estoque_reservado+?,atualizado_em=CURRENT_TIMESTAMP
    WHERE id=? AND estoque-estoque_reservado>=? AND EXISTS(SELECT 1 FROM pedido_item_trocas t
      JOIN pedido_itens pi ON pi.id=t.item_destino_id WHERE t.id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)
      AND pi.status_item='TROCA_PENDENTE' AND pi.estoque_estado='RESERVADO')`)
    .bind(params.quantidadeDestino,params.produtoDestinoId,params.quantidadeDestino,parsed.key);
  const statements: D1PreparedStatement[] = [insertExchange,claim,insertDestination,linkDestination,reserveDestination];
  if(awaitingRefund) statements.push(preparePedidoPhysicalProjection(db,params.pedidoId));
  if(!awaitingRefund) statements.push(...completeInitialExchangeStatements(db,{
    pedidoId:params.pedidoId,itemId:params.itemId,operationKey:parsed.key,
    action:params.estoqueAcaoOrigem as ExchangeStockAction,
    projectedBalance:preview.financeiro.saldoProjetadoCentavos,
  }));
  statements.push(exchangeInvariant(db,params.pedidoId,parsed.key,awaitingRefund));
  try {
    const baseResults=await db.batch(statements);
    // M1 (auditoria Comanda Viva): por quando o batch chega aqui, o D1 já
    // fez commit — este `throw` é diagnóstico (direciona pro catch e pra
    // mensagem de erro certa), não um rollback. A garantia real de
    // atomicidade contra estado parcial é `exchangeInvariant`, o último
    // statement do batch: ele força violação do CHECK de
    // `pedidos.valor_total_centavos >= 0` se o estado final não bater, e
    // isso sim reverte o batch inteiro.
    if ([0,1,2,3,4].some((i)=>Number(baseResults[i]?.meta?.changes||0)!==1)) throw new Error("TROCA_GUARD_FALHOU");
  } catch (error) {
    const winner=await buscarOperacao(db,parsed.key); if(winner)return replayExchange(db,winner,identity);
    if(await getExchangeView(db,params.pedidoId,params.itemId))return{ok:false,erro:"PREVIEW_OBSOLETO"};
    const currentPrice=await db.prepare(`SELECT id,nome,preco_centavos,preco_promocional_centavos,promocao_ativa,promocao_inicio,promocao_fim,
      estoque,estoque_reservado,ativo,disponivel FROM produtos WHERE id=?`).bind(params.produtoDestinoId).first<ProductRow>();
    if(currentPrice && precoVigenteCentavos(currentPrice)!==params.precoEsperadoCentavos)
      return {ok:false,erro:"PRECO_ALTERADO",precoAtualCentavos:precoVigenteCentavos(currentPrice)};
    throw error;
  }
  let row=await exchangeById(db,(await buscarOperacao(db,parsed.key))!.pedido_item_troca_id!);
  if(!row)return {ok:false,erro:"OPERACAO_INCOMPLETA"};
  return {ok:true,troca:await exchangeView(db,row)};
}

export async function confirmExchangeRefund(db:D1Database,params:{pedidoId:number;exchangeId:number;usuarioId:number;
  operationKey:unknown;pagamentoId:number;pagamentoAlocacaoId:number;valorCentavos:number;confirmacao:boolean;
  mpAccessToken?:string}):Promise<ExchangeResult>{
  const parsed=parseOperationKey(params.operationKey); if(parsed.ok===false)return{ok:false,erro:parsed.erro};
  const identity:IdentidadeEsperada={tipo:"REFUND_ADMIN",escopo:"ADMIN",atorUsuarioId:params.usuarioId,
    fingerprint:fingerprint({pedidoId:params.pedidoId,exchangeId:params.exchangeId,pagamentoId:params.pagamentoId,
      pagamentoAlocacaoId:params.pagamentoAlocacaoId,valorCentavos:params.valorCentavos,confirmacao:params.confirmacao})};
  const existing=await buscarOperacao(db,parsed.key);
  if(existing){const conflict=conflitoOperacao(existing,identity);if(conflict)return{ok:false,erro:conflict};
    const row=await exchangeById(db,params.exchangeId);if(!row)return{ok:false,erro:"OPERACAO_INCOMPLETA"};
    if(existing.reembolso_id){await tryFinalizeExchange(db,row);return{ok:true,troca:await exchangeView(db,(await exchangeById(db,row.id))!),replay:true,reembolsoId:existing.reembolso_id};}}
  const row=await exchangeById(db,params.exchangeId);
  if(!row||Number(row.pedido_id)!==params.pedidoId)return{ok:false,erro:"TROCA_NAO_ENCONTRADA"};
  if(!["AGUARDANDO_REEMBOLSO","INCONCLUSIVA"].includes(row.status))return{ok:false,erro:"TROCA_NAO_AGUARDANDO"};
  const view=await exchangeView(db,row);const leg=view.refundsPendentes.find(x=>x.pagamentoId===params.pagamentoId&&x.pagamentoAlocacaoId===params.pagamentoAlocacaoId);
  if(!leg)return{ok:false,erro:"PAGAMENTO_ALOCACAO_INVALIDA"};
  if(!params.confirmacao||params.valorCentavos!==leg.valorCentavos)return{ok:false,erro:"VALOR_REFUND_DIVERGENTE"};
  if(leg.metodo==="PIX_MP"){
    if(!params.mpAccessToken)return{ok:false,erro:"MERCADO_PAGO_NAO_CONFIGURADO"};
    const remote=await reconcilePixMpRefundIntent(db,{pedidoId:params.pedidoId,pagamentoId:params.pagamentoId,
      pagamentoAlocacaoId:params.pagamentoAlocacaoId,exchangeId:params.exchangeId,usuarioId:params.usuarioId,
      operationKey:parsed.key,fingerprint:identity.fingerprint,valorCentavos:params.valorCentavos,accessToken:params.mpAccessToken});
    if(remote.ok===false)return{ok:false,erro:remote.erro};
    if(remote.reembolsoId){try{await tryFinalizeExchange(db,row);}catch(error){console.error("Refund MP persistido; finalizacao de troca pendente",row.id,error);}}
    const updated=(await exchangeById(db,row.id))!;
    return{ok:true,troca:await exchangeView(db,updated),reembolsoId:remote.reembolsoId,
      refundStatus:remote.intencao.status,replay:remote.replay};
  }
  if(!leg.confirmacaoManualPermitida)return{ok:false,erro:"PIX_MP_REFUND_REMOTO_PENDENTE"};
  const refundKey=chaveReembolso(parsed.key);
  const insert=db.prepare(`INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,registrado_por_usuario_id,motivo,devolveu_estoque,concluido_em)
    SELECT ?,pp.id,'MANUAL',pp.metodo,?,'REEMBOLSADO',?,?,'Diferença de troca',0,CURRENT_TIMESTAMP
    FROM pedido_pagamentos pp JOIN pedido_pagamento_alocacoes a ON a.pagamento_id=pp.id
    WHERE pp.id=? AND a.id=? AND a.pedido_item_id=? AND pp.status='PAGO' AND pp.metodo IN ('DINHEIRO','CARTAO','PIX_EXTERNO')`)
    .bind(params.pedidoId,params.valorCentavos,refundKey,params.usuarioId,params.pagamentoId,params.pagamentoAlocacaoId,row.item_origem_id);
  const claim=prepareClaimOperacao(db,{key:parsed.key,...identity,fase:"CONCLUIDA",fonte:fonteReembolso(refundKey)});
  const allocation=db.prepare(`INSERT INTO pedido_item_troca_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_troca_id,valor_centavos)
    SELECT id,?,?,? FROM pedido_reembolsos WHERE idempotency_key=?`).bind(params.pagamentoAlocacaoId,row.id,params.valorCentavos,refundKey);
  try{await db.batch([insert,claim,allocation,preparePedidoFinancialProjection(db,params.pedidoId)]);}catch(error){
    const winner=await buscarOperacao(db,parsed.key);if(!winner){const current=await exchangeView(db,row);
      if(!current.refundsPendentes.some(x=>x.pagamentoAlocacaoId===params.pagamentoAlocacaoId))return{ok:false,erro:"PAGAMENTO_ALOCACAO_INVALIDA"};
      throw error;}const conflict=conflitoOperacao(winner,identity);if(conflict)return{ok:false,erro:conflict};}
  try{await tryFinalizeExchange(db,row);}catch(error){console.error("Refund da troca persistido; finalização pendente",row.id,error);
    await db.prepare(`UPDATE pedido_item_trocas SET status='INCONCLUSIVA' WHERE id=? AND status='AGUARDANDO_REEMBOLSO'`).bind(row.id).run().catch(()=>undefined);}
  const updated=(await exchangeById(db,row.id))!;const op=await buscarOperacao(db,parsed.key);
  if(!op?.reembolso_id)return{ok:false,erro:"OPERACAO_INCOMPLETA"};return{ok:true,troca:await exchangeView(db,updated),reembolsoId:op.reembolso_id};
}

async function tryFinalizeExchange(db:D1Database,row:ExchangeRow):Promise<void>{
  const view=await exchangeView(db,row);if(view.reembolsoPendenteCentavos>0)return;
  await db.batch(completeExchangeStatements(db,row));
}

export async function reconcileExchangeFinalization(db:D1Database,exchangeId:number):Promise<void>{
  const row=await exchangeById(db,exchangeId);if(row)await tryFinalizeExchange(db,row);
}

export async function reconcileExchangeCharges(db:D1Database,pedidoId:number):Promise<void>{
  const financeiro=await getFinanceiroPedido(db,pedidoId);if(financeiro.saldoCentavos>0)return;
  await db.prepare(`UPDATE pedido_item_trocas SET status='CONCLUIDA',concluido_em=COALESCE(concluido_em,CURRENT_TIMESTAMP)
    WHERE pedido_id=? AND status='AGUARDANDO_COBRANCA'`).bind(pedidoId).run();
}
