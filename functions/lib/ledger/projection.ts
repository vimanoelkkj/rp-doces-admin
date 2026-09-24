/// <reference types="@cloudflare/workers-types" />

import type { LedgerMetodo, StatusFinanceiroAgregado } from "./types";
import { preparePedidoFinancialProjection } from "../pedidoFinanceiroSql";

// Passo 4c-2: pedidos.status_pagamento converge para uma projeção agregada
// (PENDENTE/PARCIAL/PAGO) derivada do ledger, em vez de espelhar o status
// bruto da tentativa mais recente. `pedido_pagamentos.status` continua
// sendo a fonte da verdade sobre cada tentativa individual (PAGO, CANCELADO,
// EXPIRADO, REEMBOLSADO, FALHOU) — nenhuma dessas informações é perdida,
// só deixa de morar na coluna agregada.

// Sempre um agregado (SUM ... WHERE status='PAGO'), nunca "pega uma linha".
// Não existe getLatestPayment() genérico neste código — cada pergunta de
// domínio usa seu próprio filtro (ver relatório do 4c-2).
export async function getPaidCentavos(db: D1Database, pedidoId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(valor_centavos), 0) AS total
       FROM pedido_pagamentos WHERE pedido_id = ? AND status = 'PAGO'`,
    )
    .bind(pedidoId)
    .first<{ total: number }>();
  return Number(row?.total || 0);
}

export function computeFinancialStatus(
  totalCentavos: number,
  pagoCentavos: number,
): StatusFinanceiroAgregado {
  if (pagoCentavos <= 0) return "PENDENTE";
  if (pagoCentavos < totalCentavos) return "PARCIAL";
  return "PAGO";
}

// Passo 5: dinheiro devolvido. Nunca muta pedido_pagamentos — o reembolso
// vive inteiramente em pedido_reembolsos, como um evento independente.
export async function getRefundedCentavos(db: D1Database, pedidoId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(valor_centavos), 0) AS total
       FROM pedido_reembolsos WHERE pedido_id = ? AND status = 'REEMBOLSADO'`,
    )
    .bind(pedidoId)
    .first<{ total: number }>();
  return Number(row?.total || 0);
}

// Líquido = bruto recebido - devolvido confirmado. É isso que responde
// "quanto do dinheiro do cliente ainda está retido", não o bruto sozinho —
// um pagamento de R$100 com R$100 de reembolso contribui zero, nunca um
// número negativo (por isso nunca flipamos o status do pagamento original:
// ver nota em registerManualRefund).
export async function getNetPaidCentavos(db: D1Database, pedidoId: number): Promise<number> {
  const bruto = await getPaidCentavos(db, pedidoId);
  const reembolsado = await getRefundedCentavos(db, pedidoId);
  return Math.max(0, bruto - reembolsado);
}

// Única função que escreve pedidos.status_pagamento a partir do 4c-2.
// A partir do Passo 5, usa o LÍQUIDO (bruto - reembolsado), não o bruto —
// senão um pedido totalmente reembolsado continuaria marcado PAGO.
export async function recalculatePedidoStatusPagamento(
  db: D1Database,
  pedidoId: number,
): Promise<StatusFinanceiroAgregado | null> {
  // Calculado no instante da escrita, nunca sobre um snapshot carregado em JS.
  // null significa pedido ausente ou legado sem ledger; não materializa aqui.
  const row = await preparePedidoFinancialProjection(db, pedidoId)
    .first<{ status_pagamento: StatusFinanceiroAgregado }>();
  return row?.status_pagamento ?? null;
}

// Responde exatamente "existe dinheiro do cliente retido?" — a pergunta do
// guarda-corpo de cancelamento (Passo 2), agora em cima do LÍQUIDO. Um
// pedido pago e depois totalmente reembolsado tem líquido zero e pode ser
// cancelado sem exigir um segundo estorno que já aconteceu.
export async function hasNetConfirmedPayment(db: D1Database, pedidoId: number): Promise<boolean> {
  return (await getNetPaidCentavos(db, pedidoId)) > 0;
}

