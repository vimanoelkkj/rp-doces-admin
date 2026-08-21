import { json } from "../lib/http.js";

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, nome, categoria, descricao, preco_centavos, disponivel, destaque, ordem, emoji, estoque
      FROM produtos
      WHERE ativo = 1
      ORDER BY categoria, ordem, nome
    `).all();

    return json({
      produtos: (results || []).map(p => ({
        ...p,
        disponivel: Boolean(p.disponivel) && Number(p.estoque) > 0,
        destaque: Boolean(p.destaque),
      }))
    }, 200, { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" });
  } catch (e) {
    return json({ produtos: [], erro: "Cardápio temporariamente indisponível." }, 500, {"cache-control":"no-store"});
  }
}
