import { z } from "zod";
import { requestJson } from "../shared/apiClient";
import { OrderItemSchema, OrderSchema } from "./order.schema";

export const FinancialStatusSchema = z.enum(["PENDENTE", "PARCIAL", "PAGO"]);

export const OrderPaymentSchema = z.object({
  id: z.coerce.number().nullable().optional(),
  pedido_id: z.coerce.number(),
  metodo: z.string(),
  origem: z.string(),
  valor_centavos: z.coerce.number().default(0),
  status: z.string(),
  mp_order_id: z.string().nullable().optional(),
  mp_payment_id: z.string().nullable().optional(),
  mp_status: z.string().nullable().optional(),
  mp_status_detail: z.string().nullable().optional(),
  mp_ticket_url: z.string().nullable().optional(),
  mp_qr_code: z.string().nullable().optional(),
  mp_qr_code_base64: z.string().nullable().optional(),
  pix_expira_em: z.string().nullable().optional(),
  substitui_pagamento_id: z.coerce.number().nullable().optional(),
  registrado_por_usuario_id: z.coerce.number().nullable().optional(),
  observacao: z.string().default(""),
  criado_em: z.string().nullable().optional(),
  atualizado_em: z.string().nullable().optional(),
  pago_em: z.string().nullable().optional(),
  cancelado_em: z.string().nullable().optional(),
  legado: z.boolean().optional()
});

export const FinancialOrderItemSchema = OrderItemSchema.extend({
  id: z.coerce.number().int().positive(),
  valor_pago_centavos: z.coerce.number().default(0),
  saldo_centavos: z.coerce.number().default(0),
  status_financeiro: FinancialStatusSchema
});

export const FinancialOrderSchema = OrderSchema.extend({
  itens: z.array(FinancialOrderItemSchema).default([]),
  pagamentos: z.array(OrderPaymentSchema).default([]),
  valor_pago_centavos: z.coerce.number().default(0),
  saldo_centavos: z.coerce.number().default(0),
  credito_centavos: z.coerce.number().default(0),
  status_financeiro: FinancialStatusSchema
});

export const OrderRefundSchema = z.object({
  id: z.coerce.number().int().positive(),
  pedido_id: z.coerce.number().int().positive(),
  pagamento_id: z.coerce.number().int().positive(),
  origem: z.string(),
  metodo: z.string(),
  valor_centavos: z.coerce.number().default(0),
  status: z.string(),
  mp_refund_id: z.string().nullable().optional(),
  mp_status: z.string().nullable().optional(),
  registrado_por_usuario_id: z.coerce.number().nullable().optional(),
  registrado_por_nome: z.string().nullable().optional(),
  motivo: z.string().default(""),
  devolveu_estoque: z.coerce.number().default(0),
  criado_em: z.string().nullable().optional(),
  atualizado_em: z.string().nullable().optional(),
  concluido_em: z.string().nullable().optional()
});

const FinancialOrdersResponseSchema = z.object({
  pedidos: z.array(FinancialOrderSchema)
});

const FinancialOrderResponseSchema = z.object({
  pedido: FinancialOrderSchema
});

const RefundsResponseSchema = z.object({
  reembolsos: z.array(OrderRefundSchema).default([])
});

const RefundMutationResponseSchema = z.object({
  ok: z.literal(true),
  reembolso: OrderRefundSchema.nullable().optional(),
  ja_reembolsado: z.boolean().optional(),
  pendente: z.boolean().optional(),
  confirmado_por: z.string().optional(),
  estoque_restaurado: z.boolean().optional(),
  aviso: z.string().nullable().optional(),
  mensagem: z.string().optional()
});

const ComandaMutationResponseSchema = z.object({
  ok: z.literal(true),
  pedido_id: z.coerce.number().optional(),
  pagamento_id: z.coerce.number().optional(),
  status_financeiro: FinancialStatusSchema.optional(),
  saldo_centavos: z.coerce.number().optional(),
  aviso: z.string().optional(),
  item: z.object({
    produto_id: z.coerce.number(),
    produto_nome: z.string(),
    quantidade: z.coerce.number(),
    valor_unitario_centavos: z.coerce.number(),
    valor_total_centavos: z.coerce.number()
  }).optional(),
  pagamento: OrderPaymentSchema.optional()
});

