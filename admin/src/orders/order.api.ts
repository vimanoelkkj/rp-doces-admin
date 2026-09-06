import { z } from "zod";
import { requestJson } from "../shared/apiClient";
import { OrdersResponseSchema, type Order } from "./order.schema";

export type OrderStatus = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";
export type ManualPaymentStatus = "PENDENTE" | "PAGO" | "CANCELADO";
export type ManualOrderPaymentStatus = "PENDENTE" | "PAGO";
export type ManualOrderPaymentMethod = "PIX_EXTERNO" | "CARTAO" | "DINHEIRO" | "A_COMBINAR";
export type RefundMethod = "PIX_EXTERNO" | "DINHEIRO" | "CARTAO" | "OUTRO";

export type ManualOrderInput = {
  itens: Array<{ produto_id: number; quantidade: number }>;
  cliente_nome: string;
  cliente_whatsapp: string;
  observacao: string;
  metodo_pagamento: ManualOrderPaymentMethod;
  status_pagamento: ManualOrderPaymentStatus;
};

export type OrderItemUpdateInput = {
  item_id: number;
  produto_id: number;
  quantidade: number;
};

export type PaidOrderItemExchangeInput = {
  produto_id: number;
  quantidade: number;
  devolucao_metodo?: RefundMethod;
  confirmacao_devolucao?: "DEVOLVIDO";
};

const CreateManualOrderResponseSchema = z.object({
  ok: z.literal(true),
  id: z.coerce.number().int().positive()
});

export async function listOrders(): Promise<Order[]> {
  return OrdersResponseSchema.parse(
    await requestJson("/api/admin/orders", {}, "Não foi possível carregar os pedidos.")
  ).pedidos;
}

export async function updateOrderStatus(id: number, status: OrderStatus): Promise<void> {
  if (status === "CANCELADO") {
    await requestJson(
      `/api/admin/orders/${id}/payments`,
      {
        method: "POST",
        body: JSON.stringify({ acao: "CANCELAR_COMANDA", confirmacao: "CANCELAR" })
      },
      "Não foi possível cancelar a comanda."
    );
    return;
  }

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

export async function reopenPaidCommand(id: number): Promise<void> {
  await requestJson(
    `/api/admin/orders/${id}/reopen`,
    { method: "POST" },
    "Não foi possível reabrir a comanda paga."
  );
}

export async function updateOrderItem(id: number, input: OrderItemUpdateInput): Promise<void> {
  await requestJson(
    `/api/admin/orders/${id}/items`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    },
    "Não foi possível alterar o item do pedido."
  );
}

export async function exchangePaidOrderItem(
  id: number,
  itemId: number,
  input: PaidOrderItemExchangeInput
): Promise<void> {
  await requestJson(
    `/api/admin/orders/${id}/items/${itemId}/exchange`,
    {
      method: "POST",
      body: JSON.stringify(input)
    },
    "Não foi possível trocar o item pago."
  );
}

export async function deleteOrderItem(id: number, itemId: number): Promise<void> {
  await requestJson(
    `/api/admin/orders/${id}/items/${itemId}`,
    { method: "DELETE" },
    "Não foi possível excluir o item da comanda."
  );
}

export async function reallocateOrderItemPayment(
  id: number,
  itemId: number,
  targetItemId: number,
  refundMethod?: RefundMethod,
  confirmRefund = false
): Promise<void> {
  await requestJson(
    `/api/admin/orders/${id}/items/${itemId}/reallocate`,
    {
      method: "POST",
      body: JSON.stringify({
        destino_item_id: targetItemId,
        ...(refundMethod ? { devolucao_metodo: refundMethod } : {}),
        ...(confirmRefund ? { confirmacao_devolucao: "DEVOLVIDO" } : {})
      })
    },
    "Não foi possível corrigir o produto pago da comanda."
  );
}

export async function createManualOrder(input: ManualOrderInput): Promise<number> {
  return CreateManualOrderResponseSchema.parse(
    await requestJson(
      "/api/admin/orders",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      "Não foi possível registrar o pedido manual."
    )
  ).id;
}
