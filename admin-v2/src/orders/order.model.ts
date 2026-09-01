import type { Order, OrderItem } from "./order.schema";

export type OrderFilter = "todos" | "pendentes" | "em-andamento" | "concluidos";

export type OrdersSummary = {
  total: number;
  pendingPayment: number;
  paid: number;
  manual: number;
  active: number;
  delivered: number;
};

const ACTIVE_ORDER_STATUSES = new Set(["NOVO", "PREPARANDO", "PRONTO"]);
const COMPLETED_ORDER_STATUSES = new Set(["ENTREGUE", "CANCELADO"]);

export function itemsOf(order: Order): OrderItem[] {
  if (order.itens.length) return order.itens;

  if (!order.produto_nome) return [];
  return [
    {
      produto_id: order.produto_id ?? null,
      produto_nome: order.produto_nome,
      quantidade: order.quantidade,
      valor_unitario_centavos: order.valor_unitario_centavos,
      valor_total_centavos: order.valor_total_centavos
    }
  ];
}

export function itemSummary(order: Order): string {
  const items = itemsOf(order);
  if (!items.length) return "Pedido sem itens";

  const first = items[0];
  const rest = items.length - 1;
  return `${Number(first.quantidade || 0)}× ${first.produto_nome || "Produto"}${
    rest > 0 ? ` + ${rest} item(ns)` : ""
  }`;
}

export function buildOrdersSummary(orders: Order[]): OrdersSummary {
  return {
    total: orders.length,
    pendingPayment: orders.filter(order => order.status_pagamento === "PENDENTE").length,
    paid: orders.filter(order => order.status_pagamento === "PAGO").length,
    manual: orders.filter(order => order.origem_pedido === "MANUAL").length,
    active: orders.filter(order => ACTIVE_ORDER_STATUSES.has(order.status_pedido || "NOVO")).length,
    delivered: orders.filter(order => order.status_pedido === "ENTREGUE").length
  };
}

export function filterOrders(orders: Order[], filter: OrderFilter, rawQuery: string): Order[] {
  const query = rawQuery.trim().toLocaleLowerCase("pt-BR");

  return orders.filter(order => {
    const haystack = [
      order.id,
      order.cliente_nome || "",
      order.cliente_email || "",
      order.cliente_whatsapp || "",
      itemSummary(order)
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR");

    if (query && !haystack.includes(query)) return false;

    if (filter === "pendentes") return order.status_pagamento === "PENDENTE";
    if (filter === "em-andamento") return ACTIVE_ORDER_STATUSES.has(order.status_pedido || "NOVO");
    if (filter === "concluidos") return COMPLETED_ORDER_STATUSES.has(order.status_pedido || "NOVO");
    return true;
  });
}
