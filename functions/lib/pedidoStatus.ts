/// <reference types="@cloudflare/workers-types" />

import { resolveLedgerPaymentId, recalculatePedidoStatusPagamento } from "./comandaLedger";

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

async function statusDoPagamento(db: D1Database, pagamentoId: number | null): Promise<string | null> {
  if (!pagamentoId) return null;
  const row = await db
    .prepare(`SELECT status FROM pedido_pagamentos WHERE id = ?`)
    .bind(pagamentoId)
    .first<{ status: string }>();
  return row?.status ?? null;
}

// Grava o resultado da tentativa específica no ledger e, a partir dele,
// recalcula a projeção agregada de pedidos.status_pagamento (Passo 4c-2).
// A partir daqui, `pedidos.status_pagamento` nunca mais recebe o status bruto
// da tentativa (EXPIRADO/CANCELADO/...) diretamente — só PENDENTE/PARCIAL/PAGO.
async function sincronizarPagamentoEAgregado(
  db: D1Database,
  pedidoId: number,
  pagamentoId: number | null,
  novoStatusEspecifico: "PAGO" | "CANCELADO" | "EXPIRADO",
  mpStatusBruto: string | null,
  dateApproved: string | null,
): Promise<void> {
  // Espelhos legados em pedidos: mp_status/pago_em continuam refletindo a
  // tentativa mais recente (não fazem parte do vocabulário agregado que
  // mudou de significado — só a coluna status_pagamento em si).
  await db
    .prepare(
      `UPDATE pedidos
       SET mp_status = ?,
           pago_em = CASE WHEN ? = 'PAGO' THEN COALESCE(pago_em, ?, CURRENT_TIMESTAMP) ELSE pago_em END,
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(mpStatusBruto, novoStatusEspecifico, dateApproved, pedidoId)
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
        novoStatusEspecifico,
        mpStatusBruto,
        novoStatusEspecifico,
        dateApproved,
        novoStatusEspecifico,
        pagamentoId,
      )
      .run();
  }

  await recalculatePedidoStatusPagamento(db, pedidoId);
}

// Se o pedido ainda está PENDENTE (agregado), checa expiração local e
// consulta o Mercado Pago quando necessário. Nunca sobrescreve um
// status_pedido mais avançado que NOVO.
//
// pedidos.status_pagamento passou a ser só a projeção agregada
// (PENDENTE/PARCIAL/PAGO — ver recalculatePedidoStatusPagamento). O status
// devolvido aqui e exposto publicamente continua sendo o da tentativa de
// pagamento específica (pedido_pagamentos.status), que é a pergunta que o
// storefront sempre fez — o contrato público não muda.
export async function refreshPedidoStatus(
  db: D1Database,
  mpAccessToken: string,
  pedido: PedidoStatusRow,
): Promise<StatusAtual> {
  // Verificação explícita antes de decidir: se já existe ledger, usa a
  // linha existente; só materializa o legado se genuinamente não existir
  // nenhuma (pedido criado antes do 4c-1). Nunca "ensure() e torce".
  const pagamentoId = await resolveLedgerPaymentId(db, pedido.id);
  const statusEspecificoAtual = await statusDoPagamento(db, pagamentoId);

  if (pedido.status_pagamento !== "PENDENTE") {
    // Agregado já resolvido (PARCIAL/PAGO): pré-4d, com no máximo 1
    // pagamento por pedido, não há mais nada a verificar no MP.
    return {
      statusPagamento: statusEspecificoAtual ?? pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  if (pedido.pix_expira_em && Date.now() > Date.parse(pedido.pix_expira_em)) {
    await sincronizarPagamentoEAgregado(db, pedido.id, pagamentoId, "EXPIRADO", null, null);
    return { statusPagamento: "EXPIRADO", statusPedido: pedido.status_pedido };
  }

  if (!pedido.mp_payment_id) {
    return {
      statusPagamento: statusEspecificoAtual ?? pedido.status_pagamento,
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
      statusPagamento: statusEspecificoAtual ?? pedido.status_pagamento,
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
      statusPagamento: statusEspecificoAtual ?? pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  const novoStatusPedido =
    novoStatus === "PAGO" && pedido.status_pedido === "NOVO"
      ? "PREPARANDO"
      : pedido.status_pedido;

  // status_pedido continua sendo escrito direto (não faz parte da
  // convergência financeira — é o eixo operacional, já reconciliado no
  // Passo 2).
  await db
    .prepare(`UPDATE pedidos SET status_pedido = ? WHERE id = ?`)
    .bind(novoStatusPedido, pedido.id)
    .run();

  await sincronizarPagamentoEAgregado(
    db,
    pedido.id,
    pagamentoId,
    novoStatus,
    payment.status,
    payment.date_approved ?? null,
  );

  return { statusPagamento: novoStatus, statusPedido: novoStatusPedido };
}
