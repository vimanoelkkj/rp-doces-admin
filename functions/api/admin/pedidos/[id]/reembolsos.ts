/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../lib/auth";
import { registerManualRefund } from "../../../../lib/comandaLedger";

interface Env {
  DB: D1Database;
}

interface ReembolsoInput {
  pagamentoId?: number;
  valorCentavos?: number;
  motivo?: string;
}

const MENSAGENS: Record<string, string> = {
  PEDIDO_NAO_ENCONTRADO: "Pedido não encontrado",
  STATUS_PEDIDO_NAO_REEMBOLSAVEL:
    "Pedidos entregues ou cancelados não podem ser reembolsados",
  PAGAMENTO_NAO_ENCONTRADO: "Pagamento não encontrado ou não confirmado",
  METODO_NAO_REEMBOLSAVEL_MANUALMENTE:
    "Este pagamento exige reembolso pelo Mercado Pago, fora do escopo deste fluxo",
  VALOR_INVALIDO: "Valor inválido",
  SALDO_REEMBOLSAVEL_INSUFICIENTE:
    "O saldo reembolsável mudou antes da confirmação. Atualize e tente novamente.",
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: ReembolsoInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (!Number.isInteger(body.pagamentoId) || body.pagamentoId! <= 0) {
    return jsonError("Pagamento inválido", 400);
  }
  if (!Number.isInteger(body.valorCentavos) || body.valorCentavos! <= 0) {
    return jsonError("Valor inválido", 400);
  }

  try {
    const resultado = await registerManualRefund(env.DB, {
      pedidoId: id,
      pagamentoId: body.pagamentoId!,
      valorCentavos: body.valorCentavos!,
      usuarioId: auth.user.id,
      motivo: body.motivo,
    });

    if (!resultado.ok) {
      const status = resultado.erro === "PEDIDO_NAO_ENCONTRADO" ? 404 : 409;
      return jsonError(
        MENSAGENS[resultado.erro ?? ""] ?? "Não foi possível registrar o reembolso",
        status,
      );
    }

    return Response.json(
      {
        ok: true,
        reembolsoId: resultado.reembolsoId,
        statusFinanceiro: resultado.statusFinanceiro,
        saldoCentavos: resultado.saldoCentavos,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Erro ao registrar reembolso manual (admin)", err);
    return jsonError("Erro interno ao registrar reembolso", 500);
  }
};
