/// <reference types="@cloudflare/workers-types" />

import { chargeableCapacitySql, liveAdminPixPredicate } from "../financialCoverage";
import type { PixAdminPendente } from "./types";

const CAPACIDADE_COBRAVEL_SQL = chargeableCapacitySql("?");

export async function getCapacidadeCobravel(
  db: D1Database,
  pedidoId: number,
  substituiId: number | null = null,
): Promise<number> {
  const row = await db
    .prepare(`SELECT ${CAPACIDADE_COBRAVEL_SQL} AS capacidade`)
    .bind(substituiId, pedidoId)
    .first<{ capacidade: number }>();
  return Math.max(0, Number(row?.capacidade || 0));
}

interface PixAdminPendenteRow {
  id: number;
  valor_centavos: number;
  mp_qr_code: string | null;
  mp_qr_code_base64: string | null;
  mp_ticket_url: string | null;
  pix_expira_em: string | null;
}

// Leitura pura — nenhuma escrita, nenhuma decisão financeira nova. Reaproveita
// a MESMA definição de "ainda vivo" usada pela regeneração:
// um pedido pode legitimamente ter vários PIX_MP/ADMIN/PENDENTE simultâneos
// (Pix parciais aditivos, não uma cadeia de substituição entre si) — por
// isso é uma LISTA, nunca "o mais recente". `expiresAt` vencido não é
// escondido/filtrado aqui: só o backend/reconciliação (paymentSync.ts) tem
// autoridade para transicionar PENDENTE -> EXPIRADO; esta função devolve o
// que o ledger diz agora, sem inventar estado.
export async function getPixAdminPendentesAtivos(
  db: D1Database,
  pedidoId: number,
): Promise<PixAdminPendente[]> {
  const { results } = await db
    .prepare(
      `SELECT id, valor_centavos, mp_qr_code, mp_qr_code_base64, mp_ticket_url, pix_expira_em
       FROM pedido_pagamentos pp
       WHERE pp.pedido_id = ? AND pp.metodo = 'PIX_MP' AND pp.origem = 'ADMIN' AND pp.status = 'PENDENTE'
         AND ${liveAdminPixPredicate("pp")}
       ORDER BY id ASC`,
    )
    .bind(pedidoId)
    .all<PixAdminPendenteRow>();

  return (results || []).map((r) => ({
    id: r.id,
    valorCentavos: r.valor_centavos,
    qrCode: r.mp_qr_code,
    qrCodeBase64: r.mp_qr_code_base64,
    ticketUrl: r.mp_ticket_url,
    expiresAt: r.pix_expira_em,
  }));
}
