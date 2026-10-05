import type { ProdutoAdmin } from "../Produtos/AdminProdutos";

export interface Item {
  id: number;
  produto_nome: string;
  valor_total_centavos: number;
  estoque_estado: string;
}
export interface RefundLeg {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorCentavos: number;
  confirmacaoManualPermitida: boolean;
  refundRemoto?: {
    status: "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "RECUSADO" | "INCONCLUSIVO";
    tentativas: number;
    mpRefundId: string | null;
    ultimoErro: string | null;
    operationKey: string;
    atualizadoEm: string;
    podeVerificar: boolean;
  };
}
export interface Preview {
  previewFingerprint: string;
  itemDestino: { nome: string; valorCentavos: number };
  financeiro: {
    totalProjetadoCentavos: number;
    diferencaCentavos: number;
    saldoProjetadoCentavos: number;
    excessoProjetadoCentavos: number;
  };
  refundsPropostos: RefundLeg[];
  estoque: { acaoOrigem: string; acoesOrigemPermitidas: string[] };
  bloqueios: Array<{ codigo: string; mensagem: string }>;
  trocaExecutavel: boolean;
}
export interface Exchange {
  id: number;
  status: string;
  reembolsoPendenteCentavos: number;
  refundsPendentes: RefundLeg[];
  estoqueOrigemEstado?: string;
  estoqueDestinoEstado?: string | null;
  reembolsosConfirmados?: Array<{
    id: number;
    metodo: string;
    valorCentavos: number;
    origem: string;
    mpRefundId: string | null;
  }>;
  financeiro?: {
    status: string;
    totalCentavos: number;
    liquidoCentavos: number;
    saldoCentavos: number;
  };
}
export interface TrocarItemModalProps {
  orderId: number;
  item: Item;
  existingExchangeId?: number | null;
  existingExchangeStatus?: string | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}
export const money = (v: number) => `R$ ${(v / 100).toFixed(2).replace(".", ",")}`;
export const free = (p: ProdutoAdmin) => Math.max(0, p.estoque - p.estoque_reservado);
export const labels: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  CARTAO: "Cartão",
  PIX_EXTERNO: "Pix externo",
  PIX_MP: "Pix Mercado Pago"
};

export const remoteLabel = (leg: RefundLeg) => {
  const status = leg.refundRemoto?.status;
  if (status === "PENDENTE") return "Aguardando envio";
  if (status === "PROCESSANDO") return "Processando";
  if (status === "CONFIRMADO") return "Confirmado";
  if (status === "RECUSADO") return "Recusado pelo provedor";
  if (status === "INCONCLUSIVO") return "Verificar novamente";
  return "Solicitar estorno";
};
export const remoteCanRun = (leg: RefundLeg) => {
  const remote = leg.refundRemoto;
  if (!remote) return true;
  if (["RECUSADO", "CONFIRMADO"].includes(remote.status)) return false;
  return remote.podeVerificar;
};
