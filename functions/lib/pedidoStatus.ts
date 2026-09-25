/// <reference types="@cloudflare/workers-types" />

import { resolveLedgerPaymentId } from "./comandaLedger";
import {
  claimPendingPixPaymentReconciliation,
  syncPaymentFromMp,
  expireLocalPayment,
  fetchMpPayment,
  resolveWebhookPayment,
} from "./paymentSync";
import { reconcilePedidoAfterFinancialChange } from "./pedidoReconcile";
import { type PushEnv } from "./pushNotifier";

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

// M7: leitura PURA do status público, para os GETs do storefront. Nenhuma
// escrita, nenhuma rede, nenhuma materialização de legado. Mesmos critérios
// de `resolveLedgerPaymentId` para achar a tentativa SITE PIX_MP (o status
// público é o dessa tentativa, não o agregado) e o mesmo fail-closed quando
// a identidade é ambígua. Sem tentativa SITE — ou pedido legado ainda sem
// ledger — usa a projeção já persistida em `pedidos`. A recuperação (MP,
// expiração, reconciliação) acontece só em `refreshPedidoStatus`, via POST.
export async function readPedidoStatus(
  db: D1Database,
  pedido: PedidoStatusRow,
): Promise<StatusAtual> {
  const { results } = await db.prepare(
    `SELECT id, status FROM pedido_pagamentos
     WHERE pedido_id = ? AND origem = 'SITE' AND metodo = 'PIX_MP'
       AND (? IS NULL OR mp_payment_id = ? OR mp_payment_id IS NULL) LIMIT 2`,
  ).bind(pedido.id, pedido.mp_payment_id, pedido.mp_payment_id).all<{ id: number; status: string }>();
  if (results.length > 1) throw new Error("TENTATIVA_SITE_AMBIGUA");
  return {
    statusPagamento: results[0]?.status ?? pedido.status_pagamento,
    statusPedido: pedido.status_pedido,
  };
}

// Consulta a tentativa SITE, inclusive expirada, antes da expiração local.
// O agregado financeiro não bloqueia a consulta de uma tentativa. Nunca sobrescreve um
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
  env?: PushEnv,
): Promise<StatusAtual> {
  // Verificação explícita antes de decidir: se já existe ledger, usa a
  // linha existente; só materializa o legado se genuinamente não existir
  // nenhuma (pedido criado antes do 4c-1). Nunca "ensure() e torce".
  const pagamentoId = await resolveLedgerPaymentId(db, pedido.id, pedido.mp_payment_id);
  const statusEspecificoAtual = await statusDoPagamento(db, pagamentoId);

  // Antes de qualquer retorno por agregado/prazo, recupera efeitos locais
  // incompletos. Não precisa consultar o MP para reconhecer ledger já PAGO.
  const reconciliacao = await reconcilePedidoAfterFinancialChange(db, pedido.id);
  const statusAgregado = reconciliacao.ok ? reconciliacao.statusFinanceiro : pedido.status_pagamento;

  if (statusEspecificoAtual && statusEspecificoAtual !== "PENDENTE" && statusEspecificoAtual !== "EXPIRADO") {
    return {
      statusPagamento: statusEspecificoAtual ?? statusAgregado,
      statusPedido: pedido.status_pedido,
    };
  }

  if (!pagamentoId) {
    // Sem tentativa SITE inequívoca, não consulta nem expira um pagamento
    // administrativo escolhido arbitrariamente; responde a projeção atual.
    return {
      statusPagamento: statusEspecificoAtual ?? statusAgregado,
      statusPedido: pedido.status_pedido,
    };
  }

  const tentativa = await db.prepare(`SELECT mp_payment_id, pix_expira_em FROM pedido_pagamentos WHERE id = ?`)
    .bind(pagamentoId).first<{ mp_payment_id: string | null; pix_expira_em: string | null }>();
  const mpId = tentativa?.mp_payment_id ?? pedido.mp_payment_id;
  let payment;
  // M7: no máximo uma consulta ao MP por tentativa a cada 15s, qualquer que
  // seja o ritmo do polling. Sem o claim, segue só com o estado local (a
  // expiração abaixo continua valendo).
  if (mpId && mpAccessToken && await claimPendingPixPaymentReconciliation(db, pagamentoId)) {
    try {
      payment = await fetchMpPayment(mpAccessToken, mpId);
    } catch (err) {
      // Falha do GET não comprova rejeição. Só o prazo, abaixo, pode encerrar
      // operacionalmente o QR; a tentativa continua financeiramente recuperável.
      console.error("Falha ao consultar pagamento no Mercado Pago", pedido.id, err);
    }
  }

  let transicionou = false;
  if (payment) {
    const resolved = await resolveWebhookPayment(db, payment);
    if (resolved.kind !== "found" || resolved.pagamentoId !== pagamentoId) {
      throw new Error("IDENTIDADE_PAGAMENTO_SITE_DIVERGENTE");
    }
    // Fora do catch de rede: falha derivada B3 não é falha de consulta MP.
    transicionou = (await syncPaymentFromMp(db, pagamentoId, payment, env)).transicionou;
  }

  const expiraEm = tentativa?.pix_expira_em ?? pedido.pix_expira_em;
  if (expiraEm && Date.now() >= Date.parse(expiraEm)) {
    // Guard atômico preserva PAGO concorrente. Não devolve EXPIRADO literal.
    await expireLocalPayment(db, pagamentoId);
  }
  const statusPagamento = await statusDoPagamento(db, pagamentoId) ?? statusAgregado;
  const novoStatusPedido =
    transicionou && statusPagamento === "PAGO" && pedido.status_pedido === "NOVO"
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

  return { statusPagamento, statusPedido: novoStatusPedido };
}
