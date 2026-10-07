/// <reference types="@cloudflare/workers-types" />

import { operationalAlert } from "../operationalAlert";
import { isBrazilCountryCode, orderExternalReference } from "../mp/orders/types";
import type { MpMappedStatus, SyncPaymentResult } from "./types";
import { mapMpStatus } from "./status";
import { type MpPaymentResponse, isVerifiedMpResponse } from "./client";
import type { LedgerStatus } from "../comandaLedger";
import { reconcilePedidoAfterFinancialChange } from "../pedidoReconcile";
import { liberarReservaPedido } from "../stock";
import { enfileirarNovoPedidoPagoSafe, type PushProducerEnv as PushEnv } from "../pushOutbox";

// Matriz de transição de pedido_pagamentos.status (Passo 6, aprovada):
// PENDENTE -> PAGO/CANCELADO/EXPIRADO/REEMBOLSADO: permitido.
// Qualquer estado -> ele mesmo: no-op idempotente, permitido.
// EXPIRADO -> PAGO: apenas com resposta verificada de GET MP.
// PAGO/CANCELADO/FALHOU/REEMBOLSADO -> outra coisa: recusado.
// PAGO -> REEMBOLSADO continua proibido: reembolso de pagamento contabilizado
// permanece evento separado. O terminal colapsado só representa a tentativa
// capturada e devolvida antes de entrar no financeiro local.
function isTransitionAllowed(
  statusAtual: string,
  novoStatus: MpMappedStatus,
  mp?: MpPaymentResponse
): boolean {
  if (statusAtual === novoStatus) return true;
  if (statusAtual === "PENDENTE") return true;
  if (
    statusAtual === "EXPIRADO" &&
    (novoStatus === "PAGO" || novoStatus === "CANCELADO" || novoStatus === "REEMBOLSADO") &&
    mp !== undefined &&
    isVerifiedMpResponse(mp)
  ) {
    return true;
  }
  return false;
}

// Finalização específica do Pix, repetível mesmo sem uma nova transição.
// A reconciliação financeira B3 continua sem responsabilidade de liberação.
async function finalizePayment(
  db: D1Database,
  pagamentoId: number,
  pedidoId: number
): Promise<void> {
  await reconcilePedidoAfterFinancialChange(db, pedidoId);
  const atual = await db
    .prepare(`SELECT metodo, status FROM pedido_pagamentos WHERE id = ?`)
    .bind(pagamentoId)
    .first<{ metodo: string; status: LedgerStatus }>();
  if (
    atual?.metodo === "PIX_MP" &&
    (atual.status === "CANCELADO" || atual.status === "EXPIRADO" || atual.status === "REEMBOLSADO")
  ) {
    const liberacao = await liberarReservaPedido(db, pedidoId);
    if (!liberacao.ok) throw new Error(liberacao.erro); // log no helper; permite retry do chamador
  }
}

interface PagamentoRow {
  id: number;
  pedido_id: number;
  status: LedgerStatus;
  mp_status: string | null;
  mp_status_detail: string | null;
  origem: string;
  valor_centavos: number;
  idempotency_key: string | null;
  token_publico: string;
  mp_order_id: string | null;
  mp_payment_id: string | null;
  external_reference: string | null;
}

function decimalParaCentavos(valor: number | string | null | undefined): number | null {
  if (typeof valor === "number" && !Number.isFinite(valor)) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(valor ?? "").trim());
  if (!match) return null;
  const centavos = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return centavos <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(centavos) : null;
}

