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

const FinancialOrdersResponseSchema = z.object({
  pedidos: z.array(FinancialOrderSchema)
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
export type PixDecision = "CANCELAR" | "MANTER";
export type ManualComandaPaymentMethod = "PIX_EXTERNO" | "CARTAO" | "DINHEIRO";

export async function listFinancialOrders(): Promise<FinancialOrder[]> {
  return FinancialOrdersResponseSchema.parse(
    await requestJson(
      "/api/admin/orders/finance",
      {},
      "Não foi possível carregar o financeiro das comandas."
    )
  ).pedidos;
}

export async function addComandaItem(
  orderId: number,
  input: { produto_id: number; quantidade: number }
): Promise<z.infer<typeof ComandaMutationResponseSchema>> {
  return ComandaMutationResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/items`,
      { method: "POST", body: JSON.stringify(input) },
      "Não foi possível adicionar o item à comanda."
    )
  );
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
  return ComandaMutationResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${orderId}/payments`,
      {
        method: "POST",
        body: JSON.stringify({ acao: "REGISTRAR", ...input })
      },
      "Não foi possível registrar o pagamento."
    )
  );
}

export async function generateComandaPix(
  orderId: number,
  input: { valor_centavos: number; pix_pendente?: PixDecision; client_request_id?: string }
): Promise<z.infer<typeof ComandaMutationResponseSchema>> {
  return ComandaMutationResponseSchema.parse(
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
}

export async function cancelComandaPix(orderId: number): Promise<void> {
  await requestJson(
    `/api/admin/orders/${orderId}/payments`,
    { method: "POST", body: JSON.stringify({ acao: "CANCELAR_PIX" }) },
    "Não foi possível cancelar a cobrança Pix."
  );
}
