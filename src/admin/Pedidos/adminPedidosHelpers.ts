import type { FinanceiroPedido } from "./formatarFinanceiro";

/* ── Types (espelham o retorno de GET /api/admin/pedidos) ── */
export type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

export type TabFilter =
  "todos" | "hoje" | "novos" | "em_producao" | "prontos" | "entregues" | "arquivados";

export interface PedidoListItem {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pedido: StatusPedido;
  criado_em: string;
  financeiro: FinanceiroPedido;
}

export interface Counts {
  todos: number;
  hoje: number;
  novos: number;
  em_producao: number;
  prontos: number;
  entregues: number;
  arquivados: number;
}

export interface PedidosResponse {
  pedidos: PedidoListItem[];
  total: number;
  page: number;
  totalPages: number;
  counts: Counts;
}

/* ── Helpers ── */
export const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

export const STATUS_LABEL: Record<StatusPedido, string> = {
  NOVO: "Novo",
  PREPARANDO: "Em produção",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado"
};

export const statusLabel = (status: StatusPedido) => STATUS_LABEL[status];

export const STATUS_CLASS: Record<StatusPedido, string> = {
  NOVO: "ped-badge--orange",
  PREPARANDO: "ped-badge--orange",
  PRONTO: "ped-badge--blue",
  ENTREGUE: "ped-badge--green",
  CANCELADO: "ped-badge--red"
};

export const statusClass = (status: StatusPedido) => STATUS_CLASS[status];
