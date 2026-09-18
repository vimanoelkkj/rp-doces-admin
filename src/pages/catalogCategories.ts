import type { Product } from "../types/product";

export interface CatalogCategory {
  /** Identificador estável (`categorias.id`), usado para filtro/agrupamento. */
  slug: string;
  /** Nome de exibição atual da categoria. */
  nome: string;
}

/**
 * Retorna somente categorias que realmente possuem produtos públicos,
 * preservando a ordem entregue pelo catálogo e eliminando duplicatas.
 *
 * Deduplicação é por `categorySlug` (identificador estável, `categorias.id`
 * no backend) — nunca pelo nome de exibição, que é só rótulo e não deve
 * decidir identidade. Isso não é uma segunda fonte de categorias: os dois
 * campos já vêm juntos, por produto, na mesma resposta do catálogo público
 * (`GET /api/produtos`).
 */
export function catalogCategories(products: Product[]): CatalogCategory[] {
  const bySlug = new Map<string, string>();

  for (const product of products) {
    const slug = product.categorySlug.trim();
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, product.category.trim());
  }

  return [...bySlug].map(([slug, nome]) => ({ slug, nome }));
}
