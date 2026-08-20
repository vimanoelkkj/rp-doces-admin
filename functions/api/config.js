export async function onRequestGet({ env }) {
  const rows = await env.DB.prepare(
    "SELECT chave, valor FROM configuracoes_loja"
  ).all();
  const config = Object.fromEntries((rows.results || []).map(r => [r.chave, r.valor]));
  return Response.json(config, {
    headers: { "Cache-Control": "no-store" }
  });
}
