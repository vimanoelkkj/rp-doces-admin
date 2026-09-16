/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../lib/auth";
import { reconcilePendingPixPayments, liberarReservasVencidasLocalmente } from "../../lib/paymentSync";
import { baixarEstoquePedido, reconciliarPagosSemBaixa } from "../../lib/stock";
import { precoAtualCentavos, ProdutoRow } from "../../lib/pricing";
import { getFinanceirosPorPedidos } from "../../lib/comandaLedger";
import type { FinanceiroPedido, LedgerMetodo } from "../../lib/comandaLedger";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}

interface PedidoListRow {
  id: number;
  cliente_nome: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_pedido: string;
  criado_em: string;
}

interface PedidoListItem extends PedidoListRow {
  financeiro: FinanceiroPedido;
}

interface CountsRow {
  todos: number;
  hoje: number;
  em_producao: number;
  prontos: number;
  entregues: number;
}

const ITEMS_PER_PAGE = 8;
const TAB_FILTERS: Record<string, string> = {
  hoje: "AND date(criado_em) = date('now')",
  em_producao: "AND status_pedido IN ('NOVO', 'PREPARANDO')",
  prontos: "AND status_pedido = 'PRONTO'",
  entregues: "AND status_pedido = 'ENTREGUE'",
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  try {
    // Reconciliação oportunista (Passo 6/7): melhor esforço, nunca deve
    // impedir a listagem de carregar se falhar.
    try {
      await reconcilePendingPixPayments(env);
    } catch (err) {
      console.error("Falha na reconciliação oportunista de pagamentos PIX_MP", err);
    }
    try {
      await liberarReservasVencidasLocalmente(env);
    } catch (err) {
      console.error("Falha na liberação local de reservas vencidas", err);
    }
    try {
      await reconciliarPagosSemBaixa(env.DB);
    } catch (err) {
      console.error("Falha na reconciliação de pedidos pagos sem baixa de estoque", err);
    }

    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
    const tab = url.searchParams.get("status") ?? "todos";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

    const tabFilter = TAB_FILTERS[tab] ?? "";

    let searchFilter = "";
    const searchParams: string[] = [];
    if (search) {
      const idPart = search.replace(/^RP-/i, "");
      searchFilter =
        "AND (CAST(id AS TEXT) LIKE ? OR cliente_nome LIKE ?)";
      searchParams.push(`%${idPart}%`, `%${search}%`);
    }

    const { count } = (await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM pedidos
       WHERE status_pagamento IN ('PARCIAL', 'PAGO') ${tabFilter} ${searchFilter}`,
    )
      .bind(...searchParams)
      .first<{ count: number }>())!;

    const totalPages = Math.max(1, Math.ceil(count / ITEMS_PER_PAGE));
    const offset = (page - 1) * ITEMS_PER_PAGE;

    const { results: pedidos } = await env.DB.prepare(
      `SELECT id, cliente_nome, valor_total_centavos, status_pagamento, status_pedido, criado_em
       FROM pedidos
       WHERE status_pagamento IN ('PARCIAL', 'PAGO') ${tabFilter} ${searchFilter}
       ORDER BY criado_em DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...searchParams, ITEMS_PER_PAGE, offset)
      .all<PedidoListRow>();

    // Lote único pra página inteira (no máximo ITEMS_PER_PAGE pedidos) —
    // nunca uma consulta financeira por linha.
    const financeiroPorPedido = await getFinanceirosPorPedidos(
      env.DB,
      pedidos.map((p) => ({
        id: p.id,
        valorTotalCentavos: p.valor_total_centavos,
        statusPagamento: p.status_pagamento,
      })),
    );
    const pedidosComFinanceiro: PedidoListItem[] = pedidos.map((p) => ({
      ...p,
      financeiro: financeiroPorPedido.get(p.id) ?? {
        status: p.status_pagamento as FinanceiroPedido["status"],
        pagoCentavos: 0,
        totalCentavos: p.valor_total_centavos,
        metodosConfirmados: [],
      },
    }));

    const counts = (await env.DB.prepare(
      `SELECT
         COUNT(*) AS todos,
         SUM(CASE WHEN date(criado_em) = date('now') THEN 1 ELSE 0 END) AS hoje,
         SUM(CASE WHEN status_pedido IN ('NOVO', 'PREPARANDO') THEN 1 ELSE 0 END) AS em_producao,
         SUM(CASE WHEN status_pedido = 'PRONTO' THEN 1 ELSE 0 END) AS prontos,
         SUM(CASE WHEN status_pedido = 'ENTREGUE' THEN 1 ELSE 0 END) AS entregues
       FROM pedidos WHERE status_pagamento IN ('PARCIAL', 'PAGO')`,
    ).first<CountsRow>())!;

    return Response.json({
      pedidos: pedidosComFinanceiro,
      total: count,
      page,
      totalPages,
      counts,
    });
  } catch (err) {
    console.error("Erro ao listar pedidos (admin)", err);
    return jsonError("Erro interno ao listar pedidos", 500);
  }
};

