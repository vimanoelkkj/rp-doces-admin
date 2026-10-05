/// <reference types="@cloudflare/workers-types" />

import { temEstornoAnulacaoAtivo } from "./pedidoAnulacao";

import { precoVigenteCentavos } from "../../shared/promocao";
import { getFinanceiroPedido } from "./comandaLedger";
import {
  buscarOperacao,
  chaveReembolso,
  conflitoOperacao,
  fingerprint,
  fonteReembolso,
  fonteTrocaCriada,
  parseOperationKey,
  prepareClaimOperacao,
  type IdentidadeEsperada,
  type OperacaoRow
} from "./operacoes";
import { preparePedidoFinancialProjection } from "./pedidoFinanceiroSql";
import { preparePedidoPhysicalProjection } from "./stock";
import { reconcilePixMpRefundIntent } from "./mpRefundIntent";
import {
  CONFIRMED_REFUNDS_BY_ALLOCATION_CTE,
  financialLineageCte,
  financialLineageMembership,
  REFUND_ALLOCATIONS_UNION_SQL
} from "./financialCoverage";

import {
  stockActions,
  effectiveExchangeAllocations,
  calculateExchangePreviewFinancial,
  proposedExchangeRefunds,
  exchangePreviewBlockers,
  buildExchangePreviewContent
} from "./itemExchangePreview";
import {
  ItemExchangePreviewError,
  type OriginRow,
  type ProductRow,
  type AllocationRow,
  type ExchangeStatus,
  type ExchangeStockAction,
  type ItemExchangePreview,
  type ExchangeResult
} from "./itemExchangeTypes";
import { exchangeById, getExchangeView, exchangeView } from "./itemExchangeView";
import {
  destinationPhysicalStatements,
  completeInitialExchangeStatements,
  completeExchangeStatements,
  exchangeInvariant,
  completedExchangeInvariant
} from "./itemExchangeStatements";
import { createExchangeReconciliation } from "./itemExchangeReconciliation";
export { getExchangeView } from "./itemExchangeView";
export { ItemExchangePreviewError } from "./itemExchangeTypes";
export type {
  ExchangeStockAction,
  ExchangeStatus,
  ExchangeRefundLeg,
  ItemExchangePreview,
  ExchangeView,
  ExchangeResult
} from "./itemExchangeTypes";

const {
  tryFinalizeExchange,
  reconcileExchangeFinalization,
  reconcileExchangeFinalizationsForPedido,
  reconcileExchangeCharges
} = createExchangeReconciliation({
  completeExchangeStatements,
  destinationPhysicalStatements,
  completedExchangeInvariant
});
export {
  reconcileExchangeFinalization,
  reconcileExchangeFinalizationsForPedido,
  reconcileExchangeCharges
};

const refundsUnion = REFUND_ALLOCATIONS_UNION_SQL;

