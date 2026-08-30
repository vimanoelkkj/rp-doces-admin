import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";

const VALIDOS = new Set(["NOVO", "PREPARANDO", "PRONTO", "ENTREGUE", "CANCELADO"]);

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const id = Number(params.id);
  const body = await bodyJson(request);
  const status = String(body?.status_pedido || "").toUpperCase();

  if (!Number.isInteger(id) || id < 1 || !VALIDOS.has(status)) {
    return json({ erro: "Dados inválidos." }, 400);
  }

  const existe = await env.DB.prepare("SELECT id FROM pedidos WHERE id = ?").bind(id).first();
  if (!existe) return json({ erro: "Pedido não encontrado." }, 404);

  await env.DB.prepare(
    "UPDATE pedidos SET status_pedido = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
  )
    .bind(status, id)
    .run();

  return json({ ok: true, id, status_pedido: status });
}
