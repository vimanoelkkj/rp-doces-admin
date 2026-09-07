import { json, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import { logEvent } from "../../../../lib/logger.js";

const DIAGNOSTIC_PREFIX = "diagnostic-order:";

function isOwner(user) {
  return String(user?.papel || "").trim().toUpperCase() === "OWNER";
}

function isDiagnosticOrder(pedido) {
  return String(pedido?.idempotency_key || "").startsWith(DIAGNOSTIC_PREFIX);
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);

  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  if (!isOwner(auth.user)) return json({ erro: "Apenas OWNER pode descartar pedidos de teste." }, 403);

  const pedidoId = Number(params.id);
  if (!Number.isInteger(pedidoId) || pedidoId < 1) {
    return json({ erro: "Pedido inválido." }, 400);
  }

  const pedido = await env.DB.prepare(
    `SELECT id, idempotency_key, status_pedido, status_pagamento, status_comanda,
            reserva_status, estoque_baixado_em, arquivado,
            mp_order_id, mp_payment_id
     FROM pedidos
     WHERE id = ?
     LIMIT 1`
  )
    .bind(pedidoId)
    .first();

  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (!isDiagnosticOrder(pedido)) {
    return json({ erro: "Este pedido não é um pedido de teste e não pode ser descartado por este fluxo." }, 409);
  }

  if (Number(pedido.arquivado || 0) === 1 && String(pedido.status_pedido || "").toUpperCase() === "CANCELADO") {
    return json({ ok: true, pedido_id: pedidoId, ja_descartado: true });
  }

  const pagamentoExterno = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM pedido_pagamentos
     WHERE pedido_id = ?
       AND (
         metodo = 'PIX_MP'
         OR mp_order_id IS NOT NULL
         OR mp_payment_id IS NOT NULL
       )`
  )
    .bind(pedidoId)
    .first();

  if (pedido.mp_order_id || pedido.mp_payment_id || Number(pagamentoExterno?.total || 0) > 0) {
    return json({
      erro: "Este pedido de teste possui vínculo com pagamento externo real. Resolva esse pagamento antes de descartar o teste.",
      codigo: "PAGAMENTO_EXTERNO_PRESENTE"
    }, 409);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, produto_id, quantidade, estoque_baixado_em
     FROM pedido_itens
     WHERE pedido_id = ?
     ORDER BY id`
  )
    .bind(pedidoId)
    .all();

  const itens = results || [];
  const porProduto = new Map();
  let estoqueReposto = 0;

  for (const item of itens) {
    const produtoId = Number(item.produto_id);
    const quantidade = Number(item.quantidade || 0);
    if (!Number.isInteger(produtoId) || produtoId < 1 || !Number.isInteger(quantidade) || quantidade < 1) continue;

    const atual = porProduto.get(produtoId) || { baixado: 0 };
    if (item.estoque_baixado_em) {
      atual.baixado += quantidade;
      estoqueReposto += quantidade;
    }
    porProduto.set(produtoId, atual);
  }

  const statements = [];

  for (const [produtoId, state] of porProduto.entries()) {
    if (state.baixado > 0) {
      statements.push(
        env.DB.prepare(
          `UPDATE produtos
           SET estoque = estoque + ?,
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(state.baixado, produtoId)
      );
    }
  }

  // Pagamentos registrados dentro do pedido de diagnóstico são simulações do
  // próprio teste. Apagá-los evita gerar reembolso fictício e as alocações e
  // reembolsos dependentes acompanham o ON DELETE CASCADE.
  statements.push(
    env.DB.prepare("DELETE FROM pedido_pagamentos WHERE pedido_id = ?").bind(pedidoId),
    env.DB.prepare(
      `UPDATE pedido_itens
       SET estoque_baixado_em = NULL
       WHERE pedido_id = ?`
    ).bind(pedidoId),
    env.DB.prepare(
      `UPDATE pedidos
       SET status_pedido = 'CANCELADO',
           status_pagamento = 'CANCELADO',
           status_comanda = 'ENCERRADA',
           reserva_status = 'LIBERADA',
           reserva_expira_em = NULL,
           reserva_liberada_em = COALESCE(reserva_liberada_em, CURRENT_TIMESTAMP),
           estoque_baixado_em = NULL,
           pago_em = NULL,
           mp_order_id = NULL,
           mp_payment_id = NULL,
           mp_status = NULL,
           mp_status_detail = NULL,
           mp_ticket_url = NULL,
           mp_qr_code = NULL,
           mp_qr_code_base64 = NULL,
           arquivado = 1,
           arquivado_em = COALESCE(arquivado_em, CURRENT_TIMESTAMP),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(pedidoId)
  );

  // Recalcula o agregado de reservas a partir dos outros pedidos ativos. Assim
  // o descarte também corrige um contador de reserva que tenha ficado torto no
  // meio de algum cenário de teste.
  for (const produtoId of porProduto.keys()) {
    statements.push(
      env.DB.prepare(
        `UPDATE produtos
         SET estoque_reservado = COALESCE((
               SELECT SUM(pi.quantidade)
               FROM pedido_itens pi
               JOIN pedidos p ON p.id = pi.pedido_id
               WHERE pi.produto_id = produtos.id
                 AND pi.estoque_baixado_em IS NULL
                 AND p.reserva_status = 'ATIVA'
                 AND UPPER(COALESCE(p.status_pedido, 'NOVO')) <> 'CANCELADO'
             ), 0),
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(produtoId)
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    logEvent("error", "diagnostic_order.discard_failed", {
      pedido_id: pedidoId,
      reason: "DIAGNOSTIC_DISCARD_FAILED"
    });
    return json({ erro: "Não foi possível desfazer o pedido de teste com segurança." }, 409);
  }

  logEvent("info", "diagnostic_order.discarded", {
    pedido_id: pedidoId,
    quantity: estoqueReposto,
    action: "DISCARD_TEST_ORDER"
  });

  return json({
    ok: true,
    pedido_id: pedidoId,
    estoque_reposto_unidades: estoqueReposto,
    pagamentos_simulados_removidos: true,
    arquivado: true
  });
}