export async function getItemExchangePreview(
  db: D1Database,
  params: {
    pedidoId: number;
    itemId: number;
    produtoDestinoId: number;
    quantidadeDestino: number;
    precoEsperadoCentavos: number;
    estoqueAcaoOrigem?: string;
    permitirTrocaExistente?: boolean;
  }
): Promise<ItemExchangePreview> {
  const pedido = await db
    .prepare(
      `SELECT id,valor_total_centavos,status_pedido,status_comanda,origem_pedido
    FROM pedidos WHERE id=? LIMIT 1`
    )
    .bind(params.pedidoId)
    .first<{
      id: number;
      valor_total_centavos: number;
      status_pedido: string;
      status_comanda: string;
      origem_pedido: string;
    }>();
  if (!pedido)
    throw new ItemExchangePreviewError("PEDIDO_NAO_ENCONTRADO", "Pedido não encontrado", 404);
  const origin = await db
    .prepare(
      `SELECT id,pedido_id,produto_nome,quantidade,valor_total_centavos,status_item,estoque_estado
    FROM pedido_itens WHERE id=? LIMIT 1`
    )
    .bind(params.itemId)
    .first<OriginRow>();
  if (!origin)
    throw new ItemExchangePreviewError("ITEM_NAO_ENCONTRADO", "Item não encontrado", 404);
  if (Number(origin.pedido_id) !== params.pedidoId)
    throw new ItemExchangePreviewError("ITEM_FORA_DO_PEDIDO", "Item fora do pedido");
  if (origin.status_item !== "ATIVO")
    throw new ItemExchangePreviewError("ITEM_NAO_ATIVO", "Somente item ativo pode ser trocado");
  if (
    !Number.isInteger(params.quantidadeDestino) ||
    params.quantidadeDestino < 1 ||
    params.quantidadeDestino > 50
  ) {
    throw new ItemExchangePreviewError("QUANTIDADE_INVALIDA", "Quantidade inválida", 400);
  }
  if (!params.permitirTrocaExistente) {
    const existing = await db
      .prepare(
        `SELECT 1 FROM pedido_item_trocas
      WHERE item_origem_id=? AND status<>'FALHOU' LIMIT 1`
      )
      .bind(params.itemId)
      .first();
    if (existing)
      throw new ItemExchangePreviewError(
        "TROCA_JA_EXISTENTE",
        "Já existe uma troca para este item"
      );
  }
  const product = await db
    .prepare(
      `SELECT id,nome,preco_centavos,preco_promocional_centavos,promocao_ativa,
      promocao_inicio,promocao_fim,estoque,estoque_reservado,ativo,disponivel
    FROM produtos WHERE id=? LIMIT 1`
    )
    .bind(params.produtoDestinoId)
    .first<ProductRow>();
  if (product?.ativo !== 1)
    throw new ItemExchangePreviewError(
      "PRODUTO_NAO_ENCONTRADO",
      "Produto de destino não encontrado",
      404
    );
  const currentPrice = precoVigenteCentavos(product);
  if (currentPrice !== params.precoEsperadoCentavos) {
    throw new ItemExchangePreviewError("PRECO_ALTERADO", "O preço do produto mudou", 409, {
      precoAtualCentavos: currentPrice
    });
  }
  const allowed = stockActions(origin.estoque_estado);
  const selectedAction = (params.estoqueAcaoOrigem ?? allowed[0]) as ExchangeStockAction;
  if (!allowed.includes(selectedAction))
    throw new ItemExchangePreviewError("ESTOQUE_ACAO_INVALIDA", "Ação de estoque inválida");

  const legacyRefund = await db
    .prepare(
      `SELECT r.id FROM pedido_reembolsos r
    LEFT JOIN ${refundsUnion} ra ON ra.reembolso_id=r.id
    WHERE r.pedido_id=? AND r.status='REEMBOLSADO'
    GROUP BY r.id,r.valor_centavos HAVING COALESCE(SUM(ra.valor_centavos),0)<>r.valor_centavos LIMIT 1`
    )
    .bind(params.pedidoId)
    .first();
  if (legacyRefund)
    throw new ItemExchangePreviewError(
      "COBERTURA_INDETERMINADA",
      "Há um reembolso histórico sem atribuição completa. A origem financeira da troca não pode ser determinada."
    );

  const { results: allocations } = await db
    .prepare(
      `WITH RECURSIVE ${financialLineageCte("?")},
      ${CONFIRMED_REFUNDS_BY_ALLOCATION_CTE}
    SELECT pp.id AS pagamentoId,
      a.id AS pagamentoAlocacaoId,pp.metodo AS metodo,a.valor_centavos AS valorAlocadoCentavos,
      COALESCE(rf.valor_centavos,0) AS valorReembolsadoCentavos
    FROM pedido_pagamento_alocacoes a JOIN pedido_pagamentos pp ON pp.id=a.pagamento_id
    LEFT JOIN refunds_confirmados rf ON rf.pagamento_alocacao_id=a.id
    WHERE a.pedido_item_id IN (SELECT item_id FROM linhagem_financeira) AND pp.status='PAGO'
    ORDER BY a.id DESC`
    )
    .bind(params.itemId)
    .all<AllocationRow>();
  const { effective, originCoverage } = effectiveExchangeAllocations(allocations);
  const financeiroAtual = await getFinanceiroPedido(db, params.pedidoId);
  const financial = calculateExchangePreviewFinancial(
    pedido,
    origin,
    currentPrice,
    params,
    financeiroAtual
  );
  const { projectedExcess } = financial;
  const { proposedRefunds, remainingRefund } = proposedExchangeRefunds(effective, projectedExcess);
  const stockAvailable = Math.max(0, Number(product.estoque) - Number(product.estoque_reservado));
  const availableAfterOrigin =
    stockAvailable +
    (Number(params.produtoDestinoId) ===
      Number(
        (
          await db
            .prepare(`SELECT produto_id FROM pedido_itens WHERE id=?`)
            .bind(params.itemId)
            .first<{ produto_id: number | null }>()
        )?.produto_id
      ) &&
    origin.estoque_estado === "RESERVADO" &&
    selectedAction === "LIBERAR_RESERVA" &&
    projectedExcess === 0
      ? Number(origin.quantidade)
      : 0) +
    (Number(params.produtoDestinoId) ===
      Number(
        (
          await db
            .prepare(`SELECT produto_id FROM pedido_itens WHERE id=?`)
            .bind(params.itemId)
            .first<{ produto_id: number | null }>()
        )?.produto_id
      ) &&
    origin.estoque_estado === "BAIXADO" &&
    selectedAction === "REPOR" &&
    projectedExcess === 0
      ? Number(origin.quantidade)
      : 0);
  const pendingPix = await db
    .prepare(
      `SELECT 1 FROM pedido_pagamentos
    WHERE pedido_id=? AND metodo='PIX_MP' AND status='PENDENTE' LIMIT 1`
    )
    .bind(params.pedidoId)
    .first();
  const blockers = exchangePreviewBlockers(
    pedido,
    !!pendingPix,
    product,
    availableAfterOrigin,
    params,
    remainingRefund
  );
  const content = buildExchangePreviewContent({
    params,
    pedido,
    origin,
    product,
    currentPrice,
    originCoverage,
    financial: { ...financial, liquidoAtualCentavos: financeiroAtual.liquidoCentavos },
    proposedRefunds,
    stockAvailable,
    selectedAction,
    allowed,
    blockers
  });
  return { previewFingerprint: fingerprint(content), ...content };
}

