import type { PedidoAnulacao } from "../../../../shared/pedidoAnulacao";
import type { FinanceiroPedido } from "../formatarFinanceiro";

export interface PedidoItemRow {
  id: number;
  produto_id: number | null;
  produto_nome: string;
  emoji: string | null;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
  status_item: string;
  estoque_estado: string;
  cancelamento_id: number | null;
  cancelamento_status: string | null;
  troca_id: number | null;
  troca_status: string | null;
  troca_item_origem_id: number | null;
}

export type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";
export type MetodoPagamentoManual = "DINHEIRO" | "CARTAO" | "PIX_EXTERNO";

export interface PedidoRow {
  id: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  observacao: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_pedido: StatusPedido;
  status_comanda: string;
  criado_em: string;
  pago_em: string | null;
  origem_pedido: "SITE" | "MANUAL";
  arquivado: number;
  arquivado_em: string | null;
}

export interface PixAdminPendente {
  id: number;
  valorCentavos: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}

export interface OperacaoInconclusiva {
  tipo: string;
  diagnostico: string | null;
  atualizadoEm: string;
}

export interface PedidoDetalheResponse {
  anulacao?: PedidoAnulacao | null;
  pedido: PedidoRow;
  itens: PedidoItemRow[];
  financeiro: FinanceiroPedido;
  pixAdminPendentes: PixAdminPendente[];
  capacidadeCobravelCentavos: number;
  /** B-3: cobranças sem confirmação do Mercado Pago (leitura, nunca decisão). */
  operacoesInconclusivas: OperacaoInconclusiva[];
}
