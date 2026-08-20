import { json, sameOrigin } from "../../lib/http.js";
import { destroySession } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const cookie = await destroySession(env, request);
  return json({ ok: true }, 200, { "set-cookie": cookie });
}