// Criação manual de pedido pelo admin (balcão): origem_pedido='MANUAL',
// sem checkout do site, sem Mercado Pago. Diferente do checkout.ts, aqui
// não existe chamada de rede entre "criar" e "confirmar pagamento" — tudo é
// conhecido de uma vez só no mesmo request, então cabe no MESMO batch
// atômico: pedido + itens + reserva de estoque + pagamento (já PAGO, se for
// o caso) + alocações. status_pagamento nasce com o valor final correto já
// no INSERT (não via recalculatePedidoStatusPagamento) justamente para que
// "pedido pago" nunca possa ficar persistido como PENDENTE por causa de uma
// falha num passo posterior — não existe passo posterior para o status
// financeiro. Só a baixa FÍSICA de estoque (baixarEstoquePedido) continua
// numa chamada separada depois do batch: reaproveita o mesmo helper usado
// por todo write-path financeiro (webhook, pagamento manual, reembolso),
// sem duplicar a lógica de baixa, e sua falha nunca é silenciosa — cai no
// mesmo caminho de reconciliação oportunista (reconciliarPagosSemBaixa) que
// já existe para o Pix do site.

interface ItemManualInput {
  produtoId: number;
  quantidade: number;
}

interface CriarPedidoManualBody {
  itens?: ItemManualInput[];
  clienteNome?: string;
  clienteWhatsapp?: string;
  observacao?: string;
  metodoPagamento?: string;
  statusPagamento?: string;
}

interface ProdutoManualRow extends ProdutoRow {
  ativo: number;
}

const MAX_ITENS_PEDIDO_MANUAL = 20;
const MAX_TEXT_LENGTH_MANUAL = 200;

// Mesmo vocabulário de MetodoManual (comandaLedger.ts) mais A_COMBINAR, que
// só faz sentido para um pedido que nasce PENDENTE (dinheiro nenhum
// confirmado ainda) — nunca para um pedido que já nasce PAGO.
const METODOS_PERMITIDOS: ReadonlySet<string> = new Set([
  "DINHEIRO",
  "CARTAO",
  "PIX_EXTERNO",
  "A_COMBINAR",
]);
const METODOS_CONFIRMAVEIS: ReadonlySet<string> = new Set([
  "DINHEIRO",
  "CARTAO",
  "PIX_EXTERNO",
]);
const STATUS_PAGAMENTO_VALIDOS: ReadonlySet<string> = new Set(["PENDENTE", "PAGO"]);

