import type { PixMpRefundIntentStatus } from "./mpRefundIntent";
import type { ConflitoOperacao } from "./operacoes";

export type ExchangeStockAction = "LIBERAR_RESERVA" | "NAO_REPOR" | "REPOR" | "NENHUMA";
export type ExchangeStatus =
  | "SOLICITADA"
  | "AGUARDANDO_COBRANCA"
  | "AGUARDANDO_REEMBOLSO"
  | "CONCLUIDA"
  | "INCONCLUSIVA"
  | "FALHOU";

export interface ExchangeRefundLeg {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorCentavos: number;
  confirmacaoManualPermitida: boolean;
  refundRemoto?: {
    status: PixMpRefundIntentStatus;
    tentativas: number;
    mpRefundId: string | null;
    ultimoErro: string | null;
    operationKey: string;
    atualizadoEm: string;
    podeVerificar: boolean;
  };
}

export interface ItemExchangePreview {
  previewFingerprint: string;
  pedidoId: number;
  itemOrigem: {
    id: number;
    nome: string;
    valorCentavos: number;
    coberturaEfetivaCentavos: number;
    estoqueEstado: string;
  };
  itemDestino: {
    produtoId: number;
    nome: string;
    quantidade: number;
    precoUnitarioCentavos: number;
    valorCentavos: number;
    estoqueDisponivel: number;
  };
  financeiro: {
    totalAtualCentavos: number;
    liquidoAtualCentavos: number;
    totalProjetadoCentavos: number;
    diferencaCentavos: number;
    tipoDiferenca: "COBRAR" | "DEVOLVER" | "ZERO";
    saldoProjetadoCentavos: number;
    excessoProjetadoCentavos: number;
  };
  refundsPropostos: ExchangeRefundLeg[];
  estoque: {
    acaoOrigem: ExchangeStockAction;
    acoesOrigemPermitidas: ExchangeStockAction[];
    estadoDestino: "RESERVADO";
  };
  bloqueios: Array<{ codigo: string; mensagem: string }>;
  trocaExecutavel: boolean;
}

export class ItemExchangePreviewError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export interface OriginRow {
  id: number;
  pedido_id: number;
  produto_nome: string;
  quantidade: number;
  valor_total_centavos: number;
  status_item: string;
  estoque_estado: string;
}
export interface ProductRow {
  id: number;
  nome: string;
  preco_centavos: number;
  preco_promocional_centavos: number | null;
  promocao_inicio: string | null;
  promocao_fim: string | null;
  estoque: number;
  promocao_ativa: number;
  estoque_reservado: number;
  ativo: number;
  disponivel: number;
}
export interface AllocationRow {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorAlocadoCentavos: number;
  valorReembolsadoCentavos: number;
}
export interface ExchangeView {
  id: number;
  pedidoId: number;
  itemOrigemId: number;
  itemDestinoId: number | null;
  status: ExchangeStatus;
  reembolsoPendenteCentavos: number;
  refundsPendentes: ExchangeRefundLeg[];
  estoqueOrigemEstado: string;
  estoqueDestinoEstado: string | null;
  reembolsosConfirmados: Array<{
    id: number;
    metodo: string;
    valorCentavos: number;
    origem: string;
    mpRefundId: string | null;
  }>;
  financeiro: {
    status: string;
    totalCentavos: number;
    liquidoCentavos: number;
    saldoCentavos: number;
  };
}
type ExchangeError =
  | "OPERATION_KEY_INVALIDA"
  | "PREVIEW_OBSOLETO"
  | "PRECO_ALTERADO"
  | "ESTOQUE_INSUFICIENTE"
  | "PIX_PENDENTE"
  | "TROCA_NAO_ENCONTRADA"
  | "TROCA_NAO_AGUARDANDO"
  | "PAGAMENTO_ALOCACAO_INVALIDA"
  | "PIX_MP_REFUND_REMOTO_PENDENTE"
  | "VALOR_REFUND_DIVERGENTE"
  | "MERCADO_PAGO_NAO_CONFIGURADO"
  | "REFUND_REMOTO_EM_ANDAMENTO"
  | "SALDO_REEMBOLSAVEL_INSUFICIENTE"
  | "OPERACAO_INCOMPLETA"
  | "ESTORNO_ANULACAO_ATIVO"
  | ConflitoOperacao;
export type ExchangeResult =
  | {
      ok: true;
      troca: ExchangeView;
      replay?: boolean;
      reembolsoId?: number;
      refundStatus?: PixMpRefundIntentStatus;
    }
  | { ok: false; erro: ExchangeError; preview?: ItemExchangePreview; precoAtualCentavos?: number };

export interface ExchangeRow {
  id: number;
  pedido_id: number;
  item_origem_id: number;
  item_destino_id: number | null;
  status: ExchangeStatus;
  estoque_acao_origem: ExchangeStockAction;
  snapshot_financeiro: string;
}
