import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { mpRequest, mpOrderToLocalStatus, paymentFromOrder } from "../../../lib/mercadoPago.js";

const DIAGNOSTIC_CENTS = 10;
const DIAGNOSTIC_AMOUNT = "0.10";

function adminOnly(auth) {
  return String(auth?.user?.papel || "").toUpperCase() === "ADMIN";
}

function diagnosticToken(env) {
  return String(env?.MP_DIAGNOSTIC_ACCESS_TOKEN || "").trim();
}

function diagnosticPayload(order) {
  const payment = paymentFromOrder(order);
  return {
    order_id: order?.id ? String(order.id) : null,
    payment_id: payment.paymentId,
    status: mpOrderToLocalStatus(order),
    mp_status: order?.status || null,
    mp_status_detail: order?.status_detail || null,
    qr_code: payment.qrCode,
    qr_code_base64: payment.qrCodeBase64,
    ticket_url: payment.ticketUrl,
    valor_centavos: DIAGNOSTIC_CENTS,
    valor: DIAGNOSTIC_AMOUNT,
    real: true,
    isolated: true
  };
}

export async function onRequestPost({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!adminOnly(auth)) return json({ erro: "Apenas administradores podem gerar Pix real de diagnóstico." }, 403);

  const accessToken = diagnosticToken(env);
  if (!accessToken) {
    return json({ erro: "MP_DIAGNOSTIC_ACCESS_TOKEN não configurado. O token comercial não será usado como fallback." }, 503);
  }

  const key = `rpdiag_${crypto.randomUUID().replaceAll("-", "")}`;
  const externalReference = `RP-DIAG-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const order = await mpRequest(env, "/v1/orders", {
      method: "POST",
      idempotencyKey: key,
      accessToken,
      body: {
        type: "online",
        processing_mode: "automatic",
        external_reference: externalReference,
        total_amount: DIAGNOSTIC_AMOUNT,
        payer: {
          email: "diagnostico@rpdoces.com.br",
          first_name: "Diagnostico"
        },
        transactions: {
          payments: [
            {
              amount: DIAGNOSTIC_AMOUNT,
              payment_method: { id: "pix", type: "bank_transfer" },
              expiration_time: "PT30M"
            }
          ]
        }
      }
    });

    return json({
      ...diagnosticPayload(order),
      external_reference: externalReference,
      aviso: "Transação real de R$ 0,10 usando exclusivamente a credencial de diagnóstico."
    }, 201);
  } catch (error) {
    console.error("Falha ao gerar Pix real de diagnóstico", error?.data || error);
    return json({
      erro: "Não foi possível gerar o Pix real de diagnóstico.",
      detalhe: error?.data?.message || error?.message || null
    }, Number(error?.status) || 502);
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!adminOnly(auth)) return json({ erro: "Apenas administradores podem consultar Pix real de diagnóstico." }, 403);

  const accessToken = diagnosticToken(env);
  if (!accessToken) {
    return json({ erro: "MP_DIAGNOSTIC_ACCESS_TOKEN não configurado. O token comercial não será usado como fallback." }, 503);
  }

  const url = new URL(request.url);
  const orderId = String(url.searchParams.get("order_id") || "").trim();
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(orderId)) return json({ erro: "order_id inválido." }, 400);

  try {
    const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(orderId)}`, { accessToken });
    return json(diagnosticPayload(order), 200);
  } catch (error) {
    console.error("Falha ao consultar Pix real de diagnóstico", error?.data || error);
    return json({
      erro: "Não foi possível consultar o Pix real de diagnóstico.",
      detalhe: error?.data?.message || error?.message || null
    }, Number(error?.status) || 502);
  }
}
