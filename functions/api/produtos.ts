/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
}

interface ProdutoRow {
  id: number;
  nome: string;
  categoria: string;
  categoria_nome: string;
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
    `SELECT p.id, p.nome, p.categoria, COALESCE(c.nome, p.categoria) AS categoria_nome,
            p.descricao, p.preco_centavos,
            p.preco_promocional_centavos, p.promocao_inicio, p.promocao_fim,
            p.destaque, p.ordem, p.estoque, p.estoque_reservado, p.image_key
     FROM produtos p
     LEFT JOIN categorias c ON c.id = p.categoria
     WHERE p.disponivel = 1
     ORDER BY p.categoria, p.ordem, p.nome`,
  ).all<ProdutoRow>();

  return Response.json({ produtos: results });
};
