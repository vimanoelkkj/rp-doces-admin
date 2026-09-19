/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../lib/auth";
import { precoAtualCentavos, type ProdutoRow } from "../../../../lib/pricing";
import {
  BRUTO_PAGO_SQL,
  LIQUIDO_SQL,
  REEMBOLSADO_SQL,
  STATUS_FINANCEIRO_SQL,
  preparePedidoFinancialProjectionForItemOperation,
} from "../../../../lib/pedidoFinanceiroSql";
import { preparePedidoPhysicalProjection } from "../../../../lib/stock";
import {
  buscarOperacao,
  conflitoOperacao,
  fingerprint,
  fonteItemAdicionado,
  OPERACAO_HTTP_STATUS,
  OPERACAO_MENSAGENS,
  parseOperationKey,
  parseResultado,
  prepareClaimOperacao,
  type IdentidadeEsperada,
  type OperacaoRow,
} from "../../../../lib/operacoes";

interface Env {
  DB: D1Database;
}

const MAX_ITENS_PER_PEDIDO = 50;

interface AdicionarItemBody {
  operationKey?: unknown;
  produtoId?: unknown;
  quantidade?: unknown;
  precoEsperadoCentavos?: unknown;
}

interface PedidoAdicaoRow {
  id: number;
  origem_pedido: string;
  status_comanda: string;
  status_pedido: string;
  status_pagamento: string;
}

interface ProdutoAdicaoRow extends ProdutoRow {
  ativo: number;
}

