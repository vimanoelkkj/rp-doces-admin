import { precoVigenteCentavos, type PromocaoCampos } from "../../shared/promocao";

export interface ProdutoRow extends PromocaoCampos {
  id: number;
  nome: string;
  disponivel: number;
  estoque: number;
  estoque_reservado: number;
}

// HUMAN-12: a regra de vigência vive em `shared/promocao.ts`, importada
// também pelo catálogo público — admin e catálogo não podem divergir.
// Esta função continua sendo o ponto por onde todo write-path autoritativo
// (checkout do site e criação manual do admin) resolve preço.
export function precoAtualCentavos(p: ProdutoRow, now = Date.now()): number {
  return precoVigenteCentavos(p, now);
}
