/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
}

interface ProdutoInput {
  nome?: string;
  categoria?: string;
  descricao?: string;
  precoCentavos?: number;
  estoque?: number;
  emoji?: string;
  ativo?: boolean;
  disponivel?: boolean;
  destaque?: boolean;
}

const MAX_TEXT_LENGTH = 1000;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function validarProduto(body: ProdutoInput) {
  const nome = body.nome?.trim();
  const categoria = body.categoria?.trim();
  if (!nome || !categoria) return "Nome e categoria são obrigatórios";
  if (nome.length > MAX_TEXT_LENGTH || categoria.length > MAX_TEXT_LENGTH) {
    return "Nome ou categoria muito longos";
  }
  if (!Number.isInteger(body.precoCentavos) || body.precoCentavos! < 1) {
    return "Preço inválido";
  }
  if (!Number.isInteger(body.estoque) || body.estoque! < 0) {
    return "Estoque inválido";
  }
  return null;
}

// TODO(admin auth): proteger este endpoint quando a autenticação administrativa existir.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, nome, categoria, descricao, preco_centavos, preco_promocional_centavos,
              promocao_inicio, promocao_fim, disponivel, ativo, destaque, ordem,
              estoque, estoque_reservado, emoji, image_key
       FROM produtos ORDER BY categoria, ordem, nome`,
    ).all();
    return Response.json({ produtos: results });
  } catch (err) {
    console.error("Erro ao listar produtos (admin)", err);
    return jsonError("Erro interno ao listar produtos", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: ProdutoInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const erro = validarProduto(body);
  if (erro) return jsonError(erro, 400);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO produtos (nome, categoria, descricao, preco_centavos, estoque, emoji, ativo, disponivel, destaque)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.nome!.trim(),
        body.categoria!.trim(),
        (body.descricao ?? "").slice(0, MAX_TEXT_LENGTH),
        body.precoCentavos,
        body.estoque,
        (body.emoji ?? "").slice(0, 10),
        body.ativo === false ? 0 : 1,
        body.disponivel === false ? 0 : 1,
        body.destaque ? 1 : 0,
      )
      .run();

    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (err) {
    console.error("Erro ao criar produto (admin)", err);
    return jsonError("Erro interno ao criar produto", 500);
  }
};
