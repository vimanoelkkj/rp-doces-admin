/// <reference types="@cloudflare/workers-types" />

import { resolveLedgerPaymentId } from "./comandaLedger";
import { syncPaymentFromMp, expireLocalPayment } from "./paymentSync";
import { reconcilePedidoAfterFinancialChange } from "./pedidoReconcile";

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

async function statusDoPagamento(db: D1Database, pagamentoId: number | null): Promise<string | null> {
  if (!pagamentoId) return null;
  const row = await db
    .prepare(`SELECT status FROM pedido_pagamentos WHERE id = ?`)
    .bind(pagamentoId)
    .first<{ status: string }>();
  return row?.status ?? null;
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

  // Antes de qualquer retorno por agregado/prazo, recupera efeitos locais
  // incompletos. Não precisa consultar o MP para reconhecer ledger já PAGO.
  const reconciliacao = await reconcilePedidoAfterFinancialChange(db, pedido.id);
  const statusAgregado = reconciliacao.ok ? reconciliacao.statusFinanceiro : pedido.status_pagamento;

  if (statusAgregado !== "PENDENTE" || statusEspecificoAtual === "PAGO") {
    // Agregado já resolvido (PARCIAL/PAGO): pré-4d, com no máximo 1
    // pagamento por pedido, não há mais nada a verificar no MP.
    return {
      statusPagamento: statusEspecificoAtual ?? statusAgregado,
      statusPedido: pedido.status_pedido,
    };
  }

  if (!pagamentoId) {
    // Não deveria acontecer com o pedido ainda PENDENTE (Passo 4b garante
    // materialização), mas sem uma linha de ledger não há o que sincronizar.
    return {
      statusPagamento: statusEspecificoAtual ?? pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  if (pedido.pix_expira_em && Date.now() > Date.parse(pedido.pix_expira_em)) {
    await expireLocalPayment(db, pagamentoId);
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
    status_detail?: string | null;
    date_approved?: string | null;
  };

  const sincronizado = await syncPaymentFromMp(db, pagamentoId, {
    status: payment.status,
    statusDetail: payment.status_detail ?? null,
    dateApproved: payment.date_approved ?? null,
  });

  if (!sincronizado.transicionou || !sincronizado.status) {
    return {
      statusPagamento: sincronizado.status ?? statusEspecificoAtual ?? pedido.status_pagamento,
      statusPedido: pedido.status_pedido,
    };
  }

  const novoStatusPedido =
    sincronizado.status === "PAGO" && pedido.status_pedido === "NOVO"
      ? "PREPARANDO"
      : pedido.status_pedido;

  // status_pedido continua sendo escrito direto (não faz parte da
  // convergência financeira — é o eixo operacional, já reconciliado no
  // Passo 2). Essa promoção é um comportamento legado deste caminho
  // específico (polling público) — o helper financeiro compartilhado
  // (syncPaymentFromMp) nunca mexe em status_pedido, e os novos chamadores
  // (webhook, reconciliação do admin) não herdam essa promoção.
  if (novoStatusPedido !== pedido.status_pedido) {
    await db
      .prepare(`UPDATE pedidos SET status_pedido = ? WHERE id = ?`)
      .bind(novoStatusPedido, pedido.id)
      .run();
  }

  return { statusPagamento: sincronizado.status, statusPedido: novoStatusPedido };
}
