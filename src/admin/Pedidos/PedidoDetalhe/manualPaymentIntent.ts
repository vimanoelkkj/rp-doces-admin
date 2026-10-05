import type { MetodoPagamentoManual } from "./types";

export interface PaymentIntent {
  version: 1;
  state: "pending";
  pedidoId: number;
  operationKey: string;
  payload: { metodo: MetodoPagamentoManual; valorCentavos: number };
}

const storageKey = (pedidoId: number) => `rp:pedido:${pedidoId}:pagamento-manual:intents`;

function isPaymentIntent(value: unknown, pedidoId: number): value is PaymentIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<PaymentIntent>;
  return Boolean(
    intent.version === 1 &&
    intent.state === "pending" &&
    intent.pedidoId === pedidoId &&
    typeof intent.operationKey === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(intent.operationKey) &&
    intent.payload &&
    ["DINHEIRO", "CARTAO", "PIX_EXTERNO"].includes(intent.payload.metodo) &&
    Number.isSafeInteger(intent.payload.valorCentavos) &&
    intent.payload.valorCentavos > 0
  );
}

export function readPaymentIntents(pedidoId: number): PaymentIntent[] {
  const raw = sessionStorage.getItem(storageKey(pedidoId));
  if (!raw) return [];
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(storageKey(pedidoId));
    return [];
  }
  if (!Array.isArray(values)) {
    sessionStorage.removeItem(storageKey(pedidoId));
    return [];
  }
  return values.filter(value => isPaymentIntent(value, pedidoId));
}

export function matchesPaymentIntent(
  intent: PaymentIntent,
  pedidoId: number,
  payload: PaymentIntent["payload"]
): boolean {
  return (
    intent.pedidoId === pedidoId &&
    intent.payload.metodo === payload.metodo &&
    intent.payload.valorCentavos === payload.valorCentavos
  );
}

export function storePaymentIntent(intent: PaymentIntent): void {
  const intents = readPaymentIntents(intent.pedidoId).filter(
    pending => pending.operationKey !== intent.operationKey
  );
  intents.push(intent);
  sessionStorage.setItem(storageKey(intent.pedidoId), JSON.stringify(intents));
}

export function resolvePaymentIntent(intent: PaymentIntent): void {
  const remaining = readPaymentIntents(intent.pedidoId).filter(
    pending => pending.operationKey !== intent.operationKey
  );
  if (remaining.length) {
    sessionStorage.setItem(storageKey(intent.pedidoId), JSON.stringify(remaining));
  } else {
    sessionStorage.removeItem(storageKey(intent.pedidoId));
  }
}

export function isDefinitivePaymentRejection(status: number, code: unknown): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    ![401, 403, 408, 429].includes(status) &&
    code !== "OPERACAO_EM_PROCESSAMENTO" &&
    code !== "OPERACAO_INCOMPLETA"
  );
}
