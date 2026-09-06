import { json, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import { recalculateComanda } from "../../../../lib/comandaLedger.js";
import { logEvent } from "../../../../lib/logger.js";

async function confirmedPaidCents(env, pedido) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(valor_centavos), 0) AS total_centavos
     FROM pedido_pagamentos
     WHERE pedido_id = ? AND status = 'PAGO'`
  )
    .bind(pedido.id)
    .first();

  const ledgerPaid = Number(row?.total_centavos || 0);
  if (ledgerPaid > 0) return ledgerPaid;

  return String(pedido.status_pagamento || "").toUpperCase() === "PAGO"
    ? Number(pedido.valor_total_centavos || 0)
    : 0;
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  if (!Number.isInteger(pedidoId) || pedidoId < 1) {
    return json({ erro: "Pedido inválido." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, status_pedido, status_pagamento, status_comanda,
            reserva_status, estoque_baixado_em, valor_total_centavos
     FROM pedidos
     WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();

  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);

  if (String(pedido.status_comanda || "ABERTA").toUpperCase() !== "ENCERRADA") {
    return json({ ok: true, pedido_id: pedidoId, ja_aberta: true });
  }

  const pagoCentavos = await confirmedPaidCents(env, pedido);
  if (pagoCentavos <= 0) {
    return json({
      erro: "Esta comanda não possui pagamento confirmado. Reabra pelo fluxo de pagamento pendente.",
      codigo: "COMANDA_SEM_PAGAMENTO_CONFIRMADO"
    }, 409);
  }

  const result = await env.DB.prepare(
    `UPDATE pedidos SET
       status_comanda = 'ABERTA',
       status_pedido = CASE WHEN status_pedido = 'CANCELADO' THEN 'NOVO' ELSE status_pedido END,
       atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ? AND status_comanda = 'ENCERRADA'`
  )
    .bind(pedidoId)
    .run();

  if (Number(result?.meta?.changes || 0) !== 1) {
    return json({ erro: "Não foi possível reabrir a comanda." }, 409);
  }

  // O ledger é a fonte da verdade financeira. Recalcular aqui corrige apenas
  // projeções antigas como status_pagamento=CANCELADO, sem tocar nos pagamentos
  // registrados, nas alocações ou nas baixas físicas de estoque.
  const financeiro = await recalculateComanda(env, pedidoId);
  if (!financeiro) {
    return json({ erro: "A comanda foi reaberta, mas o financeiro não pôde ser reconciliado." }, 409);
  }

  logEvent("info", "comanda.reopened_paid", {
    pedido_id: pedidoId,
    paid_cents: financeiro.pago_centavos,
    user_id: auth.user.id,
    stock_preserved: true
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    status_comanda: "ABERTA",
    status_pedido: String(pedido.status_pedido || "").toUpperCase() === "CANCELADO" ? "NOVO" : pedido.status_pedido,
    status_pagamento: financeiro.status_financeiro,
    valor_pago_centavos: financeiro.pago_centavos,
    saldo_centavos: financeiro.saldo_centavos,
    credito_centavos: financeiro.credito_centavos,
    estoque_preservado: true
  });
}
