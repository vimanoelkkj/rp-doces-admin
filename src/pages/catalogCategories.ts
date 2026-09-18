import type { Product } from "../types/product";

/**
 * Retorna somente categorias que realmente possuem produtos públicos,
 * preservando a ordem entregue pelo catálogo e eliminando duplicatas.
 */
export function catalogCategories(products: Product[]): string[] {
  const categories = new Set<string>();

  for (const product of products) {
    const category = product.category.trim();
    if (category) categories.add(category);
  }

  return [...categories];
}
