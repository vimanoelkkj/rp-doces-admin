import { json, bodyJson, sameOrigin } from "../../lib/http.js";
import { checkLoginRateLimit } from "../../lib/rateLimit.js";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);

  const data = await bodyJson(request);
  const username = String(data?.username || "")
    .trim()
    .toLowerCase();

  if (!username || username.length > 80) {
    await wait(220);
    return json({ encontrado: false });
  }

  const rate = await checkLoginRateLimit(env, request, username);
  if (!rate.allowed) {
    return json({ erro: "Muitas tentativas. Tente novamente em alguns minutos." }, 429, {
      "retry-after": String(rate.retryAfter)
    });
  }

  const user = await env.DB.prepare(
    `SELECT nome, username, avatar_key, ativo
     FROM usuarios_admin
     WHERE username = ?
     LIMIT 1`
  )
    .bind(username)
    .first();

  await wait(220);

  if (!user || Number(user.ativo) !== 1) return json({ encontrado: false });

  return json({
    encontrado: true,
    usuario: {
      nome: user.nome,
      username: user.username,
      avatar_url: user.avatar_key ? `/api/images/${encodeURIComponent(user.avatar_key)}` : null
    }
  });
}