// Projeção financeira para exibição (admin): "quanto está confirmado, e por
// quais métodos" — não o ledger inteiro, só o que a UI precisa pra montar um
// texto como "Pago · Cartão + Dinheiro" ou "Parcial · R$ 30 / R$ 100".
//
// metodosConfirmados NUNCA é um `DISTINCT metodo WHERE status='PAGO'` puro:
// isso ignoraria reembolso. Um pagamento 100% estornado tem `status='PAGO'`
// pra sempre (Passo 5 nunca flipa o status original), então precisaríamos
// ver esse método como "confirmado" mesmo com pagoCentavos=0 — uma projeção
// mentirosa. Em vez disso, cada linha de pedido_pagamentos só conta pro
// resultado se sua contribuição LÍQUIDA própria (valor_centavos menos o que
// foi reembolsado especificamente DAQUELE pagamento, via pedido_reembolsos.
// pagamento_id) ainda for positiva — mesma lógica de getNetPaidCentavos,
// só que por linha em vez de agregada pro pedido inteiro.
export type FinanceiroPedido = {
  status: StatusFinanceiroAgregado;
  brutoPagoCentavos: number;
  reembolsadoCentavos: number;
  liquidoCentavos: number;
  saldoCentavos: number;
  /** Alias retrocompativel do liquido, mantido para leitores existentes. */
  pagoCentavos: number;
  totalCentavos: number;
  excessoCentavos: number;
  temExcesso: boolean;
  metodosConfirmados: LedgerMetodo[];
};

// Ordem fixa de exibição — nunca a ordem incidental de retorno do SQLite,
// que dependeria de id/inserção e produziria "Cartão + Dinheiro" numa carga
// e "Dinheiro + Cartão" na próxima pro mesmo pedido.
const ORDEM_METODOS_EXIBICAO: LedgerMetodo[] = [
  "PIX_MP",
  "PIX_EXTERNO",
  "CARTAO",
  "DINHEIRO",
  "A_COMBINAR",
];

function ordenarMetodos(metodos: Iterable<string>): LedgerMetodo[] {
  const presentes = new Set(metodos);
  return ORDEM_METODOS_EXIBICAO.filter((m) => presentes.has(m));
}

const METODOS_CONFIRMADOS_QUERY = `
  SELECT pp.pedido_id AS pedido_id, pp.metodo AS metodo
  FROM pedido_pagamentos pp
  WHERE pp.status = 'PAGO'
    AND pp.valor_centavos > COALESCE(
      (SELECT SUM(r.valor_centavos) FROM pedido_reembolsos r
       WHERE r.pagamento_id = pp.id AND r.status = 'REEMBOLSADO'), 0)
`;

export async function getFinanceiroPedido(db: D1Database, pedidoId: number): Promise<FinanceiroPedido> {
  const [pedido, brutoPagoCentavos, reembolsadoCentavos, metodos] = await Promise.all([
    db
      .prepare(`SELECT valor_total_centavos, status_pagamento FROM pedidos WHERE id = ?`)
      .bind(pedidoId)
      .first<{ valor_total_centavos: number; status_pagamento: string }>(),
    getPaidCentavos(db, pedidoId),
    getRefundedCentavos(db, pedidoId),
    db
      .prepare(`${METODOS_CONFIRMADOS_QUERY} AND pp.pedido_id = ?`)
      .bind(pedidoId)
      .all<{ metodo: string }>(),
  ]);
  const totalCentavos = Number(pedido?.valor_total_centavos || 0);
  const liquidoCentavos = Math.max(0, brutoPagoCentavos - reembolsadoCentavos);
  const excessoCentavos = Math.max(0, liquidoCentavos - totalCentavos);
  const temExcesso = excessoCentavos > 0;

  return {
    status: (pedido?.status_pagamento as StatusFinanceiroAgregado) ?? "PENDENTE",
    brutoPagoCentavos,
    reembolsadoCentavos,
    liquidoCentavos,
    saldoCentavos: Math.max(0, totalCentavos - liquidoCentavos),
    pagoCentavos: liquidoCentavos,
    totalCentavos,
    excessoCentavos,
    temExcesso,
    metodosConfirmados: ordenarMetodos(metodos.results.map((r) => r.metodo)),
  };
}

