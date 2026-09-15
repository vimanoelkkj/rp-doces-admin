/// <reference types="@cloudflare/workers-types" />

import { precoAtualCentavos, ProdutoRow } from "../../../../lib/pricing";
import { requireUser } from "../../../../lib/auth";

interface Env {
  DB: D1Database;
}

interface ItemInput {
  produtoId: number;
  quantidade: number;
}

interface ItensBody {
  itens?: ItemInput[];
}

const MAX_ITENS_PER_PEDIDO = 50;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
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

  let body: ItensBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (!Array.isArray(body.itens) || body.itens.length === 0) {
    return jsonError("A comanda precisa ter ao menos um item", 400);
  }
  if (body.itens.length > MAX_ITENS_PER_PEDIDO) {
    return jsonError("Itens demais", 400);
  }
  if (
    !body.itens.every(
      (i) =>
        i &&
        Number.isInteger(i.produtoId) &&
        i.produtoId > 0 &&
        Number.isInteger(i.quantidade) &&
        i.quantidade >= 1 &&
        i.quantidade <= 50,
    )
  ) {
    return jsonError("Item inválido", 400);
  }

  try {
    const pedido = await env.DB.prepare(
      `SELECT status_pedido FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<{ status_pedido: string }>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }
    if (pedido.status_pedido === "ENTREGUE") {
      return jsonError("Pedido já entregue não pode ser editado", 400);
    }

    const ids = [...new Set(body.itens.map((i) => i.produtoId))];
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id, nome, preco_centavos, preco_promocional_centavos,
              promocao_inicio, promocao_fim, disponivel, estoque, estoque_reservado
       FROM produtos WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<ProdutoRow>();

    const produtosPorId = new Map(results.map((p) => [p.id, p]));

    let totalCentavos = 0;
    const itensParaPersistir: {
      produtoId: number;
      produtoNome: string;
      quantidade: number;
      valorUnitarioCentavos: number;
      valorTotalCentavos: number;
    }[] = [];

    for (const item of body.itens) {
      const produto = produtosPorId.get(item.produtoId);
      if (!produto) {
        return jsonError(`Produto ${item.produtoId} não encontrado`, 400);
      }
      if (item.quantidade > produto.estoque) {
        return jsonError(`Estoque insuficiente para "${produto.nome}"`, 409);
      }
      const valorUnitarioCentavos = precoAtualCentavos(produto);
      const valorTotalItemCentavos = valorUnitarioCentavos * item.quantidade;
      totalCentavos += valorTotalItemCentavos;
      itensParaPersistir.push({
        produtoId: produto.id,
        produtoNome: produto.nome,
        quantidade: item.quantidade,
        valorUnitarioCentavos,
        valorTotalCentavos: valorTotalItemCentavos,
      });
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM pedido_itens WHERE pedido_id = ?`).bind(id),
      ...itensParaPersistir.map((item) =>
        env.DB.prepare(
          `INSERT INTO pedido_itens
             (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          item.produtoId,
          item.produtoNome,
          item.quantidade,
          item.valorUnitarioCentavos,
          item.valorTotalCentavos,
        ),
      ),
      env.DB.prepare(
        `UPDATE pedidos SET valor_total_centavos = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(totalCentavos, id),
    ]);

    return Response.json({ ok: true, valorTotalCentavos: totalCentavos });
  } catch (err) {
    console.error("Erro ao editar itens do pedido (admin)", err);
    return jsonError("Erro interno ao editar itens do pedido", 500);
  }
};
