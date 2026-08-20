import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser, hashPassword, validatePassword } from "../../../lib/auth.js";

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const id = Number(params.id);
  const d = await bodyJson(request);
  if (!Number.isInteger(id)) return json({ erro: "ID inválido." }, 400);

  if (d.acao === "resetar_senha") {
    const senha = String(d.senha || "");
    const err = validatePassword(senha);
    if (err) return json({ erro: err }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE usuarios_admin SET senha_hash=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?")
        .bind(await hashPassword(senha), id),
      env.DB.prepare("DELETE FROM admin_sessoes WHERE usuario_id=?").bind(id),
    ]);
    return json({ ok: true });
  }

  if (d.acao === "toggle_ativo") {
    if (id === Number(auth.user.id) && d.ativo === false)
      return json({ erro: "Você não pode desativar sua própria conta." }, 400);
    await env.DB.prepare("UPDATE usuarios_admin SET ativo=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?")
      .bind(d.ativo ? 1 : 0, id).run();
    return json({ ok: true });
  }

  return json({ erro: "Ação inválida." }, 400);
}
