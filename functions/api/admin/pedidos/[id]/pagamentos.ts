/// <reference types="@cloudflare/workers-types" />

import { recusarPedidoAnulado } from "../../../../lib/pedidoValido";
import { ESTORNO_ANULACAO_ATIVO_MENSAGEM } from "../../../../lib/pedidoAnulacao";

import { requireUser, sameOrigin } from "../../../../lib/auth";
import { registerAdminPayment, MetodoManual } from "../../../../lib/comandaLedger";
import {
  OPERACAO_HTTP_STATUS,
  OPERACAO_MENSAGENS,
  parseOperationKey,
} from "../../../../lib/operacoes";

interface Env {
  DB: D1Database;
}

interface PagamentoManualInput {
  metodo?: string;
  valorCentavos?: number;
  observacao?: string;
  operationKey?: string;
}

const METODOS_VALIDOS = new Set(["DINHEIRO", "CARTAO", "PIX_EXTERNO"]);

const MENSAGENS: Record<string, string> = {
  PEDIDO_NAO_ENCONTRADO: "Pedido não encontrado",
  COMANDA_ENCERRADA: "Esta comanda já foi encerrada",
  VALOR_ACIMA_DO_SALDO: "Valor acima do saldo em aberto",
  SALDO_INSUFICIENTE_CONCORRENCIA:
    "O saldo mudou antes da confirmação. Atualize e tente novamente.",
  ESTORNO_ANULACAO_ATIVO: ESTORNO_ANULACAO_ATIVO_MENSAGEM,
  ...OPERACAO_MENSAGENS,
};

function jsonError(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return jsonError("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  const anulado = await recusarPedidoAnulado(env.DB, Number(params.id));
  if (anulado) return anulado;


  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: PagamentoManualInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  const metodo = body.metodo;
  if (!metodo || !METODOS_VALIDOS.has(metodo)) {
    return jsonError("Método de pagamento inválido", 400);
  }
  if (!Number.isInteger(body.valorCentavos) || body.valorCentavos! <= 0) {
    return jsonError("Valor inválido", 400);
  }

  // A1: a identidade da intenção é obrigatória e precisa ter sido criada
  // pelo cliente ANTES do primeiro envio. Sem ela, um retry voltaria a ser
  // indistinguível de um segundo recebimento legítimo.
  const chave = parseOperationKey(body.operationKey);
  if (!chave.ok) {
    return jsonError(MENSAGENS.OPERATION_KEY_INVALIDA, 400, chave.erro);
  }

  try {
    const resultado = await registerAdminPayment(env.DB, {
      pedidoId: id,
      metodo: metodo as MetodoManual,
      valorCentavos: body.valorCentavos!,
      usuarioId: auth.user.id,
      observacao: body.observacao,
      operationKey: chave.key,
    });

    if (!resultado.ok) {
      const status =
        resultado.erro === "PEDIDO_NAO_ENCONTRADO"
          ? 404
          : OPERACAO_HTTP_STATUS[resultado.erro ?? ""] ?? 409;
      return jsonError(
        MENSAGENS[resultado.erro ?? ""] ?? "Não foi possível registrar o pagamento",
        status,
        resultado.erro,
      );
    }

    // Replay devolve o MESMO resultado lógico e o MESMO status: para o
    // cliente, repetir a mesma intenção é indistinguível de tê-la executado
    // uma vez. `replay` existe só para observabilidade, nunca como um
    // resultado diferente.
    return Response.json(
      {
        ok: true,
        pagamentoId: resultado.pagamentoId,
        statusFinanceiro: resultado.statusFinanceiro,
        saldoCentavos: resultado.saldoCentavos,
        ...(resultado.replay ? { replay: true } : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Erro ao registrar pagamento manual (admin)", err);
    return jsonError("Erro interno ao registrar pagamento", 500);
  }
};
