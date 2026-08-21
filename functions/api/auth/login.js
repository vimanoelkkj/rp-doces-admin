import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { verifyPassword, createSession } from "../../lib/auth.js";
import { checkLoginRateLimit, recordLoginFailure, clearLoginFailures } from "../../lib/rateLimit.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const data = await bodyJson(request);
  const username = String(data?.username || "").trim().toLowerCase();
  const senha = String(data?.senha || "");

  if (!username || username.length > 80 || senha.length > 256) {
    return json({ erro: "Credenciais inválidas." }, 400);
  }

  const rate = await checkLoginRateLimit(env, request, username);
  if (!rate.allowed) {
    return json(
      { erro: "Muitas tentativas. Tente novamente em alguns minutos." },
      429,
      { "retry-after": String(rate.retryAfter) }
    );
  }

  const user = await env.DB.prepare(`
    SELECT id, nome, username, email, senha_hash, ativo
    FROM usuarios_admin WHERE username = ? LIMIT 1
  `).bind(username).first();

  if (!user || !user.ativo || !(await verifyPassword(senha, user.senha_hash))) {
    await recordLoginFailure(env, rate.key);
    await new Promise(r => setTimeout(r, 350));
    return json({ erro: "Usuário ou senha incorretos." }, 401);
  }

  await clearLoginFailures(env, rate.key);

  await env.DB.prepare("DELETE FROM admin_sessoes WHERE expira_em <= ?")
    .bind(new Date().toISOString()).run();

  const session = await createSession(env, user.id);
  return json({ ok: true, usuario: { id: user.id, nome: user.nome, username: user.username, email: user.email } }, 200, {
    "set-cookie": session.cookie
  });
}