function diagnosticoIntegridadeMp(atual: PagamentoRow, mp: MpPaymentResponse): string | null {
  if (mp.order_id !== atual.mp_order_id || mp.id !== atual.mp_payment_id)
    return "INTEGRIDADE_MP:ORDER_DIVERGENTE";
  const valor = decimalParaCentavos(mp.transaction_amount);
  if (valor === null) return "INTEGRIDADE_MP:VALOR_INVALIDO";
  if (valor !== atual.valor_centavos) return "INTEGRIDADE_MP:VALOR_DIVERGENTE";
  if (decimalParaCentavos(mp.total_amount) !== atual.valor_centavos)
    return "INTEGRIDADE_MP:TOTAL_DIVERGENTE";
  if (mp.payment_method_id !== "pix") return "INTEGRIDADE_MP:METODO_DIVERGENTE";
  if (mp.payment_method_type !== "bank_transfer") return "INTEGRIDADE_MP:TIPO_METODO_DIVERGENTE";
  if (
    mp.order_status !== "processed" ||
    !["accredited", "partially_refunded"].includes(mp.order_status_detail ?? "")
  )
    return "INTEGRIDADE_MP:STATUS_ORDER_DIVERGENTE";
  if (
    mp.transaction_status !== "processed" ||
    !["accredited", "partially_refunded"].includes(mp.transaction_status_detail ?? "")
  )
    return "INTEGRIDADE_MP:STATUS_TRANSACAO_DIVERGENTE";
  const referenciaEsperada =
    atual.external_reference ??
    (atual.origem === "SITE" ? atual.token_publico : atual.idempotency_key);
  if (!referenciaEsperada || mp.external_reference !== referenciaEsperada) {
    return "INTEGRIDADE_MP:REFERENCIA_DIVERGENTE";
  }
  if (!isBrazilCountryCode(mp.country_code)) return "INTEGRIDADE_MP:PAIS_DIVERGENTE";
  return null;
}

