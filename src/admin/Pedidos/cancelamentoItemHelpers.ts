export interface Perna {
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

export const dinheiro = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100);
export const METODOS: Record<string, string> = {
  PIX_MP: "Pix Mercado Pago",
  PIX_EXTERNO: "Pix externo",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro"
};

export const statusLabel = (s: string) =>
  ({
    SOLICITADO: "Solicitado",
    AGUARDANDO_REEMBOLSO: "Aguardando reembolso",
    CONCLUIDO: "Cancelamento concluído",
    INCONCLUSIVO: "Reconciliação pendente",
    FALHOU: "Falhou"
  })[s] ?? s;
export const remoteLabel = (leg: Perna) => {
  const status = leg.refundRemoto?.status;
  if (status === "PENDENTE") return "Aguardando envio";
  if (status === "PROCESSANDO") return "Processando";
  if (status === "CONFIRMADO") return "Confirmado";
  if (status === "RECUSADO") return "Recusado pelo provedor";
  if (status === "INCONCLUSIVO") return "Verificar novamente";
  return "Solicitar estorno";
};
export const remoteCanRun = (leg: Perna) => {
  const remote = leg.refundRemoto;
  if (!remote) return true;
  if (["RECUSADO", "CONFIRMADO"].includes(remote.status)) return false;
  return remote.podeVerificar;
};
