export interface Product {
  id: number;
  name: string;
  category: string;
  description?: string;
  price: number;
  /**
   * HUMAN-12: preço normal, presente só quando há promoção vigente. Serve
   * exclusivamente para exibição (valor riscado no card). O preço cobrado é
   * sempre recalculado pelo backend.
   */
  originalPrice?: number;
  image: string;
}
