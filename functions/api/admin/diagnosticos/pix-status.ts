/// <reference types="@cloudflare/workers-types" />

// Admin > Loja > Diagnósticos permanentes — status do "Pix real de diagnóstico".
//
// Consulta apenas: reaproveita `fetchMpPayment`/`mapMpStatus` de
// `paymentSync.ts` (mesmo GET autoritativo usado pelo webhook, pela
// reconciliação B3 e pelo polling público) — nunca chama
// `syncPaymentFromMp`, que grava em `pedido_pagamentos`. Este diagnóstico
// não tem pagamento local para sincronizar; ISOLAMENTO: zero escrita no
// banco, exatamente como o endpoint que cria o Pix de diagnóstico.

import { requireUser } from "../../../lib/auth";
import { fetchMpPayment, mapMpStatus } from "../../../lib/paymentSync";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function isOwner(papel: string) {
  return papel === "OWNER";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  if (!isOwner(auth.user.papel)) {
    return jsonError("Apenas o proprietário pode consultar diagnósticos", 403);
  }

  const mpPaymentId = new URL(request.url).searchParams.get("mpPaymentId") || "";
  if (!/^\d+$/.test(mpPaymentId)) {
    return jsonError("mpPaymentId inválido", 400);
  }

  if (!env.MP_ACCESS_TOKEN) {
    return jsonError(
      "Mercado Pago não está configurado neste ambiente",
      503,
      "MERCADO_PAGO_NAO_CONFIGURADO",
    );
  }

  try {
    const payment = await fetchMpPayment(env.MP_ACCESS_TOKEN, mpPaymentId);
    return Response.json({
      ok: true,
      // "PENDENTE" cobre pending/in_process/authorized — mapMpStatus só
      // nomeia estados finais; não inventamos um vocabulário próprio aqui.
      status: mapMpStatus(payment.status) ?? "PENDENTE",
    });
  } catch (err) {
    console.error("Falha ao consultar status do Pix de diagnóstico", err);
    return jsonError(
      "Não foi possível confirmar o status com o Mercado Pago. Tente novamente.",
      502,
      "MERCADO_PAGO_INDISPONIVEL",
    );
  }
};
