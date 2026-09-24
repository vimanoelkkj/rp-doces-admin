/// <reference types="@cloudflare/workers-types" />

import { baixarEstoquePedido } from "../stock";
import {
  conflitoOperacao,
  OPERACAO_HTTP_STATUS,
  OPERACAO_MENSAGENS,
  type IdentidadeEsperada,
  type OperacaoRow,
} from "../operacoes";
import type { Env } from "./types";

// A1 — replay da criação de pedido ADMIN. Reconstruído a partir das linhas
// persistidas (fonte da verdade), nunca de um snapshot que poderia divergir.
// A baixa física é retentada porque `baixarEstoquePedido` é idempotente por
// pedido (guarda em `estoque_baixado_em IS NULL`): o retry RECUPERA uma baixa
// que tenha falhado, e nunca produz uma segunda.
export async function replayPedidoManual(
  env: Env,
  operacao: OperacaoRow,
  identidade: IdentidadeEsperada,
  statusPagamento: "PENDENTE" | "PAGO",
): Promise<Response> {
  const conflito = conflitoOperacao(operacao, identidade);
  if (conflito) {
    return Response.json(
      { error: OPERACAO_MENSAGENS[conflito], code: conflito },
      { status: OPERACAO_HTTP_STATUS[conflito] },
    );
  }

  const pedido = operacao.pedido_id
    ? await env.DB.prepare(
        `SELECT id, token_publico, valor_total_centavos, estoque_baixado_em
         FROM pedidos WHERE id = ? LIMIT 1`,
      )
        .bind(operacao.pedido_id)
        .first<{
          id: number;
          token_publico: string;
          valor_total_centavos: number;
          estoque_baixado_em: string | null;
        }>()
    : null;

  if (!pedido || !operacao.pagamento_id) {
    return Response.json(
      {
        error: OPERACAO_MENSAGENS.OPERACAO_INCOMPLETA,
        code: "OPERACAO_INCOMPLETA",
      },
      { status: OPERACAO_HTTP_STATUS.OPERACAO_INCOMPLETA },
    );
  }

  let estoqueBaixado = pedido.estoque_baixado_em !== null;
  if (statusPagamento === "PAGO" && !estoqueBaixado) {
    try {
      const baixa = await baixarEstoquePedido(env.DB, pedido.id);
      estoqueBaixado = baixa.ok && baixa.baixado;
    } catch (err) {
      console.error("Falha ao retentar baixa de estoque em replay de pedido manual", pedido.id, err);
    }
  }

  return Response.json(
    {
      ok: true,
      pedidoId: pedido.id,
      pagamentoId: operacao.pagamento_id,
      tokenPublico: pedido.token_publico,
      valorTotalCentavos: pedido.valor_total_centavos,
      statusPagamento,
      estoqueBaixado,
      replay: true,
    },
    { status: 201 },
  );
}
