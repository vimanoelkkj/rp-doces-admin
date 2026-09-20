/// <reference types="@cloudflare/workers-types" />

import { BRUTO_PAGO_SQL, REEMBOLSADO_SQL, LIQUIDO_SQL } from "./pedidoFinanceiroSql";
import { preparePedidoPhysicalProjection } from "./stock";

import { getPedidoAnulacao, type PedidoAnulacao } from "./pedidoValido";

export const ANULACAO_ERROS: Record<string, string> = {
  ANULACAO_MP_RECEBIDO: "Há recebimento Mercado Pago ainda não estornado. Trate o pagamento pelo fluxo de estorno existente antes de excluir.",
  ANULACAO_MP_PENDENTE: "Há cobrança Mercado Pago pendente, expirada sem confirmação definitiva ou inconclusiva. Resolva a cobrança antes de excluir.",
  ANULACAO_REFUND_PENDENTE: "Há um estorno em processamento ou inconclusivo. Aguarde sua resolução antes de excluir.",
  ANULACAO_LEGADO_AMBIGUO: "O pagamento histórico ainda não possui ledger auditável. Regularize o pagamento antes de excluir.",
};

export async function anularPedido(db: D1Database, params: {
  pedidoId: number; devolverEstoque: boolean; motivo: string; usuarioId: number; usuarioNome: string;
}): Promise<{ anulacao: PedidoAnulacao; replay: boolean } | null> {
  const existing = await getPedidoAnulacao(db, params.pedidoId);
  if (existing) return { anulacao: existing, replay: true };
  const pedido = await db.prepare(`SELECT id FROM pedidos WHERE id = ?`).bind(params.pedidoId).first();
  if (!pedido) return null;

  // UNIQUE disputa a posse antes de qualquer efeito. Todos os valores e a
  // fotografia física são lidos no próprio batch, nunca de um SELECT anterior.
  const statements = [db.prepare(`INSERT INTO pedido_anulacoes (
      pedido_id,motivo,estoque_acao,criado_por_usuario_id,usuario_nome,
      total_original_centavos,bruto_original_centavos,reembolsado_original_centavos,
      liquido_original_centavos,estoque_snapshot)
    SELECT p.id,?,?,?,?,p.valor_total_centavos,${BRUTO_PAGO_SQL},${REEMBOLSADO_SQL},${LIQUIDO_SQL},
      (SELECT json_group_array(json_object('itemId',pi.id,'produtoId',pi.produto_id,
        'nome',pi.produto_nome,'quantidade',pi.quantidade,'status',pi.status_item,'estado',pi.estoque_estado))
       FROM pedido_itens pi WHERE pi.pedido_id=p.id)
    FROM pedidos p WHERE p.id=?`).bind(params.motivo, params.devolverEstoque ? "DEVOLVER" : "MANTER",
      params.usuarioId, params.usuarioNome, params.pedidoId)];

  if (params.devolverEstoque) {
    // Mesma autoridade de stock.ts: apenas ATIVO/TROCA_PENDENTE. Origem de
    // troca já CANCELADA não volta ao estoque uma segunda vez.
    const quantidade = (estado: string) => `(SELECT COALESCE(SUM(pi.quantidade),0)
      FROM pedido_itens pi WHERE pi.pedido_id=? AND pi.produto_id=produtos.id
        AND pi.status_item IN ('ATIVO','TROCA_PENDENTE') AND pi.estoque_estado='${estado}')`;
    statements.push(db.prepare(`UPDATE produtos SET
      estoque=estoque+${quantidade("BAIXADO")},
      estoque_reservado=estoque_reservado-${quantidade("RESERVADO")},
      disponivel=CASE WHEN ativo=1 AND ${quantidade("BAIXADO")}>0 THEN 1 ELSE disponivel END,
      atualizado_em=CURRENT_TIMESTAMP
      WHERE id IN (SELECT produto_id FROM pedido_itens WHERE pedido_id=?
        AND status_item IN ('ATIVO','TROCA_PENDENTE') AND estoque_estado IN ('BAIXADO','RESERVADO'))`)
      .bind(params.pedidoId, params.pedidoId, params.pedidoId, params.pedidoId));
    statements.push(db.prepare(`UPDATE pedido_itens SET
      estoque_reposto_em=CASE WHEN estoque_estado='BAIXADO' THEN COALESCE(estoque_reposto_em,CURRENT_TIMESTAMP) ELSE estoque_reposto_em END,
      estoque_liberado_em=CASE WHEN estoque_estado='RESERVADO' THEN COALESCE(estoque_liberado_em,CURRENT_TIMESTAMP) ELSE estoque_liberado_em END,
      estoque_estado=CASE WHEN estoque_estado='BAIXADO' THEN 'REPOSTO' ELSE 'LIBERADO' END
      WHERE pedido_id=? AND produto_id IS NOT NULL AND status_item IN ('ATIVO','TROCA_PENDENTE')
        AND estoque_estado IN ('BAIXADO','RESERVADO')`).bind(params.pedidoId));
    statements.push(preparePedidoPhysicalProjection(db, params.pedidoId));
  }
  // A trava de imutabilidade só fecha depois das movimentações no mesmo batch.
  statements.push(db.prepare(`UPDATE pedido_anulacoes SET efetivada=1 WHERE pedido_id=?`).bind(params.pedidoId));
  try {
    await db.batch(statements);
  } catch (error) {
    // Uma segunda aba pode ter vencido o UNIQUE. Seu batch foi revertido por
    // inteiro; devolvemos o fato vencedor, inclusive a escolha original.
    const winner = await getPedidoAnulacao(db, params.pedidoId);
    if (winner) return { anulacao: winner, replay: true };
    throw error;
  }
  return { anulacao: (await getPedidoAnulacao(db, params.pedidoId))!, replay: false };
}
