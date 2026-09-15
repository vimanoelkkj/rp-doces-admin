/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../lib/auth";

interface Env {
  DB: D1Database;
}

interface CategoriaInput {
  nome?: string;
  emoji?: string;
  descricao?: string;
}

interface CategoriaRow {
  id: string;
  nome: string;
  emoji: string;
  descricao: string;
  ordem: number;
  ativo: number;
  sistema: number;
  total_produtos: number;
  produtos_ativos: number;
  produtos_arquivados: number;
}

const MAX_TEXT_LENGTH = 200;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Mesma convenção de identificador já usada em produção: slug maiúsculo
// sem acentos, derivado do nome digitado.
function slugify(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.nome, c.emoji, c.descricao, c.ordem, c.ativo, c.sistema,
              (SELECT COUNT(*) FROM produtos p WHERE p.categoria = c.id) AS total_produtos,
              (SELECT COUNT(*) FROM produtos p WHERE p.categoria = c.id AND p.ativo = 1) AS produtos_ativos,
              (SELECT COUNT(*) FROM produtos p WHERE p.categoria = c.id AND p.ativo = 0) AS produtos_arquivados
       FROM categorias c
       ORDER BY c.ordem, c.nome`,
    ).all<CategoriaRow>();
    return Response.json({ categorias: results });
  } catch (err) {
    console.error("Erro ao listar categorias", err);
    return jsonError("Erro interno ao listar categorias", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: CategoriaInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const nome = body.nome?.trim() ?? "";
  if (!nome || nome.length > MAX_TEXT_LENGTH) {
    return jsonError("Nome da categoria é obrigatório", 400);
  }

  const id = slugify(nome);
  if (!id) {
    return jsonError("Nome da categoria inválido", 400);
  }

  const emoji = (body.emoji ?? "🍰").slice(0, 10);
  const descricao = (body.descricao ?? "").slice(0, MAX_TEXT_LENGTH);

  try {
    await env.DB.prepare(
      `INSERT INTO categorias (id, nome, emoji, descricao, sistema) VALUES (?, ?, ?, ?, 0)`,
    )
      .bind(id, nome, emoji, descricao)
      .run();

    return Response.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Erro ao criar categoria", err);
    return jsonError("Já existe uma categoria com esse nome", 409);
  }
};