function normalizeManualItems(
  raw: unknown,
):
  | { ok: true; itens: ItemManualInput[] }
  | { ok: false; erro: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, erro: "O pedido precisa ter ao menos um item" };
  }
  if (raw.length > MAX_ITENS_PEDIDO_MANUAL) {
    return { ok: false, erro: `Máximo de ${MAX_ITENS_PEDIDO_MANUAL} itens por pedido` };
  }

  const agregados = new Map<number, number>();
  for (const item of raw) {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isInteger((item as ItemManualInput).produtoId) ||
      (item as ItemManualInput).produtoId <= 0 ||
      !Number.isInteger((item as ItemManualInput).quantidade) ||
      (item as ItemManualInput).quantidade < 1 ||
      (item as ItemManualInput).quantidade > 50
    ) {
      return { ok: false, erro: "Item de pedido inválido" };
    }
    const { produtoId, quantidade } = item as ItemManualInput;
    agregados.set(produtoId, (agregados.get(produtoId) ?? 0) + quantidade);
  }

  const itens: ItemManualInput[] = [];
  for (const [produtoId, quantidade] of agregados) {
    if (quantidade > 50) {
      return { ok: false, erro: "Quantidade total de um produto excede o limite" };
    }
    itens.push({ produtoId, quantidade });
  }
  return { ok: true, itens };
}

