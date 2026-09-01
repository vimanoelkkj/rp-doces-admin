import { z } from "zod";
import { requestJson } from "../shared/apiClient";
import { OrdersResponseSchema, type Order } from "./order.schema";

export type OrderStatus = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";
export type ManualPaymentStatus = "PENDENTE" | "PAGO" | "CANCELADO";
export type ManualOrderPaymentStatus = "PENDENTE" | "PAGO";
export type ManualOrderPaymentMethod = "PIX_EXTERNO" | "CARTAO" | "DINHEIRO" | "A_COMBINAR";

export type ManualOrderInput = {
  itens: Array<{ produto_id: number; quantidade: number }>;
  cliente_nome: string;
  cliente_whatsapp: string;
  observacao: string;
  metodo_pagamento: ManualOrderPaymentMethod;
  status_pagamento: ManualOrderPaymentStatus;
};

export type EditOrderInput = {
  itens: Array<{ produto_id: number; quantidade: number }>;
  metodo_pagamento: ManualOrderPaymentMethod;
};

const CreateManualOrderResponseSchema = z.object({
  ok: z.literal(true),
  id: z.coerce.number().int().positive()
});

const EditOrderResponseSchema = z.object({
  ok: z.literal(true),
  id: z.coerce.number().int().positive(),
  valor_total_centavos: z.coerce.number().int().positive(),
  metodo_pagamento: z.string()
});

export async function listOrders(): Promise<Order[]> {
  return OrdersResponseSchema.parse(
    await requestJson("/api/admin/orders", {}, "Não foi possível carregar os pedidos.")
  ).pedidos;
}

export async function updateOrderStatus(id: number, status: OrderStatus): Promise<void> {
  await requestJson(`/api/admin/orders/${id}`, { method: "PUT", body: JSON.stringify({ status_pedido: status }) }, "Não foi possível atualizar o pedido.");
}

export async function updateManualPayment(id: number, status: ManualPaymentStatus): Promise<void> {
  await requestJson(`/api/admin/orders/${id}`, { method: "PUT", body: JSON.stringify({ status_pagamento: status }) }, "Não foi possível atualizar o pagamento.");
}

export async function createManualOrder(input: ManualOrderInput): Promise<number> {
  return CreateManualOrderResponseSchema.parse(
    await requestJson("/api/admin/orders", { method: "POST", body: JSON.stringify(input) }, "Não foi possível registrar o pedido manual.")
  ).id;
}

export async function editOrder(id: number, input: EditOrderInput): Promise<void> {
  EditOrderResponseSchema.parse(
    await requestJson(
      `/api/admin/orders/${id}/edit`,
      { method: "PUT", body: JSON.stringify(input) },
      "Não foi possível editar o pedido."
    )
  );
}
