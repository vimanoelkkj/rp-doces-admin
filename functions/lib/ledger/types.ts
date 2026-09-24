export type LedgerStatus =
  | "PENDENTE"
  | "PAGO"
  | "CANCELADO"
  | "EXPIRADO"
  | "REEMBOLSADO"
  | "FALHOU";

export type LedgerMetodo =
  | "PIX_MP"
  | "PIX_EXTERNO"
  | "CARTAO"
  | "DINHEIRO"
  | "A_COMBINAR";

export type StatusFinanceiroAgregado = "PENDENTE" | "PARCIAL" | "PAGO";
