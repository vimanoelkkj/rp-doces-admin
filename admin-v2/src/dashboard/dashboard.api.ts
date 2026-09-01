import { listFinancialOrders, type FinancialOrder } from "../orders/order.finance";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";

export type DashboardData = {
  orders: FinancialOrder[];
  products: Product[];
};

export async function loadDashboardData(): Promise<DashboardData> {
  const [orders, products] = await Promise.all([listFinancialOrders(), listProducts()]);
  return { orders, products };
}
