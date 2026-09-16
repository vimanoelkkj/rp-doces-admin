/// <reference types="@cloudflare/workers-types" />

import { resolveLedgerPaymentId } from "./comandaLedger";

export interface PedidoStatusRow {
  id: number;
  token_publico: string;
  status_pagamento: string;
  status_pedido: string;
  mp_payment_id: string | null;
  pix_expira_em: string | null;
}

export interface StatusAtual {
  statusPagamento: string;
  statusPedido: string;
}

function mapMpStatus(mpStatus: string): "PAGO" | "CANCELADO" | "EXPIRADO" | null {
  if (mpStatus === "approved") return "PAGO";
  if (mpStatus === "rejected" || mpStatus === "cancelled") return "CANCELADO";
  if (mpStatus === "expired") return "EXPIRADO";
  return null;
}

// Se o pedido ainda está PENDENTE, checa expiração local e consulta o
// Mercado Pago quando necessário, atualizando o D1. Nunca sobrescreve
// um status_pedido mais avançado que NOVO.
export async function refreshPedidoStatus(
  db: D1Database,
  mpAccessToken: string,
  pedido: PedidoStatusRow,
): Promise<StatusAtual> {
  if (pedido.status_pagamento !== "PENDENTE") {
    return {
      statusPagamento: pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  // Verificação explícita antes de decidir: se já existe ledger, sincroniza
  // a linha existente; só materializa o legado se genuinamente não existir
  // nenhuma (pedido criado antes do 4c-1). Nunca "ensure() e torce".
  const pagamentoId = await resolveLedgerPaymentId(db, pedido.id);

  if (pedido.pix_expira_em && Date.now() > Date.parse(pedido.pix_expira_em)) {
    await db
      .prepare(
        `UPDATE pedidos SET status_pagamento = 'EXPIRADO', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .bind(pedido.id)
      .run();
    if (pagamentoId) {
      await db
        .prepare(
          `UPDATE pedido_pagamentos SET status = 'EXPIRADO', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(pagamentoId)
        .run();
    }
    return { statusPagamento: "EXPIRADO", statusPedido: pedido.status_pedido };
  }

  if (!pedido.mp_payment_id) {
    return {
      statusPagamento: pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  const mpResponse = await fetch(
    `https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}`,
    { headers: { Authorization: `Bearer ${mpAccessToken}` } },
  );

  if (!mpResponse.ok) {
    console.error("Falha ao consultar pagamento no Mercado Pago", mpResponse.status);
    return {
      statusPagamento: pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  const payment = (await mpResponse.json()) as {
    status: string;
    date_approved?: string | null;
  };
  const novoStatus = mapMpStatus(payment.status);

  if (!novoStatus) {
    return {
      statusPagamento: pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  const novoStatusPedido =
    novoStatus === "PAGO" && pedido.status_pedido === "NOVO"
      ? "PREPARANDO"
      : pedido.status_pedido;

  // pago_em prefere a data real de aprovação do MP (date_approved) a
  // CURRENT_TIMESTAMP (hora em que nós perguntamos); e nunca sobrescreve um
  // pago_em já preenchido — embora isso já seja estruturalmente impossível
  // aqui (a função retorna antes se status_pagamento já não for PENDENTE),
  // o COALESCE é mantido por disciplina, não por necessidade estrita.
  await db
    .prepare(
      `UPDATE pedidos
       SET status_pagamento = ?, status_pedido = ?, mp_status = ?,
           pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, ?, CURRENT_TIMESTAMP) ELSE pago_em END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      novoStatus,
      novoStatusPedido,
      payment.status,
      novoStatus,
      payment.date_approved ?? null,
      pedido.id,
    )
    .run();

  if (pagamentoId) {
    await db
      .prepare(
        `UPDATE pedido_pagamentos
         SET status = ?, mp_status = ?,
             pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, ?, CURRENT_TIMESTAMP) ELSE pago_em END,
             cancelado_em = CASE WHEN ? = 'CANCELADO' THEN COALESCE(cancelado_em, CURRENT_TIMESTAMP) ELSE cancelado_em END,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        novoStatus,
        payment.status,
        novoStatus,
        payment.date_approved ?? null,
        novoStatus,
        pagamentoId,
      )
      .run();
  }

  return { statusPagamento: novoStatus, statusPedido: novoStatusPedido };
}
