import { requestJson } from "../shared/apiClient";
import { OrdersResponseSchema, type Order } from "./order.schema";

export type OrderStatus = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";
export type ManualPaymentStatus = "PENDENTE" | "PAGO" | "CANCELADO";

export async function listOrders(): Promise<Order[]> {
  return OrdersResponseSchema.parse(
    await requestJson("/api/admin/orders", {}, "Não foi possível carregar os pedidos.")
  ).pedidos;
}

export async function updateOrderStatus(id: number, status: OrderStatus): Promise<void> {
  await requestJson(
    `/api/admin/orders/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ status_pedido: status })
    },
    "Não foi possível atualizar o pedido."
  );
}

export async function updateManualPayment(id: number, status: ManualPaymentStatus): Promise<void> {
  await requestJson(
    `/api/admin/orders/${id}`,
    {
      method: "PUT",
      body: JSON.stringify({ status_pagamento: status })
    },
    "Não foi possível atualizar o pagamento."
  );
}
