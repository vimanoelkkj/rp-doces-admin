import { describe, expect, it } from "vitest";
import type { Product } from "./product.types";
import {
  availableStock,
  currentPriceCents,
  promotionLabel,
  promotionState
} from "./productDisplay";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    nome: "Pudim",
    categoria: "PUDINS",
    categoria_nome: "Pudins",
    categoria_emoji: "🍮",
    categoria_ordem: 1,
    descricao: "Pudim artesanal",
    preco_centavos: 2500,
    disponivel: true,
    ativo: true,
    destaque: false,
    ordem: 1,
    emoji: "🍮",
    estoque: 10,
    estoque_reservado: 2,
    promocao_ativa: false,
    preco_promocional_centavos: null,
    promocao_inicio: null,
    promocao_fim: null,
    image_key: null,
    criado_em: "2026-09-01T00:00:00.000Z",
    atualizado_em: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

describe("availableStock", () => {
  it("desconta unidades reservadas sem ficar negativo", () => {
    expect(availableStock(product())).toBe(8);
    expect(availableStock(product({ estoque: 2, estoque_reservado: 5 }))).toBe(0);
  });
});

describe("promotionState", () => {
  it("distingue promoção inativa, agendada, ativa e encerrada", () => {
    expect(promotionState(product(), NOW)).toBe("inactive");
    expect(
      promotionState(
        product({ promocao_ativa: true, promocao_inicio: "2026-09-02T12:00:00.000Z", preco_promocional_centavos: 2000 }),
        NOW
      )
    ).toBe("scheduled");
    expect(
      promotionState(
        product({ promocao_ativa: true, promocao_inicio: "2026-08-31T12:00:00.000Z", promocao_fim: "2026-09-02T12:00:00.000Z", preco_promocional_centavos: 2000 }),
        NOW
      )
    ).toBe("active");
    expect(
      promotionState(
        product({ promocao_ativa: true, promocao_fim: "2026-08-31T12:00:00.000Z", preco_promocional_centavos: 2000 }),
        NOW
      )
    ).toBe("ended");
  });
});

describe("promotionLabel", () => {
  it("gera os rótulos administrativos esperados", () => {
    expect(promotionLabel("inactive")).toBeNull();
    expect(promotionLabel("scheduled")).toBe("Promoção agendada");
    expect(promotionLabel("active")).toBe("Promoção ativa");
    expect(promotionLabel("ended")).toBe("Promoção encerrada");
  });
});

describe("currentPriceCents", () => {
  it("usa preço promocional somente durante promoção ativa", () => {
    const base = product({
      promocao_ativa: true,
      preco_promocional_centavos: 1900,
      promocao_inicio: "2026-08-31T12:00:00.000Z",
      promocao_fim: "2026-09-02T12:00:00.000Z"
    });

    expect(currentPriceCents(base, NOW)).toBe(1900);
    expect(currentPriceCents({ ...base, promocao_inicio: "2026-09-02T12:00:00.000Z" }, NOW)).toBe(2500);
    expect(currentPriceCents({ ...base, promocao_fim: "2026-08-31T12:00:00.000Z" }, NOW)).toBe(2500);
  });
});
