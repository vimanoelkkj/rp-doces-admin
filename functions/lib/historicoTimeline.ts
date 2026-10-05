import type { PedidoAnulacao } from "../../shared/pedidoAnulacao";

type EventoTipo =
  | "PEDIDO_ANULADO"
  | "ITEM_ADICIONADO"
  | "TROCA_SOLICITADA"
  | "TROCA_CONCLUIDA"
  | "CANCELAMENTO_SOLICITADO"
  | "CANCELAMENTO_CONCLUIDO"
  | "PAGAMENTO"
  | "REEMBOLSO";

interface ItemRef {
  id: number | null;
  nome: string;
  quantidade?: number;
  valorCentavos?: number;
  estoqueEstado?: string | null;
}

export interface HistoricoEvento {
  id: string;
  tipo: EventoTipo;
  data: string;
  titulo: string;
  status?: string | null;
  item?: ItemRef;
  itemOrigem?: ItemRef;
  itemDestino?: ItemRef;
  valorOrigemCentavos?: number;
  valorDestinoCentavos?: number;
  diferencaCentavos?: number;
  tipoDiferenca?: string;
  metodo?: string | null;
  metodosReembolso?: string[];
  valorCentavos?: number;
  valorReembolsoCentavos?: number;
  estoqueAcao?: string | null;
  motivo?: string;
  usuario?: string | null;
  referenciaId?: number;
}

export interface ItemAdicionadoRow {
  id: number;
  produto_nome: string;
  quantidade: number;
  valor_total_centavos: number;
  data: string;
  usuario_nome: string | null;
}

export interface TrocaRow {
  id: number;
  item_origem_id: number;
  item_destino_id: number | null;
  produto_destino_id: number;
  quantidade_destino: number;
  valor_origem_centavos: number;
  valor_destino_centavos: number;
  diferenca_centavos: number;
  tipo_diferenca: string;
  estoque_acao_origem: string;
  status: string;
  motivo: string;
  criado_em: string;
  concluido_em: string | null;
  origem_nome: string;
  origem_estoque_estado: string;
  destino_nome: string | null;
  destino_estoque_estado: string | null;
  produto_destino_nome: string;
  usuario_nome: string | null;
}

export interface CancelamentoRow {
  id: number;
  pedido_item_id: number;
  status: string;
  estoque_acao: string;
  motivo: string;
  valor_item_centavos: number;
  criado_em: string;
  concluido_em: string | null;
  item_nome: string;
  item_estoque_estado: string;
  usuario_nome: string | null;
}

export interface RefundConfirmadoRow {
  ref_id: number;
  metodo: string;
  valor: number;
}

export interface PagamentoRow {
  id: number;
  metodo: string;
  valor_centavos: number;
  pago_em: string;
  usuario_nome: string | null;
}

export interface ReembolsoRow {
  id: number;
  metodo: string;
  valor_centavos: number;
  motivo: string;
  data: string;
  usuario_nome: string | null;
}

interface RefundGrupo {
  metodos: string[];
  total: number;
}

export interface HistoricoTimelineDados {
  itensAdicionados: ItemAdicionadoRow[];
  trocas: TrocaRow[];
  cancelamentos: CancelamentoRow[];
  refundsCancelamento: RefundConfirmadoRow[];
  refundsTroca: RefundConfirmadoRow[];
  pagamentos: PagamentoRow[];
  reembolsos: ReembolsoRow[];
  anulacao: PedidoAnulacao | null;
}

function agruparRefunds(rows: RefundConfirmadoRow[]): Map<number, RefundGrupo> {
  const mapa = new Map<number, RefundGrupo>();
  for (const row of rows) {
    const atual = mapa.get(row.ref_id) ?? { metodos: [], total: 0 };
    atual.metodos.push(row.metodo);
    atual.total += Number(row.valor);
    mapa.set(row.ref_id, atual);
  }
  return mapa;
}

function montarEventosTroca(
  rows: TrocaRow[],
  refundsPorTroca: Map<number, RefundGrupo>
): HistoricoEvento[] {
  const eventos: HistoricoEvento[] = [];
  for (const row of rows) {
    const destinoNome = row.destino_nome ?? row.produto_destino_nome;
    const itemOrigem: ItemRef = {
      id: row.item_origem_id,
      nome: row.origem_nome,
      valorCentavos: Number(row.valor_origem_centavos),
      estoqueEstado: row.origem_estoque_estado
    };
    const itemDestino: ItemRef = {
      id: row.item_destino_id,
      nome: destinoNome,
      quantidade: Number(row.quantidade_destino),
      valorCentavos: Number(row.valor_destino_centavos),
      estoqueEstado: row.destino_estoque_estado
    };
    const refundTroca = refundsPorTroca.get(row.id);
    const base = {
      itemOrigem,
      itemDestino,
      valorOrigemCentavos: Number(row.valor_origem_centavos),
      valorDestinoCentavos: Number(row.valor_destino_centavos),
      diferencaCentavos: Number(row.diferenca_centavos),
      tipoDiferenca: row.tipo_diferenca,
      estoqueAcao: row.estoque_acao_origem,
      motivo: row.motivo || undefined,
      usuario: row.usuario_nome,
      referenciaId: row.item_origem_id,
      ...(refundTroca
        ? {
            metodosReembolso: Array.from(new Set(refundTroca.metodos)),
            valorReembolsoCentavos: refundTroca.total
          }
        : {})
    };
    eventos.push({
      id: `troca-solicitada-${row.id}`,
      tipo: "TROCA_SOLICITADA",
      data: row.criado_em,
      titulo: "Troca solicitada",
      status: row.status === "CONCLUIDA" ? null : row.status,
      ...base
    });
    if (row.status === "CONCLUIDA" && row.concluido_em) {
      eventos.push({
        id: `troca-concluida-${row.id}`,
        tipo: "TROCA_CONCLUIDA",
        data: row.concluido_em,
        titulo: "Troca concluída",
        status: "CONCLUIDA",
        ...base
      });
    }
  }

  return eventos;
}

