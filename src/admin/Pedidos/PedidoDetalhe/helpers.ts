import type { StatusPedido } from "./types";

export const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

export const valorPagamentoInicial = (centavos: number) =>
  (centavos / 100).toFixed(2).replace(".", ",");

export const parseValorPagamento = (valor: string) => {
  const limpo = valor.trim().replace(/\s/g, "");
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalizado)) return null;
  const centavos = Math.round(Number(normalizado) * 100);
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
};

export const formatarData = (isoLike: string) => {
  // SQLite CURRENT_TIMESTAMP é UTC e chega como "YYYY-MM-DD HH:mm:ss".
  // Sem o sufixo Z, o navegador interpretava esse valor como horário LOCAL,
  // exibindo o pedido com deslocamento de fuso (ex.: +3h no UTC-3).
  const iso = isoLike.replace(" ", "T");
  const comFuso = /(?:Z|[+-]\\d{2}:?\\d{2})$/i.test(iso) ? iso : `${iso}Z`;

  return new Date(comFuso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Mesmo enum de produção (order.model.ts / OrderStatusSelect.tsx) — o admin
// pode escolher qualquer status livremente, sem avanço linear forçado.
export const STATUS_PEDIDO_OPCOES: StatusPedido[] = [
  "NOVO",
  "PREPARANDO",
  "PRONTO",
  "ENTREGUE",
  "CANCELADO",
];

export const STATUS_LABEL: Record<StatusPedido, string> = {
  NOVO: "Novo",
  PREPARANDO: "Em produção",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

export const STATUS_TYPE: Record<StatusPedido, "green" | "orange" | "blue" | "red"> = {
  NOVO: "orange",
  PREPARANDO: "orange",
  PRONTO: "blue",
  ENTREGUE: "green",
  CANCELADO: "red",
};

export const ITEM_STATUS_LABEL: Record<string, string> = {
  ATIVO: "Ativo",
  CANCELADO: "Cancelado",
  TROCA_PENDENTE: "Destino da troca · aguardando conclusão",
};

export const STOCK_STATUS_LABEL: Record<string, string> = {
  RESERVADO: "Estoque reservado",
  BAIXADO: "Estoque baixado",
  LIBERADO: "Reserva liberada",
  REPOSTO: "Estoque reposto",
};

export const FLOW_STATUS_LABEL: Record<string, string> = {
  AGUARDANDO_REEMBOLSO: "Aguardando devolução",
  INCONCLUSIVO: "Estorno inconclusivo",
  INCONCLUSIVA: "Troca inconclusiva",
  AGUARDANDO_COBRANCA: "Troca aguardando pagamento",
  CONCLUIDO: "Cancelamento concluído",
  CONCLUIDA: "Troca concluída",
};
