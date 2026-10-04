import type { PromocaoEstado } from "../../../shared/promocao";
import { estadoPromocao } from "../../../shared/promocao";
import { parseBrlInputToCents } from "../../lib/brl";

export interface Categoria {
  id: string;
  nome: string;
  emoji: string;
  ativo: number;
}

// HUMAN-12: `<input type="datetime-local">` fala em horário LOCAL
// ("2026-09-20T18:30"), enquanto a coluna guarda instante em ISO UTC —
// inequívoco para os dois lados da regra compartilhada. Estas duas funções
// são o único ponto de conversão, para não espalhar ambiguidade de fuso.
export function isoParaDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const instante = Date.parse(iso);
  if (!Number.isFinite(instante)) return "";
  const local = new Date(instante - new Date(instante).getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function datetimeLocalParaIso(valor: string): string | null {
  if (!valor) return null;
  const instante = Date.parse(valor);
  if (!Number.isFinite(instante)) return null;
  return new Date(instante).toISOString();
}

export const R2_IMAGE_KEY_PATTERN = /^product-\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/i;

// Fotos enviadas pelo novo upload (R2) seguem o padrão `product-{id}-{uuid}.ext`
// e são servidas via /api/images/:key; fotos de seed antigas são arquivos
// estáticos servidos direto de /images/:nome.
export function imageUrlFor(key: string | null): string | null {
  if (!key) return null;
  return R2_IMAGE_KEY_PATTERN.test(key)
    ? `/api/images/${encodeURIComponent(key)}`
    : `/images/${key}`;
}

export function calcularPromoEstadoEHint(
  precoCentavos: number | null,
  promoPriceInput: string,
  promocao: boolean,
  promoInicio: string,
  promoFim: string
): { promoEstado: PromocaoEstado; promoHint: string } {
  const promoCentavosPreview = parseBrlInputToCents(promoPriceInput);
  const promoEstado = estadoPromocao({
    preco_centavos: precoCentavos ?? 0,
    preco_promocional_centavos: promoCentavosPreview,
    promocao_ativa: promocao ? 1 : 0,
    promocao_inicio: datetimeLocalParaIso(promoInicio),
    promocao_fim: datetimeLocalParaIso(promoFim)
  });

  const promoHint = {
    DESLIGADA: "Promoção desligada: o catálogo mostra o preço normal.",
    SEM_PRECO: "Informe o preço promocional para a promoção valer.",
    FUTURA: "Agendada: o preço promocional começa a valer na data de início.",
    VIGENTE:
      promoInicio || promoFim
        ? "Vigente agora: o catálogo já mostra o preço promocional."
        : "Vigente agora e sem prazo: vale até você desligar.",
    EXPIRADA: "Período encerrado: o catálogo voltou ao preço normal."
  }[promoEstado];

  return { promoEstado, promoHint };
}

export interface ValidacaoProdutoInput {
  price: string;
  stock: string;
  promocao: boolean;
  promoPrice: string;
  promoInicio: string;
  promoFim: string;
}

export interface ProdutoValido {
  precoCentavos: number;
  estoque: number;
  promoCentavos: number | null;
  promoInicioIso: string | null;
  promoFimIso: string | null;
}

export type ValidacaoProdutoResultado =
  { sucesso: true; dados: ProdutoValido } | { sucesso: false; erro: string };

export function validarProdutoForm(input: ValidacaoProdutoInput): ValidacaoProdutoResultado {
  const precoCentavos = parseBrlInputToCents(input.price);
  if (precoCentavos === null || precoCentavos < 1) {
    return { sucesso: false, erro: "Informe um preço válido." };
  }
  if (!/^\d+$/.test(input.stock) || !Number.isSafeInteger(Number(input.stock))) {
    return { sucesso: false, erro: "Informe um estoque inteiro válido." };
  }
  const estoque = Number(input.stock);

  const promoCentavos = input.promocao ? parseBrlInputToCents(input.promoPrice) : null;
  const promoInicioIso = datetimeLocalParaIso(input.promoInicio);
  const promoFimIso = datetimeLocalParaIso(input.promoFim);

  if (input.promocao) {
    if (promoCentavos === null || promoCentavos < 1) {
      return { sucesso: false, erro: "Informe o preço promocional para ativar a promoção." };
    }
    if (promoCentavos >= precoCentavos) {
      return { sucesso: false, erro: "O preço promocional precisa ser menor que o preço normal." };
    }
    if (input.promoInicio && promoInicioIso === null) {
      return { sucesso: false, erro: "Data de início da promoção inválida." };
    }
    if (input.promoFim && promoFimIso === null) {
      return { sucesso: false, erro: "Data de término da promoção inválida." };
    }
    if (
      promoInicioIso !== null &&
      promoFimIso !== null &&
      Date.parse(promoFimIso) <= Date.parse(promoInicioIso)
    ) {
      return { sucesso: false, erro: "O término da promoção precisa ser depois do início." };
    }
  }

  return {
    sucesso: true,
    dados: {
      precoCentavos,
      estoque,
      promoCentavos,
      promoInicioIso,
      promoFimIso
    }
  };
}
