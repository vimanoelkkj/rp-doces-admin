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

const FinancialOrdersResponseSchema = z.object({
  pedidos: z.array(FinancialOrderSchema)
});

export type FinancialStatus = z.infer<typeof FinancialStatusSchema>;
export type OrderPayment = z.infer<typeof OrderPaymentSchema>;
export type FinancialOrderItem = z.infer<typeof FinancialOrderItemSchema>;
export type FinancialOrder = z.infer<typeof FinancialOrderSchema>;

export async function listFinancialOrders(): Promise<FinancialOrder[]> {
  return FinancialOrdersResponseSchema.parse(
    await requestJson(
      "/api/admin/orders/finance",
      {},
      "Não foi possível carregar o financeiro das comandas."
    )
  ).pedidos;
}
