/// <reference types="@cloudflare/workers-types" />

export type AcaoEstoqueCancelamento = "LIBERAR_RESERVA" | "NAO_REPOR" | "NENHUMA";

export type BloqueioCancelamento = {
  codigo: "STATUS_PEDIDO_PRONTO" | "PIX_PENDENTE";
  mensagem: string;
};

export interface ItemCancellationPreview {
  pedidoId: number;
  item: {
    id: number;
    nome: string;
    quantidade: number;
    valorCentavos: number;
    statusItem: string;
    estoqueEstado: string;
  };
  financeiro: {
    valorItemCentavos: number;
    coberturaConfirmadaCentavos: number;
    valorNaoPagoCentavos: number;
    reembolsoNecessarioCentavos: number;
  };
  pagamentos: Array<{
    pagamentoId: number;
    pagamentoAlocacaoId: number;
    metodo: string;
    valorAlocadoCentavos: number;
    valorJaReembolsadoDaAlocacaoCentavos: number;
    coberturaEfetivaCentavos: number;
    reembolsoPropostoCentavos: number;
  }>;
  estoque: {
    estadoAtual: string;
    acaoPadrao: AcaoEstoqueCancelamento;
  };
  bloqueios: BloqueioCancelamento[];
  cancelamentoExecutavel: boolean;
}

export type PreviewErrorCode =
  | "PEDIDO_NAO_ENCONTRADO"
  | "ITEM_NAO_ENCONTRADO"
  | "ITEM_FORA_DO_PEDIDO"
  | "ITEM_JA_CANCELADO"
  | "PEDIDO_ENTREGUE"
  | "PEDIDO_CANCELADO"
  | "COMANDA_ENCERRADA"
  | "CANCELAMENTO_JA_EXISTENTE"
  | "COBERTURA_INDETERMINADA";

export class ItemCancellationPreviewError extends Error {
  constructor(
    public readonly code: PreviewErrorCode,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = "ItemCancellationPreviewError";
  }
}

interface PedidoRow {
  id: number;
  status_pedido: string;
  status_comanda: string;
}

interface ItemRow {
  id: number;
  pedido_id: number;
  produto_nome: string;
  quantidade: number;
  valor_total_centavos: number;
  status_item: string;
  estoque_estado: string;
}

interface AllocationRow {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorAlocadoCentavos: number;
  valorReembolsadoCentavos: number;
}

function acaoEstoque(estado: string): AcaoEstoqueCancelamento {
  if (estado === "RESERVADO") return "LIBERAR_RESERVA";
  if (estado === "BAIXADO") return "NAO_REPOR";
  return "NENHUMA";
}