async function replayExchange(
  db: D1Database,
  op: OperacaoRow,
  identity: IdentidadeEsperada
): Promise<ExchangeResult> {
  const conflict = conflitoOperacao(op, identity);
  if (conflict) return { ok: false, erro: conflict };
  if (!op.pedido_item_troca_id) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  const row = await exchangeById(db, op.pedido_item_troca_id);
  return row
    ? { ok: true, troca: await exchangeView(db, row), replay: true }
    : { ok: false, erro: "OPERACAO_INCOMPLETA" };
}

export async function createItemExchange(
  db: D1Database,
  params: {
    pedidoId: number;
    itemId: number;
    produtoDestinoId: number;
    quantidadeDestino: number;
    precoEsperadoCentavos: number;
    estoqueAcaoOrigem: string;
    previewFingerprint: string;
    motivo?: string;
    usuarioId: number;
    operationKey: unknown;
  }
): Promise<ExchangeResult> {
  const parsed = parseOperationKey(params.operationKey);
  if (parsed.ok === false) return { ok: false, erro: parsed.erro };
  const motivo = String(params.motivo ?? "")
    .trim()
    .slice(0, 300);
  const identity: IdentidadeEsperada = {
    tipo: "ITEM_TROCA_ADMIN",
    escopo: "ADMIN",
    atorUsuarioId: params.usuarioId,
    fingerprint: fingerprint({
      pedidoId: params.pedidoId,
      itemOrigemId: params.itemId,
      produtoDestinoId: params.produtoDestinoId,
      quantidadeDestino: params.quantidadeDestino,
      precoEsperadoDestinoCentavos: params.precoEsperadoCentavos,
      estoqueAcaoOrigem: params.estoqueAcaoOrigem,
      motivo,
      previewFingerprint: params.previewFingerprint
    })
  };
  const existing = await buscarOperacao(db, parsed.key);
  if (existing) return replayExchange(db, existing, identity);
  if (await temEstornoAnulacaoAtivo(db, params.pedidoId)) {
    return { ok: false, erro: "ESTORNO_ANULACAO_ATIVO" };
  }
  let preview: ItemExchangePreview;
  try {
    preview = await getItemExchangePreview(db, params);
  } catch (error) {
    if (error instanceof ItemExchangePreviewError && error.code === "PRECO_ALTERADO") {
      return {
        ok: false,
        erro: "PRECO_ALTERADO",
        precoAtualCentavos: Number(error.extra.precoAtualCentavos)
      };
    }
    throw error;
  }
  if (preview.previewFingerprint !== params.previewFingerprint)
    return { ok: false, erro: "PREVIEW_OBSOLETO", preview };
  if (!preview.trocaExecutavel) {
    const code = preview.bloqueios[0]?.codigo;
    return {
      ok: false,
      erro:
        code === "PIX_PENDENTE"
          ? "PIX_PENDENTE"
          : code === "ESTOQUE_INSUFICIENTE"
            ? "ESTOQUE_INSUFICIENTE"
            : "PREVIEW_OBSOLETO",
      preview
    };
  }
  const awaitingRefund = preview.financeiro.excessoProjetadoCentavos > 0;
  const initialStatus: ExchangeStatus = awaitingRefund ? "AGUARDANDO_REEMBOLSO" : "SOLICITADA";
  const insertExchange = db
    .prepare(
      `INSERT INTO pedido_item_trocas(pedido_id,item_origem_id,produto_destino_id,
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
           -COALESCE((SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pedido_id=p.id AND status='REEMBOLSADO'),0))=?`
    )
    .bind(
      params.pedidoId,
      params.produtoDestinoId,
      params.quantidadeDestino,
      params.precoEsperadoCentavos,
      preview.itemOrigem.valorCentavos,
      preview.itemDestino.valorCentavos,
      preview.financeiro.diferencaCentavos,
      preview.financeiro.tipoDiferenca,
      params.estoqueAcaoOrigem,
      initialStatus,
      motivo,
      params.usuarioId,
      JSON.stringify(preview),
      params.produtoDestinoId,
      params.pedidoId,
      params.itemId,
      preview.itemOrigem.estoqueEstado,
      preview.itemOrigem.valorCentavos,
      preview.financeiro.totalAtualCentavos,
      params.produtoDestinoId,
      preview.financeiro.liquidoAtualCentavos
    );
  const claim = prepareClaimOperacao(db, {
    key: parsed.key,
    ...identity,
    fase: "CONCLUIDA",
    fonte: fonteTrocaCriada(params.pedidoId, params.itemId)
  });
  const insertDestination = db
    .prepare(
      `INSERT INTO pedido_itens(pedido_id,produto_id,produto_nome,quantidade,
      valor_unitario_centavos,valor_total_centavos,criado_em,adicionado_por_usuario_id,adicionado_em,
      status_item,estoque_estado,estoque_reservado_em,pedido_item_troca_id)
    SELECT t.pedido_id,pr.id,pr.nome,t.quantidade_destino,t.preco_unitario_destino_centavos,
      t.valor_destino_centavos,CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP,'TROCA_PENDENTE','RESERVADO',CURRENT_TIMESTAMP,t.id
    FROM pedido_item_trocas t JOIN produtos pr ON pr.id=t.produto_destino_id
    WHERE t.id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)
      AND pr.estoque-pr.estoque_reservado>=t.quantidade_destino`
    )
    .bind(params.usuarioId, parsed.key);
  const linkDestination = db
    .prepare(
      `UPDATE pedido_item_trocas SET item_destino_id=(SELECT id FROM pedido_itens
    WHERE pedido_item_troca_id=pedido_item_trocas.id AND status_item='TROCA_PENDENTE')
    WHERE id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)`
    )
    .bind(parsed.key);
  const reserveDestination = db
    .prepare(
      `UPDATE produtos SET estoque_reservado=estoque_reservado+?,atualizado_em=CURRENT_TIMESTAMP
    WHERE id=? AND estoque-estoque_reservado>=? AND EXISTS(SELECT 1 FROM pedido_item_trocas t
      JOIN pedido_itens pi ON pi.id=t.item_destino_id WHERE t.id=(SELECT pedido_item_troca_id FROM pedido_operacoes WHERE operation_key=?)
      AND pi.status_item='TROCA_PENDENTE' AND pi.estoque_estado='RESERVADO')`
    )
    .bind(params.quantidadeDestino, params.produtoDestinoId, params.quantidadeDestino, parsed.key);
  const statements: D1PreparedStatement[] = [
    insertExchange,
    claim,
    insertDestination,
    linkDestination,
    reserveDestination
  ];
  if (awaitingRefund) statements.push(preparePedidoPhysicalProjection(db, params.pedidoId));
  if (!awaitingRefund)
    statements.push(
      ...completeInitialExchangeStatements(db, {
        pedidoId: params.pedidoId,
        itemId: params.itemId,
        operationKey: parsed.key,
        action: params.estoqueAcaoOrigem as ExchangeStockAction,
        projectedBalance: preview.financeiro.saldoProjetadoCentavos
      })
    );
  statements.push(
    exchangeInvariant(
      db,
      params.pedidoId,
      parsed.key,
      awaitingRefund
        ? {
            originStatus: "ATIVO",
            destinationStatus: "TROCA_PENDENTE",
            destinationStock: "RESERVADO"
          }
        : preview.financeiro.saldoProjetadoCentavos > 0
          ? { originStatus: "CANCELADO", destinationStatus: "ATIVO", destinationStock: "RESERVADO" }
          : { originStatus: "CANCELADO", destinationStatus: "ATIVO", destinationStock: "BAIXADO" }
    )
  );
  try {
    const baseResults = await db.batch(statements);
    // M1 (auditoria Comanda Viva): por quando o batch chega aqui, o D1 já
    // fez commit — este `throw` é diagnóstico (direciona pro catch e pra
    // mensagem de erro certa), não um rollback. A garantia real de
    // atomicidade contra estado parcial é `exchangeInvariant`, o último
    // statement do batch: ele força violação do CHECK de
    // `pedidos.valor_total_centavos >= 0` se o estado final não bater, e
    // isso sim reverte o batch inteiro.
    if ([0, 1, 2, 3, 4].some(i => Number(baseResults[i]?.meta?.changes || 0) !== 1))
      throw new Error("TROCA_GUARD_FALHOU");
  } catch (error) {
    const winner = await buscarOperacao(db, parsed.key);
    if (winner) return replayExchange(db, winner, identity);
    if (await getExchangeView(db, params.pedidoId, params.itemId))
      return { ok: false, erro: "PREVIEW_OBSOLETO" };
    const competingCancellation = await db
      .prepare(
        `SELECT 1 FROM pedido_item_cancelamentos
      WHERE pedido_id=? AND pedido_item_id=? AND status<>'FALHOU' LIMIT 1`
      )
      .bind(params.pedidoId, params.itemId)
      .first();
    if (competingCancellation) return { ok: false, erro: "PREVIEW_OBSOLETO" };
    const currentPrice = await db
      .prepare(
        `SELECT id,nome,preco_centavos,preco_promocional_centavos,promocao_ativa,promocao_inicio,promocao_fim,
      estoque,estoque_reservado,ativo,disponivel FROM produtos WHERE id=?`
      )
      .bind(params.produtoDestinoId)
      .first<ProductRow>();
    if (currentPrice && precoVigenteCentavos(currentPrice) !== params.precoEsperadoCentavos)
      return {
        ok: false,
        erro: "PRECO_ALTERADO",
        precoAtualCentavos: precoVigenteCentavos(currentPrice)
      };
    throw error;
  }
  const operacao = await buscarOperacao(db, parsed.key);
  if (!operacao) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  if (!operacao.pedido_item_troca_id) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  const row = await exchangeById(db, operacao.pedido_item_troca_id);
  if (!row) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  return { ok: true, troca: await exchangeView(db, row) };
}

