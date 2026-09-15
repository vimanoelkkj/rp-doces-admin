/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../lib/auth";

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
  promocaoAtiva?: boolean;
}

const MAX_TEXT_LENGTH = 1000;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function categoriaValida(db: D1Database, categoria: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT ativo FROM categorias WHERE id = ?`)
    .bind(categoria)
    .first<{ ativo: number }>();
  return !!row && row.ativo === 1;
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

export const onRequestPut: PagesFunction<Env> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: ProdutoInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const erro = validarProduto(body);
  if (erro) return jsonError(erro, 400);

  const categoria = body.categoria!.trim();
  if (!(await categoriaValida(env.DB, categoria))) {
    return jsonError("Categoria inválida ou inativa", 400);
  }

  try {
    const atual = await env.DB.prepare(
      `SELECT estoque_reservado FROM produtos WHERE id = ?`,
    )
      .bind(id)
      .first<{ estoque_reservado: number }>();

    if (atual && body.estoque! < atual.estoque_reservado) {
      return jsonError(
        `Não é possível reduzir o estoque para ${body.estoque}, pois existem ${atual.estoque_reservado} unidade(s) reservada(s) em pedidos pendentes`,
        409,
      );
    }

    const result = await env.DB.prepare(
      `UPDATE produtos
       SET nome = ?, categoria = ?, descricao = ?, preco_centavos = ?, estoque = ?,
           emoji = ?, ativo = ?, disponivel = ?, destaque = ?, promocao_ativa = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(
        body.nome!.trim(),
        categoria,
        (body.descricao ?? "").slice(0, MAX_TEXT_LENGTH),
        body.precoCentavos,
        body.estoque,
        (body.emoji ?? "").slice(0, 10),
        body.ativo === false ? 0 : 1,
        body.disponivel === false ? 0 : 1,
        body.destaque ? 1 : 0,
        body.promocaoAtiva ? 1 : 0,
        id,
      )
      .run();

    if (result.meta.changes === 0) {
      return jsonError("Produto não encontrado", 404);
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Erro ao editar produto (admin)", err);
    return jsonError("Erro interno ao editar produto", 500);
  }
};
