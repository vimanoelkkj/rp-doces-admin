/// <reference types="@cloudflare/workers-types" />

import { BRUTO_PAGO_SQL, REEMBOLSADO_SQL, LIQUIDO_SQL } from "./pedidoFinanceiroSql";
import { preparePedidoPhysicalProjection } from "./stock";
import { getPedidoAnulacao, type PedidoAnulacao } from "./pedidoValido";
import {
  fetchMpPayment,
  syncPaymentFromMp,
  resolveWebhookPayment,
  type MpPaymentResponse,
} from "./paymentSync";
import { cancelarPagamentoMp } from "./mpPost";
import { buscarPagamentosPorReferenciaExterna } from "./mpSearch";
import {
  externalReferenceDaOperacao,
  registrarFase,
  type OperacaoInconclusiva,
} from "./operacoes";

export const ESTORNO_ANULACAO_ATIVO_MENSAGEM =
  "Este pedido tem um estorno de exclusão em andamento no Mercado Pago. Nenhuma ação financeira é permitida até a exclusão ser concluída ou o estorno ser recusado.";

export const ANULACAO_ERROS: Record<string, string> = {
  ANULACAO_MP_RECEBIDO: "Há recebimento Mercado Pago ainda não estornado. Trate o pagamento pelo fluxo de estorno existente antes de excluir.",
  ANULACAO_MP_PENDENTE: "Há cobrança Mercado Pago pendente, expirada sem confirmação definitiva ou inconclusiva. Resolva a cobrança antes de excluir.",
  ANULACAO_REFUND_PENDENTE: "Há um estorno em processamento ou inconclusivo. Aguarde sua resolução antes de excluir.",
  ANULACAO_LEGADO_AMBIGUO: "O pagamento histórico ainda não possui ledger auditável. Regularize o pagamento antes de excluir.",
  PIX_JA_PAGO: "Há recebimento Mercado Pago confirmado para este pedido. Trate o pagamento pelo fluxo de estorno antes de excluir.",
};

export interface PagamentoMpReembolsavel {
  pagamentoId: number;
  valorCentavos: number;
  restanteCentavos: number;
}

// Espelha exatamente a condição ANULACAO_MP_RECEBIDO da trigger
// `pedido_anulacoes_validar_mp` (migration 0022): o saldo restante de cada
// pagamento PIX_MP confirmado, descontados os estornos MP já confirmados
// daquele mesmo pagamento_id. Não percorre a linhagem de trocas (migration
// 0021) de propósito — aqui o pedido inteiro está sendo anulado, não a
// cobertura de um item específico, e cada pagamento é a unidade de refund.
export async function listarPagamentosMpReembolsaveis(
  db: D1Database,
  pedidoId: number,
): Promise<PagamentoMpReembolsavel[]> {
  const { results } = await db.prepare(`
    SELECT pagamento_id, valor_centavos, restante_centavos FROM (
      SELECT pp.id AS pagamento_id, pp.valor_centavos AS valor_centavos,
        pp.valor_centavos - COALESCE((
          SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
          WHERE r.pagamento_id=pp.id AND r.status='REEMBOLSADO'
            AND r.origem='MERCADO_PAGO' AND r.metodo='PIX_MP' AND r.mp_refund_id IS NOT NULL
        ),0) AS restante_centavos
      FROM pedido_pagamentos pp
      WHERE pp.pedido_id=? AND pp.metodo='PIX_MP' AND pp.status='PAGO'
    ) WHERE restante_centavos > 0
    ORDER BY pagamento_id`)
    .bind(pedidoId)
    .all<{ pagamento_id: number; valor_centavos: number; restante_centavos: number }>();
  return (results || []).map((row) => ({
    pagamentoId: Number(row.pagamento_id),
    valorCentavos: Number(row.valor_centavos),
    restanteCentavos: Number(row.restante_centavos),
  }));
}

