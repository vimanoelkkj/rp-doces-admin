/// <reference types="@cloudflare/workers-types" />

import type { MpMappedStatus, SyncPaymentResult } from "./types";
import { mapMpStatus } from "./status";
import { type MpPaymentResponse, isVerifiedMpResponse } from "./client";
import type { LedgerStatus } from "../comandaLedger";
import { reconcilePedidoAfterFinancialChange } from "../pedidoReconcile";
import { liberarReservaPedido } from "../stock";
import { notificarNovoPedidoPagoSafe, type PushEnv } from "../pushNotifier";

// Matriz de transição de pedido_pagamentos.status (Passo 6, aprovada):
// PENDENTE -> PAGO/CANCELADO/EXPIRADO: permitido.
// Qualquer estado -> ele mesmo: no-op idempotente, permitido.
// EXPIRADO -> PAGO: apenas com resposta verificada de GET MP.
// PAGO/CANCELADO/FALHOU/REEMBOLSADO -> outra coisa: recusado.
// REEMBOLSADO nunca é alcançado por este caminho (reembolso é evento e
// tabela separados — Passo 5); a exclusão aqui é só a última linha de defesa.
function isTransitionAllowed(statusAtual: string, novoStatus: MpMappedStatus, mp?: MpPaymentResponse): boolean {
  if (statusAtual === novoStatus) return true;
  if (statusAtual === "PENDENTE") return true;
  if (
    statusAtual === "EXPIRADO" &&
    (novoStatus === "PAGO" || novoStatus === "CANCELADO") &&
    mp !== undefined &&
    isVerifiedMpResponse(mp)
  ) {
    return true;
  }
  return false;
}

// Finalização específica do Pix, repetível mesmo sem uma nova transição.
// A reconciliação financeira B3 continua sem responsabilidade de liberação.
async function finalizePayment(db: D1Database, pagamentoId: number, pedidoId: number): Promise<void> {
  await reconcilePedidoAfterFinancialChange(db, pedidoId);
  const atual = await db.prepare(`SELECT metodo, status FROM pedido_pagamentos WHERE id = ?`)
    .bind(pagamentoId).first<{ metodo: string; status: LedgerStatus }>();
  if (atual?.metodo === "PIX_MP" && (atual.status === "CANCELADO" || atual.status === "EXPIRADO")) {
    const liberacao = await liberarReservaPedido(db, pedidoId);
    if (!liberacao.ok) throw new Error(liberacao.erro); // log no helper; permite retry do chamador
  }
}

interface PagamentoRow {
  id: number;
  pedido_id: number;
  status: LedgerStatus;
}

