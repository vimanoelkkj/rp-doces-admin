import { json } from "../../lib/http.js";
import { currentUser } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return json({ autenticado: false }, 401);
  return json({ autenticado: true, usuario: user });
}
