import { listOrders } from "../orders/order.api";
import type { Order } from "../orders/order.schema";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";

export type DashboardData = {
  orders: Order[];
  products: Product[];
};

export async function loadDashboardData(): Promise<DashboardData> {
  const [orders, products] = await Promise.all([listOrders(), listProducts()]);
  return { orders, products };
}