export type FinancialStatus = z.infer<typeof FinancialStatusSchema>;
export type OrderPayment = z.infer<typeof OrderPaymentSchema>;
export type FinancialOrderItem = z.infer<typeof FinancialOrderItemSchema>;
export type FinancialOrder = z.infer<typeof FinancialOrderSchema>;
export type OrderRefund = z.infer<typeof OrderRefundSchema>;
export type RefundMutationResult = z.infer<typeof RefundMutationResponseSchema>;
export type PixDecision = "CANCELAR" | "MANTER";
export type ManualComandaPaymentMethod = "PIX_EXTERNO" | "CARTAO" | "DINHEIRO";
export type ManualRefundMethod = ManualComandaPaymentMethod | "OUTRO";
export type RefundInput = {
  pagamento_id: number;
  origem: "MERCADO_PAGO" | "MANUAL";
  metodo: "PIX_MP" | ManualRefundMethod;
  motivo?: string;
  devolver_estoque?: boolean;
};

type FinancialCacheEntry = {
  value: FinancialOrder;
  updatedAt: number;
};

const FINANCIAL_CACHE_TTL_MS = 15_000;
const financialOrderCache = new Map<number, FinancialCacheEntry>();

function cacheFinancialOrder(order: FinancialOrder, updatedAt = Date.now()) {
  financialOrderCache.set(order.id, { value: order, updatedAt });
}

export function invalidateFinancialOrder(orderId: number) {
  financialOrderCache.delete(orderId);
}

export async function listFinancialOrders(): Promise<FinancialOrder[]> {
  const orders = FinancialOrdersResponseSchema.parse(
    await requestJson(
      "/api/admin/orders/finance",
      {},
      "Não foi possível carregar o financeiro das comandas."
    )
  ).pedidos;

  const updatedAt = Date.now();
  orders.forEach(order => cacheFinancialOrder(order, updatedAt));
  return orders;
}

export async function getFinancialOrder(orderId: number, fresh = false): Promise<FinancialOrder> {
  const cached = financialOrderCache.get(orderId);
  if (!fresh && cached && Date.now() - cached.updatedAt < FINANCIAL_CACHE_TTL_MS) {
    return cached.value;
  }

  const order = FinancialOrderResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/finance?fresh=1`,
      {},
      "Não foi possível atualizar a comanda."
    )
  ).pedido;

  cacheFinancialOrder(order);
  return order;
}

export async function listOrderRefunds(orderId: number, sync = true): Promise<OrderRefund[]> {
  return RefundsResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/refunds${sync ? "?sync=1" : ""}`,
      {},
      "Não foi possível carregar os reembolsos da comanda."
    )
  ).reembolsos;
}

export async function refundPayment(
  orderId: number,
  input: RefundInput
): Promise<RefundMutationResult> {
  const result = RefundMutationResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/refunds`,
      { method: "POST", body: JSON.stringify(input) },
      "Não foi possível reembolsar o pagamento."
    )
  );
  invalidateFinancialOrder(orderId);
  return result;
}

export async function addComandaItem(
  orderId: number,
  input: { produto_id: number; quantidade: number }
): Promise<z.infer<typeof ComandaMutationResponseSchema>> {
  const result = ComandaMutationResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/items`,
      { method: "POST", body: JSON.stringify(input) },
      "Não foi possível adicionar o item à comanda."
    )
  );
  invalidateFinancialOrder(orderId);
  return result;
}

export async function registerComandaPayment(
  orderId: number,
  input: {
    metodo: ManualComandaPaymentMethod;
    valor_centavos: number;
    pix_pendente?: PixDecision;
    observacao?: string;
  }
): Promise<z.infer<typeof ComandaMutationResponseSchema>> {
  const result = ComandaMutationResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/payments`,
      {
        method: "POST",
        body: JSON.stringify({ acao: "REGISTRAR", ...input })
      },
      "Não foi possível registrar o pagamento."
    )
  );
  invalidateFinancialOrder(orderId);
  return result;
}

export async function generateComandaPix(
  orderId: number,
  input: { valor_centavos?: number; pix_pendente?: PixDecision; client_request_id?: string }
): Promise<z.infer<typeof ComandaMutationResponseSchema>> {
  const result = ComandaMutationResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/payments`,
      {
        method: "POST",
        body: JSON.stringify({
          acao: "GERAR_PIX",
          client_request_id: input.client_request_id || crypto.randomUUID(),
          ...input
        })
      },
      "Não foi possível gerar a cobrança Pix."
    )
  );
  invalidateFinancialOrder(orderId);
  return result;
}

export async function cancelComandaPix(orderId: number): Promise<void> {
  await requestJson(
    `/api/admin/orders/${orderId}/payments`,
    { method: "POST", body: JSON.stringify({ acao: "CANCELAR_PIX" }) },
    "Não foi possível cancelar a cobrança Pix."
  );
  invalidateFinancialOrder(orderId);
}