// Núcleo compartilhado: aplica (ou recusa) uma transição já mapeada, com
// CAS contra o status lido (evita pisar em uma mudança concorrente) e
// reconcilia o pedido mesmo quando a transição já aconteceu antes.
// `mp_status`/`mp_status_detail` são gravados para diagnóstico mesmo
// quando a transição do ledger é recusada pela matriz (permite auditar
// "o MP mandou X, mas não aplicamos porque Y" sem perder o dado bruto).
// Sem resposta MP, este núcleo privado só aceita expiração operacional.
async function applyLedgerTransition(
  db: D1Database,
  pagamentoId: number,
  novoStatus: MpMappedStatus | null,
  mp?: MpPaymentResponse,
  env?: PushEnv,
): Promise<SyncPaymentResult> {
  if (mp) {
    if (!isVerifiedMpResponse(mp)) throw new Error("RESPOSTA_MP_NAO_VERIFICADA");
    const { results: vinculados } = await db.prepare(
      `SELECT id FROM pedido_pagamentos WHERE metodo = 'PIX_MP' AND mp_payment_id = ? LIMIT 2`,
    ).bind(String(mp.id)).all<{ id: number }>();
    if (vinculados.length !== 1 || vinculados[0].id !== pagamentoId) {
      throw new Error("IDENTIDADE_PAGAMENTO_MP_AMBIGUA_OU_DIVERGENTE");
    }
  } else if (novoStatus !== "EXPIRADO") {
    throw new Error("TRANSICAO_LOCAL_INVALIDA");
  }
  const atual = await db
    .prepare(`SELECT id, pedido_id, status FROM pedido_pagamentos WHERE id = ?`)
    .bind(pagamentoId)
    .first<PagamentoRow>();
  if (!atual) return { ok: false, status: null, transicionou: false };

  if (mp) {
    await db
      .prepare(
        `UPDATE pedido_pagamentos SET mp_status = ?, mp_status_detail = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(mp.status, mp.status_detail ?? null, pagamentoId)
      .run();
  }

  if (!novoStatus || !isTransitionAllowed(atual.status, novoStatus, mp) || atual.status === novoStatus) {
    await finalizePayment(db, pagamentoId, atual.pedido_id);
    const pos = await db.prepare(`SELECT status FROM pedido_pagamentos WHERE id = ?`)
      .bind(pagamentoId).first<{ status: LedgerStatus }>();
    return { ok: true, status: pos?.status ?? atual.status, transicionou: false };
  }

  // A aprovação ou cancelamento podem ter lido PENDENTE e perdido a corrida para a expiração.
  // Revalida os estados elegíveis na própria escrita, sem retry recursivo.
  const origemGuard =
    mp && (novoStatus === "PAGO" || novoStatus === "CANCELADO")
      ? "status IN ('PENDENTE', 'EXPIRADO')"
      : "status = 'PENDENTE'";
  const result = await db
    .prepare(
      `UPDATE pedido_pagamentos
       SET status = ?,
           pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, ?, CURRENT_TIMESTAMP) ELSE pago_em END,
           cancelado_em = CASE WHEN ? IN ('CANCELADO', 'EXPIRADO') THEN COALESCE(cancelado_em, CURRENT_TIMESTAMP) ELSE cancelado_em END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND ${origemGuard}
         ${mp ? "AND metodo = 'PIX_MP' AND mp_payment_id = ? AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos outro WHERE outro.mp_payment_id = ? AND outro.metodo = 'PIX_MP' AND outro.id != pedido_pagamentos.id)" : ""}`,
    )
    .bind(novoStatus, novoStatus, mp?.date_approved ?? null, novoStatus, pagamentoId,
      ...(mp ? [String(mp.id), String(mp.id)] : []))
    .run();

  const aplicou = Number(result?.meta?.changes || 0) > 0;
  if (!aplicou) {
    // Estado já era o mesmo (no-op) ou perdeu a corrida do CAS para outro
    // chamador concorrente — recarrega o estado real antes de responder.
    await finalizePayment(db, pagamentoId, atual.pedido_id);
    const pos = await db
      .prepare(`SELECT status FROM pedido_pagamentos WHERE id = ?`)
      .bind(pagamentoId)
      .first<{ status: LedgerStatus }>();
    return { ok: true, status: pos?.status ?? atual.status, transicionou: false };
  }

  const transicionou = atual.status !== novoStatus;
  await finalizePayment(db, pagamentoId, atual.pedido_id);

  if (novoStatus === "PAGO" && transicionou && env) {
    await notificarNovoPedidoPagoSafe(db, env, atual.pedido_id);
  }

  return { ok: true, status: novoStatus, transicionou };
}

// Ponto de entrada usado por webhook, reconciliação do admin e
// refreshPedidoStatus quando já existe uma resposta do Mercado Pago.
export async function syncPaymentFromMp(
  db: D1Database,
  pagamentoId: number,
  mp: MpPaymentResponse,
  env?: PushEnv,
): Promise<SyncPaymentResult> {
  if (!isVerifiedMpResponse(mp)) throw new Error("RESPOSTA_MP_NAO_VERIFICADA");
  return applyLedgerTransition(db, pagamentoId, mapMpStatus(mp.status), mp, env);
}

// Caminho local de expiração (pix_expira_em vencido), sem nenhum dado do
// MP envolvido — usado por refreshPedidoStatus. Não sobrescreve
// mp_status/mp_status_detail (não temos nada novo do MP para gravar).
export async function expireLocalPayment(db: D1Database, pagamentoId: number): Promise<SyncPaymentResult> {
  return applyLedgerTransition(db, pagamentoId, "EXPIRADO");
}
