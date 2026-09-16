/// <reference types="@cloudflare/workers-types" />

// Passo 7: ponte explícita entre o financeiro (comandaLedger.ts) e o
// físico (stock.ts) — nenhum dos dois módulos conhece o outro.
// `recalculatePedidoStatusPagamento` continua uma função puramente
// financeira; a decisão "se PAGO, baixa estoque" mora aqui, não dentro
// dela. Todo write-path financeiro que pode levar um pedido a PAGO
// (sync com Mercado Pago, pagamento manual do admin, reembolso) passa
// por esta função em vez de chamar o cálculo financeiro diretamente —
// assim nenhum caminho pode "esquecer" de converter a reserva em baixa.

import { recalculatePedidoStatusPagamento, StatusFinanceiroAgregado } from "./comandaLedger";
import { baixarEstoquePedido } from "./stock";

export async function reconcilePedidoAfterFinancialChange(
  db: D1Database,
  pedidoId: number,
): Promise<StatusFinanceiroAgregado> {
  const agregado = await recalculatePedidoStatusPagamento(db, pedidoId);
  if (agregado === "PAGO") {
    await baixarEstoquePedido(db, pedidoId);
  }
  return agregado;
}
