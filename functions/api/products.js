import { json } from "../lib/http.js";

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, nome, categoria, descricao, preco_centavos, disponivel, destaque, ordem, emoji, estoque,
             promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim
      FROM produtos WHERE ativo = 1 ORDER BY categoria, ordem, nome
    `).all();
    const agora = Date.now();
    return json({ produtos: (results || []).map(p => {
      const inicioOk = !p.promocao_inicio || Date.parse(p.promocao_inicio) <= agora;
      const fimOk = !p.promocao_fim || Date.parse(p.promocao_fim) > agora;
      const promo = Boolean(p.promocao_ativa) && Number(p.preco_promocional_centavos) > 0 && inicioOk && fimOk;
      const normal = Number(p.preco_centavos);
      return { ...p, preco_original_centavos: normal, preco_centavos: promo ? Number(p.preco_promocional_centavos) : normal, promocao_vigente: promo, disponivel: Boolean(p.disponivel) && Number(p.estoque) > 0, destaque: Boolean(p.destaque) };
    }) }, 200, { "cache-control": "no-store, no-cache, must-revalidate, max-age=0" });
  } catch (e) {
    console.error("products:", e);
    return json({ produtos: [], erro: "Cardápio temporariamente indisponível." }, 500, {"cache-control":"no-store"});
  }
}
