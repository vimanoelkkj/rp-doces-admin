import { json, sameOrigin } from "../../../lib/http.js";
import { mpRequest } from "../../../lib/mercadoPago.js";
import { syncOrderPayment } from "../../../lib/paymentSync.js";
import { logEvent } from "../../../lib/logger.js";

function isValidToken(token) {
  return /^[0-9a-f-]{36}$/i.test(token);
}

function canceledResponse(pedido) {
  return json({
    pedido: {
      token: pedido.token_publico,
      status: "CANCELADO"
    }
  });
}

async function syncCurrentOrder(env, pedido) {
  const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}`);
  return syncOrderPayment(env, {
    pedidoId: pedido.id,
    order,
    mpOrderId: pedido.mp_order_id
  });
}

export async function onRequestPost({ request, params, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  if (!env.MP_ACCESS_TOKEN) return json({ erro: "Pagamento Pix ainda não configurado." }, 503);

  const token = String(params.token || "");
  if (!isValidToken(token)) return json({ erro: "Pedido inválido." }, 400);

  const pedido = await env.DB.prepare(
    `
    SELECT id, token_publico, status_pagamento, mp_order_id
    FROM pedidos
    WHERE token_publico = ?
    LIMIT 1
  `
  )
    .bind(token)
    .first();

  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (pedido.status_pagamento === "CANCELADO") return canceledResponse(pedido);
  if (["PAGO", "REEMBOLSADO"].includes(pedido.status_pagamento)) {
    return json({ erro: "Este pedido já foi pago e não pode mais ser cancelado." }, 409);
  }
  if (pedido.status_pagamento !== "PENDENTE") {
    return json({ erro: "Este pedido já foi encerrado e não pode mais ser cancelado." }, 409);
  }
  if (!pedido.mp_order_id) {
    return json({ erro: "O Pix ainda não está pronto para cancelamento." }, 409);
  }

  try {
    const current = await syncCurrentOrder(env, pedido);
    if (current.status_pagamento === "CANCELADO") return canceledResponse(pedido);
    if (current.status_pagamento === "PAGO") {
      return json(
        { erro: "O pagamento já foi confirmado e o pedido não pode ser cancelado." },
        409
      );
    }
    if (current.status_pagamento !== "PENDENTE") {
      return json({ erro: "Este Pix já foi encerrado e não pode mais ser cancelado." }, 409);
    }

    const canceledOrder = await mpRequest(
      env,
      `/v1/orders/${encodeURIComponent(pedido.mp_order_id)}/cancel`,
      {
        method: "POST",
        idempotencyKey: crypto.randomUUID()
      }
    );

    const canceled = await syncOrderPayment(env, {
      pedidoId: pedido.id,
      order: canceledOrder,
      mpOrderId: pedido.mp_order_id
    });

    if (canceled.status_pagamento !== "CANCELADO") {
      return json({ erro: "O Mercado Pago não confirmou o cancelamento do Pix." }, 409);
    }

    logEvent("info", "payment.cancelled_by_customer", {
      pedido_id: pedido.id,
      mp_order_id: pedido.mp_order_id,
      status: "CANCELADO"
    });

    return canceledResponse(pedido);
  } catch (err) {
    if (err?.status === 409) {
      try {
        const current = await syncCurrentOrder(env, pedido);
        if (current.status_pagamento === "CANCELADO") return canceledResponse(pedido);
        if (current.status_pagamento === "PAGO") {
          return json(
            {
              erro: "O pagamento foi confirmado antes do cancelamento e o pedido continua válido."
            },
            409
          );
        }
      } catch {
        // Mantém o erro original de conflito quando a reconciliação também falhar.
      }
      return json({ erro: "Não foi possível cancelar este Pix no estado atual." }, 409);
    }

    logEvent("warn", "payment.cancel_failed", {
      pedido_id: pedido.id,
      mp_order_id: pedido.mp_order_id,
      http_status: err?.status || undefined,
      reason: err?.status ? "MP_HTTP_ERROR" : "MP_TIMEOUT"
    });
    return json({ erro: "Não foi possível cancelar o Pix agora. Tente novamente." }, 502);
  }
}
