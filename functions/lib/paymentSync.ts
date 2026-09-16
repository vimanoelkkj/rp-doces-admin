/// <reference types="@cloudflare/workers-types" />

// Passo 6: helper central de sincronização financeira contra o Mercado
// Pago. Webhook, reconciliação oportunista do admin e o polling público
// (refreshPedidoStatus) convergem todos para `syncPaymentFromMp` — nenhum
// dos três pode ter sua própria interpretação do que o MP respondeu.
//
// Continuamos na Payments API (/v1/payments), não na Orders API que
// produção usa hoje — decisão explícita, não migramos de carona aqui.

import { LedgerStatus } from "./comandaLedger";
import { reconcilePedidoAfterFinancialChange } from "./pedidoReconcile";
import { liberarReservaPedido } from "./stock";

export type MpMappedStatus = "PAGO" | "CANCELADO" | "EXPIRADO";

export interface MpPaymentSnapshot {
  status: string;
  statusDetail?: string | null;
  dateApproved?: string | null;
}

export interface SyncPaymentResult {
  ok: boolean;
  status: LedgerStatus | null;
  transicionou: boolean;
}

// Vocabulário de eventos do Mercado Pago (Payments API) -> vocabulário do
// nosso ledger. `null` significa "ainda não é um estado final conhecido"
// (ex.: in_process/authorized/pending) — nesse caso não há nada a aplicar.
export function mapMpStatus(mpStatus: string): MpMappedStatus | null {
  const status = String(mpStatus || "").toLowerCase();
  if (status === "approved") return "PAGO";
  if (status === "rejected" || status === "cancelled") return "CANCELADO";
  if (status === "expired") return "EXPIRADO";
  return null;
}

// Matriz de transição de pedido_pagamentos.status (Passo 6, aprovada):
// PENDENTE -> PAGO/CANCELADO/EXPIRADO: permitido.
// Qualquer estado -> ele mesmo: no-op idempotente, permitido.
// PAGO/CANCELADO/EXPIRADO/FALHOU/REEMBOLSADO -> qualquer outra coisa: recusado.
// REEMBOLSADO nunca é alcançado por este caminho (reembolso é evento e
// tabela separados — Passo 5); a exclusão aqui é só a última linha de defesa.
function isTransitionAllowed(statusAtual: string, novoStatus: MpMappedStatus): boolean {
  if (statusAtual === novoStatus) return true;
  return statusAtual === "PENDENTE";
}

interface PagamentoRow {
  id: number;
  pedido_id: number;
  status: LedgerStatus;
}