function validarMetodoEStatus(
  metodo: unknown,
  status: unknown,
):
  | { ok: true; metodo: LedgerMetodo; status: "PENDENTE" | "PAGO" }
  | { ok: false; erro: string } {
  if (typeof status !== "string" || !STATUS_PAGAMENTO_VALIDOS.has(status)) {
    return { ok: false, erro: "Situação de pagamento inválida" };
  }
  if (typeof metodo !== "string" || !METODOS_PERMITIDOS.has(metodo)) {
    return { ok: false, erro: "Método de pagamento inválido" };
  }
  if (status === "PAGO" && !METODOS_CONFIRMAVEIS.has(metodo)) {
    return { ok: false, erro: "\"A combinar\" não é válido para um pedido já pago" };
  }
  return { ok: true, metodo: metodo as LedgerMetodo, status: status as "PENDENTE" | "PAGO" };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  let body: CriarPedidoManualBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const itensResult = normalizeManualItems(body.itens);
  if (!itensResult.ok) return jsonError(itensResult.erro, 400);

  const metodoStatusResult = validarMetodoEStatus(body.metodoPagamento, body.statusPagamento);
  if (!metodoStatusResult.ok) return jsonError(metodoStatusResult.erro, 400);
  const { metodo: metodoPagamento, status: statusPagamento } = metodoStatusResult;
  const nascePago = statusPagamento === "PAGO";

  const clienteNome = (body.clienteNome ?? "").trim().slice(0, MAX_TEXT_LENGTH_MANUAL);
  const clienteWhatsapp = (body.clienteWhatsapp ?? "").trim().slice(0, MAX_TEXT_LENGTH_MANUAL);
  const observacao = (body.observacao ?? "").trim().slice(0, MAX_TEXT_LENGTH_MANUAL);

  try {
    const ids = [...new Set(itensResult.itens.map((i) => i.produtoId))];
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id, nome, preco_centavos, preco_promocional_centavos,
              promocao_inicio, promocao_fim, disponivel, ativo, estoque, estoque_reservado
       FROM produtos WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<ProdutoManualRow>();

    const produtosPorId = new Map(results.map((p) => [p.id, p]));

    let totalCentavos = 0;
    const itensParaPersistir: {
      produtoId: number;
      produtoNome: string;
      quantidade: number;
      valorUnitarioCentavos: number;
      valorTotalCentavos: number;
    }[] = [];

    for (const item of itensResult.itens) {
      const produto = produtosPorId.get(item.produtoId);
      if (!produto) {
        return jsonError(`Produto ${item.produtoId} não encontrado`, 400);
      }
      if (!produto.ativo || !produto.disponivel) {
        return jsonError(`Produto "${produto.nome}" indisponível`, 400);
      }
      const estoqueLivre = produto.estoque - produto.estoque_reservado;
      if (item.quantidade > estoqueLivre) {
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

    const tokenPublico = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const statements = [
      env.DB.prepare(
        `INSERT INTO pedidos
           (token_publico, cliente_nome, cliente_whatsapp, observacao, valor_total_centavos,
            idempotency_key, origem_pedido, reserva_status, status_pagamento, pago_em)
         VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', 'ATIVA', ?, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)`,
      ).bind(
        tokenPublico,
        clienteNome,
        clienteWhatsapp,
        observacao,
        totalCentavos,
        idempotencyKey,
        statusPagamento,
        nascePago ? 1 : 0,
      ),
      ...itensParaPersistir.map((item) =>
        env.DB.prepare(
          `INSERT INTO pedido_itens
             (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos,
              valor_total_centavos, adicionado_por_usuario_id, adicionado_em)
           SELECT id, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP FROM pedidos WHERE token_publico = ?`,
        ).bind(
          item.produtoId,
          item.produtoNome,
          item.quantidade,
          item.valorUnitarioCentavos,
          item.valorTotalCentavos,
          auth.user.id,
          tokenPublico,
        ),
      ),
      env.DB.prepare(
        `INSERT INTO pedido_pagamentos
           (pedido_id, metodo, origem, valor_centavos, status, registrado_por_usuario_id,
            observacao, idempotency_key, pago_em)
         SELECT id, ?, 'ADMIN', ?, ?, ?, ?, ?, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
         FROM pedidos WHERE token_publico = ?`,
      ).bind(
        metodoPagamento,
        totalCentavos,
        statusPagamento,
        auth.user.id,
        observacao,
        idempotencyKey,
        nascePago ? 1 : 0,
        tokenPublico,
      ),
      env.DB.prepare(
        `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
         SELECT (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?), pi.id, pi.valor_total_centavos
         FROM pedido_itens pi
         JOIN pedidos p ON p.id = pi.pedido_id
         WHERE p.token_publico = ? AND pi.valor_total_centavos > 0`,
      ).bind(idempotencyKey, tokenPublico),
      ...itensParaPersistir.map((item) =>
        env.DB.prepare(
          `UPDATE produtos SET estoque_reservado = estoque_reservado + ?, atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(item.quantidade, item.produtoId),
      ),
    ];

    let batchResults;
    try {
      batchResults = await env.DB.batch(statements);
    } catch (err) {
      if (String((err as Error)?.message || "").includes("CHECK")) {
        return jsonError("Um ou mais produtos não possuem estoque suficiente disponível.", 409);
      }
      throw err;
    }

    const pedidoId = batchResults[0].meta.last_row_id;
    const pagamentoId = batchResults[1 + itensParaPersistir.length].meta.last_row_id;

    let estoqueBaixado = false;
    if (nascePago) {
      try {
        const baixa = await baixarEstoquePedido(env.DB, pedidoId);
        estoqueBaixado = baixa.ok && baixa.baixado;
        if (!baixa.ok) {
          // Estoque físico insuficiente no instante da conversão (corrida
          // com outra venda entre a reserva acima e este passo). O pedido
          // continua PAGO — não silencioso, será retentado pela
          // reconciliação oportunista (reconciliarPagosSemBaixa) na próxima
          // carga do painel admin.
          console.error(
            "Pedido manual criado como PAGO sem baixa imediata de estoque",
            pedidoId,
            baixa.erro,
          );
        }
      } catch (err) {
        console.error("Falha ao baixar estoque do pedido manual recém-criado", pedidoId, err);
      }
    }

    return Response.json(
      {
        ok: true,
        pedidoId,
        pagamentoId,
        tokenPublico,
        valorTotalCentavos: totalCentavos,
        statusPagamento,
        estoqueBaixado,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Erro ao criar pedido manual (admin)", err);
    return jsonError("Erro interno ao criar pedido", 500);
  }
};
