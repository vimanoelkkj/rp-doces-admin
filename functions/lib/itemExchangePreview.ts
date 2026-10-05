import type {
  AllocationRow,
  ExchangeRefundLeg,
  ExchangeStockAction,
  ItemExchangePreview,
  OriginRow,
  ProductRow
} from "./itemExchangeTypes";

export const MANUAL_METHODS = new Set(["DINHEIRO", "CARTAO", "PIX_EXTERNO"]);

export function stockActions(state: string): ExchangeStockAction[] {
  if (state === "RESERVADO") return ["LIBERAR_RESERVA"];
  if (state === "BAIXADO") return ["NAO_REPOR", "REPOR"];
  return ["NENHUMA"];
}

export type EffectiveExchangeAllocation = AllocationRow & { efetivo: number };

export function effectiveExchangeAllocations(allocations: AllocationRow[]): {
  effective: EffectiveExchangeAllocation[];
  originCoverage: number;
} {
  const effective = allocations.map(a => ({
    ...a,
    efetivo: Math.max(0, Number(a.valorAlocadoCentavos) - Number(a.valorReembolsadoCentavos))
  }));
  const originCoverage = effective.reduce((s, a) => s + a.efetivo, 0);
  return { effective, originCoverage };
}

export interface ExchangePreviewFinancial {
  destinationValue: number;
  projectedTotal: number;
  projectedBalance: number;
  projectedExcess: number;
  difference: number;
  differenceType: "COBRAR" | "DEVOLVER" | "ZERO";
}

export function calculateExchangePreviewFinancial(
  pedido: { valor_total_centavos: number },
  origin: Pick<OriginRow, "valor_total_centavos">,
  currentPrice: number,
  params: { quantidadeDestino: number },
  financeiroAtual: { liquidoCentavos: number }
): ExchangePreviewFinancial {
  const destinationValue = currentPrice * params.quantidadeDestino;
  const projectedTotal =
    Number(pedido.valor_total_centavos) - Number(origin.valor_total_centavos) + destinationValue;
  const projectedBalance = Math.max(0, projectedTotal - financeiroAtual.liquidoCentavos);
  const projectedExcess = Math.max(0, financeiroAtual.liquidoCentavos - projectedTotal);
  const difference = projectedBalance > 0 ? projectedBalance : -projectedExcess;
  const differenceType: "COBRAR" | "DEVOLVER" | "ZERO" =
    difference > 0 ? "COBRAR" : difference < 0 ? "DEVOLVER" : "ZERO";
  return {
    destinationValue,
    projectedTotal,
    projectedBalance,
    projectedExcess,
    difference,
    differenceType
  };
}

export function proposedExchangeRefunds(
  effective: EffectiveExchangeAllocation[],
  projectedExcess: number
): {
  proposedRefunds: ExchangeRefundLeg[];
  remainingRefund: number;
} {
  let remainingRefund = projectedExcess;
  const proposedRefunds: ExchangeRefundLeg[] = [];
  for (const allocation of effective) {
    if (remainingRefund <= 0) break;
    const amount = Math.min(remainingRefund, allocation.efetivo);
    if (amount > 0)
      proposedRefunds.push({
        pagamentoId: Number(allocation.pagamentoId),
        pagamentoAlocacaoId: Number(allocation.pagamentoAlocacaoId),
        metodo: allocation.metodo,
        valorCentavos: amount,
        confirmacaoManualPermitida: MANUAL_METHODS.has(allocation.metodo)
      });
    remainingRefund -= amount;
  }
  return { proposedRefunds, remainingRefund };
}

