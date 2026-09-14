export interface ProdutoRow {
  id: number;
  nome: string;
  preco_centavos: number;
  preco_promocional_centavos: number | null;
  promocao_inicio: string | null;
  promocao_fim: string | null;
  disponivel: number;
  estoque: number;
  estoque_reservado: number;
}

export function precoAtualCentavos(p: ProdutoRow, now = Date.now()): number {
  if (p.preco_promocional_centavos == null) return p.preco_centavos;
  if (p.promocao_inicio && now < Date.parse(p.promocao_inicio)) {
    return p.preco_centavos;
  }
  if (p.promocao_fim && now > Date.parse(p.promocao_fim)) {
    return p.preco_centavos;
  }
  return p.preco_promocional_centavos;
}
