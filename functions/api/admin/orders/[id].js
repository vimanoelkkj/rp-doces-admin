import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { baixarEstoquePedido, liberarReservaPedido } from "../../../lib/stock.js";

const VALIDOS = new Set(["NOVO", "PREPARANDO", "PRONTO", "ENTREGUE", "CANCELADO"]);
const PAGAMENTOS_MANUAIS = new Set(["PAGO", "CANCELADO"]);

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const id = Number(params.id);
  const body = await bodyJson(request);
  if (!Number.isInteger(id) || id < 1) return json({ erro: "Dados inválidos." }, 400);

  const pedido = await env.DB.prepare(
    `SELECT id, origem_pedido, status_pedido, status_pagamento, reserva_status, estoque_baixado_em
     FROM pedidos WHERE id = ? LIMIT 1`
  )
    .bind(id)
    .first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);

  if (body?.status_pagamento != null) {
    const nextPayment = String(body.status_pagamento || "").toUpperCase();
    if (pedido.origem_pedido !== "MANUAL" || !PAGAMENTOS_MANUAIS.has(nextPayment)) {
      return json({ erro: "Alteração de pagamento inválida." }, 400);
    }
    if (pedido.status_pagamento !== "PENDENTE") {
      return json({ erro: "Somente pagamentos manuais pendentes podem ser alterados." }, 409);
    }

    if (nextPayment === "PAGO") {
      await env.DB.prepare(
        `UPDATE pedidos
         SET status_pagamento = 'PAGO', pago_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status_pagamento = 'PENDENTE'`
      )
        .bind(id)
        .run();

      const stock = await baixarEstoquePedido(env, id);
      if (!stock.ok) {
        await env.DB.prepare(
          `UPDATE pedidos
           SET status_pagamento = 'PENDENTE', pago_em = NULL, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ? AND estoque_baixado_em IS NULL`
        )
          .bind(id)
          .run();
        return json({ erro: "Não foi possível confirmar o pagamento por inconsistência no estoque." }, 409);
      }

      return json({ ok: true, id, status_pagamento: "PAGO" });
    }

    const released = await liberarReservaPedido(env, id, { novoStatus: "CANCELADO" });
    if (!released.ok) {
      return json({ erro: "Não foi possível liberar o estoque reservado." }, 409);
    }
    await env.DB.prepare(
      `UPDATE pedidos
       SET status_pedido = 'CANCELADO', atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(id)
      .run();
    return json({ ok: true, id, status_pagamento: "CANCELADO", status_pedido: "CANCELADO" });
  }

  const status = String(body?.status_pedido || "").toUpperCase();
  if (!VALIDOS.has(status)) return json({ erro: "Dados inválidos." }, 400);

  if (
    status === "CANCELADO" &&
    pedido.origem_pedido === "MANUAL" &&
    pedido.status_pagamento === "PENDENTE" &&
    pedido.reserva_status === "ATIVA"
  ) {
    const released = await liberarReservaPedido(env, id, { novoStatus: "CANCELADO" });
    if (!released.ok) return json({ erro: "Não foi possível liberar o estoque reservado." }, 409);
  }

  await env.DB.prepare(
    "UPDATE pedidos SET status_pedido = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(status, id)
    .run();

  return json({ ok: true, id, status_pedido: status });
}
