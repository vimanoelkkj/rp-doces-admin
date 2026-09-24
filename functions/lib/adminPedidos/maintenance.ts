/// <reference types="@cloudflare/workers-types" />

import {
  reconcilePendingPixPayments,
  liberarReservasVencidasLocalmente,
  recuperarOperacoesInconclusivas,
} from "../paymentSync";
import { reconcilePedidosDivergentes } from "../pedidoReconcile";
import type { Env } from "./types";

export async function reconcilePedidosEmBackground(env: Env): Promise<void> {
  const resultados = await Promise.allSettled([
    reconcilePendingPixPayments(env),
    reconcilePedidosDivergentes(env.DB),
    recuperarOperacoesInconclusivas(env),
    liberarReservasVencidasLocalmente(env),
  ]);

  const rotulos = [
    "reconciliação oportunista de pagamentos PIX_MP",
    "reconciliação de pedidos com ledger",
    "recuperação de operações inconclusivas",
    "liberação local de reservas vencidas",
  ];

  resultados.forEach((resultado, indice) => {
    if (resultado.status === "rejected") {
      console.error(`Falha na ${rotulos[indice]}`, resultado.reason);
    }
  });
}