// Núcleo compartilhado: aplica (ou recusa) uma transição já mapeada, com
// CAS contra o status lido (evita pisar em uma mudança concorrente) e
// recalcula o agregado só quando a transição realmente aconteceu.
// `mpStatusRaw`/`mpStatusDetail` são gravados para diagnóstico mesmo
// quando a transição do ledger é recusada pela matriz (permite auditar
// "o MP mandou X, mas não aplicamos porque Y" sem perder o dado bruto).
// Quando `null`/`undefined` (caminho de expiração local, sem MP
// envolvido), esses campos simplesmente não são tocados.
async function applyLedgerTransition(
  db: D1Database,
  pagamentoId: number,
  novoStatus: MpMappedStatus,
  meta: { mpStatusRaw?: string | null; mpStatusDetail?: string | null; dateApproved?: string | null } = {},
): Promise<SyncPaymentResult> {
  const atual = await db
    .prepare(`SELECT id, pedido_id, status FROM pedido_pagamentos WHERE id = ?`)
    .bind(pagamentoId)
    .first<PagamentoRow>();
  if (!atual) return { ok: false, status: null, transicionou: false };

  if (meta.mpStatusRaw !== undefined && meta.mpStatusRaw !== null) {
    await db
      .prepare(
        `UPDATE pedido_pagamentos SET mp_status = ?, mp_status_detail = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(meta.mpStatusRaw, meta.mpStatusDetail ?? null, pagamentoId)
      .run();
  }

  if (!isTransitionAllowed(atual.status, novoStatus)) {
    return { ok: true, status: atual.status, transicionou: false };
  }

  const result = await db
    .prepare(
      `UPDATE pedido_pagamentos
       SET status = ?,
           pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, ?, CURRENT_TIMESTAMP) ELSE pago_em END,
           cancelado_em = CASE WHEN ? IN ('CANCELADO', 'EXPIRADO') THEN COALESCE(cancelado_em, CURRENT_TIMESTAMP) ELSE cancelado_em END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status = ?`,
    )
    .bind(novoStatus, novoStatus, meta.dateApproved ?? null, novoStatus, pagamentoId, atual.status)
    .run();

  const aplicou = Number(result?.meta?.changes || 0) > 0;
  if (!aplicou) {
    // Estado já era o mesmo (no-op) ou perdeu a corrida do CAS para outro
    // chamador concorrente — recarrega o estado real antes de responder.
    const pos = await db
      .prepare(`SELECT status FROM pedido_pagamentos WHERE id = ?`)
      .bind(pagamentoId)
      .first<{ status: LedgerStatus }>();
    return { ok: true, status: pos?.status ?? atual.status, transicionou: false };
  }

  const transicionou = atual.status !== novoStatus;
  if (transicionou) {
    // Passo 7: reconcilia o agregado e, se ele fechar em PAGO, converte a
    // reserva em baixa física (pedidoReconcile.ts). Para EXPIRADO/CANCELADO,
    // tenta liberar a reserva — a própria função só libera se o agregado
    // ainda estiver genuinamente PENDENTE (guard no próprio write), nunca
    // se um pedido PARCIAL tiver essa tentativa vindo de uma perna Pix
    // morta: dívida operacional conhecida, não resolvida aqui.
    await reconcilePedidoAfterFinancialChange(db, atual.pedido_id);
    if (novoStatus === "CANCELADO" || novoStatus === "EXPIRADO") {
      await liberarReservaPedido(db, atual.pedido_id);
    }
  }

  return { ok: true, status: novoStatus, transicionou };
}

// Ponto de entrada usado por webhook, reconciliação do admin e
// refreshPedidoStatus quando já existe uma resposta do Mercado Pago.
export async function syncPaymentFromMp(
  db: D1Database,
  pagamentoId: number,
  mp: MpPaymentSnapshot,
): Promise<SyncPaymentResult> {
  const novoStatus = mapMpStatus(mp.status);

  if (!novoStatus) {
    // Estado do MP ainda não é final (ex.: in_process) — só registra o
    // retrato bruto para diagnóstico, sem tentar nenhuma transição.
    await db
      .prepare(
        `UPDATE pedido_pagamentos SET mp_status = ?, mp_status_detail = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(mp.status, mp.statusDetail ?? null, pagamentoId)
      .run();
    const atual = await db
      .prepare(`SELECT status FROM pedido_pagamentos WHERE id = ?`)
      .bind(pagamentoId)
      .first<{ status: LedgerStatus }>();
    return { ok: true, status: atual?.status ?? null, transicionou: false };
  }

  return applyLedgerTransition(db, pagamentoId, novoStatus, {
    mpStatusRaw: mp.status,
    mpStatusDetail: mp.statusDetail ?? null,
    dateApproved: mp.dateApproved ?? null,
  });
}

// Caminho local de expiração (pix_expira_em vencido), sem nenhum dado do
// MP envolvido — usado por refreshPedidoStatus. Não sobrescreve
// mp_status/mp_status_detail (não temos nada novo do MP para gravar).
export async function expireLocalPayment(db: D1Database, pagamentoId: number): Promise<SyncPaymentResult> {
  return applyLedgerTransition(db, pagamentoId, "EXPIRADO");
}

export interface MpPaymentResponse {
  id: number;
  status: string;
  status_detail?: string | null;
  date_approved?: string | null;
  external_reference?: string | null;
}

export async function fetchMpPayment(accessToken: string, paymentId: string): Promise<MpPaymentResponse> {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const err = new Error(`Mercado Pago respondeu ${response.status}`) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return (await response.json()) as MpPaymentResponse;
}

