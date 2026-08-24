import { json } from "../../lib/http.js";
import { mpRequest, validateMpWebhook } from "../../lib/mercadoPago.js";
import { syncOrderPayment } from "../../lib/paymentSync.js";
import { logEvent } from "../../lib/logger.js";

function getBodyDataId(body) {
  const value = body?.data?.id ?? body?.data_id ?? body?.id ?? null;
  return value === null || value === undefined ? "" : String(value);
}

function pedidoIdFromExternalReference(value) {
  const match = /^RP-(\d+)$/.exec(String(value || "").trim());
  return match ? Number(match[1]) : null;
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);

  let body = null;
  try {
    body = await request.clone().json();
  } catch {
    body = null;
  }

  const dataId =
    url.searchParams.get("data.id") ||
    url.searchParams.get("data_id") ||
    getBodyDataId(body);

  const type = String(
    url.searchParams.get("type") ||
    url.searchParams.get("topic") ||
    body?.type ||
    body?.topic ||
    ""
  ).toLowerCase();

  // Sem ID não há o que sincronizar. Outros tipos desconhecidos são reconhecidos
  // sem efeito para evitar retries desnecessários do Mercado Pago.
  const supportedType = !type || ["order", "orders", "payment", "payments"].includes(type);
  if (!dataId || !supportedType) return json({ ok: true });

  if (!env.MP_WEBHOOK_SECRET) {
    logEvent("error", "webhook.error", {
      http_status: 503,
      reason: "MP_HTTP_ERROR"
    });
    return json({ erro: "Webhook não configurado." }, 503);
  }

  const valid = await validateMpWebhook(request, env.MP_WEBHOOK_SECRET, dataId);
  if (!valid) {
    logEvent("warn", "webhook.invalid_signature", {
      http_status: 401,
      reason: "HMAC_MISMATCH"
    });
    return json({ erro: "Assinatura inválida." }, 401);
  }

  let local = null;
  let orderId = null;

  try {
    // O MP pode notificar a Order ou o Payment. Primeiro tentamos resolver o
    // identificador recebido contra os dois IDs persistidos localmente.
    local = await env.DB.prepare(`
      SELECT id, mp_order_id
      FROM pedidos
      WHERE mp_order_id = ? OR mp_payment_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(dataId, dataId).first();

    orderId = local?.mp_order_id ? String(local.mp_order_id) : null;
    let order = null;

    // Para notificações de Order, o próprio data.id é consultável diretamente.
    // Mesmo se o vínculo local ainda não for encontrado, external_reference
    // permite recuperar RP-<id> sem confiar no payload do webhook.
    if (!orderId && (!type || type === "order" || type === "orders")) {
      try {
        order = await mpRequest(env, `/v1/orders/${encodeURIComponent(dataId)}`);
        orderId = order?.id ? String(order.id) : String(dataId);

        if (!local) {
          const pedidoId = pedidoIdFromExternalReference(order?.external_reference);
          if (pedidoId) {
            local = await env.DB.prepare(
              "SELECT id, mp_order_id FROM pedidos WHERE id = ? LIMIT 1"
            ).bind(pedidoId).first();
          }
        }
      } catch (err) {
        // ID fictício do simulador ou notificação que não pertence a uma Order
        // acessível por estas credenciais: reconhece sem alterar pedido algum.
        if (err?.status === 404) return json({ ok: true });
        throw err;
      }
    }

    // Se foi uma notificação de Payment e não conseguimos relacioná-la a um
    // pedido local, não há atualização segura a fazer.
    if (!local || !orderId) return json({ ok: true });

    if (!order) {
      order = await mpRequest(env, `/v1/orders/${encodeURIComponent(orderId)}`);
    }

    await syncOrderPayment(env, { pedidoId: local.id, order, mpOrderId: orderId });

    return json({ ok: true });
  } catch (err) {
    logEvent("error", "webhook.error", {
      pedido_id: local?.id || undefined,
      mp_order_id: orderId || undefined,
      http_status: err?.status || 502,
      reason: err?.status ? "MP_HTTP_ERROR" : "UNKNOWN_ERROR"
    });
    // Em falhas transitórias devolvemos não-2xx para o MP reenviar a notificação.
    return json({ erro: "Falha ao sincronizar pagamento." }, 502);
  }
}
