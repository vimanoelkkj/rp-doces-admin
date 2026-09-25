/// <reference types="@cloudflare/workers-types" />

import { fetchMpPayment } from "./client";
import { syncPaymentFromMp, expireLocalPayment } from "./ledgerSync";

const RECONCILE_AFTER_SECONDS = 15;
const RECONCILE_BATCH_SIZE = 4;

// Throttle de consulta ao Mercado Pago por tentativa PIX_MP, compartilhado
// pela reconciliação do admin e pelo POST público de acompanhamento. CAS em
// `atualizado_em` ANTES da chamada externa: só um chamador por janela de 15s
// consulta o MP, e uma falha de rede também consome a janela. Elegível apenas
// PENDENTE/EXPIRADO (EXPIRADO -> PAGO tardio continua recuperável). Não altera
// fatos nem timestamps históricos financeiros.
export async function claimPendingPixPaymentReconciliation(
  db: D1Database,
  pagamentoId: number,
): Promise<boolean> {
  const claim = await db.prepare(
    `UPDATE pedido_pagamentos SET atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ? AND metodo = 'PIX_MP' AND status IN ('PENDENTE', 'EXPIRADO')
       AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')`,
  ).bind(pagamentoId, RECONCILE_AFTER_SECONDS).run();
  return Number(claim.meta.changes || 0) > 0;
}

// Reconciliação oportunista: chamada a partir de GET /api/admin/pedidos.
// Seleciona pelo ledger (pedido_pagamentos), não pela projeção agregada em
// pedidos.status_pagamento — depois do Passo 5, um pedido PENDENTE no
// agregado pode significar "nunca pago" ou "totalmente reembolsado", e só
// o fato individual (metodo/status do pagamento) responde "existe um Pix
// do Mercado Pago ainda pendente de confirmação" sem ambiguidade.
export async function reconcilePendingPixPayments(env: { DB: D1Database; MP_ACCESS_TOKEN?: string }): Promise<void> {
  if (!env.MP_ACCESS_TOKEN) return;

  const { results } = await env.DB.prepare(
    `SELECT id, mp_payment_id FROM pedido_pagamentos
     WHERE metodo = 'PIX_MP' AND status IN ('PENDENTE', 'EXPIRADO') AND mp_payment_id IS NOT NULL
       AND datetime(atualizado_em) <= datetime('now', '-' || ? || ' seconds')
     ORDER BY atualizado_em ASC, id ASC
     LIMIT ?`,
  )
    .bind(RECONCILE_AFTER_SECONDS, RECONCILE_BATCH_SIZE)
    .all<{ id: number; mp_payment_id: string }>();

  const pendentes = results || [];
  if (!pendentes.length) return;

  await Promise.allSettled(
    pendentes.map(async (row) => {
      try {
        // Claim por candidato: concorrência e falhas de rede também respeitam
        // o throttle. Não altera fatos nem timestamps históricos financeiros.
        if (!(await claimPendingPixPaymentReconciliation(env.DB, row.id))) return;
        const payment = await fetchMpPayment(env.MP_ACCESS_TOKEN!, row.mp_payment_id);
        await syncPaymentFromMp(env.DB, row.id, payment, env);
      } catch (err) {
        console.error("Falha ao reconciliar pagamento PIX_MP pendente/expirado", row.id, err);
      }
    }),
  );
}

const RESERVA_VENCIDA_BATCH_SIZE = 10;

// Passo 7: fecha o gap "ninguém nunca visitou este pedido nem chegou
// webhook" para a expiração local do Pix — mesma checagem que
// `refreshPedidoStatus` já faz por visita do cliente (`pix_expira_em`
// vencido, sem precisar consultar o MP: o TTL real já veio do MP na
// criação da cobrança), agora também disparada oportunisticamente pela
// abertura do painel admin. A folga de 1 minuto é operacional e não prova
// ausência de pagamento. Approved posterior continua recuperável pelo B2.
// Reaproveita expireLocalPayment/applyLedgerTransition e a proteção B4.
export async function liberarReservasVencidasLocalmente(env: { DB: D1Database }): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT pp.id AS pagamento_id
     FROM pedidos p
     JOIN pedido_pagamentos pp ON pp.pedido_id = p.id
     WHERE p.status_pagamento = 'PENDENTE'
       AND p.reserva_status = 'ATIVA'
       AND pp.metodo = 'PIX_MP' AND pp.origem = 'SITE' AND pp.status = 'PENDENTE'
       AND p.reserva_expira_em IS NOT NULL
       AND datetime(p.reserva_expira_em) <= datetime('now')
     ORDER BY p.reserva_expira_em ASC
     LIMIT ?`,
  )
    .bind(RESERVA_VENCIDA_BATCH_SIZE)
    .all<{ pagamento_id: number }>();

  const pendentes = results || [];
  if (!pendentes.length) return;

  await Promise.allSettled(
    pendentes.map(async (row) => {
      try {
        await expireLocalPayment(env.DB, row.pagamento_id);
      } catch (err) {
        console.error("Falha ao liberar reserva vencida localmente", row.pagamento_id, err);
      }
    }),
  );
}
