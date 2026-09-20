/// <reference types="@cloudflare/workers-types" />

import type { PedidoAnulacao } from "../../shared/pedidoAnulacao";
export type { PedidoAnulacao } from "../../shared/pedidoAnulacao";

// Exclusão operacional: nunca usar este filtro para consultas de auditoria.
export const pedidoValidoSql = (id: string) =>
  `NOT EXISTS (SELECT 1 FROM pedido_anulacoes an WHERE an.pedido_id = ${id})`;

export async function getPedidoAnulacao(db: D1Database, id: number) {
  return db.prepare(`SELECT * FROM pedido_anulacoes WHERE pedido_id = ?`)
    .bind(id).first<PedidoAnulacao>();
}

export async function recusarPedidoAnulado(db: D1Database, id: number): Promise<Response | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return await getPedidoAnulacao(db, id)
    ? Response.json({ error: "Pedido anulado. O histórico está disponível somente para consulta.", code: "PEDIDO_ANULADO" }, { status: 409 })
    : null;
}