// Leitura pura. A autoridade da distribuicao e pedido_pagamento_alocacoes,
// em id ASC. Somente pagamentos PAGO entram; somente refunds REEMBOLSADO e
// explicitamente atribuidos reduzem a cobertura. Nenhuma distribuicao e
// inventada para refunds historicos sem atribuicao.
export async function getItemCancellationPreview(
  db: D1Database,
  pedidoId: number,
  itemId: number,
): Promise<ItemCancellationPreview> {
  const pedido = await db.prepare(
    `SELECT id, status_pedido, status_comanda FROM pedidos WHERE id = ? LIMIT 1`,
  ).bind(pedidoId).first<PedidoRow>();
  if (!pedido) {
    throw new ItemCancellationPreviewError(
      "PEDIDO_NAO_ENCONTRADO",
      "Pedido não encontrado",
      404,
    );
  }

  const item = await db.prepare(
    `SELECT id, pedido_id, produto_nome, quantidade, valor_total_centavos,
            status_item, estoque_estado
     FROM pedido_itens WHERE id = ? LIMIT 1`,
  ).bind(itemId).first<ItemRow>();
  if (!item) {
    throw new ItemCancellationPreviewError(
      "ITEM_NAO_ENCONTRADO",
      "Item não encontrado",
      404,
    );
  }
  if (Number(item.pedido_id) !== pedidoId) {
    throw new ItemCancellationPreviewError(
      "ITEM_FORA_DO_PEDIDO",
      "O item informado não pertence a este pedido",
    );
  }
  if (item.status_item === "CANCELADO") {
    throw new ItemCancellationPreviewError(
      "ITEM_JA_CANCELADO",
      "Este item já está cancelado",
    );
  }
  if (pedido.status_pedido === "ENTREGUE") {
    throw new ItemCancellationPreviewError(
      "PEDIDO_ENTREGUE",
      "Itens de pedidos entregues não podem ser cancelados",
    );
  }
  if (pedido.status_pedido === "CANCELADO") {
    throw new ItemCancellationPreviewError(
      "PEDIDO_CANCELADO",
      "O pedido já está cancelado",
    );
  }
  if (pedido.status_comanda === "ENCERRADA") {
    throw new ItemCancellationPreviewError(
      "COMANDA_ENCERRADA",
      "A comanda está encerrada",
    );
  }

  const cancelamentoExistente = await db.prepare(
    `SELECT 1 FROM pedido_item_cancelamentos
     WHERE pedido_item_id = ? AND status <> 'FALHOU' LIMIT 1`,
  ).bind(itemId).first();
  if (cancelamentoExistente) {
    throw new ItemCancellationPreviewError(
      "CANCELAMENTO_JA_EXISTENTE",
      "Já existe um cancelamento associado a este item",
    );
  }

  // Um refund confirmado so e determinavel quando 100% do seu valor aponta
  // para alocacoes reais. Qualquer diferenca e historia legada que nao pode
  // ser adivinhada com seguranca para item algum do pedido.
  const refundLegado = await db.prepare(
    `SELECT r.id
     FROM pedido_reembolsos r
     LEFT JOIN pedido_reembolso_alocacoes ra ON ra.reembolso_id = r.id
     WHERE r.pedido_id = ? AND r.status = 'REEMBOLSADO'
     GROUP BY r.id, r.valor_centavos
     HAVING COALESCE(SUM(ra.valor_centavos), 0) <> r.valor_centavos
     LIMIT 1`,
  ).bind(pedidoId).first<{ id: number }>();
  if (refundLegado) {
    throw new ItemCancellationPreviewError(
      "COBERTURA_INDETERMINADA",
      "Há um reembolso histórico sem atribuição completa aos itens. Não é possível determinar com segurança quanto deste item continua pago.",
    );
  }

  const { results: alocacoes } = await db.prepare(
    `SELECT
       pp.id AS pagamentoId,
       a.id AS pagamentoAlocacaoId,
       pp.metodo AS metodo,
       a.valor_centavos AS valorAlocadoCentavos,
       COALESCE(SUM(CASE WHEN r.status = 'REEMBOLSADO' THEN ra.valor_centavos ELSE 0 END), 0)
         AS valorReembolsadoCentavos
     FROM pedido_pagamento_alocacoes a
     JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
     LEFT JOIN pedido_reembolso_alocacoes ra ON ra.pagamento_alocacao_id = a.id
     LEFT JOIN pedido_reembolsos r ON r.id = ra.reembolso_id
     WHERE a.pedido_item_id = ? AND pp.pedido_id = ? AND pp.status = 'PAGO'
     GROUP BY a.id, pp.id, pp.metodo, a.valor_centavos
     ORDER BY a.id ASC, pp.id ASC`,
  ).bind(itemId, pedidoId).all<AllocationRow>();

  const valorItemCentavos = Number(item.valor_total_centavos);
  let restanteDoItem = valorItemCentavos;
  const pagamentos = alocacoes.map((row) => {
    const valorAlocado = Number(row.valorAlocadoCentavos);
    const jaReembolsado = Number(row.valorReembolsadoCentavos);
    const coberturaEfetiva = Math.max(0, valorAlocado - jaReembolsado);
    const proposto = Math.min(restanteDoItem, coberturaEfetiva);
    restanteDoItem -= proposto;
    return {
      pagamentoId: Number(row.pagamentoId),
      pagamentoAlocacaoId: Number(row.pagamentoAlocacaoId),
      metodo: row.metodo,
      valorAlocadoCentavos: valorAlocado,
      valorJaReembolsadoDaAlocacaoCentavos: jaReembolsado,
      coberturaEfetivaCentavos: coberturaEfetiva,
      reembolsoPropostoCentavos: proposto,
    };
  });
  const coberturaConfirmadaCentavos = valorItemCentavos - restanteDoItem;

  const bloqueios: BloqueioCancelamento[] = [];
  if (pedido.status_pedido === "PRONTO") {
    bloqueios.push({
      codigo: "STATUS_PEDIDO_PRONTO",
      mensagem: "O pedido está pronto. Esta etapa não reabre o fluxo de produção.",
    });
  }
  const pixPendente = await db.prepare(
    `SELECT 1 FROM pedido_pagamentos
     WHERE pedido_id = ? AND metodo = 'PIX_MP' AND status = 'PENDENTE' LIMIT 1`,
  ).bind(pedidoId).first();
  if (pixPendente) {
    bloqueios.push({
      codigo: "PIX_PENDENTE",
      mensagem: "Há uma cobrança Pix pendente para esta comanda. O cancelamento só poderá ser executado após ela ser resolvida.",
    });
  }

  return {
    pedidoId,
    item: {
      id: Number(item.id),
      nome: item.produto_nome,
      quantidade: Number(item.quantidade),
      valorCentavos: valorItemCentavos,
      statusItem: item.status_item,
      estoqueEstado: item.estoque_estado,
    },
    financeiro: {
      valorItemCentavos,
      coberturaConfirmadaCentavos,
      valorNaoPagoCentavos: restanteDoItem,
      reembolsoNecessarioCentavos: coberturaConfirmadaCentavos,
    },
    pagamentos,
    estoque: {
      estadoAtual: item.estoque_estado,
      acaoPadrao: acaoEstoque(item.estoque_estado),
    },
    bloqueios,
    cancelamentoExecutavel: bloqueios.length === 0,
  };
}
