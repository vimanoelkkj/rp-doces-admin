/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../lib/auth";
import { obterDespesa, editarDespesa, validarCabecalho, validarItens } from "../../../lib/despesas";

interface Env {
  DB: D1Database;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const EDITAR_MENSAGENS: Record<string, string> = {
  DESPESA_NAO_ENCONTRADA: "Despesa não encontrada",
  DESPESA_CANCELADA: "Uma despesa cancelada não pode ser editada",
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = parseId(params.id);
  if (!id) return jsonError("Id inválido", 400);

  try {
    const despesa = await obterDespesa(env.DB, id);
    if (!despesa) return jsonError("Despesa não encontrada", 404);
    return Response.json({ despesa });
  } catch (err) {
    console.error("Erro ao obter despesa (admin)", err);
    return jsonError("Erro interno ao obter despesa", 500);
  }
};

async function editar(request: Request, env: Env, params: Record<string, string | string[] | undefined>) {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = parseId(params.id);
  if (!id) return jsonError("Id inválido", 400);

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
    const resultado = await editarDespesa(env.DB, {
      id, ...cabecalho.cabecalho, itens: itens.itens,
    });
    if (!resultado.ok) {
      const status = resultado.erro === "DESPESA_NAO_ENCONTRADA" ? 404 : 409;
      return jsonError(EDITAR_MENSAGENS[resultado.erro], status, resultado.erro);
    }
    return Response.json(resultado);
  } catch (err) {
    console.error("Erro ao editar despesa (admin)", err);
    return jsonError("Erro interno ao editar despesa", 500);
  }
}

export const onRequestPut: PagesFunction<Env> = ({ request, env, params }) => editar(request, env, params);
export const onRequestPatch: PagesFunction<Env> = ({ request, env, params }) => editar(request, env, params);
