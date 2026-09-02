import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { mpRequest, mpOrderToLocalStatus, paymentFromOrder } from "../../../lib/mercadoPago.js";

const DIAGNOSTIC_CENTS = 10;
const DIAGNOSTIC_AMOUNT = "0.10";

function adminOnly(auth) {
  const papel = String(auth?.user?.papel || "").toUpperCase();
  return papel === "OWNER" || papel === "ADMIN";
}

function diagnosticToken(env) {
  return String(env?.MP_DIAGNOSTIC_ACCESS_TOKEN || "").trim();
}

function diagnosticPayload(order, diagnostic = null) {
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
    isolated: true,
    webhook_recebido: Boolean(diagnostic?.webhook_recebido_em),
    webhook_recebido_em: diagnostic?.webhook_recebido_em || null,
    webhook_data_id: diagnostic?.webhook_data_id || null,
    pago_em: diagnostic?.pago_em || null
  };
}

async function findDiagnostic(env, orderId) {
  return env.DB.prepare(
    `SELECT external_reference, mp_order_id, mp_payment_id, status, mp_status, mp_status_detail,
            criado_em, atualizado_em, pago_em, webhook_recebido_em, webhook_data_id, webhook_request_id
     FROM pix_diagnosticos
     WHERE mp_order_id = ?
     LIMIT 1`
  )
    .bind(orderId)
    .first();
}

async function findLatestDiagnostic(env) {
  return env.DB.prepare(
    `SELECT external_reference, mp_order_id, mp_payment_id, status, mp_status, mp_status_detail,
            criado_em, atualizado_em, pago_em, webhook_recebido_em, webhook_data_id, webhook_request_id
     FROM pix_diagnosticos
     WHERE mp_order_id IS NOT NULL
     ORDER BY criado_em DESC
     LIMIT 1`
  ).first();
}

async function updateDiagnosticFromOrder(env, order) {
  const orderId = order?.id ? String(order.id) : "";
  if (!orderId) return null;

  const payment = paymentFromOrder(order);
  const status = mpOrderToLocalStatus(order);
  await env.DB.prepare(
    `UPDATE pix_diagnosticos
     SET mp_payment_id = COALESCE(?, mp_payment_id),
         status = ?,
         mp_status = ?,
         mp_status_detail = ?,
         pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, CURRENT_TIMESTAMP) ELSE pago_em END,
         atualizado_em = CURRENT_TIMESTAMP
     WHERE mp_order_id = ?`
  )
    .bind(
      payment.paymentId,
      status,
      order?.status || null,
      order?.status_detail || null,
      status,
      orderId
    )
    .run();

  return findDiagnostic(env, orderId);
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

    const payment = paymentFromOrder(order);
    const status = mpOrderToLocalStatus(order);
    let diagnostic = null;
    let trackingError = null;

    try {
      await env.DB.prepare(
        `INSERT INTO pix_diagnosticos
          (external_reference, mp_order_id, mp_payment_id, valor_centavos, status, mp_status, mp_status_detail, pago_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'PAGO' THEN CURRENT_TIMESTAMP ELSE NULL END)`
      )
        .bind(
          externalReference,
          order?.id ? String(order.id) : null,
          payment.paymentId,
          DIAGNOSTIC_CENTS,
          status,
          order?.status || null,
          order?.status_detail || null,
          status
        )
        .run();
      diagnostic = await findDiagnostic(env, String(order?.id || ""));
    } catch (dbError) {
      trackingError = dbError?.message || "Falha ao registrar diagnóstico.";
      console.error("Pix real criado, mas rastreio diagnóstico falhou", dbError);
    }

    return json({
      ...diagnosticPayload(order, diagnostic),
      external_reference: externalReference,
      webhook_rastreavel: !trackingError,
      rastreio_erro: trackingError,
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
  let orderId = String(url.searchParams.get("order_id") || "").trim();
  const latest = url.searchParams.get("latest") === "1";

  if (!orderId && latest) {
    const diagnostic = await findLatestDiagnostic(env);
    if (!diagnostic?.mp_order_id) return json({ diagnostico: false }, 200);
    orderId = String(diagnostic.mp_order_id);
  }

  if (!/^[A-Za-z0-9_-]{3,120}$/.test(orderId)) return json({ erro: "order_id inválido." }, 400);

  try {
    const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(orderId)}`, { accessToken });
    const diagnostic = await updateDiagnosticFromOrder(env, order);
    return json({ ...diagnosticPayload(order, diagnostic), diagnostico: true }, 200);
  } catch (error) {
    console.error("Falha ao consultar Pix real de diagnóstico", error?.data || error);
    return json({
      erro: "Não foi possível consultar Pix real de diagnóstico.",
      detalhe: error?.data?.message || error?.message || null
    }, Number(error?.status) || 502);
  }
}
