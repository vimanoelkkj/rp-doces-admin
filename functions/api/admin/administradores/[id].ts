/// <reference types="@cloudflare/workers-types" />

import {
  requireUser,
  hashPassword,
  validatePassword,
  verifyPassword,
  sameOrigin,
} from "../../../lib/auth";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from "../../../lib/rateLimit";

interface Env {
  DB: D1Database;
}

interface AcaoBody {
  acao?: string;
  senha?: string;
  senhaAtual?: string;
  ativo?: boolean;
  papel?: string;
}

interface TargetRow {
  ativo: number;
  papel: string;
}

function jsonError(
  message: string,
  status: number,
  headers?: Record<string, string>,
) {
  return Response.json({ error: message }, { status, headers });
}

function isOwner(papel: string) {
  return papel === "OWNER";
}

function isLastActiveOwnerError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String((error as { message?: unknown })?.message ?? error);
  return message.toLowerCase().includes("ultimo_owner_ativo");
}

async function getTarget(db: D1Database, id: number) {
  return db
    .prepare(`SELECT ativo, papel FROM usuarios_admin WHERE id = ?`)
    .bind(id)
    .first<TargetRow>();
}

async function handlePut({
  request,
  env,
  params,
}: {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}): Promise<Response> {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: AcaoBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const target = await getTarget(env.DB, id);
  if (!target) {
    return jsonError("Administrador não encontrado", 404);
  }

  if (body.acao === "resetar_senha") {
    const isSelf = id === auth.user.id;
    if (!isSelf && !isOwner(auth.user.papel)) {
      return jsonError("Sem permissão para redefinir esta senha", 403);
    }

    if (isSelf) {
      const senhaAtual =
        typeof body.senhaAtual === "string" ? body.senhaAtual : "";
      if (!senhaAtual) {
        return jsonError("Senha atual obrigatória", 400);
      }

      const rate = await checkLoginRateLimit(
        env.DB,
        request,
        auth.user.username,
      );
      if (!rate.allowed) {
        return jsonError(
          "Muitas tentativas. Tente novamente em alguns minutos",
          429,
          { "retry-after": String(rate.retryAfter) },
        );
      }

      const usuario = await env.DB.prepare(
        `SELECT senha_hash FROM usuarios_admin WHERE id = ?`,
      )
        .bind(id)
        .first<{ senha_hash: string }>();
      if (!usuario || !usuario.senha_hash) {
        return jsonError("Administrador não encontrado", 404);
      }

      const senhaAtualCorreta = await verifyPassword(
        senhaAtual,
        usuario.senha_hash,
      );
      if (!senhaAtualCorreta) {
        await recordLoginFailure(env.DB, rate.key);
        return jsonError("Senha atual incorreta", 400);
      }

      await clearLoginFailures(env.DB, rate.key);
    }

    const senha = body.senha ?? "";
    const erro = validatePassword(senha);
    if (erro) return jsonError(erro, 400);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE usuarios_admin SET senha_hash = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(await hashPassword(senha), id),
      env.DB.prepare(`DELETE FROM admin_sessoes WHERE usuario_id = ?`).bind(
        id,
      ),
    ]);
    return Response.json({ ok: true });
  }

  if (body.acao === "toggle_ativo") {
    if (!isOwner(auth.user.papel)) {
      return jsonError(
        "Apenas um administrador mestre pode alterar o estado de contas",
        403,
      );
    }
    if (typeof body.ativo !== "boolean") {
      return jsonError("Estado da conta inválido", 400);
    }
    if (id === auth.user.id) {
      return jsonError("Você não pode alterar o estado da sua própria conta", 403);
    }

    if (!body.ativo && target.papel === "OWNER") {
      const owners = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel = 'OWNER' AND ativo = 1`,
      ).first<{ total: number }>();
      if ((owners?.total ?? 0) <= 1) {
        return jsonError(
          "A loja precisa manter pelo menos um administrador mestre ativo",
          409,
        );
      }
    }

    try {
      await env.DB.prepare(
        `UPDATE usuarios_admin SET ativo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
        .bind(body.ativo ? 1 : 0, id)
        .run();
    } catch (err: unknown) {
      if (isLastActiveOwnerError(err)) {
        return jsonError(
          "A loja precisa manter pelo menos um administrador mestre ativo",
          409,
        );
      }
      throw err;
    }

    if (!body.ativo) {
      await env.DB.prepare(`DELETE FROM admin_sessoes WHERE usuario_id = ?`)
        .bind(id)
        .run();
    }
    return Response.json({ ok: true });
  }

  if (body.acao === "alterar_papel") {
    if (!isOwner(auth.user.papel)) {
      return jsonError(
        "Apenas um administrador mestre pode alterar níveis de acesso",
        403,
      );
    }
    if (!body.papel || !["OWNER", "ADMIN"].includes(body.papel)) {
      return jsonError("Nível de acesso inválido", 400);
    }
    if (id === auth.user.id) {
      return jsonError(
        "Altere o nível da sua própria conta somente por outro administrador mestre",
        403,
      );
    }

    if (target.papel === "OWNER" && body.papel === "ADMIN" && target.ativo) {
      const owners = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel = 'OWNER' AND ativo = 1`,
      ).first<{ total: number }>();
      if ((owners?.total ?? 0) <= 1) {
        return jsonError(
          "A loja precisa manter pelo menos um administrador mestre ativo",
          409,
        );
      }
    }

    try {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE usuarios_admin SET papel = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
        ).bind(body.papel, id),
        env.DB.prepare(`DELETE FROM admin_sessoes WHERE usuario_id = ?`).bind(
          id,
        ),
      ]);
    } catch (err: unknown) {
      if (isLastActiveOwnerError(err)) {
        return jsonError(
          "A loja precisa manter pelo menos um administrador mestre ativo",
          409,
        );
      }
      throw err;
    }
    return Response.json({ ok: true });
  }

  return jsonError("Ação inválida", 400);
}

// Sem esse dispatcher, um método não suportado nesta rota pode cair no
// fallback HTML do Cloudflare Pages e responder 200 com o index.html.
export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "PUT") return handlePut(context);
  return jsonError("Rota não encontrada", 404);
};
