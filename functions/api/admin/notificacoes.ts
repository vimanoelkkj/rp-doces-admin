/// <reference types="@cloudflare/workers-types" />

// HUMAN-14 — notificações internas do admin.
//
// GET  lista os eventos derivados agora + estado de leitura do operador.
// POST marca leitura: `{ todas: true }` ou `{ chaves: [...] }`.
//
// Não existe endpoint de criação: notificação não é um fato que se cria, é um
// fato do domínio observado de outro ângulo.

import { requireUser } from "../../lib/auth";
import {
  listarNotificacoes,
  marcarComoLidas,
  marcarTodasComoLidas,
} from "../../lib/notificacoes";

interface Env {
  DB: D1Database;
}

interface LeituraInput {
  todas?: boolean;
  chaves?: unknown;
}

const MAX_CHAVES_POR_REQUISICAO = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    return Response.json(await listarNotificacoes(env.DB, auth.user.id));
  } catch (err) {
    console.error("Erro ao listar notificações (admin)", err);
    return jsonError("Erro interno ao listar notificações", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: LeituraInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }
  if (!body || typeof body !== "object") {
    return jsonError("JSON inválido", 400);
  }

  try {
    if (body.todas === true) {
      const marcadas = await marcarTodasComoLidas(env.DB, auth.user.id);
      // Devolve o estado já recalculado: a UI não precisa adivinhar nem
      // fazer uma segunda chamada para atualizar o badge.
      return Response.json({
        ok: true,
        marcadas,
        ...(await listarNotificacoes(env.DB, auth.user.id)),
      });
    }

    const chaves = body.chaves;
    if (
      !Array.isArray(chaves) ||
      chaves.length === 0 ||
      chaves.length > MAX_CHAVES_POR_REQUISICAO ||
      !chaves.every((c) => typeof c === "string" && c.length > 0 && c.length <= 200)
    ) {
      return jsonError("Chaves inválidas", 400);
    }

    const marcadas = await marcarComoLidas(env.DB, auth.user.id, chaves as string[]);
    return Response.json({
      ok: true,
      marcadas,
      ...(await listarNotificacoes(env.DB, auth.user.id)),
    });
  } catch (err) {
    console.error("Erro ao marcar notificações como lidas (admin)", err);
    return jsonError("Erro interno ao marcar notificações", 500);
  }
};
