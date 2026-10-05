/* ── Types (espelham o retorno de GET /api/admin/dashboard) ── */
export type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

export interface ValorContagem {
  count: number;
  total: number;
}

export interface AReceberResumo extends ValorContagem {
  anteriores: number;
}

export interface PendenciaPagamentoRow {
  id: number;
  cliente_nome: string;
  status_pedido: StatusPedido;
  criado_em: string;
  saldo_centavos: number;
  dias_em_aberto: number;
}

export interface MaisVendidoRow {
  produtoId: number | null;
  nome: string;
  quantidade: number;
}

export interface PedidoRecenteRow {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pedido: StatusPedido;
  itens_count: number;
}

export interface DashboardResponse {
  data: string;
  hoje: string;
  recebidoHoje: ValorContagem;
  aReceber: AReceberResumo;
  pagamentosPendentes: PendenciaPagamentoRow[];
  comandasAbertas: number;
  aguardandoPreparo: number;
  catalogo: { total: number; estoqueBaixo: number };
  financeiro: {
    brutoCentavos: number;
    reembolsadoCentavos: number;
    liquidoCentavos: number;
  };
  maisVendidos: MaisVendidoRow[];
  pedidosRecentes: PedidoRecenteRow[];
  resultadoFinanceiro: {
    faturamentoLiquidoCentavos: number;
    despesasCentavos: number;
    lucroEstimadoCentavos: number;
    margemEstimada: number | null;
  };
}

/* ── Helpers ── */
export const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

export const formatarPrecoComSinal = (centavos: number) =>
  `${centavos < 0 ? "-" : ""}${formatarPreco(Math.abs(centavos))}`;

export const formatarMargem = (margem: number | null) =>
  margem === null
    ? "—"
    : `${margem.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function parseDateISO(iso: string): Date {
  const [yyyy, mm, dd] = iso.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

export function formatDateISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const statusLabel = (s: StatusPedido) =>
  s === "ENTREGUE" ? "Entregue" : s === "PRONTO" ? "Pronto" : "Em produção";

export const statusClass = (s: StatusPedido) =>
  s === "ENTREGUE"
    ? "dash-badge--green"
    : s === "PRONTO"
      ? "dash-badge--blue"
      : "dash-badge--orange";

export const idadePendencia = (dias: number) =>
  dias <= 0 ? "Hoje" : dias === 1 ? "Desde ontem" : `Há ${dias} dias`;
