import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { randomToken, sha256 } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const data = await bodyJson(request);
  const email = String(data?.email || "").trim().toLowerCase();

  const generic = { ok: true, mensagem: "Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação." };
  const user = await env.DB.prepare(
    "SELECT id, nome, email FROM usuarios_admin WHERE email = ? AND ativo = 1 LIMIT 1"
  ).bind(email).first();

  if (!user) return json(generic);

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expira = new Date(Date.now() + 30 * 60000).toISOString();

  await env.DB.prepare("DELETE FROM tokens_recuperacao WHERE usuario_id = ? OR expira_em <= ?")
    .bind(user.id, new Date().toISOString()).run();
  await env.DB.prepare(`
    INSERT INTO tokens_recuperacao (usuario_id, token_hash, expira_em)
    VALUES (?, ?, ?)
  `).bind(user.id, tokenHash, expira).run();

  if (env.EMAIL && env.EMAIL_FROM) {
    const url = `${new URL(request.url).origin}/admin/?reset=${encodeURIComponent(token)}`;
    try {
      await env.EMAIL.send({
        to: user.email,
        from: env.EMAIL_FROM,
        subject: "Redefinição de senha — R&P Doces",
        text: `Olá, ${user.nome}. Use este link para redefinir sua senha (válido por 30 minutos): ${url}`,
        html: `<p>Olá, <strong>${user.nome}</strong>.</p><p>Use o link abaixo para redefinir sua senha. Ele vale por 30 minutos.</p><p><a href="${url}">Redefinir minha senha</a></p>`
      });
    } catch (_) {}
  }

  return json(generic);
}
