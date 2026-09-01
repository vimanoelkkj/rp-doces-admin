import { AuthError } from "../auth/auth.api";
import { OrdersResponseSchema, type Order } from "./order.schema";

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError("Resposta inválida do servidor.", response.status);
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "erro" in body && typeof body.erro === "string") {
    return body.erro;
  }
  return fallback;
}

export async function listOrders(): Promise<Order[]> {
  const response = await fetch("/api/admin/orders", {
    credentials: "include",
    headers: { accept: "application/json" }
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new AuthError(errorMessage(body, "Não foi possível carregar os pedidos."), response.status);
  }

  return OrdersResponseSchema.parse(body).pedidos;
}