function identidadeTerminalMpCompativel(atual: PagamentoRow, mp: MpPaymentResponse): boolean {
  const referenciaEsperada =
    atual.external_reference ??
    (atual.origem === "SITE" ? atual.token_publico : atual.idempotency_key);
  return Boolean(
    referenciaEsperada &&
    mp.external_reference === referenciaEsperada &&
    mp.order_id === atual.mp_order_id &&
    mp.id === atual.mp_payment_id &&
    mp.payment_method_id === "pix" &&
    mp.payment_method_type === "bank_transfer" &&
    isBrazilCountryCode(mp.country_code)
  );
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
  env?: PushEnv
): Promise<SyncPaymentResult> {
  if (mp) {
    if (!isVerifiedMpResponse(mp)) throw new Error("RESPOSTA_MP_NAO_VERIFICADA");
    const { results: vinculados } = await db
      .prepare(
        `SELECT id,mp_order_id,mp_payment_id FROM pedido_pagamentos WHERE metodo = 'PIX_MP' AND (mp_payment_id = ? OR mp_order_id = ?) LIMIT 2`
      )
      .bind(String(mp.id), mp.order_id)
      .all<{ id: number; mp_order_id: string | null; mp_payment_id: string | null }>();
    if (
      vinculados.length !== 1 ||
      vinculados[0].id !== pagamentoId ||
      vinculados[0].mp_order_id !== mp.order_id ||
      vinculados[0].mp_payment_id !== mp.id
    ) {
      throw new Error("IDENTIDADE_PAGAMENTO_MP_AMBIGUA_OU_DIVERGENTE");
    }
  } else if (novoStatus !== "EXPIRADO") {
    throw new Error("TRANSICAO_LOCAL_INVALIDA");
  }
  const atual = await db
    .prepare(
      `SELECT pp.id, pp.pedido_id, pp.status, pp.mp_status, pp.mp_status_detail,
                     pp.origem, pp.valor_centavos,
                     pp.idempotency_key, p.token_publico, pp.mp_order_id, pp.mp_payment_id,
                     (SELECT json_extract(o.mp_request, '$.external_reference') FROM pedido_operacoes o
                      WHERE o.pagamento_id = pp.id AND o.tipo IN ('CHECKOUT_SITE','PIX_ADMIN','PIX_ADMIN_REGENERACAO')
                      ORDER BY o.id ASC LIMIT 1) AS external_reference
              FROM pedido_pagamentos pp
              JOIN pedidos p ON p.id = pp.pedido_id
              WHERE pp.id = ?`
    )
    .bind(pagamentoId)
    .first<PagamentoRow>();
  if (!atual) return { ok: false, status: null, transicionou: false };
  if (atual.external_reference === null && atual.origem === "ADMIN" && atual.idempotency_key) {
    atual.external_reference = await orderExternalReference(atual.idempotency_key);
  }
  // A known legacy Payments resource has no readable Orders identity. The
  // cutover must not turn inability to query it into evidence of non-payment.
  if (
    !mp &&
    ["PENDENTE", "EXPIRADO"].includes(atual.status) &&
    atual.mp_payment_id &&
    !/^ORD[A-Za-z0-9]+$/.test(atual.mp_order_id ?? "")
  ) {
    throw new Error("LEGACY_MP_ORDER_ID_AUSENTE");
  }

  // Uma aprovacao remota ja observada, mas ainda nao validada, e um fato
  // financeiro inconclusivo. Expiracao local e respostas posteriores nao
  // aprovadas nao provam que o efeito remoto deixou de existir.
  const mpStatusAtual = String(atual.mp_status || "").toLowerCase();
  const mpStatusRecebido = String(mp?.status || "").toLowerCase();
  const integridadeRemotaPendente =
    !["PAGO", "REEMBOLSADO"].includes(atual.status) &&
    ["approved", "refunded"].includes(mpStatusAtual);
  const resolucaoSemCaptura =
    mp !== undefined &&
    mpStatusAtual === "approved" &&
    ["cancelled", "rejected"].includes(mpStatusRecebido) &&
    identidadeTerminalMpCompativel(atual, mp);
  const resolucaoReembolsada =
    mp !== undefined &&
    mpStatusRecebido === "refunded" &&
    !["PAGO", "REEMBOLSADO"].includes(atual.status) &&
    identidadeTerminalMpCompativel(atual, mp);

  if (!mp && novoStatus === "EXPIRADO" && integridadeRemotaPendente) {
    return { ok: true, status: atual.status, transicionou: false };
  }
  if (
    mp &&
    mpStatusRecebido === "refunded" &&
    !["PAGO", "REEMBOLSADO"].includes(atual.status) &&
    !resolucaoReembolsada
  ) {
    await db
      .prepare(
        `UPDATE pedido_pagamentos
       SET mp_status = 'refunded',
           mp_status_detail = 'INTEGRIDADE_MP:REFUNDED_REQUER_CONCILIACAO',
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND status = ?`
      )
      .bind(pagamentoId, atual.status)
      .run();
    return { ok: true, status: atual.status, transicionou: false };
  }
  if (
    mp &&
    mpStatusAtual === "refunded" &&
    atual.status !== "REEMBOLSADO" &&
    !resolucaoReembolsada
  ) {
    return { ok: true, status: atual.status, transicionou: false };
  }
  if (mp && mpStatusAtual === "refunded" && atual.status === "REEMBOLSADO") {
    await finalizePayment(db, pagamentoId, atual.pedido_id);
    return { ok: true, status: atual.status, transicionou: false };
  }
  if (
    mp &&
    mpStatusRecebido !== "approved" &&
    mpStatusAtual === "approved" &&
    !resolucaoSemCaptura &&
    !resolucaoReembolsada
  ) {
    return { ok: true, status: atual.status, transicionou: false };
  }

  const diagnostico =
    mp && novoStatus === "PAGO" && atual.status !== "PAGO"
      ? diagnosticoIntegridadeMp(atual, mp)
      : null;

  if (mp && !resolucaoSemCaptura && !resolucaoReembolsada) {
    await db
      .prepare(
        `UPDATE pedido_pagamentos SET mp_status = ?, mp_status_detail = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .bind(mp.status, diagnostico ?? mp.status_detail ?? null, pagamentoId)
      .run();
  }

  if (diagnostico) {
    if (atual.mp_status_detail !== diagnostico)
      operationalAlert({
        code: "FINANCIAL_INTEGRITY_MISMATCH",
        pedidoId: atual.pedido_id,
        pagamentoId
      });
    return { ok: true, status: atual.status, transicionou: false };
  }

  if (
    !novoStatus ||
    !isTransitionAllowed(atual.status, novoStatus, mp) ||
    atual.status === novoStatus
  ) {
    await finalizePayment(db, pagamentoId, atual.pedido_id);
    const pos = await db
      .prepare(`SELECT status FROM pedido_pagamentos WHERE id = ?`)
      .bind(pagamentoId)
      .first<{ status: LedgerStatus }>();
    return { ok: true, status: pos?.status ?? atual.status, transicionou: false };
  }

  // A aprovação ou cancelamento podem ter lido PENDENTE e perdido a corrida para a expiração.
  // Revalida os estados elegíveis na própria escrita, sem retry recursivo.
  const origemGuard =
    mp && (novoStatus === "PAGO" || novoStatus === "CANCELADO" || novoStatus === "REEMBOLSADO")
      ? "status IN ('PENDENTE', 'EXPIRADO')"
      : "status = 'PENDENTE'";
  const integridadeGuard =
    mp && novoStatus === "PAGO"
      ? `AND valor_centavos = ? AND origem = ? AND idempotency_key IS ?
       AND EXISTS (SELECT 1 FROM pedidos p WHERE p.id = pedido_pagamentos.pedido_id AND p.token_publico = ?)`
      : "";
  const expiracaoIntegridadeGuard =
    !mp && novoStatus === "EXPIRADO"
      ? "AND LOWER(COALESCE(mp_status, '')) NOT IN ('approved', 'refunded')"
      : "";
  const resolucaoIntegridadeSet =
    resolucaoSemCaptura || resolucaoReembolsada ? ", mp_status = ?, mp_status_detail = ?" : "";
  const resolucaoIntegridadeGuard = resolucaoSemCaptura
    ? "AND LOWER(COALESCE(mp_status, '')) = 'approved'"
    : "";
  // Record the existing notification intent in the same guarded financial write.
  // No outbox insert/Queue failure can undo payment or lose this recovery source.
  const pushIntentSet = novoStatus === "PAGO" && env ? "push_pedido_pago = 1," : "";
  const result = await db
    .prepare(
      `UPDATE pedido_pagamentos
       SET status = ?,
           pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, ?, CURRENT_TIMESTAMP) ELSE pago_em END,
           cancelado_em = CASE WHEN ? IN ('CANCELADO', 'EXPIRADO') THEN COALESCE(cancelado_em, CURRENT_TIMESTAMP) ELSE cancelado_em END
           ${resolucaoIntegridadeSet},
           ${pushIntentSet}
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND ${origemGuard}
         ${mp ? "AND metodo = 'PIX_MP' AND mp_payment_id = ? AND mp_order_id = ? AND NOT EXISTS (SELECT 1 FROM pedido_pagamentos outro WHERE outro.mp_payment_id = ? AND outro.metodo = 'PIX_MP' AND outro.id != pedido_pagamentos.id)" : ""}
         ${expiracaoIntegridadeGuard}
         ${resolucaoIntegridadeGuard}
         ${integridadeGuard}`
    )
    .bind(
      novoStatus,
      novoStatus,
      mp?.date_approved ?? null,
      novoStatus,
      ...(mp !== undefined && (resolucaoSemCaptura || resolucaoReembolsada)
        ? [
            mp.status,
            resolucaoSemCaptura
              ? "INTEGRIDADE_MP:RESOLVIDA_SEM_CAPTURA"
              : "INTEGRIDADE_MP:REFUNDED_RECONHECIDO"
          ]
        : []),
      pagamentoId,
      ...(mp ? [String(mp.id), mp.order_id, String(mp.id)] : []),
      ...(integridadeGuard
        ? [atual.valor_centavos, atual.origem, atual.idempotency_key, atual.token_publico]
        : [])
    )
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
  if (transicionou && integridadeRemotaPendente)
    operationalAlert({
      code: "FINANCIAL_INTEGRITY_RESOLVED",
      pedidoId: atual.pedido_id,
      pagamentoId
    });

  if (novoStatus === "PAGO" && transicionou && env) {
    await enfileirarNovoPedidoPagoSafe(db, env, atual.pedido_id);
  }

  return { ok: true, status: novoStatus, transicionou };
}

// Ponto de entrada usado por webhook, reconciliação do admin e
// refreshPedidoStatus quando já existe uma resposta do Mercado Pago.
export async function syncPaymentFromMp(
  db: D1Database,
  pagamentoId: number,
  mp: MpPaymentResponse,
  env?: PushEnv
): Promise<SyncPaymentResult> {
  if (!isVerifiedMpResponse(mp)) throw new Error("RESPOSTA_MP_NAO_VERIFICADA");
  return applyLedgerTransition(db, pagamentoId, mapMpStatus(mp.status), mp, env);
}

// Caminho local de expiração (pix_expira_em vencido), sem nenhum dado do
// MP envolvido — usado por refreshPedidoStatus. Não sobrescreve
// mp_status/mp_status_detail (não temos nada novo do MP para gravar).
export async function expireLocalPayment(
  db: D1Database,
  pagamentoId: number
): Promise<SyncPaymentResult> {
  return applyLedgerTransition(db, pagamentoId, "EXPIRADO");
}
