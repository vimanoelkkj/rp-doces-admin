/// <reference types="@cloudflare/workers-types" />

import { requireUser, hashPassword, validatePassword, sameOrigin } from "../../lib/auth";

interface Env {
  DB: D1Database;
}

interface AdminInput {
  nome?: string;
  username?: string;
  email?: string;
  senha?: string;
  papel?: string;
}

interface UsuarioRow {
  id: number;
  nome: string;
  username: string;
  email: string;
  ativo: number;
  papel: string;
  criado_em: string;
}

const PAPEIS = new Set(["OWNER", "ADMIN"]);
const MAX_TEXT_LENGTH = 100;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isOwner(papel: string) {
  return papel === "OWNER";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    if (!isOwner(auth.user.papel)) {
      const self = await env.DB.prepare(
        `SELECT id, nome, username, email, ativo, papel, criado_em
         FROM usuarios_admin WHERE id = ?`,
      )
        .bind(auth.user.id)
        .first<UsuarioRow>();
      return Response.json({ administradores: self ? [self] : [] });
    }

    const { results } = await env.DB.prepare(
      `SELECT id, nome, username, email, ativo, papel, criado_em
       FROM usuarios_admin ORDER BY nome`,
    ).all<UsuarioRow>();

    return Response.json({ administradores: results });
  } catch (err) {
    console.error("Erro ao listar administradores", err);
    return jsonError("Erro interno ao listar administradores", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  if (!isOwner(auth.user.papel)) {
    return jsonError(
      "Apenas um administrador mestre pode criar administradores",
      403,
    );
  }

  let body: AdminInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const nome = body.nome?.trim() ?? "";
  const username = body.username?.trim().toLowerCase() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const senha = body.senha ?? "";
  const papel = body.papel ?? "ADMIN";

  const senhaErro = validatePassword(senha);
  if (
    nome.length < 2 ||
    nome.length > MAX_TEXT_LENGTH ||
    !/^[a-z0-9._-]{3,30}$/.test(username) ||
    email.length > 254 ||
    !email.includes("@") ||
    !PAPEIS.has(papel) ||
    senhaErro
  ) {
    return jsonError(senhaErro ?? "Dados do administrador inválidos", 400);
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO usuarios_admin (nome, username, email, senha_hash, ativo, papel)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
      .bind(nome, username, email, await hashPassword(senha), papel)
      .run();

    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (err) {
    console.error("Erro ao criar administrador", err);
    return jsonError(
      "Esse nome de usuário ou e-mail já está cadastrado",
      409,
    );
  }
};
