import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { mpRequest, mpOrderToLocalStatus } from "../../../lib/mercadoPago.js";

const CONFIRMED_REFUND_STATUSES = new Set(["approved", "processed", "refunded"]);

function adminOnly(auth) {
  const papel = String(auth?.user?.papel || "").toUpperCase();
  return papel === "OWNER" || papel === "ADMIN";
}

function diagnosticToken(env) {
  return String(env?.MP_DIAGNOSTIC_ACCESS_TOKEN || "").trim();
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function refundFromOrder(order) {
  const refunds = order?.transactions?.refunds || [];
  const refund = refunds.find(item => CONFIRMED_REFUND_STATUSES.has(normalize(item?.status))) || refunds[0] || null;
  return {
    id: refund?.id ? String(refund.id) : null,
    status: normalize(refund?.status || order?.status),
    confirmed: normalize(order?.status) === "refunded" || Boolean(refund && CONFIRMED_REFUND_STATUSES.has(normalize(refund.status)))
  };
}

async function findDiagnostic(env, orderId) {
  return env.DB.prepare(
    `SELECT external_reference, mp_order_id, mp_payment_id, valor_centavos, status,
            reembolso_status, mp_refund_id, mp_refund_status,
            reembolso_solicitado_em, reembolsado_em
     FROM pix_diagnosticos
     WHERE mp_order_id = ?
     LIMIT 1`
  ).bind(orderId).first();
}

function payload(row) {
  return {
    order_id: row?.mp_order_id ? String(row.mp_order_id) : null,
    valor_centavos: Number(row?.valor_centavos || 0),
    reembolso_status: row?.reembolso_status || null,
    mp_refund_id: row?.mp_refund_id || null,
    mp_refund_status: row?.mp_refund_status || null,
    reembolso_solicitado_em: row?.reembolso_solicitado_em || null,
    reembolsado_em: row?.reembolsado_em || null,
    reembolsado: Boolean(row?.reembolsado_em) || String(row?.reembolso_status || "").toUpperCase() === "REEMBOLSADO"
  };
}

async function reconcileRefund(env, accessToken, row) {
  if (!row?.mp_order_id) return row;

  try {
    const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(row.mp_order_id)}`, { accessToken });
    const refund = refundFromOrder(order);
    const localStatus = mpOrderToLocalStatus(order);

    if (refund.confirmed || localStatus === "REEMBOLSADO") {
      await env.DB.prepare(
        `UPDATE pix_diagnosticos
         SET status = 'REEMBOLSADO',
             reembolso_status = 'REEMBOLSADO',
             mp_status = ?,
             mp_status_detail = ?,
             mp_refund_id = COALESCE(?, mp_refund_id),
             mp_refund_status = COALESCE(?, mp_refund_status),
             reembolsado_em = COALESCE(reembolsado_em, CURRENT_TIMESTAMP),
             atualizado_em = CURRENT_TIMESTAMP
         WHERE mp_order_id = ?`
      ).bind(
        order?.status || null,
        order?.status_detail || null,
        refund.id,
        refund.status || "processed",
        row.mp_order_id
      ).run();
      return findDiagnostic(env, row.mp_order_id);
    }
  } catch (error) {
    console.warn("Falha ao reconciliar reembolso do Pix diagnostico", error?.data || error);
  }

  return row;
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!adminOnly(auth)) return json({ erro: "Apenas administradores podem consultar o reembolso do diagnóstico." }, 403);

  const accessToken = diagnosticToken(env);
  if (!accessToken) return json({ erro: "MP_DIAGNOSTIC_ACCESS_TOKEN não configurado." }, 503);

  const orderId = String(new URL(request.url).searchParams.get("order_id") || "").trim();
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(orderId)) return json({ erro: "order_id inválido." }, 400);

  let row = await findDiagnostic(env, orderId);
  if (!row) return json({ erro: "Diagnóstico não encontrado." }, 404);

  if (row.reembolso_status === "PROCESSANDO") row = await reconcileRefund(env, accessToken, row);
  return json(payload(row), 200);
}

export async function onRequestPost({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!adminOnly(auth)) return json({ erro: "Apenas administradores podem reembolsar o Pix de diagnóstico." }, 403);

  const accessToken = diagnosticToken(env);
  if (!accessToken) return json({ erro: "MP_DIAGNOSTIC_ACCESS_TOKEN não configurado." }, 503);

  const body = await request.json().catch(() => ({}));
  const orderId = String(body?.order_id || "").trim();
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(orderId)) return json({ erro: "order_id inválido." }, 400);

  let row = await findDiagnostic(env, orderId);
  if (!row) return json({ erro: "Diagnóstico não encontrado." }, 404);

  if (row.reembolsado_em || row.reembolso_status === "REEMBOLSADO") {
    return json({ ...payload(row), ja_reembolsado: true }, 200);
  }

  if (row.status !== "PAGO" && row.status !== "REEMBOLSADO") {
    return json({ erro: "Somente um Pix diagnóstico pago pode ser reembolsado." }, 409);
  }

  const idempotencyKey = `rpdiag_refund_${orderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)}`;

  await env.DB.prepare(
    `UPDATE pix_diagnosticos
     SET reembolso_status = 'PROCESSANDO',
         reembolso_solicitado_em = COALESCE(reembolso_solicitado_em, CURRENT_TIMESTAMP),
         atualizado_em = CURRENT_TIMESTAMP
     WHERE mp_order_id = ?`
  ).bind(orderId).run();

  try {
    const response = await mpRequest(
      env,
      `/v1/orders/${encodeURIComponent(orderId)}/refund`,
      { method: "POST", idempotencyKey, accessToken }
    );

    const refund = refundFromOrder(response);
    if (refund.confirmed || mpOrderToLocalStatus(response) === "REEMBOLSADO") {
      await env.DB.prepare(
        `UPDATE pix_diagnosticos
         SET status = 'REEMBOLSADO',
             reembolso_status = 'REEMBOLSADO',
             mp_status = ?,
             mp_status_detail = ?,
             mp_refund_id = ?,
             mp_refund_status = ?,
             reembolsado_em = COALESCE(reembolsado_em, CURRENT_TIMESTAMP),
             atualizado_em = CURRENT_TIMESTAMP
         WHERE mp_order_id = ?`
      ).bind(
        response?.status || "refunded",
        response?.status_detail || null,
        refund.id,
        refund.status || "processed",
        orderId
      ).run();
    }

    row = await findDiagnostic(env, orderId);
    if (row.reembolso_status === "PROCESSANDO") row = await reconcileRefund(env, accessToken, row);

    return json({
      ...payload(row),
      real: true,
      isolated: true,
      aviso: "Reembolso real do Pix diagnóstico solicitado ao Mercado Pago."
    }, row.reembolso_status === "REEMBOLSADO" ? 200 : 202);
  } catch (error) {
    await env.DB.prepare(
      `UPDATE pix_diagnosticos
       SET reembolso_status = 'FALHOU',
           mp_refund_status = ?,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE mp_order_id = ?`
    ).bind(String(error?.data?.message || error?.message || "falhou").slice(0, 200), orderId).run();

    console.error("Falha ao reembolsar Pix real de diagnóstico", error?.data || error);
    return json({
      erro: "Não foi possível reembolsar o Pix real de diagnóstico.",
      detalhe: error?.data?.message || error?.message || null
    }, Number(error?.status) || 502);
  }
}
