/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../lib/auth";

interface Env {
  DB: D1Database;
}

const MAX_ITENS_PER_PEDIDO = 50;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPut: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !("itens" in body) ||
    !Array.isArray(body.itens) ||
    body.itens.length === 0
  ) {
    return jsonError("A comanda precisa ter ao menos um item", 400);
  }
  if (body.itens.length > MAX_ITENS_PER_PEDIDO) {
    return jsonError("Itens demais", 400);
  }
  if (
    !body.itens.every(
      (i) =>
        i &&
        typeof i === "object" &&
        !Array.isArray(i) &&
        Number.isInteger(i.produtoId) &&
        i.produtoId > 0 &&
        Number.isInteger(i.quantidade) &&
        i.quantidade >= 1 &&
        i.quantidade <= 50,
    )
  ) {
    return jsonError("Item inválido", 400);
  }

  try {
    const pedido = await env.DB.prepare(
      `SELECT id FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<{ id: number }>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }

    // B1: toda edição fica bloqueada até existir um editor que preserve
    // identidade, histórico financeiro e físico, inclusive sob concorrência.
    return Response.json(
      {
        error: "A edição de itens está temporariamente indisponível. Nenhuma alteração foi salva.",
        code: "EDICAO_ITENS_BLOQUEADA",
      },
      { status: 409 },
    );
  } catch (err) {
    console.error("Erro ao editar itens do pedido (admin)", err);
    return jsonError("Erro interno ao editar itens do pedido", 500);
  }
};
