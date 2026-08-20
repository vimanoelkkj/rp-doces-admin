import { requireUser } from "../../lib/auth.js";

export async function onRequestGet({ env, request }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const rows = await env.DB.prepare("SELECT chave, valor FROM configuracoes_loja").all();
  return Response.json(Object.fromEntries((rows.results || []).map(r => [r.chave, r.valor])));
}

export async function onRequestPut({ env, request }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const data = await request.json();
  const allowed = ["whatsapp","local_retirada","endereco","maps_url","entregas_status","horario_atendimento","horario_dias","horario_abre","horario_fecha","mensagem_whatsapp"];
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