// Ponto 4 da revisão de arquitetura (migration 0023): existe uma janela real
// entre o estorno de um pagamento confirmado (ou ainda em voo) e a anulação
// do pedido se efetivar. Nessa janela o dinheiro já pode ter voltado ao
// cliente, então nenhuma outra ação financeira pode acontecer — só
// reconciliar esse mesmo estorno e concluir a exclusão. `status<>'RECUSADO'`
// inclui de propósito PENDENTE/PROCESSANDO/INCONCLUSIVO/CONFIRMADO: só uma
// recusa definitiva do provedor devolve a escrita ao pedido.
export async function temEstornoAnulacaoAtivo(db: D1Database, pedidoId: number): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM pedido_reembolso_pix_mp_intencoes
      WHERE pedido_id=? AND pedido_item_cancelamento_id IS NULL
        AND pedido_item_troca_id IS NULL AND status<>'RECUSADO' LIMIT 1`)
    .bind(pedidoId).first();
  return !!row;
}

export interface ResolucaoPixAnulacaoResultado {
  ok: boolean;
  erro?: string;
  mensagem?: string;
}

export async function resolverPixNaoPagosParaAnulacao(
  db: D1Database,
  params: {
    pedidoId: number;
    accessToken?: string;
    usuarioId: number;
  },
): Promise<ResolucaoPixAnulacaoResultado> {
  const { pedidoId, accessToken } = params;

  const existing = await getPedidoAnulacao(db, pedidoId);
  if (existing) return { ok: true };

  const pedido = await db.prepare(`SELECT id FROM pedidos WHERE id = ?`).bind(pedidoId).first();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO", mensagem: "Pedido não encontrado." };

  if (await temEstornoAnulacaoAtivo(db, pedidoId)) {
    return {
      ok: false,
      erro: "ANULACAO_REFUND_PENDENTE",
      mensagem: ESTORNO_ANULACAO_ATIVO_MENSAGEM,
    };
  }

  const reembolsaveis = await listarPagamentosMpReembolsaveis(db, pedidoId);
  if (reembolsaveis.length > 0) {
    return {
      ok: false,
      erro: "PIX_JA_PAGO",
      mensagem: "Há recebimento Mercado Pago confirmado para este pedido. Trate o estorno/reembolso antes da anulação.",
    };
  }

  const { results: operacoes } = await db.prepare(
    `SELECT o.id, o.operation_key, o.tipo, o.fase, o.pedido_id, o.pagamento_id,
            o.mp_idempotency_key, o.mp_payment_id, o.mp_request, o.erro, o.atualizado_em,
            o.expirado_em, o.ator_usuario_id
     FROM pedido_operacoes o
     WHERE o.pedido_id = ?
       AND o.mp_idempotency_key IS NOT NULL
       AND o.fase IN ('LOCAL_CRIADA', 'ENVIO_INCONCLUSIVO')
     ORDER BY o.id ASC`,
  ).bind(pedidoId).all<OperacaoInconclusiva & { mp_idempotency_key: string; mp_payment_id: string | null; ator_usuario_id: number }>();

  const ops = operacoes || [];

  const { results: pagamentos } = await db.prepare(
    `SELECT id, pedido_id, metodo, status, mp_payment_id, valor_centavos, idempotency_key
     FROM pedido_pagamentos
     WHERE pedido_id = ? AND metodo = 'PIX_MP' AND status IN ('PENDENTE', 'EXPIRADO')
     ORDER BY id ASC`,
  ).bind(pedidoId).all<{
    id: number;
    pedido_id: number;
    metodo: string;
    status: string;
    mp_payment_id: string | null;
    valor_centavos: number;
    idempotency_key: string | null;
  }>();

  const pags = pagamentos || [];

  if (ops.length === 0 && pags.length === 0) {
    return { ok: true };
  }

  if (!accessToken) {
    return {
      ok: false,
      erro: "MERCADO_PAGO_NAO_CONFIGURADO",
      mensagem: "Credenciais do Mercado Pago não configuradas para resolver cobranças pendentes.",
    };
  }

  for (const operacao of ops) {
    let mpPaymentId = operacao.mp_payment_id;

    if (!mpPaymentId) {
      const referencia = externalReferenceDaOperacao(operacao);
      if (!referencia) {
        return {
          ok: false,
          erro: "OPERACAO_INCONCLUSIVA",
          mensagem: "Operação do Mercado Pago inconclusiva sem referência externa identificável.",
        };
      }

      const busca = await buscarPagamentosPorReferenciaExterna(accessToken, referencia);
      if (busca.resultado === "INDISPONIVEL") {
        return {
          ok: false,
          erro: "MERCADO_PAGO_INDISPONIVEL",
          mensagem: "Mercado Pago indisponível para verificar operação inconclusiva.",
        };
      }
      if (busca.resultado === "AMBIGUO") {
        return {
          ok: false,
          erro: "OPERACAO_INCONCLUSIVA",
          mensagem: "Múltiplos pagamentos encontrados no Mercado Pago para a mesma operação.",
        };
      }
      if (busca.resultado === "NENHUM") {
        return {
          ok: false,
          erro: "OPERACAO_INCONCLUSIVA",
          mensagem: "Cobrança Mercado Pago pendente de confirmação do provedor.",
        };
      }

      mpPaymentId = busca.mpPaymentId;
    }

    let payment: MpPaymentResponse;
    try {
      payment = await fetchMpPayment(accessToken, mpPaymentId);
    } catch {
      return {
        ok: false,
        erro: "MERCADO_PAGO_INDISPONIVEL",
        mensagem: "Não foi possível consultar o pagamento do Mercado Pago.",
      };
    }

    if (operacao.tipo === "PIX_ADMIN_REGENERACAO") {
      const referencia = externalReferenceDaOperacao(operacao);
      let bRow = referencia
        ? await db.prepare(`SELECT id, status FROM pedido_pagamentos WHERE idempotency_key = ? LIMIT 1`)
            .bind(referencia)
            .first<{ id: number; status: string }>()
        : null;

      if (!bRow && referencia) {
        const txData = (payment as { point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } } }).point_of_interaction?.transaction_data;
        const req = operacao.mp_request ? JSON.parse(operacao.mp_request) as { transaction_amount?: number } : null;
        const valorCentavos = req?.transaction_amount ? Math.round(Number(req.transaction_amount) * 100) : 0;

        await db.batch([
          db.prepare(
            `UPDATE pedido_pagamentos
             SET status = 'CANCELADO', cancelado_em = COALESCE(cancelado_em, CURRENT_TIMESTAMP), atualizado_em = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'PENDENTE'`,
          ).bind(operacao.pagamento_id),
          db.prepare(
            `INSERT INTO pedido_pagamentos (
               pedido_id, metodo, origem, valor_centavos, status,
               registrado_por_usuario_id, idempotency_key, substitui_pagamento_id,
               mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64, mp_ticket_url, pix_expira_em
             )
             VALUES (?, 'PIX_MP', 'ADMIN', ?, 'PENDENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            operacao.pedido_id,
            valorCentavos,
            operacao.ator_usuario_id,
            referencia,
            operacao.pagamento_id,
            String(payment.id),
            payment.status,
            txData?.qr_code ?? null,
            txData?.qr_code_base64 ?? null,
            txData?.ticket_url ?? null,
            (payment as { date_of_expiration?: string }).date_of_expiration ?? null,
          ),
          db.prepare(
            `UPDATE pedido_operacoes
             SET fase = 'REMOTO_CONHECIDO', mp_payment_id = ?,
                 pagamento_id = (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?),
                 atualizado_em = CURRENT_TIMESTAMP
             WHERE operation_key = ?`,
          ).bind(String(payment.id), referencia, operacao.operation_key),
        ]);

        bRow = await db.prepare(`SELECT id, status FROM pedido_pagamentos WHERE idempotency_key = ? LIMIT 1`)
          .bind(referencia).first<{ id: number; status: string }>();
      }

      if (bRow) {
        await registrarFase(db, operacao.operation_key, {
          fase: "REMOTO_CONHECIDO",
          mpPaymentId,
        });
        await syncPaymentFromMp(db, bRow.id, payment);
      }
    } else {
      const resolvido = await resolveWebhookPayment(db, payment);
      let targetPagamentoId: number | null = null;
      if (resolvido.kind === "found") {
        targetPagamentoId = resolvido.pagamentoId;
      } else if (operacao.pagamento_id) {
        await db.prepare("UPDATE pedido_pagamentos SET mp_payment_id = ?, mp_status = ? WHERE id = ?")
          .bind(String(payment.id), payment.status, operacao.pagamento_id).run();
        targetPagamentoId = operacao.pagamento_id;
      }

      if (targetPagamentoId) {
        await registrarFase(db, operacao.operation_key, {
          fase: "REMOTO_CONHECIDO",
          mpPaymentId,
        });
        await syncPaymentFromMp(db, targetPagamentoId, payment);
      } else {
        return {
          ok: false,
          erro: "OPERACAO_INCONCLUSIVA",
          mensagem: "Não foi possível vincular o pagamento do Mercado Pago ao pedido.",
        };
      }
    }

    if (String(payment.status || "").toLowerCase() === "approved") {
      return {
        ok: false,
        erro: "PIX_JA_PAGO",
        mensagem: "Há recebimento Mercado Pago confirmado para este pedido. Trate o estorno/reembolso antes da anulação.",
      };
    }
  }

  const { results: pagamentosAResolver } = await db.prepare(
    `SELECT id, pedido_id, metodo, status, mp_payment_id, valor_centavos, idempotency_key
     FROM pedido_pagamentos
     WHERE pedido_id = ? AND metodo = 'PIX_MP' AND status IN ('PENDENTE', 'EXPIRADO')
     ORDER BY id ASC`,
  ).bind(pedidoId).all<{
    id: number;
    pedido_id: number;
    metodo: string;
    status: string;
    mp_payment_id: string | null;
    valor_centavos: number;
    idempotency_key: string | null;
  }>();

  for (const pag of pagamentosAResolver || []) {
    if (!pag.mp_payment_id) {
      return {
        ok: false,
        erro: "PIX_SEM_ID_REMOTO",
        mensagem: "Cobrança Pix não possui identificador remoto do Mercado Pago.",
      };
    }

    let mp: MpPaymentResponse;
    try {
      mp = await fetchMpPayment(accessToken, String(pag.mp_payment_id));
    } catch {
      return {
        ok: false,
        erro: "MERCADO_PAGO_INDISPONIVEL",
        mensagem: "Não foi possível consultar a cobrança no Mercado Pago. O pedido não foi alterado.",
      };
    }

    const statusRemoto = String(mp.status || "").toLowerCase();

    if (statusRemoto === "approved") {
      await syncPaymentFromMp(db, pag.id, mp);
      return {
        ok: false,
        erro: "PIX_JA_PAGO",
        mensagem: "Há recebimento Mercado Pago confirmado para este pedido. Trate o estorno/reembolso antes da anulação.",
      };
    }

    if (statusRemoto === "cancelled" || statusRemoto === "rejected") {
      await syncPaymentFromMp(db, pag.id, mp);
      continue;
    }

    if (statusRemoto === "pending" || statusRemoto === "in_process" || statusRemoto === "authorized") {
      const cancelKey = `a1:anul-cancel:${pedidoId}:${pag.id}:${pag.mp_payment_id}`;
      await cancelarPagamentoMp(accessToken, pag.mp_payment_id, cancelKey);

      let reconsulta: MpPaymentResponse | null = null;
      try {
        reconsulta = await fetchMpPayment(accessToken, String(pag.mp_payment_id));
      } catch {
        reconsulta = null;
      }

      if (reconsulta) {
        const reconsultaStatus = String(reconsulta.status || "").toLowerCase();
        if (reconsultaStatus === "cancelled" || reconsultaStatus === "rejected") {
          await syncPaymentFromMp(db, pag.id, reconsulta);
          continue;
        }
        if (reconsultaStatus === "approved") {
          await syncPaymentFromMp(db, pag.id, reconsulta);
          return {
            ok: false,
            erro: "PIX_JA_PAGO",
            mensagem: "Há recebimento Mercado Pago confirmado para este pedido. Trate o estorno/reembolso antes da anulação.",
          };
        }
      }

      return {
        ok: false,
        erro: "MERCADO_PAGO_INDISPONIVEL",
        mensagem: "Não foi possível confirmar o cancelamento da cobrança no Mercado Pago. O pedido não foi alterado.",
      };
    }

    return {
      ok: false,
      erro: "PIX_ESTADO_INVALIDO",
      mensagem: "Cobrança Mercado Pago em estado inesperado. Regularize o pagamento antes de excluir.",
    };
  }

  const aindaPendente = await db.prepare(
    `SELECT 1 FROM pedido_pagamentos
     WHERE pedido_id = ? AND metodo = 'PIX_MP' AND status IN ('PENDENTE', 'EXPIRADO')
     LIMIT 1`,
  ).bind(pedidoId).first();

  if (aindaPendente) {
    return {
      ok: false,
      erro: "ANULACAO_MP_PENDENTE",
      mensagem: ANULACAO_ERROS.ANULACAO_MP_PENDENTE,
    };
  }

  const aindaOperacaoPendente = await db.prepare(
    `SELECT 1 FROM pedido_operacoes
     WHERE pedido_id = ? AND mp_idempotency_key IS NOT NULL AND fase IN ('LOCAL_CRIADA', 'ENVIO_INCONCLUSIVO')
     LIMIT 1`,
  ).bind(pedidoId).first();

  if (aindaOperacaoPendente) {
    return {
      ok: false,
      erro: "ANULACAO_MP_PENDENTE",
      mensagem: ANULACAO_ERROS.ANULACAO_MP_PENDENTE,
    };
  }

  return { ok: true };
}

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
