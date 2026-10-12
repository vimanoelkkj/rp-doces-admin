/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../../lib/auth";
import {
  fetchMpPayment,
  syncPaymentFromMp,
  type MpPaymentResponse
} from "../../../../../lib/paymentSync";
import { pedidoValidoSql } from "../../../../../lib/pedidoValido";

interface Env {
  DB: D1Database;
  APP_ENV?: string;
  MP_TEST_MODE?: string;
  MP_ACCESS_TOKEN?: string;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const error = (code: string, status: number) => json({ ok: false, code }, status);

// Publication gates attest DB isolation; runtime flags cannot attest its UUID.
export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request))
    return json({ error: "Origem inválida" }, 403);
  try {
    const auth = await requireUser(env.DB, request);
    if ("error" in auth) return json({ error: "Não autenticado" }, 401);
    if (auth.user.papel !== "OWNER") return error("PIX_RECUPERACAO_PROIBIDA", 403);
    if (request.method !== "POST") {
      const response = error("METODO_NAO_PERMITIDO", 405);
      response.headers.set("Allow", "POST");
      return response;
    }
    if (
      env.APP_ENV !== "staging" ||
      env.MP_TEST_MODE !== "orders_pix" ||
      new URL(request.url).origin !== "https://staging.rpdoces.com.br"
    ) {
      return error("PIX_RECUPERACAO_PROIBIDA", 403);
    }
    const id = typeof params.id === "string" && /^\d+$/.test(params.id) ? Number(params.id) : 0;
    if (!Number.isSafeInteger(id) || id <= 0) return error("ID_INVALIDO", 400);
    let pagamentoId: number;
    try {
      if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
        throw new Error();
      const text = await request.text();
      if (text.length > 256) throw new Error();
      const body = JSON.parse(text);
      if (
        !body ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !Number.isSafeInteger(body.pagamentoId) ||
        body.pagamentoId <= 0
      )
        throw new Error();
      pagamentoId = body.pagamentoId;
    } catch {
      return error("CORPO_INVALIDO", 400);
    }
    const local = await env.DB.prepare(
      `SELECT pp.metodo,pp.origem,pp.status,pp.mp_order_id,pp.mp_payment_id
       FROM pedido_pagamentos pp JOIN pedidos p ON p.id = pp.pedido_id
       WHERE pp.id = ? AND pp.pedido_id = ? AND ${pedidoValidoSql("p.id")}`
    )
      .bind(pagamentoId, id)
      .first<{
        metodo: string;
        origem: string;
        status: string;
        mp_order_id: string | null;
        mp_payment_id: string | null;
      }>();
    if (!local) return error("PAGAMENTO_NAO_ENCONTRADO", 404);
    const orderId = local.mp_order_id;
    if (
      local.metodo !== "PIX_MP" ||
      local.origem !== "SITE" ||
      !["PENDENTE", "EXPIRADO", "PAGO"].includes(local.status) ||
      !orderId ||
      !/^ORD[A-Za-z0-9]{1,128}$/.test(orderId) ||
      !/^PAY[A-Za-z0-9]{1,128}$/.test(local.mp_payment_id ?? "")
    ) {
      return error("PIX_RECUPERACAO_RECUSADA", 409);
    }
    if (!env.MP_ACCESS_TOKEN) return error("MP_NAO_CONFIGURADO", 503);
    let mp: MpPaymentResponse;
    try {
      mp = await fetchMpPayment(env.MP_ACCESS_TOKEN, orderId);
    } catch {
      return error("CONSULTA_PIX_FALHOU", 502);
    }
    const result = await syncPaymentFromMp(env.DB, pagamentoId, mp, undefined, {
      confirmationOnly: true,
      expectedPedidoId: id
    });
    console.info("PIX_RECUPERACAO_RESULTADO", {
      atorUsuarioId: auth.user.id,
      pedidoId: id,
      pagamentoId,
      ok: result.ok,
      transicionou: result.transicionou,
      finalizacaoPendente: result.finalizacaoPendente
    });
    if (!result.ok || result.status !== "PAGO" || result.finalizacaoPendente === undefined) {
      return json(
        {
          ok: false,
          code: "PIX_RECUPERACAO_RECUSADA",
          confirmacaoPersistida: result.transicionou,
          finalizacaoPendente: result.finalizacaoPendente ?? false
        },
        409
      );
    }
    return json(
      {
        ok: true,
        confirmacaoPersistida: true,
        transicionou: result.transicionou,
        finalizacaoPendente: result.finalizacaoPendente
      },
      result.finalizacaoPendente ? 202 : 200
    );
  } catch {
    console.error("PIX_RECUPERACAO_LOCAL_FALHOU");
    return error("PIX_RECUPERACAO_LOCAL_FALHOU", 503);
  }
};
