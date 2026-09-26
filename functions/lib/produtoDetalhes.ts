// Detalhes do produto exibidos no cardápio (migration 0033): peso/porção,
// ingredientes e alérgenos. Texto livre, com trim e limites validados aqui —
// compartilhado entre criar (POST) e editar (PUT), para as duas rotas não
// divergirem. O frontend também limita, mas não é autoridade.

import { ALERGENICOS_MAX, INGREDIENTES_MAX, PESO_TEXTO_MAX } from "../../shared/produtoDetalhes";

export interface ProdutoDetalhesInput {
  pesoTexto?: unknown;
  ingredientes?: unknown;
  alergenicos?: unknown;
}

// `null` = campo ausente no payload (o PUT preserva o valor atual; o POST
// grava vazio).
export interface ProdutoDetalhesNormalizados {
  pesoTexto: string | null;
  ingredientes: string | null;
  alergenicos: string | null;
}

const CAMPOS = [
  { chave: "pesoTexto", rotulo: "Peso / porção", max: PESO_TEXTO_MAX },
  { chave: "ingredientes", rotulo: "Ingredientes", max: INGREDIENTES_MAX },
  { chave: "alergenicos", rotulo: "Alérgenos", max: ALERGENICOS_MAX },
] as const;

export function validarDetalhesProduto(body: ProdutoDetalhesInput): string | null {
  for (const { chave, rotulo, max } of CAMPOS) {
    const valor = body[chave];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== "string") return `${rotulo} inválido`;
    if (valor.trim().length > max) return `${rotulo} muito longo (máximo ${max} caracteres)`;
  }
  return null;
}

// Chamar somente depois de validarDetalhesProduto.
export function normalizarDetalhesProduto(body: ProdutoDetalhesInput): ProdutoDetalhesNormalizados {
  const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : null);
  return {
    pesoTexto: texto(body.pesoTexto),
    ingredientes: texto(body.ingredientes),
    alergenicos: texto(body.alergenicos),
  };
}