export function exchangePreviewBlockers(
  pedido: { origem_pedido: string; status_comanda: string; status_pedido: string },
  pendingPix: boolean,
  product: Pick<ProductRow, "disponivel">,
  availableAfterOrigin: number,
  params: { quantidadeDestino: number },
  remainingRefund: number
): ItemExchangePreview["bloqueios"] {
  const blockers: Array<{ codigo: string; mensagem: string }> = [];
  if (
    pedido.origem_pedido !== "MANUAL" ||
    pedido.status_comanda !== "ABERTA" ||
    !["NOVO", "PREPARANDO", "PRONTO"].includes(pedido.status_pedido)
  ) {
    blockers.push({
      codigo: "PEDIDO_NAO_TROCAVEL",
      mensagem: "Este pedido não aceita troca nesta etapa."
    });
  } else if (pedido.status_pedido === "PRONTO") {
    blockers.push({
      codigo: "STATUS_PEDIDO_PRONTO",
      mensagem: "Pedido pronto não pode ser reaberto nesta fase."
    });
  }
  if (pendingPix)
    blockers.push({ codigo: "PIX_PENDENTE", mensagem: "Há um Pix pendente nesta comanda." });
  if (product.disponivel !== 1 || availableAfterOrigin < params.quantidadeDestino) {
    blockers.push({
      codigo: "ESTOQUE_INSUFICIENTE",
      mensagem: "Estoque insuficiente para o produto de destino."
    });
  }
  if (remainingRefund > 0)
    blockers.push({
      codigo: "COBERTURA_INSUFICIENTE",
      mensagem: "A origem financeira do excesso não pôde ser determinada."
    });

  return blockers;
}

export function buildExchangePreviewContent({
  params,
  pedido,
  origin,
  product,
  currentPrice,
  originCoverage,
  financial,
  proposedRefunds,
  stockAvailable,
  selectedAction,
  allowed,
  blockers
}: {
  params: { pedidoId: number; quantidadeDestino: number };
  pedido: { valor_total_centavos: number };
  origin: Pick<OriginRow, "id" | "produto_nome" | "valor_total_centavos" | "estoque_estado">;
  product: Pick<ProductRow, "id" | "nome">;
  currentPrice: number;
  originCoverage: number;
  financial: ExchangePreviewFinancial & { liquidoAtualCentavos: number };
  proposedRefunds: ExchangeRefundLeg[];
  stockAvailable: number;
  selectedAction: ExchangeStockAction;
  allowed: ExchangeStockAction[];
  blockers: ItemExchangePreview["bloqueios"];
}): Omit<ItemExchangePreview, "previewFingerprint"> {
  const {
    destinationValue,
    projectedTotal,
    projectedBalance,
    projectedExcess,
    difference,
    differenceType
  } = financial;
  const financeiroAtual = { liquidoCentavos: financial.liquidoAtualCentavos };
  const content = {
    pedidoId: params.pedidoId,
    itemOrigem: {
      id: Number(origin.id),
      nome: origin.produto_nome,
      valorCentavos: Number(origin.valor_total_centavos),
      coberturaEfetivaCentavos: originCoverage,
      estoqueEstado: origin.estoque_estado
    },
    itemDestino: {
      produtoId: Number(product.id),
      nome: product.nome,
      quantidade: params.quantidadeDestino,
      precoUnitarioCentavos: currentPrice,
      valorCentavos: destinationValue,
      estoqueDisponivel: stockAvailable
    },
    financeiro: {
      totalAtualCentavos: Number(pedido.valor_total_centavos),
      liquidoAtualCentavos: financeiroAtual.liquidoCentavos,
      totalProjetadoCentavos: projectedTotal,
      diferencaCentavos: difference,
      tipoDiferenca: differenceType,
      saldoProjetadoCentavos: projectedBalance,
      excessoProjetadoCentavos: projectedExcess
    },
    refundsPropostos: proposedRefunds,
    estoque: {
      acaoOrigem: selectedAction,
      acoesOrigemPermitidas: allowed,
      estadoDestino: "RESERVADO" as const
    },
    bloqueios: blockers,
    trocaExecutavel: blockers.length === 0
  };
  return content;
}
