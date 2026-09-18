/// <reference types="@cloudflare/workers-types" />

// Admin > Loja > Diagnósticos permanentes — "Pedido de produto de teste".
//
// Objetivo único: validar que o painel administrativo detecta e exibe
// notificações. NÃO cria pedido, NÃO altera estoque, NÃO altera pagamento,
// NÃO contamina o histórico operacional nem as métricas do Dashboard — o
// único efeito é uma linha em `admin_diagnostico_eventos` (migration 0015),
// tabela isolada que nenhuma outra tela do sistema consulta.
//
// A notificação em si é produzida pela MESMA infraestrutura do HUMAN-14
// (`functions/lib/notificacoes.ts`), reaproveitada, não duplicada: este
// endpoint só registra o fato; `derivarNotificacoes` já sabe transformá-lo
// em notificação.

import { requireUser, sameOrigin } from "../../../lib/auth";
import { registrarEventoPedidoTeste } from "../../../lib/notificacoes";

interface Env {
  DB: D1Database;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function isOwner(papel: string) {
  return papel === "OWNER";
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) {
    return jsonError("Origem inválida", 403);
  }

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  if (!isOwner(auth.user.papel)) {
    return jsonError("Apenas o proprietário pode disparar diagnósticos", 403);
  }

  try {
    await registrarEventoPedidoTeste(env.DB, auth.user.id);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("Erro ao disparar diagnóstico de pedido de teste", err);
    return jsonError("Erro interno ao disparar o diagnóstico", 500);
  }
};
