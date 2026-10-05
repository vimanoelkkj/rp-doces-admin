import type { DespesaCategoria, DespesaUnidade } from "../../../shared/despesas";
import { centavosParaValorInput, parseQuantidade, parseValorReais } from "./formatarDespesas";

export interface DespesaItemView {
  id: number;
  descricao: string;
  categoria: DespesaCategoria;
  quantidade: number;
  unidade: DespesaUnidade;
  valorUnitarioCentavos: number;
  valorTotalCentavos: number;
}

export interface DespesaView {
  id: number;
  fornecedor: string;
  dataCompetencia: string;
  observacao: string;
  status: "ATIVA" | "CANCELADA";
  totalCentavos: number;
  itens: DespesaItemView[];
}

export interface ItemForm {
  key: string;
  descricao: string;
  categoria: DespesaCategoria;
  quantidade: string;
  unidade: DespesaUnidade;
  valorUnitario: string;
}

export type Modo = "criar" | "ver" | "editar";

export interface ValidacaoItemPayload {
  descricao: string;
  categoria: DespesaCategoria;
  quantidade: number;
  unidade: DespesaUnidade;
  valorUnitarioCentavos: number;
}

export interface FormularioPayload {
  fornecedor: string;
  dataCompetencia: string;
  observacao: string;
  itens: ValidacaoItemPayload[];
}

export type ValidacaoResultado =
  { ok: true; payload: FormularioPayload } | { ok: false; erro: string };

let proximaKey = 0;

export function novoItemVazio(): ItemForm {
  proximaKey += 1;
  return {
    key: `novo-${proximaKey}`,
    descricao: "",
    categoria: "INGREDIENTES",
    quantidade: "",
    unidade: "UN",
    valorUnitario: ""
  };
}

export function itensDaDespesa(despesa: DespesaView): ItemForm[] {
  return despesa.itens.map(item => {
    proximaKey += 1;
    return {
      key: `item-${item.id}-${proximaKey}`,
      descricao: item.descricao,
      categoria: item.categoria,
      quantidade: String(item.quantidade).replace(".", ","),
      unidade: item.unidade,
      valorUnitario: centavosParaValorInput(item.valorUnitarioCentavos)
    };
  });
}

export function subtotalItem(item: ItemForm): number | null {
  const quantidade = parseQuantidade(item.quantidade);
  const valorUnitarioCentavos = parseValorReais(item.valorUnitario);
  if (quantidade === null || valorUnitarioCentavos === null) return null;
  return Math.round(quantidade * valorUnitarioCentavos);
}

export function validarFormulario(
  dataCompetencia: string,
  fornecedor: string,
  observacao: string,
  itens: ItemForm[]
): ValidacaoResultado {
  if (!dataCompetencia) return { ok: false, erro: "Informe a data da compra." };
  if (itens.length === 0) return { ok: false, erro: "Adicione ao menos um item." };

  const itensPayload: ValidacaoItemPayload[] = [];
  for (const item of itens) {
    if (!item.descricao.trim()) return { ok: false, erro: "Todo item precisa de uma descrição." };
    const quantidade = parseQuantidade(item.quantidade);
    if (quantidade === null)
      return { ok: false, erro: `Quantidade inválida em "${item.descricao || "item"}".` };
    const valorUnitarioCentavos = parseValorReais(item.valorUnitario);
    if (valorUnitarioCentavos === null) {
      return { ok: false, erro: `Valor unitário inválido em "${item.descricao || "item"}".` };
    }
    itensPayload.push({
      descricao: item.descricao.trim(),
      categoria: item.categoria,
      quantidade,
      unidade: item.unidade,
      valorUnitarioCentavos
    });
  }

  return {
    ok: true,
    payload: {
      fornecedor: fornecedor.trim(),
      dataCompetencia,
      observacao: observacao.trim(),
      itens: itensPayload
    }
  };
}
