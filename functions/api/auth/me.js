import { json } from "../../lib/http.js";
import { currentUser } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const user = await currentUser(env, request);
  if (!user) return json({ autenticado: false }, 401);

  try {
    const row = await env.DB.prepare("SELECT avatar_key FROM usuarios_admin WHERE id = ?")
      .bind(user.id)
      .first();
    if (row?.avatar_key) {
      user.avatar_key = row.avatar_key;
      user.avatar_url = `/api/images/${encodeURIComponent(row.avatar_key)}`;
    } else {
      user.avatar_key = null;
      user.avatar_url = null;
    }
  } catch (error) {
    if (!String(error?.message || "").includes("no such column: avatar_key")) throw error;
    user.avatar_key = null;
    user.avatar_url = null;
  }

  return json({ autenticado: true, usuario: user });
}
