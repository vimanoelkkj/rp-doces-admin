const MP_BASE = "https://api.mercadopago.com";

export function localTestMode(env) {
  const value = String(env?.LOCAL_TEST_MODE || "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export function mercadoPagoConfigured(env) {
  return Boolean(env?.MP_ACCESS_TOKEN) || localTestMode(env);
}

export function requireMercadoPago(env) {
  if (!mercadoPagoConfigured(env)) throw new Error("MP_ACCESS_TOKEN não configurado.");
}

function fakeOrderId(idempotencyKey) {
  const raw = String(idempotencyKey || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, "");
  return `local_${raw.slice(0, 48)}`;
}

function fakePixOrder({ id, status = "action_required" }) {
  const paymentStatus = status === "canceled" ? "canceled" : "pending";
  return {
    id,
    status,
    status_detail: status === "canceled" ? "canceled_by_user" : "waiting_transfer",
    transactions: {
      payments: [
        {
          id: `pay_${id}`,
          status: paymentStatus,
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: `000201LOCALTEST${id}`,
            qr_code_base64: null,
            ticket_url: `http://127.0.0.1:8788/pedido/?fake_pix=${encodeURIComponent(id)}`
          }
        }
      ]
    }
  };
}

function fakeMpRequest(path, { method = "GET", idempotencyKey } = {}) {
  const cancelMatch = path.match(/^\/v1\/orders\/([^/]+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    return fakePixOrder({ id: decodeURIComponent(cancelMatch[1]), status: "canceled" });
  }

  const orderMatch = path.match(/^\/v1\/orders\/([^/]+)$/);
  if (method === "GET" && orderMatch) {
    return fakePixOrder({ id: decodeURIComponent(orderMatch[1]) });
  }

  if (method === "POST" && path === "/v1/orders") {
    return fakePixOrder({ id: fakeOrderId(idempotencyKey) });
  }

  const err = new Error(`Mercado Pago fake não suporta ${method} ${path}`);
  err.status = 501;
  throw err;
}

export async function mpRequest(
  env,
  path,
  { method = "GET", body, idempotencyKey, forceReal = false, accessToken = null } = {}
) {
  const explicitToken = String(accessToken || "").trim();

  if (explicitToken) {
    forceReal = true;
  } else if (forceReal) {
    if (!env?.MP_ACCESS_TOKEN) throw new Error("MP_ACCESS_TOKEN não configurado.");
  } else {
    requireMercadoPago(env);
  }

  if (localTestMode(env) && !forceReal) {
    return fakeMpRequest(path, { method, body, idempotencyKey });
  }

  const token = explicitToken || env.MP_ACCESS_TOKEN;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`${MP_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(`Mercado Pago respondeu ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function mpOrderToLocalStatus(order) {
  const mapStatus = value => {
    const status = String(value || "").toLowerCase();
    if (status === "processed") return "PAGO";
    if (status === "refunded") return "REEMBOLSADO";
    if (status === "canceled") return "CANCELADO";
    if (status === "expired") return "EXPIRADO";
    if (status === "failed") return "FALHOU";
    return "PENDENTE";
  };

  const orderStatus = mapStatus(order?.status);
  if (orderStatus !== "PENDENTE") return orderStatus;

  return mapStatus(order?.transactions?.payments?.[0]?.status);
}

export function paymentFromOrder(order) {
  const payment = order?.transactions?.payments?.[0] || null;
  const pm = payment?.payment_method || {};
  return {
    paymentId: payment?.id ? String(payment.id) : null,
    ticketUrl: pm.ticket_url || null,
    qrCode: pm.qr_code || order?.type_response?.qr_data || null,
    qrCodeBase64: pm.qr_code_base64 || null
  };
}

export const PIX_TTL_MS = 30 * 60 * 1000;

export function calculatePixExpiration(baseDateOrIso) {
  if (!baseDateOrIso) return null;
  let dateVal = baseDateOrIso;
  if (typeof dateVal === "string") {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(dateVal)) {
      dateVal = dateVal.replace(" ", "T") + "Z";
    }
  }
  const parsed = dateVal instanceof Date ? dateVal.getTime() : new Date(dateVal).getTime();
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed + PIX_TTL_MS).toISOString();
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function validateMpWebhook(request, secret, dataId) {
  if (!secret) return false;
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const parts = Object.fromEntries(signature.split(",").map(p => p.trim().split("=")));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  let manifest = "";
  if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return timingSafeEqual(hex(digest), v1.toLowerCase());
}
