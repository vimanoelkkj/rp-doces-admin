/// <reference types="@cloudflare/workers-types" />

// Liberação pública, best-effort, de reservas Pix do site já vencidas.
//
// Existe para que a vitrine não enxergue estoque falso preso por um Pix
// abandonado enquanto nenhum outro gatilho (webhook, polling do cliente,
// painel admin) rodou a limpeza. Escrita explícita em POST: o GET
// /api/produtos continua somente leitura.
//
// Escopo deliberadamente mínimo: não recebe nenhum input do cliente, não
// consulta o Mercado Pago e não roda outras reconciliações financeiras. Só
// delega a `liberarReservasVencidasLocalmente`, que já é local, limitada em
// lote e preserva os guards B4 (outro Pix pendente ou regeneração ativa
// continuam retendo a reserva).

import { sameOrigin } from "../../lib/auth";
import { liberarReservasVencidasLocalmente } from "../../lib/paymentSync";

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  }

  try {
    await liberarReservasVencidasLocalmente(env);
  } catch (err) {
    // Best-effort: falha aqui nunca pode impedir a vitrine de carregar.
    console.error("Falha na liberação pública de reservas vencidas", err);
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
};
