import type { Product } from "./product.types";

export type PromotionState = "inactive" | "scheduled" | "active" | "ended";

export function availableStock(product: Product): number {
  return Math.max(0, product.estoque - product.estoque_reservado);
}

export function promotionState(product: Product, now = Date.now()): PromotionState {
  if (!product.promocao_ativa) return "inactive";

  const start = product.promocao_inicio ? Date.parse(product.promocao_inicio) : null;
  const end = product.promocao_fim ? Date.parse(product.promocao_fim) : null;

  if (start !== null && start > now) return "scheduled";
  if (end !== null && end < now) return "ended";
  return "active";
}

export function promotionLabel(state: PromotionState): string | null {
  if (state === "scheduled") return "Promoção agendada";
  if (state === "active") return "Promoção ativa";
  if (state === "ended") return "Promoção encerrada";
  return null;
}

export function currentPriceCents(product: Product, now = Date.now()): number {
  if (
    promotionState(product, now) === "active" &&
    product.preco_promocional_centavos !== null &&
    product.preco_promocional_centavos > 0
  ) {
    return product.preco_promocional_centavos;
  }

  return product.preco_centavos;
}
