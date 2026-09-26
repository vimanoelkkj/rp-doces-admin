/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../lib/auth";

interface Env {
  DB: D1Database;
}

import {
  normalizarPromocao,
  type ProdutoInput,
  validarProdutoPromocao,
} from "../../lib/produtoPromocao";
import {
  normalizarDetalhesProduto,
  type ProdutoDetalhesInput,
  validarDetalhesProduto,
} from "../../lib/produtoDetalhes";

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

function validarProduto(body: ProdutoInput & ProdutoDetalhesInput) {
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
  return validarDetalhesProduto(body) ?? validarProdutoPromocao(body);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, nome, categoria, descricao, preco_centavos, preco_promocional_centavos,
              promocao_inicio, promocao_fim, promocao_ativa, disponivel, ativo, destaque, ordem,
              estoque, estoque_reservado, emoji, image_key,
              peso_texto, ingredientes, alergenicos
       FROM produtos ORDER BY categoria, ordem, nome`,
    ).all();
    return Response.json({ produtos: results });
  } catch (err) {
    console.error("Erro ao listar produtos (admin)", err);
    return jsonError("Erro interno ao listar produtos", 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: ProdutoInput & ProdutoDetalhesInput;
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

  const promocao = normalizarPromocao(body);
  const detalhes = normalizarDetalhesProduto(body);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO produtos (nome, categoria, descricao, preco_centavos, estoque, emoji, ativo, disponivel, destaque,
                             promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim,
                             peso_texto, ingredientes, alergenicos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        promocao.promocaoAtiva,
        promocao.precoPromocionalCentavos,
        promocao.promocaoInicio,
        promocao.promocaoFim,
        detalhes.pesoTexto ?? "",
        detalhes.ingredientes ?? "",
        detalhes.alergenicos ?? "",
      )
      .run();

    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (err) {
    console.error("Erro ao criar produto (admin)", err);
    return jsonError("Erro interno ao criar produto", 500);
  }
};
