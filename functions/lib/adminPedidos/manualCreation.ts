/// <reference types="@cloudflare/workers-types" />

import { precoAtualCentavos, type ProdutoRow } from "../pricing";
import { baixarEstoquePedido } from "../stock";
import { notificarNovoPedidoPagoSafe } from "../pushNotifier";
import {
  buscarOperacao,
  chavePagamento,
  chavePedido,
  fontePedidoComPagamento,
  prepareClaimOperacao,
  type IdentidadeEsperada,
} from "../operacoes";
import { replayPedidoManual } from "./manualReplay";
import type { ItemManualInput } from "./manualValidation";
import type { Env } from "./types";

interface ProdutoManualRow extends ProdutoRow {
  ativo: number;
}

export interface CreateManualPedidoParams {
  usuarioId: number;
  itens: ItemManualInput[];
  clienteNome: string;
  clienteWhatsapp: string;
  observacao: string;
  metodoPagamento: string;
  statusPagamento: "PENDENTE" | "PAGO";
  operationKey: string;
  identidade: IdentidadeEsperada;
}

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export async function createManualPedido(
  env: Env,
  params: CreateManualPedidoParams,
): Promise<Response> {
  const {
    usuarioId,
    itens,
    clienteNome,
    clienteWhatsapp,
    observacao,
    metodoPagamento,
    statusPagamento,
    operationKey,
    identidade,
  } = params;
  const nascePago = statusPagamento === "PAGO";

  try {
    const ids = [...new Set(itens.map((i) => i.produtoId))];
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      `SELECT id, nome, preco_centavos, preco_promocional_centavos,
              promocao_ativa, promocao_inicio, promocao_fim,
              disponivel, ativo, estoque, estoque_reservado
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

    for (const item of itens) {
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

    // B-1 — POLÍTICA DE RESERVA DO PEDIDO MANUAL (decisão explícita).
    //
    // A reserva nasce `ATIVA` com `reserva_expira_em` deliberadamente NULL:
    // um pedido de balcão NÃO tem prazo de pagamento como um Pix tem. O TTL
    // de 31 minutos do checkout existe porque lá a reserva protege uma
    // cobrança remota com vencimento próprio; aqui não há cobrança remota
    // nenhuma enquanto o método for local.
    //
    // Expirar essa reserva automaticamente seria o comportamento ERRADO:
    // venderia para outra pessoa o doce que a operadora acabou de prometer
    // no balcão, sem ninguém pedir. Por isso `liberarReservasVencidasLocalmente`
    // continua restrita a `origem='SITE'` e NÃO foi estendida aqui, e nenhum
    // cron/sweep novo foi criado.
    //
    // O que torna essa reserva sem prazo segura é a LIBERAÇÃO EXPLÍCITA, que
    // já existe e continua protegida pelo B4:
    //   * cancelar o pedido (PATCH status CANCELADO) chama
    //     `liberarReservaPedido`, cujo predicado exige líquido zero, ausência
    //     de baixa física e ausência de qualquer `PIX_MP/PENDENTE` — um
    //     placeholder local (A_COMBINAR/DINHEIRO/...) não retém reserva;
    //   * pagar converte a reserva em baixa física (`baixarEstoquePedido`).
    // E o que faltava para isso ser operável era exatamente a visibilidade
    // corrigida em `PEDIDOS_OPERACIONAIS_SQL`: reserva sem prazo só é segura
    // quando o pedido é visível e cancelável.
    //
    // `token_publico` continua ALEATÓRIO de propósito: é o identificador
    // público de acompanhamento do pedido e não pode ser derivado de uma key
    // conhecida pelo operador. A idempotência não precisa dele — as chaves
    // derivadas abaixo já tornam a criação at-most-once, e num retry o
    // pedido não é recriado (o replay devolve o token persistido).
    const tokenPublico = crypto.randomUUID();
    // A1: derivadas da operation key. `pedidos.idempotency_key` é NOT NULL
    // UNIQUE, então a criação do pedido é atomicamente at-most-once por
    // intenção — inclusive sob concorrência e inclusive quando ele nasce PAGO.
    const idempotencyKeyPedido = chavePedido(operationKey);
    const idempotencyKey = chavePagamento(operationKey);

    const statements = [
      // B5: colunas do modelo legado "um produto por pedido" que o `pedidos`
      // histórico de produção exige como NOT NULL sem DEFAULT. Preenchidas
      // com valores neutros por compatibilidade estrutural — a composição
      // real é `pedido_itens` e o total é `valor_total_centavos`. Ver a nota
      // completa em `migrations/0013_pedidos_compat_colunas_legadas.sql`.
      env.DB.prepare(
        `INSERT INTO pedidos
           (token_publico, cliente_nome, cliente_whatsapp, observacao, valor_total_centavos,
            idempotency_key, origem_pedido, reserva_status, status_pagamento, status_pedido, pago_em,
            cliente_email, produto_nome, quantidade, valor_unitario_centavos)
         VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', 'ATIVA', ?, 'NOVO', CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
                 '', '', 1, 0)`,
      ).bind(
        tokenPublico,
        clienteNome,
        clienteWhatsapp,
        observacao,
        totalCentavos,
        idempotencyKeyPedido,
        statusPagamento,
        nascePago ? 1 : 0,
      ),
      ...itensParaPersistir.map((item) =>
        env.DB.prepare(
          `INSERT INTO pedido_itens
             (pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos,
              valor_total_centavos, adicionado_por_usuario_id, adicionado_em,
              status_item, estoque_estado, estoque_reservado_em)
           SELECT id, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
                  'ATIVO', 'RESERVADO', CURRENT_TIMESTAMP
           FROM pedidos WHERE token_publico = ?`,
        ).bind(
          item.produtoId,
          item.produtoNome,
          item.quantidade,
          item.valorUnitarioCentavos,
          item.valorTotalCentavos,
          usuarioId,
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
        usuarioId,
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
      // Claim A1 por último e condicionado à existência do pedido E do
      // pagamento recém-criados. Tudo no mesmo batch: ou a intenção fica
      // registrada junto com o pedido, os itens, o pagamento, as alocações e
      // a reserva, ou nada existe.
      prepareClaimOperacao(env.DB, {
        key: operationKey,
        ...identidade,
        fase: "CONCLUIDA",
        fonte: fontePedidoComPagamento(idempotencyKeyPedido, idempotencyKey),
      }),
    ];

    let batchResults;
    try {
      batchResults = await env.DB.batch(statements);
    } catch (err) {
      // A disputa da mesma operation key (UNIQUE de
      // `pedidos.idempotency_key` ou de `operation_key`) reverte o batch
      // inteiro do perdedor, que então recupera a operação vencedora em vez
      // de criar um segundo pedido.
      const vencedora = await buscarOperacao(env.DB, operationKey);
      if (vencedora) {
        return await replayPedidoManual(env, vencedora, identidade, statusPagamento);
      }
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
          // reconciliação oportunista (reconcilePedidosDivergentes) na próxima
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
      await notificarNovoPedidoPagoSafe(env.DB, env, pedidoId, {
        excludeUsuarioId: usuarioId,
      });
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
}
