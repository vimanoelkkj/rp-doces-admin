import { listFinancialOrders, type FinancialOrder } from "../orders/order.finance";
import { listOrders } from "../orders/order.api";
import { listProducts } from "../products/product.api";
import type { Product } from "../products/product.types";

export type DashboardData = {
  orders: FinancialOrder[];
  products: Product[];
};

export async function loadDashboardData(): Promise<DashboardData> {
  // A rota principal de pedidos reconcilia Pix pendentes com o Mercado Pago.
  // Só depois lemos o livro-caixa para o Dashboard nunca projetar um saldo
  // desatualizado enquanto o pagamento já foi confirmado externamente.
  await listOrders();
  const [orders, products] = await Promise.all([listFinancialOrders(), listProducts()]);
  return { orders, products };
}
