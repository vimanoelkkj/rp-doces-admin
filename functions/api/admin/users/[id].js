import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser, hashPassword, validatePassword } from "../../../lib/auth.js";

const isOwner = user => user?.papel === "OWNER";

async function getTarget(env, id) {
  return env.DB.prepare("SELECT id, ativo, papel FROM usuarios_admin WHERE id=? LIMIT 1")
    .bind(id)
    .first();
}

async function handlePut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const id = Number(params.id);
  const d = await bodyJson(request);
  if (!Number.isInteger(id) || id < 1 || !d || typeof d !== "object" || Array.isArray(d))
    return json({ erro: "Dados inválidos." }, 400);

  const target = await getTarget(env, id);
  if (!target) return json({ erro: "Administrador não encontrado." }, 404);

  if (d.acao === "resetar_senha") {
    const extras = Object.keys(d).some(k => !["acao", "senha"].includes(k));
    if (extras) return json({ erro: "Dados inválidos." }, 400);
    // ADMIN pode trocar apenas a própria senha. OWNER pode trocar a de qualquer conta.
    if (id !== Number(auth.user.id) && !isOwner(auth.user))
      return json({ erro: "Sem permissão para redefinir esta senha." }, 403);
    const senha = typeof d.senha === "string" ? d.senha : "";
    const err = validatePassword(senha);
    if (err) return json({ erro: err }, 400);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE usuarios_admin SET senha_hash=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(await hashPassword(senha), id),
      env.DB.prepare("DELETE FROM admin_sessoes WHERE usuario_id=?").bind(id)
    ]);
    return json({ ok: true });
  }

  if (d.acao === "toggle_ativo") {
    if (!isOwner(auth.user))
      return json({ erro: "Apenas um administrador mestre pode alterar o estado de contas." }, 403);
    if (Object.keys(d).some(k => !["acao", "ativo"].includes(k)) || typeof d.ativo !== "boolean")
      return json({ erro: "Estado da conta inválido." }, 400);
    if (id === Number(auth.user.id))
      return json({ erro: "Você não pode alterar o estado da sua própria conta." }, 403);

    if (!d.ativo && target.papel === "OWNER") {
      const owners = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel='OWNER' AND ativo=1"
      ).first();
      if (Number(owners?.total || 0) <= 1)
        return json(
          { erro: "A loja precisa manter pelo menos um administrador mestre ativo." },
          409
        );
    }

    await env.DB.prepare(
      "UPDATE usuarios_admin SET ativo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?"
    )
      .bind(d.ativo ? 1 : 0, id)
      .run();
    if (!d.ativo)
      await env.DB.prepare("DELETE FROM admin_sessoes WHERE usuario_id=?").bind(id).run();
    return json({ ok: true });
  }

  if (d.acao === "alterar_papel") {
    if (!isOwner(auth.user))
      return json({ erro: "Apenas um administrador mestre pode alterar níveis de acesso." }, 403);
    if (
      Object.keys(d).some(k => !["acao", "papel"].includes(k)) ||
      !["OWNER", "ADMIN"].includes(d.papel)
    )
      return json({ erro: "Nível de acesso inválido." }, 400);
    if (id === Number(auth.user.id))
      return json(
        { erro: "Altere o nível da sua própria conta somente por outro administrador mestre." },
        403
      );

    if (target.papel === "OWNER" && d.papel === "ADMIN" && target.ativo) {
      const owners = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM usuarios_admin WHERE papel='OWNER' AND ativo=1"
      ).first();
      if (Number(owners?.total || 0) <= 1)
        return json(
          { erro: "A loja precisa manter pelo menos um administrador mestre ativo." },
          409
        );
    }

    await env.DB.batch([
      env.DB.prepare(
        "UPDATE usuarios_admin SET papel=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(d.papel, id),
      env.DB.prepare("DELETE FROM admin_sessoes WHERE usuario_id=?").bind(id)
    ]);
    return json({ ok: true });
  }

  return json({ erro: "Ação inválida." }, 400);
}

// Esta rota existe apenas para PUT. Sem este dispatcher, um GET em
// /api/admin/users/:id pode cair no fallback HTML do Cloudflare Pages e
// responder 200 com index.html. Toda chamada não suportada fica na API.
export async function onRequest(context) {
  if (context.request.method === "PUT") return handlePut(context);
  return json({ erro: "Rota não encontrada." }, 404);
}
