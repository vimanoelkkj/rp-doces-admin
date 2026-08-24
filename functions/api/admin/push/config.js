import { json } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  return json({
    supported: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    publicKey: env.VAPID_PUBLIC_KEY || null
  });
}
