/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
}

interface ProdutoRow {
  id: number;
  nome: string;
  categoria: string;
  descricao: string;
  preco_centavos: number;
  preco_promocional_centavos: number | null;
  promocao_inicio: string | null;
  promocao_fim: string | null;
  destaque: number;
  ordem: number;
  estoque: number;
  estoque_reservado: number;
  image_key: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT id, nome, categoria, descricao, preco_centavos,
            preco_promocional_centavos, promocao_inicio, promocao_fim,
            destaque, ordem, estoque, estoque_reservado, image_key
     FROM produtos
     WHERE disponivel = 1
     ORDER BY categoria, ordem, nome`,
  ).all<ProdutoRow>();

  return Response.json({ produtos: results });
};