// Mesma projeção, em lote, pra telas de listagem — três queries no total
// pra página inteira (bruto pago, reembolsado, métodos com contribuição
// líquida), nunca uma consulta por linha.
export async function getFinanceirosPorPedidos(
  db: D1Database,
  pedidos: { id: number; valorTotalCentavos: number; statusPagamento: string }[],
): Promise<Map<number, FinanceiroPedido>> {
  const resultado = new Map<number, FinanceiroPedido>();
  if (pedidos.length === 0) return resultado;

  const ids = pedidos.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");

  const [brutoRows, reembolsoRows, metodoRows] = await Promise.all([
    db
      .prepare(
        `SELECT pedido_id, COALESCE(SUM(valor_centavos), 0) AS total
         FROM pedido_pagamentos WHERE pedido_id IN (${placeholders}) AND status = 'PAGO'
         GROUP BY pedido_id`,
      )
      .bind(...ids)
      .all<{ pedido_id: number; total: number }>(),
    db
      .prepare(
        `SELECT pedido_id, COALESCE(SUM(valor_centavos), 0) AS total
         FROM pedido_reembolsos WHERE pedido_id IN (${placeholders}) AND status = 'REEMBOLSADO'
         GROUP BY pedido_id`,
      )
      .bind(...ids)
      .all<{ pedido_id: number; total: number }>(),
    db
      .prepare(`${METODOS_CONFIRMADOS_QUERY} AND pp.pedido_id IN (${placeholders})`)
      .bind(...ids)
      .all<{ pedido_id: number; metodo: string }>(),
  ]);

  const brutoPorPedido = new Map(brutoRows.results.map((r) => [r.pedido_id, Number(r.total)]));
  const reembolsoPorPedido = new Map(reembolsoRows.results.map((r) => [r.pedido_id, Number(r.total)]));
  const metodosPorPedido = new Map<number, Set<string>>();
  for (const row of metodoRows.results) {
    const set = metodosPorPedido.get(row.pedido_id) ?? new Set<string>();
    set.add(row.metodo);
    metodosPorPedido.set(row.pedido_id, set);
  }

  for (const p of pedidos) {
    const bruto = brutoPorPedido.get(p.id) ?? 0;
    const reembolsado = reembolsoPorPedido.get(p.id) ?? 0;
    const liquido = Math.max(0, bruto - reembolsado);
    const excessoCentavos = Math.max(0, liquido - p.valorTotalCentavos);
    const temExcesso = excessoCentavos > 0;
    resultado.set(p.id, {
      status: p.statusPagamento as StatusFinanceiroAgregado,
      brutoPagoCentavos: bruto,
      reembolsadoCentavos: reembolsado,
      liquidoCentavos: liquido,
      saldoCentavos: Math.max(0, p.valorTotalCentavos - liquido),
      pagoCentavos: liquido,
      totalCentavos: p.valorTotalCentavos,
      excessoCentavos,
      temExcesso,
      metodosConfirmados: ordenarMetodos(metodosPorPedido.get(p.id) ?? []),
    });
  }

  return resultado;
}

// Saldo em aberto = total - LÍQUIDO (não bruto) — desde o Passo 5. Um
// pedido pago e parcialmente reembolsado tem saldo aberto de novo (o
// reembolso reabre o direito de cobrar aquele valor), mesmo que
// registerAdminPayment ainda recuse aceitar um novo pagamento nesse caso
// (ver comentário lá) — o número do saldo em si precisa estar certo
// independente disso, senão a UI mostraria "faltam R$30" e "saldo=0" ao
// mesmo tempo.
export async function getComandaSaldo(
  db: D1Database,
  pedidoId: number,
): Promise<{ total: number; pago: number; saldo: number }> {
  const pedido = await db
    .prepare(`SELECT valor_total_centavos FROM pedidos WHERE id = ?`)
    .bind(pedidoId)
    .first<{ valor_total_centavos: number }>();
  const pago = await getNetPaidCentavos(db, pedidoId);
  const total = Number(pedido?.valor_total_centavos || 0);
  return { total, pago, saldo: Math.max(0, total - pago) };
}
