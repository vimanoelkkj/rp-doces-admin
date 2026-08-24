import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
export async function onRequestPost({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ erro: "JSON inválido." }, 400);
  }
  const endpoint = String(body?.endpoint || "");
  const p256dh = String(body?.keys?.p256dh || "");
  const keyAuth = String(body?.keys?.auth || "");
  if (!endpoint.startsWith("https://") || !p256dh || !keyAuth)
    return json({ erro: "Inscrição push inválida." }, 400);
  await env.DB.prepare(
    `INSERT INTO push_inscricoes(usuario_id,endpoint,p256dh,auth,user_agent) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET usuario_id=excluded.usuario_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,atualizado_em=CURRENT_TIMESTAMP`
  )
    .bind(auth.user.id, endpoint, p256dh, keyAuth, request.headers.get("User-Agent") || null)
    .run();
  return json({ ok: true });
}
export async function onRequestDelete({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  let body = {};
  try {
    body = await request.json();
  } catch {}
  const endpoint = String(body?.endpoint || "");
  if (endpoint)
    await env.DB.prepare("DELETE FROM push_inscricoes WHERE endpoint=? AND usuario_id=?")
      .bind(endpoint, auth.user.id)
      .run();
  return json({ ok: true });
}
