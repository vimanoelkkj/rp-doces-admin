import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { baixarEstoquePedido, liberarReservaPedido } from "../../../lib/stock.js";

const VALIDOS = new Set(["NOVO", "PREPARANDO", "PRONTO", "ENTREGUE", "CANCELADO"]);
const PAGAMENTOS_MANUAIS = new Set(["PENDENTE", "PAGO", "CANCELADO"]);
const METODOS_MANUAIS = new Set(["PIX_EXTERNO", "CARTAO", "DINHEIRO", "A_COMBINAR"]);

async function itensAgrupados(env, pedidoId) {
  const { results } = await env.DB.prepare(
    `SELECT produto_id, SUM(quantidade) AS quantidade
     FROM pedido_itens
     WHERE pedido_id = ? AND produto_id IS NOT NULL
     GROUP BY produto_id`
  ).bind(pedidoId).all();
  return results || [];
}

async function reativarProdutosComSaldo(env, pedidoId) {
  const itens = await itensAgrupados(env, pedidoId);
  if (!itens.length) return;
  await env.DB.batch(itens.map(item => env.DB.prepare(
    `UPDATE produtos
     SET disponivel = CASE WHEN ativo = 1 AND estoque - estoque_reservado > 0 THEN 1 ELSE disponivel END,
         atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(item.produto_id)));
}

async function restaurarBaixaManual(env, pedidoId) {
  const itens = await itensAgrupados(env, pedidoId);
  if (!itens.length) return { ok: false };
  const statements = [];
  for (const item of itens) {
    statements.push(env.DB.prepare(
      `UPDATE produtos
       SET estoque = estoque + ?, disponivel = CASE WHEN ativo = 1 THEN 1 ELSE disponivel END,
           atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(item.quantidade, item.produto_id));
  }
  statements.push(env.DB.prepare(`UPDATE pedido_itens SET estoque_baixado_em = NULL WHERE pedido_id = ?`).bind(pedidoId));
  statements.push(env.DB.prepare(
    `UPDATE pedidos SET estoque_baixado_em = NULL, reserva_status = 'LIBERADA',
       reserva_liberada_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(pedidoId));
  try { await env.DB.batch(statements); return { ok: true }; } catch { return { ok: false }; }
}

async function reservarPedidoManual(env, pedidoId) {
  const itens = await itensAgrupados(env, pedidoId);
  if (!itens.length) return { ok: false, erro: "ITENS_NAO_ENCONTRADOS" };
  for (const item of itens) {
    const produto = await env.DB.prepare(`SELECT id, ativo, estoque, estoque_reservado FROM produtos WHERE id = ? LIMIT 1`).bind(item.produto_id).first();
    const disponivel = Number(produto?.estoque || 0) - Number(produto?.estoque_reservado || 0);
    if (!produto || !produto.ativo || disponivel < Number(item.quantidade || 0)) return { ok: false, erro: "ESTOQUE_INSUFICIENTE" };
  }
  const statements = [];
  for (const item of itens) {
    statements.push(env.DB.prepare(
      `UPDATE produtos SET estoque_reservado = estoque_reservado + ?, disponivel = 1,
       atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(item.quantidade, item.produto_id));
  }
  statements.push(env.DB.prepare(`UPDATE pedido_itens SET estoque_baixado_em = NULL WHERE pedido_id = ?`).bind(pedidoId));
  statements.push(env.DB.prepare(
    `UPDATE pedidos SET status_pagamento = 'PENDENTE', pago_em = NULL, estoque_baixado_em = NULL,
       reserva_status = 'ATIVA', reserva_expira_em = NULL, reserva_liberada_em = NULL,
       status_pedido = CASE WHEN status_pedido = 'CANCELADO' THEN 'NOVO' ELSE status_pedido END,
       atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(pedidoId));
  try { await env.DB.batch(statements); return { ok: true }; } catch { return { ok: false, erro: "ERRO_RESERVA" }; }
}

async function confirmarPagamentoManual(env, pedido) {
  if (pedido.status_pagamento === "PAGO") return { ok: true, status_pagamento: "PAGO" };
  if (pedido.status_pagamento === "CANCELADO") {
    const reserva = await reservarPedidoManual(env, pedido.id);
    if (!reserva.ok) return reserva;
  }
  await env.DB.prepare(
    `UPDATE pedidos SET status_pagamento = 'PAGO', pago_em = CURRENT_TIMESTAMP,
     status_pedido = CASE WHEN status_pedido = 'CANCELADO' THEN 'NOVO' ELSE status_pedido END,
     atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(pedido.id).run();
  const stock = await baixarEstoquePedido(env, pedido.id);
  if (!stock.ok) {
    await env.DB.prepare(
      `UPDATE pedidos SET status_pagamento = 'PENDENTE', pago_em = NULL, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ? AND estoque_baixado_em IS NULL`
    ).bind(pedido.id).run();
    return { ok: false, erro: "ESTOQUE_INCONSISTENTE" };
  }
  return { ok: true, status_pagamento: "PAGO" };
}

async function cancelarPagamentoManual(env, pedido) {
  if (pedido.status_pagamento === "CANCELADO") return { ok: true, status_pagamento: "CANCELADO", status_pedido: "CANCELADO" };
  if (pedido.status_pagamento === "PAGO") {
    const restored = await restaurarBaixaManual(env, pedido.id);
    if (!restored.ok) return { ok: false, erro: "ERRO_RESTAURAR_ESTOQUE" };
  } else if (pedido.reserva_status === "ATIVA") {
    const released = await liberarReservaPedido(env, pedido.id, { novoStatus: "CANCELADO" });
    if (!released.ok) return { ok: false, erro: "ERRO_LIBERAR_RESERVA" };
  }
  await env.DB.prepare(
    `UPDATE pedidos SET status_pagamento = 'CANCELADO', status_pedido = 'CANCELADO', pago_em = NULL,
     reserva_status = 'LIBERADA', reserva_liberada_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(pedido.id).run();
  await reativarProdutosComSaldo(env, pedido.id);
  return { ok: true, status_pagamento: "CANCELADO", status_pedido: "CANCELADO" };
}

async function tornarPendenteManual(env, pedido) {
  if (pedido.status_pagamento === "PENDENTE" && pedido.reserva_status === "ATIVA") return { ok: true, status_pagamento: "PENDENTE" };
  if (pedido.status_pagamento === "PAGO") {
    const restored = await restaurarBaixaManual(env, pedido.id);
    if (!restored.ok) return { ok: false, erro: "ERRO_RESTAURAR_ESTOQUE" };
  }
  const reserva = await reservarPedidoManual(env, pedido.id);
  if (!reserva.ok) return reserva;
  return { ok: true, status_pagamento: "PENDENTE", status_pedido: "NOVO" };
}

function pagamentoAdministravel(pedido) {
  return pedido.origem_pedido === "MANUAL" || METODOS_MANUAIS.has(String(pedido.metodo_pagamento || "").toUpperCase());
}

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const id = Number(params.id);
  const body = await bodyJson(request);
  if (!Number.isInteger(id) || id < 1) return json({ erro: "Dados inválidos." }, 400);

  const pedido = await env.DB.prepare(
    `SELECT id, origem_pedido, metodo_pagamento, status_pedido, status_pagamento, reserva_status, estoque_baixado_em
     FROM pedidos WHERE id = ? LIMIT 1`
  ).bind(id).first();
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);

  if (body?.status_pagamento != null) {
    const nextPayment = String(body.status_pagamento || "").toUpperCase();
    if (!pagamentoAdministravel(pedido) || !PAGAMENTOS_MANUAIS.has(nextPayment)) return json({ erro: "Alteração de pagamento inválida." }, 400);
    let result;
    if (nextPayment === "PAGO") result = await confirmarPagamentoManual(env, pedido);
    else if (nextPayment === "CANCELADO") result = await cancelarPagamentoManual(env, pedido);
    else result = await tornarPendenteManual(env, pedido);
    if (!result.ok) {
      const mensagem = result.erro === "ESTOQUE_INSUFICIENTE" ? "Não há estoque disponível para reabrir este pedido." : "Não foi possível atualizar o pagamento por inconsistência no estoque.";
      return json({ erro: mensagem }, 409);
    }
    return json({ ok: true, id, ...result });
  }

  const status = String(body?.status_pedido || "").toUpperCase();
  if (!VALIDOS.has(status)) return json({ erro: "Dados inválidos." }, 400);
  if (status === "CANCELADO" && pagamentoAdministravel(pedido) && pedido.status_pagamento !== "CANCELADO") {
    const result = await cancelarPagamentoManual(env, pedido);
    if (!result.ok) return json({ erro: "Não foi possível cancelar o pedido." }, 409);
    return json({ ok: true, id, status_pedido: "CANCELADO", status_pagamento: "CANCELADO" });
  }
  await env.DB.prepare("UPDATE pedidos SET status_pedido = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?").bind(status, id).run();
  return json({ ok: true, id, status_pedido: status });
}
