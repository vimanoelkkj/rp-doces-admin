/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../lib/auth";
import {
  criarDespesa,
  listarDespesas,
  getResumoDespesas,
  validarCabecalho,
  validarItens,
  type StatusFiltro,
} from "../../lib/despesas";
import { getResultadoFinanceiro } from "../../lib/resultadoFinanceiro";
import { DESPESA_STATUS } from "../../../shared/despesas";

interface Env {
  DB: D1Database;
}

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function parsePeriodo(url: URL): { ok: true; desde: string; ate: string } | { ok: false; erro: string } {
  const desde = url.searchParams.get("desde") ?? "";
  const ate = url.searchParams.get("ate") ?? "";
  if (!DATA_REGEX.test(desde) || !DATA_REGEX.test(ate)) {
    return { ok: false, erro: "Parâmetros desde/ate inválidos (esperado YYYY-MM-DD)" };
  }
  if (desde > ate) {
    return { ok: false, erro: "O período inicial não pode ser depois do período final" };
  }
  return { ok: true, desde, ate };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const periodo = parsePeriodo(url);
  if (!periodo.ok) return jsonError(periodo.erro, 400);

  const statusParam = url.searchParams.get("status") ?? "TODOS";
  const status: StatusFiltro = statusParam === "TODOS" || (DESPESA_STATUS as readonly string[]).includes(statusParam)
    ? (statusParam as StatusFiltro)
    : "TODOS";
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);

  try {
    const [despesas, resumo, resultadoFinanceiro] = await Promise.all([
      listarDespesas(env.DB, { desde: periodo.desde, ate: periodo.ate, status, search }),
      getResumoDespesas(env.DB, { desde: periodo.desde, ate: periodo.ate }),
      getResultadoFinanceiro(env.DB, { desde: periodo.desde, ate: periodo.ate }),
    ]);
    return Response.json({ despesas, resumo, resultadoFinanceiro });
  } catch (err) {
    console.error("Erro ao listar despesas (admin)", err);
    return jsonError("Erro interno ao listar despesas", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload");
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const cabecalho = validarCabecalho(body);
  if (!cabecalho.ok) return jsonError(cabecalho.erro, 400);

  const itens = validarItens(body.itens);
  if (!itens.ok) return jsonError(itens.erro, 400);

  try {
    const resultado = await criarDespesa(env.DB, {
      ...cabecalho.cabecalho,
      itens: itens.itens,
      usuarioId: auth.user.id,
    });
    return Response.json(resultado, { status: 201 });
  } catch (err) {
    console.error("Erro ao registrar despesa (admin)", err);
    return jsonError("Erro interno ao registrar despesa", 500);
  }
};
