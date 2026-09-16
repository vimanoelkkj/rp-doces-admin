/// <reference types="@cloudflare/workers-types" />

import { requireUser } from "../../../../lib/auth";
import { createAdminPixCharge } from "../../../../lib/comandaPix";

interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN: string;
}

interface GerarPixInput {
  valorCentavos?: number;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const MENSAGENS: Record<string, string> = {
  PEDIDO_NAO_ENCONTRADO: "Pedido não encontrado",
  COMANDA_ENCERRADA: "Esta comanda já foi encerrada",
  PEDIDO_COM_REEMBOLSO_NAO_SUPORTADO:
    "Este pedido possui reembolso e ainda não suporta nova cobrança Pix após devolução parcial.",
  VALOR_INVALIDO: "Valor inválido",
  CAPACIDADE_INSUFICIENTE: "Valor acima da capacidade disponível para novas cobranças Pix",
  ESTOQUE_INSUFICIENTE: "Um ou mais itens não possuem estoque suficiente disponível.",
  MERCADO_PAGO_RECUSOU: "O Mercado Pago recusou o pagamento Pix",
  MERCADO_PAGO_INDISPONIVEL:
    "Não foi possível confirmar com o Mercado Pago se o Pix foi criado. Verifique novamente em instantes.",
};

const STATUS_HTTP: Record<string, number> = {
  PEDIDO_NAO_ENCONTRADO: 404,
  COMANDA_ENCERRADA: 409,
  PEDIDO_COM_REEMBOLSO_NAO_SUPORTADO: 409,
  VALOR_INVALIDO: 400,
  CAPACIDADE_INSUFICIENTE: 409,
  ESTOQUE_INSUFICIENTE: 409,
  MERCADO_PAGO_RECUSOU: 502,
  MERCADO_PAGO_INDISPONIVEL: 502,
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError("Id inválido", 400);
  }

  let body: GerarPixInput;
  try {
    body = await request.json();
  } catch {
    return jsonError("JSON inválido", 400);
  }

  if (
    body.valorCentavos !== undefined &&
    (!Number.isSafeInteger(body.valorCentavos) || body.valorCentavos <= 0)
  ) {
    return jsonError("Valor inválido", 400);
  }

  try {
    const resultado = await createAdminPixCharge(env, {
      pedidoId: id,
      valorCentavos: body.valorCentavos,
      usuarioId: auth.user.id,
    });

    if (!resultado.ok) {
      return jsonError(
        MENSAGENS[resultado.erro] ?? "Não foi possível gerar o Pix",
        STATUS_HTTP[resultado.erro] ?? 500,
      );
    }

    return Response.json(
      {
        ok: true,
        pagamentoId: resultado.pagamentoId,
        valorCentavos: resultado.valorCentavos,
        mpPaymentId: resultado.mpPaymentId,
        status: resultado.mpStatus,
        qrCode: resultado.qrCode,
        qrCodeBase64: resultado.qrCodeBase64,
        ticketUrl: resultado.ticketUrl,
        expiresAt: resultado.expiresAt,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("Erro ao gerar Pix administrativo", err);
    return jsonError("Erro interno ao gerar Pix", 500);
  }
};
