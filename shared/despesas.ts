// Vocabulário centralizado de despesas itemizadas — categoria e unidade são
// usados tanto na validação do servidor (functions/lib/despesas.ts) quanto
// na exibição do admin (src/admin/Despesas), para nunca haver duas listas
// de labels divergentes.

export const DESPESA_CATEGORIAS = [
  "INGREDIENTES",
  "EMBALAGENS",
  "ENTREGA_TRANSPORTE",
  "TAXAS",
  "MARKETING",
  "EQUIPAMENTOS",
  "MANUTENCAO",
  "SERVICOS",
  "OUTROS",
] as const;

export type DespesaCategoria = (typeof DESPESA_CATEGORIAS)[number];

export const DESPESA_CATEGORIA_LABEL: Record<DespesaCategoria, string> = {
  INGREDIENTES: "Ingredientes",
  EMBALAGENS: "Embalagens",
  ENTREGA_TRANSPORTE: "Entrega / Transporte",
  TAXAS: "Taxas",
  MARKETING: "Marketing",
  EQUIPAMENTOS: "Equipamentos",
  MANUTENCAO: "Manutenção",
  SERVICOS: "Serviços",
  OUTROS: "Outros",
};

export function isDespesaCategoria(value: unknown): value is DespesaCategoria {
  return typeof value === "string" && (DESPESA_CATEGORIAS as readonly string[]).includes(value);
}

export const DESPESA_UNIDADES = [
  "UN",
  "KG",
  "G",
  "L",
  "ML",
  "PACOTE",
  "CAIXA",
  "BANDEJA",
  "OUTRO",
] as const;

export type DespesaUnidade = (typeof DESPESA_UNIDADES)[number];

export const DESPESA_UNIDADE_LABEL: Record<DespesaUnidade, string> = {
  UN: "un",
  KG: "kg",
  G: "g",
  L: "L",
  ML: "ml",
  PACOTE: "pacote",
  CAIXA: "caixa",
  BANDEJA: "bandeja",
  OUTRO: "outro",
};

export function isDespesaUnidade(value: unknown): value is DespesaUnidade {
  return typeof value === "string" && (DESPESA_UNIDADES as readonly string[]).includes(value);
}

export const DESPESA_STATUS = ["ATIVA", "CANCELADA"] as const;
export type DespesaStatus = (typeof DESPESA_STATUS)[number];

export const DESPESA_STATUS_LABEL: Record<DespesaStatus, string> = {
  ATIVA: "Ativa",
  CANCELADA: "Cancelada",
};

// Quantidade nunca em float: 1 unidade = 1000 "milésimos", permitindo até 3
// casas decimais (1,5 kg = 1500; 0,5 kg = 500; 30 un = 30000) sem os erros
// de arredondamento de ponto flutuante que uma coluna REAL teria.
export const QUANTIDADE_MILESIMOS_POR_UNIDADE = 1000;

// O valor unitário pode precisar de frações de centavo (ex.: R$ 232,61 /
// 200 un = R$ 1,16305 por unidade). Mantemos até 3 casas abaixo do centavo,
// equivalentes a 5 casas decimais em reais, sem perder o total em centavos.
export const MILICENTAVOS_POR_CENTAVO = 1000;

// Converte a quantidade decimal digitada pelo operador (ex.: 1.5) para o
// inteiro persistido. Arredonda para o milésimo mais próximo — 3 casas
// decimais é precisão mais que suficiente para compras do negócio.
export function paraMilesimos(quantidade: number): number {
  return Math.round(quantidade * QUANTIDADE_MILESIMOS_POR_UNIDADE);
}

export function deMilesimos(quantidadeMilesimos: number): number {
  return quantidadeMilesimos / QUANTIDADE_MILESIMOS_POR_UNIDADE;
}

// Total do item = quantidade × valor unitário, sempre derivado no servidor,
// nunca aceito do cliente. O valor unitário chega em centavos e pode ter até
// 3 casas fracionárias; convertemos para milicentavos antes da multiplicação.
// BigInt evita perda de precisão intermediária em quantidades/valores altos.
export function calcularValorTotalCentavos(
  quantidadeMilesimos: number,
  valorUnitarioCentavos: number,
): number {
  const valorUnitarioMilicentavos = Math.round(valorUnitarioCentavos * MILICENTAVOS_POR_CENTAVO);
  const divisor = BigInt(QUANTIDADE_MILESIMOS_POR_UNIDADE * MILICENTAVOS_POR_CENTAVO);
  const numerador = BigInt(quantidadeMilesimos) * BigInt(valorUnitarioMilicentavos);
  return Number((numerador + divisor / 2n) / divisor);
}
