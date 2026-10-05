import type { DespesaCategoria } from "../../../shared/despesas";
import type { Periodo } from "./formatarDespesas";

export interface DespesaListItem {
  id: number;
  fornecedor: string;
  dataCompetencia: string;
  status: "ATIVA" | "CANCELADA";
  totalCentavos: number;
  itemCount: number;
}

export interface CategoriaResumo {
  categoria: DespesaCategoria;
  valorCentavos: number;
  percentual: number;
}

export interface ItemRankingResumo {
  descricao: string;
  valorCentavos: number;
}

export interface ResultadoFinanceiro {
  faturamentoLiquidoCentavos: number;
  despesasCentavos: number;
  lucroEstimadoCentavos: number;
  margemEstimada: number | null;
}

export interface DespesasResponse {
  despesas: DespesaListItem[];
  resumo: {
    totalCentavos: number;
    porCategoria: CategoriaResumo[];
    rankingItens: ItemRankingResumo[];
  };
  resultadoFinanceiro: ResultadoFinanceiro;
}

export type StatusFiltro = "TODOS" | "ATIVA" | "CANCELADA";

// Record exaustivo: se a união ganhar um status, o compilador exige o rótulo dele aqui.
export const STATUS_LABEL: Record<StatusFiltro, string> = {
  TODOS: "Todos",
  ATIVA: "Ativa",
  CANCELADA: "Cancelada"
};

export const STATUS_OPCOES: StatusFiltro[] = ["TODOS", "ATIVA", "CANCELADA"];

export const PERIODOS: { valor: Periodo; label: string }[] = [
  { valor: "HOJE", label: "Hoje" },
  { valor: "7DIAS", label: "7 dias" },
  { valor: "ESTE_MES", label: "Este mês" },
  { valor: "MES_PASSADO", label: "Mês passado" },
  { valor: "PERSONALIZADO", label: "Personalizado" }
];

export type ModalState =
  null | { modo: "criar" } | { modo: "ver"; id: number } | { modo: "editar"; id: number };
