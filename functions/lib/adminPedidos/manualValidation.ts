import type { LedgerMetodo } from "../comandaLedger";

export interface ItemManualInput {
  produtoId: number;
  quantidade: number;
}

export interface CriarPedidoManualBody {
  itens?: ItemManualInput[];
  clienteNome?: string;
  clienteWhatsapp?: string;
  observacao?: string;
  metodoPagamento?: string;
  statusPagamento?: string;
  operationKey?: string;
}

export const MAX_ITENS_PEDIDO_MANUAL = 20;
export const MAX_TEXT_LENGTH_MANUAL = 200;

// Mesmo vocabulário de MetodoManual (comandaLedger.ts) mais A_COMBINAR, que
// só faz sentido para um pedido que nasce PENDENTE (dinheiro nenhum
// confirmado ainda) — nunca para um pedido que já nasce PAGO.
const METODOS_PERMITIDOS: ReadonlySet<string> = new Set([
  "DINHEIRO",
  "CARTAO",
  "PIX_EXTERNO",
  "A_COMBINAR",
]);
const METODOS_CONFIRMAVEIS: ReadonlySet<string> = new Set([
  "DINHEIRO",
  "CARTAO",
  "PIX_EXTERNO",
]);
const STATUS_PAGAMENTO_VALIDOS: ReadonlySet<string> = new Set(["PENDENTE", "PAGO"]);

export function normalizeManualItems(
  raw: unknown,
):
  | { ok: true; itens: ItemManualInput[] }
  | { ok: false; erro: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, erro: "O pedido precisa ter ao menos um item" };
  }
  if (raw.length > MAX_ITENS_PEDIDO_MANUAL) {
    return { ok: false, erro: `Máximo de ${MAX_ITENS_PEDIDO_MANUAL} itens por pedido` };
  }

  const agregados = new Map<number, number>();
  for (const item of raw) {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isInteger((item as ItemManualInput).produtoId) ||
      (item as ItemManualInput).produtoId <= 0 ||
      !Number.isInteger((item as ItemManualInput).quantidade) ||
      (item as ItemManualInput).quantidade < 1 ||
      (item as ItemManualInput).quantidade > 50
    ) {
      return { ok: false, erro: "Item de pedido inválido" };
    }
    const { produtoId, quantidade } = item as ItemManualInput;
    agregados.set(produtoId, (agregados.get(produtoId) ?? 0) + quantidade);
  }

  const itens: ItemManualInput[] = [];
  for (const [produtoId, quantidade] of agregados) {
    if (quantidade > 50) {
      return { ok: false, erro: "Quantidade total de um produto excede o limite" };
    }
    itens.push({ produtoId, quantidade });
  }
  return { ok: true, itens };
}

export function validarMetodoEStatus(
  metodo: unknown,
  status: unknown,
):
  | { ok: true; metodo: LedgerMetodo; status: "PENDENTE" | "PAGO" }
  | { ok: false; erro: string } {
  if (typeof status !== "string" || !STATUS_PAGAMENTO_VALIDOS.has(status)) {
    return { ok: false, erro: "Situação de pagamento inválida" };
  }
  if (typeof metodo !== "string" || !METODOS_PERMITIDOS.has(metodo)) {
    return { ok: false, erro: "Método de pagamento inválido" };
  }
  if (status === "PAGO" && !METODOS_CONFIRMAVEIS.has(metodo)) {
    return { ok: false, erro: "\"A combinar\" não é válido para um pedido já pago" };
  }
  return { ok: true, metodo: metodo as LedgerMetodo, status: status as "PENDENTE" | "PAGO" };
}
