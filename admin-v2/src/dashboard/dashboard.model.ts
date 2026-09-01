import type { Order } from "../orders/order.schema";
import type { Product } from "../products/product.types";

export type DashboardSummary = {
  paidRevenueToday: number;
  paidTodayCount: number;
  waitingPreparationCount: number;
  pendingPaymentCount: number;
  productCount: number;
  soldOutCount: number;
  lowStockCount: number;
  ordersTodayCount: number;
  recentOrders: Order[];
  attention: string[];
};

export function parseDashboardDate(value?: string | null): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sameLocalDay(date: Date | null, reference: Date): boolean {
  return Boolean(
    date &&
      date.getFullYear() === reference.getFullYear() &&
      date.getMonth() === reference.getMonth() &&
      date.getDate() === reference.getDate()
  );
}

export function dashboardOrderItemsCount(order: Order): number {
  if (order.itens.length) {
    return order.itens.reduce((total, item) => total + Number(item.quantidade || 0), 0);
  }
  return Number(order.quantidade || 0);
}

export function dashboardAvailableStock(product: Product): number {
  return Number(product.estoque || 0) - Number(product.estoque_reservado || 0);
}

export function buildDashboardSummary(
  orders: Order[],
  products: Product[],
  now = new Date()
): DashboardSummary {
  const ordersToday = orders.filter(order => sameLocalDay(parseDashboardDate(order.criado_em), now));
  const paidToday = orders.filter(
    order =>
      String(order.status_pagamento || "").toUpperCase() === "PAGO" &&
      sameLocalDay(parseDashboardDate(order.pago_em || order.atualizado_em), now)
  );
  const pendingPayment = orders.filter(
    order => String(order.status_pagamento || "").toUpperCase() === "PENDENTE"
  );
  const waitingPreparation = orders.filter(
    order =>
      String(order.status_pedido || "NOVO").toUpperCase() === "NOVO" &&
      String(order.status_pagamento || "").toUpperCase() === "PAGO"
  );
  const soldOut = products.filter(product => dashboardAvailableStock(product) <= 0);
  const lowStock = products.filter(product => {
    const available = dashboardAvailableStock(product);
    return available > 0 && available <= 2 && Boolean(product.ativo);
  });
  const paidRevenueToday = paidToday.reduce(
    (total, order) => total + Number(order.valor_total_centavos || 0),
    0
  );

  const attention: string[] = [];
  if (pendingPayment.length) {
    attention.push(
      `${pendingPayment.length} pedido${pendingPayment.length === 1 ? "" : "s"} aguardando pagamento`
    );
  }
  if (waitingPreparation.length) {
    attention.push(
      `${waitingPreparation.length} pedido${waitingPreparation.length === 1 ? "" : "s"} aguardando preparação`
    );
  }
  if (soldOut.length) {
    attention.push(
      `${soldOut.length} produto${soldOut.length === 1 ? "" : "s"} sem estoque disponível`
    );
  }
  if (lowStock.length) {
    attention.push(
      `${lowStock.length} produto${lowStock.length === 1 ? "" : "s"} com estoque baixo`
    );
  }

  return {
    paidRevenueToday,
    paidTodayCount: paidToday.length,
    waitingPreparationCount: waitingPreparation.length,
    pendingPaymentCount: pendingPayment.length,
    productCount: products.length,
    soldOutCount: soldOut.length,
    lowStockCount: lowStock.length,
    ordersTodayCount: ordersToday.length,
    recentOrders: orders.slice(0, 6),
    attention
  };
}
