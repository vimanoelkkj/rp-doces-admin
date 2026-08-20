import { requireAdmin } from "../../lib/auth.js";

export async function onRequestGet({ env, request }) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const rows = await env.DB.prepare("SELECT chave, valor FROM configuracoes_loja").all();
  return Response.json(Object.fromEntries((rows.results || []).map(r => [r.chave, r.valor])));
}

export async function onRequestPut({ env, request }) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const data = await request.json();
  const allowed = ["whatsapp","local_retirada","entregas_status","horario_atendimento","mensagem_whatsapp"];
  const stmts = [];
  for (const chave of allowed) {
    if (!(chave in data)) continue;
    stmts.push(env.DB.prepare(
      `INSERT INTO configuracoes_loja (chave, valor, atualizado_em)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, atualizado_em=CURRENT_TIMESTAMP`
    ).bind(chave, String(data[chave] ?? "")));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return Response.json({ ok: true });
}
