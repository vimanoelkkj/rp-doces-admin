/* Formatação da projeção financeira (GET /api/admin/pedidos e
 * GET /api/admin/pedidos/:id, campo `financeiro`) — compartilhada entre
 * AdminPedidos.tsx (linha da listagem) e PedidoDetalheModal.tsx (badge do
 * detalhe), pra nunca divergir o texto entre os dois lugares. */

export type LedgerMetodo = "PIX_MP" | "PIX_EXTERNO" | "CARTAO" | "DINHEIRO" | "A_COMBINAR";
export type StatusFinanceiroAgregado = "PENDENTE" | "PARCIAL" | "PAGO";

export interface FinanceiroPedido {
  status: StatusFinanceiroAgregado;
  brutoPagoCentavos: number;
  reembolsadoCentavos: number;
  liquidoCentavos: number;
  saldoCentavos: number;
  pagoCentavos: number;
  totalCentavos: number;
  metodosConfirmados: LedgerMetodo[];
}

export type BadgeCor = "green" | "orange" | "blue";

const METODO_LABEL: Record<LedgerMetodo, string> = {
  PIX_MP: "Pix",
  PIX_EXTERNO: "Pix externo",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
  A_COMBINAR: "A combinar",
};

const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

export interface FinanceiroFormatado {
  /** Rótulo curto — o texto do badge/pill. */
  badge: string;
  /** Detalhe (métodos ou valores) — string vazia quando não há nada a acrescentar. */
  detalhe: string;
  cor: BadgeCor;
}

export function formatarFinanceiro(financeiro: FinanceiroPedido): FinanceiroFormatado {
  if (financeiro.status === "PAGO") {
    const metodos = financeiro.metodosConfirmados.map((m) => METODO_LABEL[m]);
    return { badge: "✓ Pago", detalhe: metodos.join(" + "), cor: "green" };
  }

  if (financeiro.status === "PARCIAL") {
    return {
      badge: "Parcial",
      detalhe: `${formatarPreco(financeiro.pagoCentavos)} / ${formatarPreco(financeiro.totalCentavos)}`,
      cor: "orange",
    };
  }

  return { badge: "Aguardando pagamento", detalhe: "", cor: "blue" };
}

/** Junta badge+detalhe num texto só, pra layouts com um único elemento. */
export function formatarFinanceiroTexto(financeiro: FinanceiroPedido): { texto: string; cor: BadgeCor } {
  const { badge, detalhe, cor } = formatarFinanceiro(financeiro);
  return { texto: detalhe ? `${badge} · ${detalhe}` : badge, cor };
}
