/// <reference types="@cloudflare/workers-types" />

import {
  conflitoOperacao,
  parseResultado,
  type IdentidadeEsperada,
  type OperacaoRow,
} from "../operacoes";
import type {
  GerarPixAdminResult,
  GerarPixAdminSucesso,
} from "./types";

// A1 — replay de uma operação de Pix administrativo. Nunca faz outro POST,
// nunca cria outra tentativa, nunca mexe na reserva.
export async function replayPixAdmin(
  db: D1Database,
  operacao: OperacaoRow,
  identidade: IdentidadeEsperada,
): Promise<GerarPixAdminResult> {
  const conflito = conflitoOperacao(operacao, identidade);
  if (conflito) return { ok: false, erro: conflito };

  // Recusa comprovada do Mercado Pago é terminal para esta key.
  if (operacao.fase === "RECUSADA") {
    if (operacao.erro === "PIX_SUBSTITUTO_JA_PAGO") return { ok: false, erro: "PIX_SUBSTITUTO_JA_PAGO" };
    if (operacao.erro === "PIX_PARA_SUBSTITUIR_INVALIDO") return { ok: false, erro: "PIX_PARA_SUBSTITUIR_INVALIDO" };
    return { ok: false, erro: "MERCADO_PAGO_RECUSOU" };
  }

  const snapshot = parseResultado<GerarPixAdminSucesso>(operacao);
  if (snapshot) {
    if (!snapshot.pagamentoId && operacao.pagamento_id) {
      snapshot.pagamentoId = operacao.pagamento_id;
    }
    return { ...snapshot, ok: true, replay: true };
  }

  if (operacao.tipo === "PIX_ADMIN_REGENERACAO") {
    const bPagamento = await db
      .prepare(
        `SELECT id, valor_centavos, mp_payment_id, mp_status, mp_qr_code,
                mp_qr_code_base64, mp_ticket_url, pix_expira_em
         FROM pedido_pagamentos
         WHERE substitui_pagamento_id = ? AND status = 'PENDENTE'
         LIMIT 1`,
      )
      .bind(operacao.pagamento_id)
      .first<{
        id: number;
        valor_centavos: number;
        mp_payment_id: string | null;
        mp_status: string | null;
        mp_qr_code: string | null;
        mp_qr_code_base64: string | null;
        mp_ticket_url: string | null;
        pix_expira_em: string | null;
      }>();

    if (bPagamento && bPagamento.mp_payment_id) {
      return {
        ok: true,
        replay: true,
        pagamentoId: bPagamento.id,
        valorCentavos: bPagamento.valor_centavos,
        mpPaymentId: bPagamento.mp_payment_id,
        mpStatus: bPagamento.mp_status ?? "pending",
        qrCode: bPagamento.mp_qr_code,
        qrCodeBase64: bPagamento.mp_qr_code_base64,
        ticketUrl: bPagamento.mp_ticket_url,
        expiresAt: bPagamento.pix_expira_em,
      };
    }

    return { ok: false, erro: "OPERACAO_EM_PROCESSAMENTO" };
  }

  const pagamento = operacao.pagamento_id
    ? await db
        .prepare(
          `SELECT id, valor_centavos, mp_payment_id, mp_status, mp_qr_code,
                  mp_qr_code_base64, mp_ticket_url, pix_expira_em
           FROM pedido_pagamentos WHERE id = ? LIMIT 1`,
        )
        .bind(operacao.pagamento_id)
        .first<{
          id: number;
          valor_centavos: number;
          mp_payment_id: string | null;
          mp_status: string | null;
          mp_qr_code: string | null;
          mp_qr_code_base64: string | null;
          mp_ticket_url: string | null;
          pix_expira_em: string | null;
        }>()
    : null;

  if (!pagamento) return { ok: false, erro: "OPERACAO_INCOMPLETA" };

  if (pagamento.mp_payment_id) {
    return {
      ok: true,
      replay: true,
      pagamentoId: pagamento.id,
      valorCentavos: pagamento.valor_centavos,
      mpPaymentId: pagamento.mp_payment_id,
      mpStatus: pagamento.mp_status ?? "pending",
      qrCode: pagamento.mp_qr_code,
      qrCodeBase64: pagamento.mp_qr_code_base64,
      ticketUrl: pagamento.mp_ticket_url,
      expiresAt: pagamento.pix_expira_em,
    };
  }

  // Tentativa local existe, recurso remoto não é conhecido: a operação
  // continua a MESMA, inconclusiva. Sem reenvio automático, sem nova key,
  // sem inventar sucesso/rejeição e sem tocar na reserva do pedido (B4).
  return { ok: false, erro: "OPERACAO_EM_PROCESSAMENTO" };
}
