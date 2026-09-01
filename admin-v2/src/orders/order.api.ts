import { requestJson } from "../shared/apiClient";
import { OrdersResponseSchema, type Order } from "./order.schema";

export async function listOrders(): Promise<Order[]> {
  return OrdersResponseSchema.parse(
    await requestJson("/api/admin/orders", {}, "Não foi possível carregar os pedidos.")
  ).pedidos;
}
