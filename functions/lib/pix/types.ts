import type { ConflitoOperacao } from "../operacoes";

export interface GerarPixAdminParams {
  pedidoId: number;
  valorCentavos?: number;
  usuarioId: number;
  /** Regeneração: id do Pix administrativo sendo substituído. `undefined`/`null` = geração normal. */
  substituiId?: number | null;
  /**
   * A1: identidade lógica da intenção (gerar ou regenerar), criada pelo
   * cliente antes do primeiro envio. Obrigatória no endpoint HTTP.
   */
  operationKey?: string | null;
}

export interface GerarPixAdminSucesso {
  ok: true;
  pagamentoId: number;
  valorCentavos: number;
  mpPaymentId: string;
  mpStatus: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
  /** true quando a resposta recuperou uma operação já persistida (A1). */
  replay?: boolean;
}

export interface GerarPixAdminFalha {
  ok: false;
  erro:
    | "PEDIDO_NAO_ENCONTRADO"
    | "COMANDA_ENCERRADA"
    | "VALOR_INVALIDO"
    | "CAPACIDADE_INSUFICIENTE"
    | "PIX_PARA_SUBSTITUIR_INVALIDO"
    | "PIX_SUBSTITUTO_JA_PAGO"
    | "ESTOQUE_INSUFICIENTE"
    | "MERCADO_PAGO_RECUSOU"
    | "MERCADO_PAGO_INDISPONIVEL"
    | "OPERATION_KEY_INVALIDA"
    | "OPERACAO_INCOMPLETA"
    | "OPERACAO_EM_PROCESSAMENTO"
    | "ESTORNO_ANULACAO_ATIVO"
    | ConflitoOperacao;
}

export type GerarPixAdminResult = GerarPixAdminSucesso | GerarPixAdminFalha;

export interface PixAdminPendente {
  id: number;
  valorCentavos: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}
