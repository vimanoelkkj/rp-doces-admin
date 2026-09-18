// HUMAN-12 — validação e normalização dos campos de promoção do produto.
//
// Compartilhado entre criar (POST) e editar (PUT) para que as duas rotas não
// possam divergir sobre o que é uma promoção válida.
//
// Antes, o admin só persistia `promocao_ativa`; `preco_promocional_centavos`,
// `promocao_inicio` e `promocao_fim` existiam no schema desde a migration
// 0001/0005 e nunca eram escritos. Nenhuma migration nova é necessária.

import { parseInstantePromocao } from "../../shared/promocao";

export interface ProdutoInput {
  nome?: string;
  categoria?: string;
  descricao?: string;
  precoCentavos?: number;
  estoque?: number;
  emoji?: string;
  ativo?: boolean;
  disponivel?: boolean;
  destaque?: boolean;
  promocaoAtiva?: boolean;
  precoPromocionalCentavos?: number | null;
  promocaoInicio?: string | null;
  promocaoFim?: string | null;
}

export interface PromocaoNormalizada {
  promocaoAtiva: 0 | 1;
  precoPromocionalCentavos: number | null;
  promocaoInicio: string | null;
  promocaoFim: string | null;
}

function textoOuNulo(valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto ? texto : null;
}

/**
 * Regras de validação, todas necessárias para que a regra de vigência em
 * `shared/promocao.ts` nunca receba um dado que ela teria de adivinhar:
 *
 * - promoção ligada exige preço promocional utilizável;
 * - preço promocional precisa ser MENOR que o preço normal (senão não é
 *   promoção — seria um aumento disfarçado);
 * - datas são opcionais (o estado "sem agendamento" é legítimo), mas quando
 *   presentes precisam ser instantes legíveis;
 * - fim precisa ser depois do início.
 *
 * Uma promoção desligada não precisa de nada disso: o preço/datas guardados
 * ficam preservados para poder religar sem redigitar.
 */
export function validarProdutoPromocao(body: ProdutoInput): string | null {
  if (!body.promocaoAtiva) return null;

  const promocional = body.precoPromocionalCentavos;
  if (!Number.isInteger(promocional) || (promocional as number) < 1) {
    return "Informe o preço promocional para ativar a promoção";
  }
  if (
    Number.isInteger(body.precoCentavos) &&
    (promocional as number) >= (body.precoCentavos as number)
  ) {
    return "O preço promocional precisa ser menor que o preço normal";
  }

  const inicioTexto = textoOuNulo(body.promocaoInicio);
  const fimTexto = textoOuNulo(body.promocaoFim);
  const inicio = parseInstantePromocao(inicioTexto);
  const fim = parseInstantePromocao(fimTexto);

  if (inicioTexto !== null && inicio === null) {
    return "Data de início da promoção inválida";
  }
  if (fimTexto !== null && fim === null) {
    return "Data de término da promoção inválida";
  }
  if (inicio !== null && fim !== null && fim <= inicio) {
    return "O término da promoção precisa ser depois do início";
  }
  return null;
}

export function normalizarPromocao(body: ProdutoInput): PromocaoNormalizada {
  const ativa = body.promocaoAtiva ? 1 : 0;
  // Com a promoção desligada, os campos são preservados exatamente como
  // vieram — desligar não apaga o que a operadora já configurou, e a regra
  // de vigência ignora tudo enquanto `promocao_ativa` for 0.
  return {
    promocaoAtiva: ativa,
    precoPromocionalCentavos:
      Number.isInteger(body.precoPromocionalCentavos) &&
      (body.precoPromocionalCentavos as number) > 0
        ? (body.precoPromocionalCentavos as number)
        : null,
    promocaoInicio: textoOuNulo(body.promocaoInicio),
    promocaoFim: textoOuNulo(body.promocaoFim),
  };
}