// Resolução do pagamento a ser sincronizado, para o webhook.
//
// 1) Caminho direto: mp_payment_id já persistido (caso feliz, checkout já
//    completou o roundtrip com o MP antes do webhook chegar).
// 2) Fallback por external_reference (= token_publico): cobre a corrida
//    checkout-ainda-não-persistiu-mp_payment_id. Nunca escolhe "o mais
//    recente" entre candidatos — 0 candidatos é "não encontrado", >1 é
//    "ambíguo, não decide", só exatamente 1 é resolvido. Quando resolve
//    por aqui, persiste mp_payment_id nessa linha (protegido por CAS) para
//    que o próximo evento já resolva pelo caminho direto.
export type ResolveWebhookPaymentResult =
  | { kind: "found"; pagamentoId: number }
  | { kind: "not_found" }
  | { kind: "ambiguous" };

export async function resolveWebhookPayment(
  db: D1Database,
  payment: MpPaymentResponse,
): Promise<ResolveWebhookPaymentResult> {
  const mpPaymentId = String(payment.id);

  const direto = await db
    .prepare(`SELECT id FROM pedido_pagamentos WHERE metodo = 'PIX_MP' AND mp_payment_id = ? LIMIT 1`)
    .bind(mpPaymentId)
    .first<{ id: number }>();
  if (direto) return { kind: "found", pagamentoId: Number(direto.id) };

  const tokenPublico = String(payment.external_reference || "").trim();
  if (!tokenPublico) return { kind: "not_found" };

  const pedido = await db
    .prepare(`SELECT id FROM pedidos WHERE token_publico = ? LIMIT 1`)
    .bind(tokenPublico)
    .first<{ id: number }>();
  if (!pedido) return { kind: "not_found" };

  const { results: candidatos } = await db
    .prepare(
      `SELECT id FROM pedido_pagamentos
       WHERE pedido_id = ? AND metodo = 'PIX_MP' AND origem = 'SITE' AND status = 'PENDENTE'`,
    )
    .bind(pedido.id)
    .all<{ id: number }>();

  if (!candidatos || candidatos.length === 0) return { kind: "not_found" };
  if (candidatos.length > 1) return { kind: "ambiguous" };

  const pagamentoId = Number(candidatos[0].id);
  await db
    .prepare(
      `UPDATE pedido_pagamentos SET mp_payment_id = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'PENDENTE' AND mp_payment_id IS NULL`,
    )
    .bind(mpPaymentId, pagamentoId)
    .run();

  return { kind: "found", pagamentoId };
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Porta fiel do protocolo HMAC de produção: manifest
// `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` assinado com
// HMAC-SHA256 e comparado contra x-signature de forma timing-safe.
export async function validateMpWebhookSignature(
  request: Request,
  secret: string,
  dataId: string,
): Promise<boolean> {
  if (!secret) return false;
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const parts = Object.fromEntries(signature.split(",").map((p) => p.trim().split("=")));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  let manifest = "";
  if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return timingSafeEqual(hex(digest), v1.toLowerCase());
}

const RECONCILE_AFTER_SECONDS = 15;
const RECONCILE_BATCH_SIZE = 4;

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
     WHERE metodo = 'PIX_MP' AND status = 'PENDENTE' AND mp_payment_id IS NOT NULL
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
        const payment = await fetchMpPayment(env.MP_ACCESS_TOKEN!, row.mp_payment_id);
        await syncPaymentFromMp(env.DB, row.id, {
          status: payment.status,
          statusDetail: payment.status_detail ?? null,
          dateApproved: payment.date_approved ?? null,
        });
      } catch (err) {
        console.error("Falha ao reconciliar pagamento PIX_MP pendente", row.id, err);
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
// abertura do painel admin. `reserva_expira_em` já embute a folga de 1
// minuto sobre `pix_expira_em`, então não há corrida "liberamos enquanto
// ainda podia ser pago" — reaproveita expireLocalPayment/
// applyLedgerTransition, não reimplementa a regra.
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
