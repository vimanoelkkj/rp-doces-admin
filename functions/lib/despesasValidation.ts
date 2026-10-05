import {
  DESPESA_CATEGORIAS,
  DESPESA_UNIDADES,
  isDespesaCategoria,
  isDespesaUnidade,
  paraMilesimos,
  calcularValorTotalCentavos,
  type DespesaCategoria,
  type DespesaUnidade
} from "../../shared/despesas";

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITENS = 60;
const MAX_FORNECEDOR = 200;
const MAX_OBSERVACAO = 1000;
const MAX_DESCRICAO = 200;
// Teto de sanidade, não uma regra de negócio: evita erro de digitação
// virando um valor astronômico persistido como se fosse real.
const MAX_VALOR_UNITARIO_CENTAVOS = 100_000_000; // R$ 1.000.000,00
const MAX_QUANTIDADE = 1_000_000;

function isValidCalendarDate(value: string): boolean {
  if (!DATA_REGEX.test(value)) return false;
  const [ano, mes, dia] = value.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia
  );
}

export interface DespesaItemNormalizado {
  descricao: string;
  categoria: DespesaCategoria;
  quantidadeMilesimos: number;
  unidade: DespesaUnidade;
  valorUnitarioCentavos: number;
  valorTotalCentavos: number;
}

export type ValidarItensResultado =
  { ok: true; itens: DespesaItemNormalizado[] } | { ok: false; erro: string };

// Autoridade única de validação + cálculo de item: o total nunca vem do
// cliente, sempre é derivado aqui de quantidade × valor unitário.
export function validarItens(raw: unknown): ValidarItensResultado {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, erro: "A despesa precisa ter ao menos um item" };
  }
  if (raw.length > MAX_ITENS) {
    return { ok: false, erro: `Máximo de ${MAX_ITENS} itens por despesa` };
  }

  const itens: DespesaItemNormalizado[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, erro: "Item de despesa inválido" };
    }
    const {
      descricao: descricaoRaw,
      categoria,
      quantidade,
      unidade,
      valorUnitarioCentavos
    } = item as Record<string, unknown>;

    const descricao = typeof descricaoRaw === "string" ? descricaoRaw.trim() : "";
    if (!descricao || descricao.length > MAX_DESCRICAO) {
      return { ok: false, erro: "Descrição do item é obrigatória (até 200 caracteres)" };
    }
    if (!isDespesaCategoria(categoria)) {
      return {
        ok: false,
        erro: `Categoria inválida. Use uma de: ${DESPESA_CATEGORIAS.join(", ")}`
      };
    }
    if (!isDespesaUnidade(unidade)) {
      return { ok: false, erro: `Unidade inválida. Use uma de: ${DESPESA_UNIDADES.join(", ")}` };
    }
    if (
      typeof quantidade !== "number" ||
      !Number.isFinite(quantidade) ||
      quantidade <= 0 ||
      quantidade > MAX_QUANTIDADE
    ) {
      return { ok: false, erro: "Quantidade deve ser um número maior que zero" };
    }
    const quantidadeMilesimos = paraMilesimos(quantidade);
    if (!Number.isSafeInteger(quantidadeMilesimos) || quantidadeMilesimos <= 0) {
      return { ok: false, erro: "Quantidade inválida" };
    }
    if (
      typeof valorUnitarioCentavos !== "number" ||
      !Number.isFinite(valorUnitarioCentavos) ||
      valorUnitarioCentavos <= 0 ||
      valorUnitarioCentavos > MAX_VALOR_UNITARIO_CENTAVOS
    ) {
      return { ok: false, erro: "Valor unitário deve ser maior que zero" };
    }
    // Até 3 casas abaixo do centavo = até 5 casas decimais em reais.
    // A coluna SQLite tem afinidade INTEGER, mas armazena REAL quando o valor
    // não é inteiro; os totais continuam sempre persistidos em centavos inteiros.
    const valorUnitarioMilicentavos = Math.round(valorUnitarioCentavos * 1000);
    if (
      !Number.isSafeInteger(valorUnitarioMilicentavos) ||
      Math.abs(valorUnitarioCentavos * 1000 - valorUnitarioMilicentavos) > 1e-6
    ) {
      return { ok: false, erro: "Valor unitário aceita no máximo 5 casas decimais em reais" };
    }

    const valorTotalCentavos = calcularValorTotalCentavos(
      quantidadeMilesimos,
      valorUnitarioCentavos
    );
    if (!Number.isSafeInteger(valorTotalCentavos) || valorTotalCentavos <= 0) {
      return { ok: false, erro: "Total do item inválido" };
    }

    itens.push({
      descricao,
      categoria,
      quantidadeMilesimos,
      unidade,
      valorUnitarioCentavos,
      valorTotalCentavos
    });
  }

  return { ok: true, itens };
}

export interface CabecalhoDespesaNormalizado {
  fornecedor: string;
  dataCompetencia: string;
  observacao: string;
}

export type ValidarCabecalhoResultado =
  { ok: true; cabecalho: CabecalhoDespesaNormalizado } | { ok: false; erro: string };

export function validarCabecalho(body: Record<string, unknown>): ValidarCabecalhoResultado {
  const fornecedor = typeof body.fornecedor === "string" ? body.fornecedor.trim() : "";
  if (fornecedor.length > MAX_FORNECEDOR) {
    return { ok: false, erro: "Fornecedor muito longo" };
  }
  const dataCompetencia =
    typeof body.dataCompetencia === "string" ? body.dataCompetencia.trim() : "";
  if (!isValidCalendarDate(dataCompetencia)) {
    return { ok: false, erro: "Data da compra inválida (esperado YYYY-MM-DD)" };
  }
  const observacao = typeof body.observacao === "string" ? body.observacao.trim() : "";
  if (observacao.length > MAX_OBSERVACAO) {
    return { ok: false, erro: "Observação muito longa" };
  }
  return { ok: true, cabecalho: { fornecedor, dataCompetencia, observacao } };
}
