export interface Product {
  id: number;
  name: string;
  /** Nome de exibição da categoria (rótulo), pode mudar sem afetar identidade. */
  category: string;
  /**
   * Identificador canônico e estável da categoria (`categorias.id` no
   * backend). Filtro e agrupamento devem usar este campo, nunca o texto de
   * exibição — o nome é só rótulo.
   */
  categorySlug: string;
  description?: string;
  /** Peso/porção em texto livre ("220 g", "1 unidade"). Ausente quando vazio. */
  weightText?: string;
  /** Lista de ingredientes. Ausente quando vazia. */
  ingredients?: string;
  /** Alérgenos. Ausente quando vazio. */
  allergens?: string;
  price: number;
  /**
   * HUMAN-12: preço normal, presente só quando há promoção vigente. Serve
   * exclusivamente para exibição (valor riscado no card). O preço cobrado é
   * sempre recalculado pelo backend.
   */
  originalPrice?: number;
  image: string;
  /** Disponibilidade líquida para venda imediata: max(0, estoque - estoque_reservado). */
  disponibilidade: number;
}
