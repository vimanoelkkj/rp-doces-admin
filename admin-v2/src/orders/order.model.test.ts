import { describe, expect, it } from "vitest";
import { buildOrdersSummary, filterOrders, itemSummary } from "./order.model";
import type { Order } from "./order.schema";

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    token_publico: null,
    produto_id: 10,
    produto_nome: "Pudim",
    quantidade: 1,
    valor_unitario_centavos: 1200,
    valor_total_centavos: 1200,
    cliente_nome: "Maria",
    cliente_email: "maria@example.com",
    cliente_whatsapp: "31999999999",
    tipo_entrega: "RETIRADA",
    observacao: null,
    metodo_pagamento: "PIX",
    status_pagamento: "PENDENTE",
    status_pedido: "NOVO",
    origem_pedido: "SITE",
    mp_order_id: null,
    mp_payment_id: null,
    mp_status: null,
    mp_status_detail: null,
    criado_em: "2026-09-01 12:00:00",
    atualizado_em: "2026-09-01 12:00:00",
    pago_em: null,
    estoque_baixado_em: null,
    reserva_status: "ATIVA",
    itens: [],
    ...overrides
  };
}

describe("orders model", () => {
  it("resume os estados principais do legado", () => {
    const orders = [
      order(),
      order({ id: 2, status_pagamento: "PAGO", status_pedido: "PREPARANDO", origem_pedido: "MANUAL" }),
      order({ id: 3, status_pagamento: "PAGO", status_pedido: "ENTREGUE" }),
      order({ id: 4, status_pagamento: "CANCELADO", status_pedido: "CANCELADO" })
    ];

    expect(buildOrdersSummary(orders)).toEqual({
      total: 4,
      pendingPayment: 1,
      paid: 2,
      manual: 1,
      active: 2,
      delivered: 1
    });
  });

  it("filtra por pagamento pendente, andamento e concluídos", () => {
    const orders = [
      order({ id: 1, status_pagamento: "PENDENTE", status_pedido: "NOVO" }),
      order({ id: 2, status_pagamento: "PAGO", status_pedido: "PRONTO" }),
      order({ id: 3, status_pagamento: "PAGO", status_pedido: "ENTREGUE" })
    ];

    expect(filterOrders(orders, "pendentes", "").map(item => item.id)).toEqual([1]);
    expect(filterOrders(orders, "em-andamento", "").map(item => item.id)).toEqual([1, 2]);
    expect(filterOrders(orders, "concluidos", "").map(item => item.id)).toEqual([3]);
  });

  it("busca por cliente, contato, id e resumo dos itens", () => {
    const orders = [
      order({ id: 17, cliente_nome: "Ana Souza", produto_nome: "Brownie" }),
      order({ id: 18, cliente_nome: "Bruno", cliente_whatsapp: "31912345678", produto_nome: "Pudim" })
    ];

    expect(filterOrders(orders, "todos", "ana").map(item => item.id)).toEqual([17]);
    expect(filterOrders(orders, "todos", "3191234").map(item => item.id)).toEqual([18]);
    expect(filterOrders(orders, "todos", "17").map(item => item.id)).toEqual([17]);
    expect(filterOrders(orders, "todos", "brownie").map(item => item.id)).toEqual([17]);
  });

  it("resume múltiplos itens e preserva fallback de pedido antigo", () => {
    const multi = order({
      itens: [
        { produto_nome: "Pudim", quantidade: 2, valor_unitario_centavos: 1200, valor_total_centavos: 2400 },
        { produto_nome: "Brownie", quantidade: 1, valor_unitario_centavos: 900, valor_total_centavos: 900 }
      ]
    });

    expect(itemSummary(multi)).toBe("2× Pudim + 1 item(ns)");
    expect(itemSummary(order({ quantidade: 3, produto_nome: "Brigadeiro" }))).toBe("3× Brigadeiro");
  });
});