function montarEventosCancelamento(
  rows: CancelamentoRow[],
  refundsPorCancelamento: Map<number, RefundGrupo>
): HistoricoEvento[] {
  const eventos: HistoricoEvento[] = [];
  for (const row of rows) {
    const refund = refundsPorCancelamento.get(row.id);
    const item: ItemRef = {
      id: row.pedido_item_id,
      nome: row.item_nome,
      valorCentavos: Number(row.valor_item_centavos),
      estoqueEstado: row.item_estoque_estado
    };
    const base = {
      item,
      estoqueAcao: row.estoque_acao,
      motivo: row.motivo || undefined,
      usuario: row.usuario_nome,
      referenciaId: row.pedido_item_id,
      ...(refund
        ? {
            metodosReembolso: Array.from(new Set(refund.metodos)),
            valorReembolsoCentavos: refund.total
          }
        : {})
    };
    eventos.push({
      id: `cancelamento-solicitado-${row.id}`,
      tipo: "CANCELAMENTO_SOLICITADO",
      data: row.criado_em,
      titulo: "Cancelamento solicitado",
      status: row.status === "CONCLUIDO" ? null : row.status,
      ...base
    });
    if (row.status === "CONCLUIDO" && row.concluido_em) {
      eventos.push({
        id: `cancelamento-concluido-${row.id}`,
        tipo: "CANCELAMENTO_CONCLUIDO",
        data: row.concluido_em,
        titulo: "Cancelamento concluído",
        status: "CONCLUIDO",
        ...base
      });
    }
  }

  return eventos;
}

export function montarHistoricoTimeline({
  itensAdicionados,
  trocas,
  cancelamentos,
  refundsCancelamento,
  refundsTroca,
  pagamentos,
  reembolsos,
  anulacao
}: HistoricoTimelineDados): HistoricoEvento[] {
  const refundsPorCancelamento = agruparRefunds(refundsCancelamento);
  const refundsPorTroca = agruparRefunds(refundsTroca);

  const eventos: HistoricoEvento[] = [];
  if (anulacao)
    eventos.push({
      id: `anulacao-${anulacao.id}`,
      tipo: "PEDIDO_ANULADO",
      data: anulacao.criado_em,
      titulo: "Pedido anulado",
      status: "ANULADO",
      motivo: anulacao.motivo,
      usuario: anulacao.usuario_nome,
      estoqueAcao: anulacao.estoque_acao,
      valorCentavos: -anulacao.liquido_original_centavos
    });

  for (const row of itensAdicionados) {
    eventos.push({
      id: `item-${row.id}`,
      tipo: "ITEM_ADICIONADO",
      data: row.data,
      titulo: `${row.produto_nome} adicionado`,
      item: {
        id: row.id,
        nome: row.produto_nome,
        quantidade: Number(row.quantidade),
        valorCentavos: Number(row.valor_total_centavos)
      },
      usuario: row.usuario_nome,
      referenciaId: row.id
    });
  }

  for (const evento of montarEventosTroca(trocas, refundsPorTroca)) eventos.push(evento);

  for (const evento of montarEventosCancelamento(cancelamentos, refundsPorCancelamento))
    eventos.push(evento);

  for (const row of pagamentos) {
    eventos.push({
      id: `pagamento-${row.id}`,
      tipo: "PAGAMENTO",
      data: row.pago_em,
      titulo: "Pagamento registrado",
      metodo: row.metodo,
      valorCentavos: Number(row.valor_centavos),
      usuario: row.usuario_nome,
      referenciaId: row.id
    });
  }

  for (const row of reembolsos) {
    eventos.push({
      id: `reembolso-${row.id}`,
      tipo: "REEMBOLSO",
      data: row.data,
      titulo: "Reembolso confirmado",
      metodo: row.metodo,
      valorReembolsoCentavos: Number(row.valor_centavos),
      motivo: row.motivo || undefined,
      usuario: row.usuario_nome,
      referenciaId: row.id
    });
  }

  eventos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

  return eventos;
}