export async function confirmExchangeRefund(
  db: D1Database,
  params: {
    pedidoId: number;
    exchangeId: number;
    usuarioId: number;
    operationKey: unknown;
    pagamentoId: number;
    pagamentoAlocacaoId: number;
    valorCentavos: number;
    confirmacao: boolean;
    mpAccessToken?: string;
  }
): Promise<ExchangeResult> {
  const parsed = parseOperationKey(params.operationKey);
  if (parsed.ok === false) return { ok: false, erro: parsed.erro };
  const identity: IdentidadeEsperada = {
    tipo: "REFUND_ADMIN",
    escopo: "ADMIN",
    atorUsuarioId: params.usuarioId,
    fingerprint: fingerprint({
      pedidoId: params.pedidoId,
      exchangeId: params.exchangeId,
      pagamentoId: params.pagamentoId,
      pagamentoAlocacaoId: params.pagamentoAlocacaoId,
      valorCentavos: params.valorCentavos,
      confirmacao: params.confirmacao
    })
  };
  const existing = await buscarOperacao(db, parsed.key);
  if (existing) {
    const conflict = conflitoOperacao(existing, identity);
    if (conflict) return { ok: false, erro: conflict };
    const row = await exchangeById(db, params.exchangeId);
    if (!row) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
    if (existing.reembolso_id) {
      await tryFinalizeExchange(db, row);
      const updated = await exchangeById(db, row.id);
      if (!updated) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
      return {
        ok: true,
        troca: await exchangeView(db, updated),
        replay: true,
        reembolsoId: existing.reembolso_id
      };
    }
  }
  const row = await exchangeById(db, params.exchangeId);
  if (!row || Number(row.pedido_id) !== params.pedidoId)
    return { ok: false, erro: "TROCA_NAO_ENCONTRADA" };
  if (!["AGUARDANDO_REEMBOLSO", "INCONCLUSIVA"].includes(row.status))
    return { ok: false, erro: "TROCA_NAO_AGUARDANDO" };
  const view = await exchangeView(db, row);
  const leg = view.refundsPendentes.find(
    x =>
      x.pagamentoId === params.pagamentoId && x.pagamentoAlocacaoId === params.pagamentoAlocacaoId
  );
  if (!leg) return { ok: false, erro: "PAGAMENTO_ALOCACAO_INVALIDA" };
  if (!params.confirmacao || params.valorCentavos !== leg.valorCentavos)
    return { ok: false, erro: "VALOR_REFUND_DIVERGENTE" };
  if (leg.metodo === "PIX_MP") {
    if (!params.mpAccessToken) return { ok: false, erro: "MERCADO_PAGO_NAO_CONFIGURADO" };
    const remote = await reconcilePixMpRefundIntent(db, {
      pedidoId: params.pedidoId,
      pagamentoId: params.pagamentoId,
      pagamentoAlocacaoId: params.pagamentoAlocacaoId,
      exchangeId: params.exchangeId,
      usuarioId: params.usuarioId,
      operationKey: parsed.key,
      fingerprint: identity.fingerprint,
      valorCentavos: params.valorCentavos,
      accessToken: params.mpAccessToken
    });
    if (remote.ok === false) return { ok: false, erro: remote.erro };
    if (remote.reembolsoId) {
      try {
        await tryFinalizeExchange(db, row);
      } catch (error) {
        console.error("Refund MP persistido; finalizacao de troca pendente", row.id, error);
      }
    }
    const updated = await exchangeById(db, row.id);
    if (!updated) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
    return {
      ok: true,
      troca: await exchangeView(db, updated),
      reembolsoId: remote.reembolsoId,
      refundStatus: remote.intencao.status,
      replay: remote.replay
    };
  }
  if (!leg.confirmacaoManualPermitida) return { ok: false, erro: "PIX_MP_REFUND_REMOTO_PENDENTE" };
  const refundKey = chaveReembolso(parsed.key);
  const insert = db
    .prepare(
      `INSERT INTO pedido_reembolsos(pedido_id,pagamento_id,origem,metodo,valor_centavos,status,idempotency_key,registrado_por_usuario_id,motivo,devolveu_estoque,concluido_em)
    SELECT ?,pp.id,'MANUAL',pp.metodo,?,'REEMBOLSADO',?,?,'Diferença de troca',0,CURRENT_TIMESTAMP
    FROM pedido_pagamentos pp JOIN pedido_pagamento_alocacoes a ON a.pagamento_id=pp.id
    WHERE pp.id=? AND a.id=?
      AND ${financialLineageMembership("a.pedido_item_id", String(Number(row.item_origem_id)), "refund_linhagem")}
      AND pp.status='PAGO' AND pp.metodo IN ('DINHEIRO','CARTAO','PIX_EXTERNO')`
    )
    .bind(
      params.pedidoId,
      params.valorCentavos,
      refundKey,
      params.usuarioId,
      params.pagamentoId,
      params.pagamentoAlocacaoId
    );
  const claim = prepareClaimOperacao(db, {
    key: parsed.key,
    ...identity,
    fase: "CONCLUIDA",
    fonte: fonteReembolso(refundKey)
  });
  const allocation = db
    .prepare(
      `INSERT INTO pedido_item_troca_reembolso_alocacoes(reembolso_id,pagamento_alocacao_id,pedido_item_troca_id,valor_centavos)
    SELECT id,?,?,? FROM pedido_reembolsos WHERE idempotency_key=?`
    )
    .bind(params.pagamentoAlocacaoId, row.id, params.valorCentavos, refundKey);
  try {
    await db.batch([
      insert,
      claim,
      allocation,
      preparePedidoFinancialProjection(db, params.pedidoId)
    ]);
  } catch (error) {
    const winner = await buscarOperacao(db, parsed.key);
    if (!winner) {
      const current = await exchangeView(db, row);
      if (!current.refundsPendentes.some(x => x.pagamentoAlocacaoId === params.pagamentoAlocacaoId))
        return { ok: false, erro: "PAGAMENTO_ALOCACAO_INVALIDA" };
      throw error;
    }
    const conflict = conflitoOperacao(winner, identity);
    if (conflict) return { ok: false, erro: conflict };
  }
  try {
    await tryFinalizeExchange(db, row);
  } catch (error) {
    console.error("Refund da troca persistido; finalização pendente", row.id, error);
    await db
      .prepare(
        `UPDATE pedido_item_trocas SET status='INCONCLUSIVA' WHERE id=? AND status='AGUARDANDO_REEMBOLSO'`
      )
      .bind(row.id)
      .run()
      .catch(() => undefined);
  }
  const updated = await exchangeById(db, row.id);
  if (!updated) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  const op = await buscarOperacao(db, parsed.key);
  if (!op?.reembolso_id) return { ok: false, erro: "OPERACAO_INCOMPLETA" };
  return { ok: true, troca: await exchangeView(db, updated), reembolsoId: op.reembolso_id };
}
