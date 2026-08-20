import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { sha256, hashPassword, validatePassword } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const data = await bodyJson(request);
  const token = String(data?.token || "");
  const senha = String(data?.senha || "");
  const err = validatePassword(senha);
  if (!token || err) return json({ erro: err || "Token inválido." }, 400);

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT id, usuario_id FROM tokens_recuperacao
    WHERE token_hash = ? AND usado = 0 AND expira_em > ?
    LIMIT 1
  `).bind(tokenHash, new Date().toISOString()).first();

  if (!row) return json({ erro: "Link inválido ou expirado." }, 400);

  const senhaHash = await hashPassword(senha);
  await env.DB.batch([
    env.DB.prepare("UPDATE usuarios_admin SET senha_hash = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(senhaHash, row.usuario_id),
    env.DB.prepare("UPDATE tokens_recuperacao SET usado = 1 WHERE id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM admin_sessoes WHERE usuario_id = ?").bind(row.usuario_id),
  ]);

  return json({ ok: true });
}
