import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { verifyPassword, createSession } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const data = await bodyJson(request);
  const username = String(data?.username || "").trim().toLowerCase();
  const senha = String(data?.senha || "");

  const user = await env.DB.prepare(`
    SELECT id, nome, username, email, senha_hash, ativo
    FROM usuarios_admin WHERE username = ? LIMIT 1
  `).bind(username).first();

  if (!user || !user.ativo || !(await verifyPassword(senha, user.senha_hash))) {
    await new Promise(r => setTimeout(r, 250));
    return json({ erro: "Usuário ou senha incorretos." }, 401);
  }

  await env.DB.prepare("DELETE FROM admin_sessoes WHERE expira_em <= ?")
    .bind(new Date().toISOString()).run();

  const session = await createSession(env, user.id);
  return json({ ok: true, usuario: { id: user.id, nome: user.nome, username: user.username, email: user.email } }, 200, {
    "set-cookie": session.cookie
  });
}
