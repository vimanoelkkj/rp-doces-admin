import { describe, expect, it } from "vitest";
import type { Order } from "../orders/order.schema";
import type { Product } from "../products/product.types";
import {
  buildDashboardSummary,
  dashboardOrderItemsCount,
  parseDashboardDate,
  sameLocalDay
} from "./dashboard.model";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    cliente_nome: "Cliente",
    cliente_email: "",
    cliente_whatsapp: "",
    quantidade: 1,
    valor_unitario_centavos: 2500,
    valor_total_centavos: 2500,
    status_pagamento: "PENDENTE",
    status_pedido: "NOVO",
    criado_em: "2026-09-01T12:00:00-03:00",
    atualizado_em: "2026-09-01T12:00:00-03:00",
    pago_em: null,
    itens: [],
    ...overrides
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    nome: "Produto",
    categoria: "TESTE",
    categoria_nome: "Teste",
    categoria_emoji: "🍰",
    descricao: "",
    preco_centavos: 2500,
    disponivel: true,
    ativo: true,
    destaque: false,
    ordem: 0,
    emoji: "🍰",
    estoque: 10,
    estoque_reservado: 0,
    promocao_ativa: false,
    preco_promocional_centavos: null,
    promocao_inicio: null,
    promocao_fim: null,
    image_key: null,
    criado_em: "2026-09-01T00:00:00Z",
    atualizado_em: "2026-09-01T00:00:00Z",
    ...overrides
  };
}

describe("dashboard.model", () => {
  it("normaliza data SQLite UTC usada pelo backend", () => {
    expect(parseDashboardDate("2026-09-01 15:30:00")?.toISOString()).toBe("2026-09-01T15:30:00.000Z");
  });

  it("compara o dia no fuso local", () => {
    const reference = new Date(2026, 8, 1, 20, 0, 0);
    expect(sameLocalDay(new Date(2026, 8, 1, 1, 0, 0), reference)).toBe(true);
    expect(sameLocalDay(new Date(2026, 8, 2, 0, 0, 0), reference)).toBe(false);
  });

  it("prefere a soma dos itens ao snapshot legado de quantidade", () => {
    expect(
      dashboardOrderItemsCount(
        order({
          quantidade: 99,
          itens: [
            { quantidade: 2, valor_unitario_centavos: 1000, valor_total_centavos: 2000 },
            { quantidade: 1, valor_unitario_centavos: 500, valor_total_centavos: 500 }
          ]
        })
      )
    ).toBe(3);
  });

  it("calcula as mesmas metricas operacionais do dashboard legado", () => {
    const now = new Date(2026, 8, 1, 18, 0, 0);
    const orders = [
      order({
        id: 1,
        status_pagamento: "PAGO",
        status_pedido: "NOVO",
        valor_total_centavos: 3000,
        pago_em: "2026-09-01T14:00:00-03:00"
      }),
      order({ id: 2, status_pagamento: "PENDENTE", valor_total_centavos: 2000 }),
      order({
        id: 3,
        status_pagamento: "PAGO",
        status_pedido: "PRONTO",
        valor_total_centavos: 4000,
        pago_em: "2026-08-31T14:00:00-03:00",
        criado_em: "2026-08-31T14:00:00-03:00"
      })
    ];
    const products = [
      product({ id: 1, estoque: 1 }),
      product({ id: 2, estoque: 3, estoque_reservado: 3 }),
      product({ id: 3, estoque: 2, ativo: false })
    ];

    const summary = buildDashboardSummary(orders, products, now);

    expect(summary.paidRevenueToday).toBe(3000);
    expect(summary.paidTodayCount).toBe(1);
    expect(summary.waitingPreparationCount).toBe(1);
    expect(summary.pendingPaymentCount).toBe(1);
    expect(summary.productCount).toBe(3);
    expect(summary.soldOutCount).toBe(1);
    expect(summary.lowStockCount).toBe(1);
    expect(summary.ordersTodayCount).toBe(2);
    expect(summary.recentOrders).toHaveLength(3);
    expect(summary.attention).toEqual([
      "1 pedido aguardando pagamento",
      "1 pedido aguardando preparação",
      "1 produto sem estoque disponível",
      "1 produto com estoque baixo"
    ]);
  });
});
