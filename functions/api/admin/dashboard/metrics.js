import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcBoundsForBrazilDay(value) {
  if (!DATE_RE.test(value)) return null;
  const start = new Date(`${value}T00:00:00-03:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 86_400_000);
  const sqlDate = date => date.toISOString().slice(0, 19).replace("T", " ");
  return { start: sqlDate(start), end: sqlDate(end) };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const date = String(url.searchParams.get("date") || "");
  const bounds = utcBoundsForBrazilDay(date);
  if (!bounds) return json({ erro: "Data inválida. Use AAAA-MM-DD." }, 400);

  const [received, settled, created] = await Promise.all([
    env.DB.prepare(
      `SELECT
         COALESCE(SUM(valor_centavos), 0) AS recebido_centavos,
         COUNT(*) AS pagamentos_confirmados,
         COUNT(DISTINCT pedido_id) AS pedidos_com_recebimento
       FROM (
         SELECT
           pp.pedido_id,
           pp.valor_centavos,
           COALESCE(pp.pago_em, pp.atualizado_em) AS recebido_em
         FROM pedido_pagamentos pp
         INNER JOIN pedidos p ON p.id = pp.pedido_id
         WHERE pp.status = 'PAGO'
           AND UPPER(COALESCE(p.status_pedido, '')) <> 'CANCELADO'

         UNION ALL

         SELECT
           p.id AS pedido_id,
           p.valor_total_centavos AS valor_centavos,
           COALESCE(p.pago_em, p.atualizado_em) AS recebido_em
         FROM pedidos p
         WHERE UPPER(COALESCE(p.origem_pedido, '')) = 'MANUAL'
           AND UPPER(COALESCE(p.status_pagamento, '')) = 'PAGO'
           AND UPPER(COALESCE(p.status_pedido, '')) <> 'CANCELADO'
           AND NOT EXISTS (
             SELECT 1
             FROM pedido_pagamentos pp2
             WHERE pp2.pedido_id = p.id
               AND pp2.status = 'PAGO'
           )
       ) recebimentos
       WHERE recebido_em >= ?
         AND recebido_em < ?`
    ).bind(bounds.start, bounds.end).first(),
    env.DB.prepare(
      `SELECT
         COUNT(*) AS pedidos_quitados,
         COALESCE(SUM(p.valor_total_centavos), 0) AS vendas_quitadas_centavos,
         COALESCE(SUM((
           SELECT COALESCE(SUM(pi.quantidade), 0)
           FROM pedido_itens pi
           WHERE pi.pedido_id = p.id
         )), 0) AS itens_vendidos
       FROM pedidos p
       WHERE UPPER(COALESCE(p.status_pagamento, '')) = 'PAGO'
         AND UPPER(COALESCE(p.status_pedido, '')) <> 'CANCELADO'
         AND COALESCE(p.pago_em, p.atualizado_em) >= ?
         AND COALESCE(p.pago_em, p.atualizado_em) < ?`
    ).bind(bounds.start, bounds.end).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS pedidos_criados
       FROM pedidos
       WHERE UPPER(COALESCE(status_pedido, '')) <> 'CANCELADO'
         AND criado_em >= ?
         AND criado_em < ?`
    ).bind(bounds.start, bounds.end).first()
  ]);

  const paidOrders = Number(settled?.pedidos_quitados || 0);
  const settledCents = Number(settled?.vendas_quitadas_centavos || 0);

  return json({
    date,
    recebido_centavos: Number(received?.recebido_centavos || 0),
    pagamentos_confirmados: Number(received?.pagamentos_confirmados || 0),
    pedidos_com_recebimento: Number(received?.pedidos_com_recebimento || 0),
    vendas_quitadas_centavos: settledCents,
    pedidos_quitados: paidOrders,
    itens_vendidos: Number(settled?.itens_vendidos || 0),
    pedidos_criados: Number(created?.pedidos_criados || 0),
    ticket_medio_centavos: paidOrders ? Math.round(settledCents / paidOrders) : 0
  });
}