interface ItemAdicionadoResponse {
  pedidoId: number;
  item: {
    id: number;
    produtoId: number;
    nome: string;
    quantidade: number;
    precoUnitarioCentavos: number;
    valorTotalCentavos: number;
    statusItem: string;
    estoqueEstado: string;
  };
  financeiro: {
    totalCentavos: number;
    brutoPagoCentavos: number;
    reembolsadoCentavos: number;
    liquidoCentavos: number;
    saldoCentavos: number;
    statusPagamento: string;
  };
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

function precoAlterado(precoAtual: number): Response {
  return Response.json(
    {
      error: "O preço do produto mudou. Atualize os dados antes de adicionar o item.",
      code: "PRECO_ALTERADO",
      precoAtualCentavos: precoAtual,
    },
    { status: 409 },
  );
}

function pedidoPermiteAdicao(pedido: PedidoAdicaoRow): boolean {
  return pedido.origem_pedido === "MANUAL"
    && pedido.status_comanda === "ABERTA"
    && ["NOVO", "PREPARANDO"].includes(pedido.status_pedido)
    && ["PENDENTE", "PARCIAL", "PAGO"].includes(pedido.status_pagamento);
}

async function carregarPedido(db: D1Database, pedidoId: number): Promise<PedidoAdicaoRow | null> {
  return await db.prepare(
    `SELECT id, origem_pedido, status_comanda, status_pedido, status_pagamento
     FROM pedidos WHERE id = ?`,
  ).bind(pedidoId).first<PedidoAdicaoRow>();
}

async function carregarProduto(db: D1Database, produtoId: number): Promise<ProdutoAdicaoRow | null> {
  return await db.prepare(
    `SELECT id, nome, preco_centavos, preco_promocional_centavos,
            promocao_ativa, promocao_inicio, promocao_fim,
            disponivel, ativo, estoque, estoque_reservado
     FROM produtos WHERE id = ?`,
  ).bind(produtoId).first<ProdutoAdicaoRow>();
}

async function reconstruirResposta(
  db: D1Database,
  operacao: OperacaoRow,
): Promise<ItemAdicionadoResponse | null> {
  if (!operacao.pedido_item_id || !operacao.pedido_id) return null;
  const row = await db.prepare(`
    SELECT p.id AS pedido_id, p.valor_total_centavos AS pedido_total_centavos,
           p.status_pagamento,
           pi.id AS item_id, pi.produto_id, pi.produto_nome, pi.quantidade,
           pi.valor_unitario_centavos,
           pi.valor_total_centavos AS item_total_centavos,
           pi.status_item, pi.estoque_estado,
           ${BRUTO_PAGO_SQL} AS bruto_pago_centavos,
           ${REEMBOLSADO_SQL} AS reembolsado_centavos,
           ${LIQUIDO_SQL} AS liquido_centavos
    FROM pedido_operacoes o
    JOIN pedido_itens pi ON pi.id = o.pedido_item_id
    JOIN pedidos p ON p.id = pi.pedido_id
    WHERE o.id = ? AND o.pedido_id = p.id
  `).bind(operacao.id).first<{
    pedido_id: number;
    pedido_total_centavos: number;
    status_pagamento: string;
    item_id: number;
    produto_id: number;
    produto_nome: string;
    quantidade: number;
    valor_unitario_centavos: number;
    item_total_centavos: number;
    status_item: string;
    estoque_estado: string;
    bruto_pago_centavos: number;
    reembolsado_centavos: number;
    liquido_centavos: number;
  }>();
  if (!row) return null;
  const liquido = Number(row.liquido_centavos || 0);
  return {
    pedidoId: row.pedido_id,
    item: {
      id: row.item_id,
      produtoId: row.produto_id,
      nome: row.produto_nome,
      quantidade: row.quantidade,
      precoUnitarioCentavos: row.valor_unitario_centavos,
      valorTotalCentavos: row.item_total_centavos,
      statusItem: row.status_item,
      estoqueEstado: row.estoque_estado,
    },
    financeiro: {
      totalCentavos: row.pedido_total_centavos,
      brutoPagoCentavos: Number(row.bruto_pago_centavos || 0),
      reembolsadoCentavos: Number(row.reembolsado_centavos || 0),
      liquidoCentavos: liquido,
      saldoCentavos: Math.max(0, row.pedido_total_centavos - liquido),
      statusPagamento: row.status_pagamento,
    },
  };
}

async function replayAdicionarItem(
  db: D1Database,
  operacao: OperacaoRow,
  identidade: IdentidadeEsperada,
): Promise<Response> {
  const conflito = conflitoOperacao(operacao, identidade);
  if (conflito) {
    return jsonError(OPERACAO_MENSAGENS[conflito], OPERACAO_HTTP_STATUS[conflito], conflito);
  }
  if (operacao.fase !== "CONCLUIDA") {
    return jsonError(
      OPERACAO_MENSAGENS.OPERACAO_EM_PROCESSAMENTO,
      OPERACAO_HTTP_STATUS.OPERACAO_EM_PROCESSAMENTO,
      "OPERACAO_EM_PROCESSAMENTO",
    );
  }
  const snapshot = parseResultado<ItemAdicionadoResponse>(operacao);
  const resultado = snapshot ?? await reconstruirResposta(db, operacao);
  if (!resultado) {
    return jsonError(
      OPERACAO_MENSAGENS.OPERACAO_INCOMPLETA,
      OPERACAO_HTTP_STATUS.OPERACAO_INCOMPLETA,
      "OPERACAO_INCOMPLETA",
    );
  }
  return Response.json(resultado, { status: 201 });
}

async function erroGuardAtual(
  db: D1Database,
  pedidoId: number,
  produtoId: number,
  quantidade: number,
  precoEsperadoCentavos: number,
): Promise<Response> {
  const [pedido, produto] = await Promise.all([
    carregarPedido(db, pedidoId),
    carregarProduto(db, produtoId),
  ]);
  if (!pedido) return jsonError("Pedido não encontrado", 404);
  if (!pedidoPermiteAdicao(pedido)) {
    return jsonError("Este pedido não permite adicionar itens no estado atual.", 409, "PEDIDO_NAO_EDITAVEL");
  }
  if (!produto) return jsonError("Produto não encontrado", 404);
  if (!produto.ativo || !produto.disponivel) {
    return jsonError(`Produto "${produto.nome}" indisponível`, 409, "PRODUTO_INDISPONIVEL");
  }
  const atual = precoAtualCentavos(produto);
  if (atual !== precoEsperadoCentavos) return precoAlterado(atual);
  if (quantidade > produto.estoque - produto.estoque_reservado) {
    return jsonError(`Estoque insuficiente para "${produto.nome}"`, 409, "ESTOQUE_INSUFICIENTE");
  }
  return jsonError("O pedido mudou durante a operação. Atualize e tente novamente.", 409, "ESTADO_ALTERADO");
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);

  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const pedidoId = Number(params.id);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) return jsonError("Id inválido", 400);

  let body: AdicionarItemBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Dados do item inválidos", 400);
  }
  const produtoId = body.produtoId;
  const quantidade = body.quantidade;
  const precoEsperadoCentavos = body.precoEsperadoCentavos;
  if (!Number.isInteger(produtoId) || Number(produtoId) <= 0
      || !Number.isInteger(quantidade) || Number(quantidade) < 1 || Number(quantidade) > 50
      || !Number.isSafeInteger(precoEsperadoCentavos) || Number(precoEsperadoCentavos) < 1) {
    return jsonError("Dados do item inválidos", 400);
  }

  const chave = parseOperationKey(body.operationKey);
  if (!chave.ok) return jsonError(OPERACAO_MENSAGENS.OPERATION_KEY_INVALIDA, 400, chave.erro);
  const operationKey = chave.key;
  const produtoIdNumero = Number(produtoId);
  const quantidadeNumero = Number(quantidade);
  const precoEsperadoNumero = Number(precoEsperadoCentavos);
  const identidade: IdentidadeEsperada = {
    tipo: "ITEM_ADICAO_ADMIN",
    escopo: "ADMIN",
    atorUsuarioId: auth.user.id,
    fingerprint: fingerprint({
      pedidoId,
      produtoId: produtoIdNumero,
      quantidade: quantidadeNumero,
      precoEsperadoCentavos: precoEsperadoNumero,
    }),
  };

  try {
    // A1 antes de qualquer guard mutavel: replay continua funcionando mesmo
    // se pedido, produto, preco ou estoque mudaram desde a primeira resposta.
    const existente = await buscarOperacao(env.DB, operationKey);
    if (existente) return await replayAdicionarItem(env.DB, existente, identidade);

    const [pedido, produto] = await Promise.all([
      carregarPedido(env.DB, pedidoId),
      carregarProduto(env.DB, produtoIdNumero),
    ]);
    if (!pedido) return jsonError("Pedido não encontrado", 404);
    if (!pedidoPermiteAdicao(pedido)) {
      return jsonError("Este pedido não permite adicionar itens no estado atual.", 409, "PEDIDO_NAO_EDITAVEL");
    }
    if (!produto) return jsonError("Produto não encontrado", 404);
    if (!produto.ativo || !produto.disponivel) {
      return jsonError(`Produto "${produto.nome}" indisponível`, 409, "PRODUTO_INDISPONIVEL");
    }
    const precoAtual = precoAtualCentavos(produto);
    if (precoAtual !== precoEsperadoNumero) return precoAlterado(precoAtual);
    if (quantidadeNumero > produto.estoque - produto.estoque_reservado) {
      return jsonError(`Estoque insuficiente para "${produto.nome}"`, 409, "ESTOQUE_INSUFICIENTE");
    }

    const insertItem = env.DB.prepare(`
      INSERT INTO pedido_itens (
        pedido_id, produto_id, produto_nome, quantidade,
        valor_unitario_centavos, valor_total_centavos,
        adicionado_por_usuario_id, adicionado_em,
        status_item, estoque_estado, estoque_reservado_em
      )
      SELECT p.id, pr.id, pr.nome, ?, ?, ?, ?, CURRENT_TIMESTAMP,
             'ATIVO', 'RESERVADO', CURRENT_TIMESTAMP
      FROM pedidos p
      JOIN produtos pr ON pr.id = ?
      WHERE p.id = ?
        AND p.origem_pedido = 'MANUAL'
        AND p.status_comanda = 'ABERTA'
        AND p.status_pedido IN ('NOVO', 'PREPARANDO')
        AND p.status_pagamento IN ('PENDENTE', 'PARCIAL', 'PAGO')
        AND pr.ativo = 1 AND pr.disponivel = 1
        AND pr.estoque - pr.estoque_reservado >= ?
        AND pr.preco_centavos = ?
        AND pr.preco_promocional_centavos IS ?
        AND pr.promocao_ativa = ?
        AND pr.promocao_inicio IS ?
        AND pr.promocao_fim IS ?
    `).bind(
      quantidadeNumero,
      precoAtual,
      precoAtual * quantidadeNumero,
      auth.user.id,
      produtoIdNumero,
      pedidoId,
      quantidadeNumero,
      produto.preco_centavos,
      produto.preco_promocional_centavos,
      produto.promocao_ativa,
      produto.promocao_inicio,
      produto.promocao_fim,
    );

    const claim = prepareClaimOperacao(env.DB, {
      key: operationKey,
      ...identidade,
      fase: "LOCAL_CRIADA",
      fonte: fonteItemAdicionado({
        pedidoId,
        produtoId: produtoIdNumero,
        quantidade: quantidadeNumero,
        valorUnitarioCentavos: precoAtual,
        atorUsuarioId: auth.user.id,
      }),
    });

    const reserveNewItem = env.DB.prepare(`
      UPDATE produtos
      SET estoque_reservado = estoque_reservado + ?,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM pedido_operacoes o
          JOIN pedido_itens pi ON pi.id = o.pedido_item_id
          WHERE o.operation_key = ? AND o.pedido_id = ?
            AND pi.produto_id = produtos.id
            AND pi.quantidade = ?
            AND pi.status_item = 'ATIVO'
            AND pi.estoque_estado = 'RESERVADO'
        )
    `).bind(quantidadeNumero, produtoIdNumero, operationKey, pedidoId, quantidadeNumero);

    const projectTotal = env.DB.prepare(`
      UPDATE pedidos
      SET valor_total_centavos = (
            SELECT COALESCE(SUM(pi.valor_total_centavos), 0)
            FROM pedido_itens pi
            WHERE pi.pedido_id = pedidos.id AND pi.status_item = 'ATIVO'
          ),
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
        AND EXISTS (SELECT 1 FROM pedido_operacoes o
                    WHERE o.operation_key = ? AND o.pedido_id = pedidos.id
                      AND o.pedido_item_id IS NOT NULL)
    `).bind(pedidoId, operationKey);

    const finalizeOperation = env.DB.prepare(`
      UPDATE pedido_operacoes AS o
      SET fase = 'CONCLUIDA',
          resultado = (
            SELECT json_object(
              'pedidoId', p.id,
              'item', json_object(
                'id', pi.id,
                'produtoId', pi.produto_id,
                'nome', pi.produto_nome,
                'quantidade', pi.quantidade,
                'precoUnitarioCentavos', pi.valor_unitario_centavos,
                'valorTotalCentavos', pi.valor_total_centavos,
                'statusItem', pi.status_item,
                'estoqueEstado', pi.estoque_estado
              ),
              'financeiro', json_object(
                'totalCentavos', p.valor_total_centavos,
                'brutoPagoCentavos', ${BRUTO_PAGO_SQL},
                'reembolsadoCentavos', ${REEMBOLSADO_SQL},
                'liquidoCentavos', ${LIQUIDO_SQL},
                'saldoCentavos', MAX(0, p.valor_total_centavos - (${LIQUIDO_SQL})),
                'statusPagamento', p.status_pagamento
              )
            )
            FROM pedido_itens pi
            JOIN pedidos p ON p.id = pi.pedido_id
            WHERE pi.id = o.pedido_item_id AND p.id = o.pedido_id
          ),
          atualizado_em = CURRENT_TIMESTAMP
      WHERE o.operation_key = ? AND o.tipo = 'ITEM_ADICAO_ADMIN'
        AND o.fase = 'LOCAL_CRIADA' AND o.pedido_item_id IS NOT NULL
    `).bind(operationKey);

    // D1 so reverte o batch quando um statement falha; changes=0, por si
    // so, confirmaria a transacao. Esta sentinela tenta gravar um total
    // proibido se qualquer parte do resultado atomico nao estiver provada.
    // O CHECK de pedidos.valor_total_centavos entao aborta e reverte tudo.
    const assertAtomicOutcome = env.DB.prepare(`
      UPDATE pedidos AS p
      SET valor_total_centavos = -1
      WHERE p.id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM pedido_operacoes o
          JOIN pedido_itens pi ON pi.id = o.pedido_item_id
          JOIN produtos pr ON pr.id = pi.produto_id
          WHERE o.operation_key = ?
            AND o.tipo = 'ITEM_ADICAO_ADMIN'
            AND o.fase = 'CONCLUIDA'
            AND o.pedido_id = p.id
            AND o.resultado IS NOT NULL
            AND pi.status_item = 'ATIVO'
            AND pi.estoque_estado = 'RESERVADO'
            AND p.valor_total_centavos = (
              SELECT COALESCE(SUM(ativo.valor_total_centavos), 0)
              FROM pedido_itens ativo
              WHERE ativo.pedido_id = p.id AND ativo.status_item = 'ATIVO'
            )
            AND p.status_pagamento = ${STATUS_FINANCEIRO_SQL}
            AND pr.estoque_reservado = (
              SELECT COALESCE(SUM(reservado.quantidade), 0)
              FROM pedido_itens reservado
              WHERE reservado.produto_id = pr.id
                AND reservado.status_item = 'ATIVO'
                AND reservado.estoque_estado = 'RESERVADO'
            )
        )
    `).bind(pedidoId, operationKey);

    let results;
    try {
      results = await env.DB.batch([
        insertItem,
        claim,
        reserveNewItem,
        projectTotal,
        preparePedidoFinancialProjectionForItemOperation(env.DB, pedidoId, operationKey),
        preparePedidoPhysicalProjection(env.DB, pedidoId, operationKey),
        finalizeOperation,
        assertAtomicOutcome,
      ]);
    } catch (err) {
      const vencedora = await buscarOperacao(env.DB, operationKey);
      if (vencedora) return await replayAdicionarItem(env.DB, vencedora, identidade);
      const mensagem = String((err as Error)?.message || "");
      if (mensagem.includes("CHECK constraint failed: estoque")) {
        return jsonError(`Estoque insuficiente para "${produto.nome}"`, 409, "ESTOQUE_INSUFICIENTE");
      }
      if (mensagem.includes("FOREIGN KEY constraint failed")
          || mensagem.includes("valor_total_centavos")) {
        return await erroGuardAtual(
          env.DB,
          pedidoId,
          produtoIdNumero,
          quantidadeNumero,
          precoEsperadoNumero,
        );
      }
      throw err;
    }

    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      return await erroGuardAtual(
        env.DB,
        pedidoId,
        produtoIdNumero,
        quantidadeNumero,
        precoEsperadoNumero,
      );
    }
    if ([1, 2, 3, 4, 5, 6].some((index) => Number(results[index]?.meta?.changes || 0) !== 1)) {
      throw new Error("ITEM_ADICAO_ADMIN_BATCH_INCOMPLETO");
    }
    if (Number(results[7]?.meta?.changes || 0) !== 0) {
      throw new Error("ITEM_ADICAO_ADMIN_INVARIANTE_INVALIDA");
    }

    const concluida = await buscarOperacao(env.DB, operationKey);
    if (!concluida) throw new Error("ITEM_ADICAO_ADMIN_SEM_CLAIM");
    return await replayAdicionarItem(env.DB, concluida, identidade);
  } catch (err) {
    console.error("Erro ao adicionar item ao pedido (admin)", err);
    return jsonError("Erro interno ao adicionar item ao pedido", 500);
  }
};

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !("itens" in body) ||
    !Array.isArray(body.itens) ||
    body.itens.length === 0
  ) {
    return jsonError("A comanda precisa ter ao menos um item", 400);
  }
  if (body.itens.length > MAX_ITENS_PER_PEDIDO) {
    return jsonError("Itens demais", 400);
  }
  if (
    !body.itens.every(
      (i) =>
        i &&
        typeof i === "object" &&
        !Array.isArray(i) &&
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
      `SELECT id FROM pedidos WHERE id = ?`,
    )
      .bind(id)
      .first<{ id: number }>();

    if (!pedido) {
      return jsonError("Pedido não encontrado", 404);
    }

    // B1: toda edição fica bloqueada até existir um editor que preserve
    // identidade, histórico financeiro e físico, inclusive sob concorrência.
    return Response.json(
      {
        error: "A edição de itens está temporariamente indisponível. Nenhuma alteração foi salva.",
        code: "EDICAO_ITENS_BLOQUEADA",
      },
      { status: 409 },
    );
  } catch (err) {
    console.error("Erro ao editar itens do pedido (admin)", err);
    return jsonError("Erro interno ao editar itens do pedido", 500);
  }
};
