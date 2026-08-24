import { mpRequest, mpOrderToLocalStatus } from "./mercadoPago.js";
import { syncOrderPayment } from "./paymentSync.js";

async function itemSemEstoque(env, pedidoId, isReservaAtiva = false) {
  if (isReservaAtiva) {
    return env.DB.prepare(`
      SELECT MIN(i.id) AS id, i.produto_id, MIN(i.produto_nome) AS produto_nome,
             SUM(i.quantidade) AS quantidade, COALESCE(p.estoque, 0) AS estoque
      FROM pedido_itens i
      LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.pedido_id = ? AND i.estoque_baixado_em IS NULL
      GROUP BY i.produto_id, p.estoque, p.estoque_reservado
      HAVING i.produto_id IS NULL OR p.id IS NULL OR p.estoque < SUM(i.quantidade) OR p.estoque_reservado < SUM(i.quantidade)
      ORDER BY MIN(i.id) LIMIT 1
    `).bind(pedidoId).first();
  }
  return env.DB.prepare(`
    SELECT MIN(i.id) AS id, i.produto_id, MIN(i.produto_nome) AS produto_nome,
           SUM(i.quantidade) AS quantidade, COALESCE(p.estoque, 0) AS estoque
    FROM pedido_itens i
    LEFT JOIN produtos p ON p.id = i.produto_id
    WHERE i.pedido_id = ? AND i.estoque_baixado_em IS NULL
    GROUP BY i.produto_id, p.estoque
    HAVING i.produto_id IS NULL OR p.id IS NULL OR p.estoque < SUM(i.quantidade)
    ORDER BY MIN(i.id) LIMIT 1
  `).bind(pedidoId).first();
}

async function itemSemReserva(env, pedidoId) {
  return env.DB.prepare(`
    SELECT MIN(i.id) AS id, i.produto_id, MIN(i.produto_nome) AS produto_nome,
           SUM(i.quantidade) AS quantidade, COALESCE(p.estoque_reservado, 0) AS estoque_reservado
    FROM pedido_itens i
    LEFT JOIN produtos p ON p.id = i.produto_id
    WHERE i.pedido_id = ?
    GROUP BY i.produto_id, p.estoque_reservado
    HAVING i.produto_id IS NULL OR p.id IS NULL OR p.estoque_reservado < SUM(i.quantidade)
    ORDER BY MIN(i.id) LIMIT 1
  `).bind(pedidoId).first();
}

/**
 * Converte a reserva em baixa definitiva de estoque quando o pedido atinge status PAGO.
 * Executa em batch transacional atômico no D1.
 */
export async function baixarEstoquePedido(env, pedidoId) {
  const pedido = await env.DB.prepare(`
    SELECT id, status_pagamento, estoque_baixado_em, reserva_status
    FROM pedidos WHERE id = ? LIMIT 1
  `).bind(pedidoId).first();

  if (!pedido || pedido.status_pagamento !== "PAGO" || pedido.estoque_baixado_em) {
    return { ok: true, baixado: false };
  }

  const { results } = await env.DB.prepare(`
    SELECT id, produto_id, produto_nome, quantidade
    FROM pedido_itens
    WHERE pedido_id = ? AND estoque_baixado_em IS NULL
    ORDER BY id
  `).bind(pedidoId).all();

  const itens = results || [];
  if (!itens.length) return { ok: false, baixado: false, erro: "ITENS_NAO_ENCONTRADOS" };

  const isReservaAtiva = pedido.reserva_status === "ATIVA";
  const insuficienteInicial = await itemSemEstoque(env, pedidoId, isReservaAtiva);
  if (insuficienteInicial) {
    const erro = insuficienteInicial.produto_id ? "ESTOQUE_INSUFICIENTE" : "PRODUTO_NAO_ENCONTRADO";
    return { ok: false, baixado: false, erro, item_id: insuficienteInicial.id };
  }

  const statements = [];

  for (const item of itens) {
    if (isReservaAtiva) {
      // Converte reserva em baixa física: reduz estoque físico e estoque reservado simultaneamente
      statements.push(
        env.DB.prepare(`
          UPDATE produtos
          SET estoque = estoque - ?,
              estoque_reservado = estoque_reservado - ?,
              disponivel = CASE WHEN estoque - ? <= 0 THEN 0 ELSE disponivel END,
              atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?
            AND estoque >= ?
            AND estoque_reservado >= ?
            AND EXISTS (
              SELECT 1 FROM pedidos
              WHERE id = ?
                AND status_pagamento = 'PAGO'
                AND estoque_baixado_em IS NULL
                AND reserva_status = 'ATIVA'
            )
        `).bind(item.quantidade, item.quantidade, item.quantidade, item.produto_id, item.quantidade, item.quantidade, pedidoId)
      );

      statements.push(
        env.DB.prepare(`
          UPDATE pedido_itens SET estoque_baixado_em = CURRENT_TIMESTAMP
          WHERE id = ? AND estoque_baixado_em IS NULL
            AND EXISTS (
              SELECT 1 FROM pedidos
              WHERE id = ?
                AND status_pagamento = 'PAGO'
                AND estoque_baixado_em IS NULL
                AND reserva_status = 'ATIVA'
            )
        `).bind(item.id, pedidoId)
      );
    } else {
      // Pedidos legados (SEM_RESERVA): reduz apenas o estoque físico
      statements.push(
        env.DB.prepare(`
          UPDATE produtos
          SET estoque = estoque - ?,
              disponivel = CASE WHEN estoque - ? <= 0 THEN 0 ELSE disponivel END,
              atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?
            AND estoque >= ?
            AND EXISTS (
              SELECT 1 FROM pedidos
              WHERE id = ?
                AND status_pagamento = 'PAGO'
                AND estoque_baixado_em IS NULL
            )
        `).bind(item.quantidade, item.quantidade, item.produto_id, item.quantidade, pedidoId)
      );

      statements.push(
        env.DB.prepare(`
          UPDATE pedido_itens SET estoque_baixado_em = CURRENT_TIMESTAMP
          WHERE id = ? AND estoque_baixado_em IS NULL
            AND EXISTS (
              SELECT 1 FROM pedidos
              WHERE id = ?
                AND status_pagamento = 'PAGO'
                AND estoque_baixado_em IS NULL
            )
        `).bind(item.id, pedidoId)
      );
    }
  }

  // Atualiza o pedido marcando estoque baixado e reserva convertida
  if (isReservaAtiva) {
    statements.push(env.DB.prepare(`
      UPDATE pedidos
      SET estoque_baixado_em = CURRENT_TIMESTAMP,
          reserva_status = 'CONVERTIDA',
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND status_pagamento = 'PAGO' AND estoque_baixado_em IS NULL AND reserva_status = 'ATIVA'
    `).bind(pedidoId));
  } else {
    statements.push(env.DB.prepare(`
      UPDATE pedidos
      SET estoque_baixado_em = CURRENT_TIMESTAMP,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND status_pagamento = 'PAGO' AND estoque_baixado_em IS NULL
    `).bind(pedidoId));
  }

  try {
    const results = await env.DB.batch(statements);
    const pedidoResult = results[results.length - 1];
    const baixado = Number(pedidoResult?.meta?.changes || 0) === 1;
    return { ok: true, baixado };
  } catch (err) {
    console.error(`Falha na baixa física de estoque do pedido #${pedidoId}:`, err?.message);
    return { ok: false, baixado: false, erro: "ERRO_TRANSACIONAL_BAIXA" };
  }
}

/**
 * Libera atomicamente o estoque reservado de um pedido cancelado, expirado ou falho.
 * Se qualquer item apresentar inconsistência, o batch falha e nenhuma liberação parcial ocorre.
 */
export async function liberarReservaPedido(env, pedidoId, { novoStatus = null } = {}) {
  const pedido = await env.DB.prepare(`
    SELECT id, status_pagamento, reserva_status
    FROM pedidos WHERE id = ? LIMIT 1
  `).bind(pedidoId).first();

  if (!pedido || pedido.reserva_status !== "ATIVA") {
    return { ok: true, liberado: false };
  }

  const { results } = await env.DB.prepare(`
    SELECT id, produto_id, quantidade
    FROM pedido_itens
    WHERE pedido_id = ?
    ORDER BY id
  `).bind(pedidoId).all();

  const itens = results || [];
  if (!itens.length) return { ok: false, liberado: false, erro: "ITENS_NAO_ENCONTRADOS" };

  const insuficienteReserva = await itemSemReserva(env, pedidoId);
  if (insuficienteReserva) {
    return { ok: false, liberado: false, erro: "ESTOQUE_RESERVADO_INSUFICIENTE", item_id: insuficienteReserva.id };
  }

  const statements = [];

  for (const item of itens) {
    // Reduz estoque_reservado SOMENTE SE o pedido ainda estiver no estado ATIVA e houver reserva suficiente
    statements.push(
      env.DB.prepare(`
        UPDATE produtos
        SET estoque_reservado = estoque_reservado - ?,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
          AND estoque_reservado >= ?
          AND EXISTS (
            SELECT 1 FROM pedidos
            WHERE id = ? AND reserva_status = 'ATIVA'
          )
      `).bind(item.quantidade, item.produto_id, item.quantidade, pedidoId)
    );
  }

  // Atualiza o pedido marcando reserva liberada
  statements.push(
    env.DB.prepare(`
      UPDATE pedidos
      SET reserva_status = 'LIBERADA',
          reserva_liberada_em = CURRENT_TIMESTAMP,
          status_pagamento = COALESCE(?, status_pagamento),
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND reserva_status = 'ATIVA'
    `).bind(novoStatus, pedidoId)
  );

  try {
    const results = await env.DB.batch(statements);
    const pedidoResult = results[results.length - 1];
    const liberado = Number(pedidoResult?.meta?.changes || 0) === 1;
    return { ok: true, liberado };
  } catch (err) {
    console.error(`Erro ao liberar reserva do pedido #${pedidoId}:`, err?.message);
    return { ok: false, liberado: false, erro: "ERRO_BATCH_LIBERACAO" };
  }
}

/**
 * Reconcilia um pedido pendente com reserva vencida perante o Mercado Pago antes de qualquer liberação.
 */
export async function reconciliarReservaExpirada(env, pedidoId) {
  const pedido = await env.DB.prepare(`
    SELECT id, token_publico, status_pagamento, reserva_status, reserva_expira_em,
           mp_order_id, idempotency_key, valor_total_centavos, cliente_nome,
           cliente_email, cliente_whatsapp
    FROM pedidos WHERE id = ? LIMIT 1
  `).bind(pedidoId).first();

  if (!pedido || pedido.reserva_status !== "ATIVA" || pedido.status_pagamento !== "PENDENTE") {
    return { reconciliado: false };
  }

  let mpOrderId = pedido.mp_order_id;

  // 1. Se mp_order_id for NULL (resultado incerto na criação anterior), repete o POST idempotente com o snapshot original
  if (!mpOrderId) {
    try {
      const { results: itensSalvos } = await env.DB.prepare(`
        SELECT produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos
        FROM pedido_itens WHERE pedido_id = ? ORDER BY id
      `).bind(pedidoId).all();

      const externalReference = `RP-${pedidoId}`;
      const totalAmount = (pedido.valor_total_centavos / 100).toFixed(2);
      const payerFirstName = String(env.MP_TEST_MODE || "").toLowerCase() === "true"
        ? "APRO"
        : (pedido.cliente_nome ? pedido.cliente_nome.split(/\s+/)[0] : "Cliente");

      const body = {
        type: "online",
        processing_mode: "automatic",
        external_reference: externalReference,
        total_amount: totalAmount,
        payer: { email: pedido.cliente_email, first_name: payerFirstName },
        transactions: {
          payments: [
            {
              amount: totalAmount,
              payment_method: { id: "pix", type: "bank_transfer" },
              expiration_time: "PT30M"
            }
          ]
        }
      };

      const orderRecuperada = await mpRequest(env, "/v1/orders", {
        method: "POST",
        idempotencyKey: pedido.idempotency_key,
        body
      });

      if (orderRecuperada?.id) {
        mpOrderId = String(orderRecuperada.id);
        await env.DB.prepare(`
          UPDATE pedidos SET mp_order_id = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(mpOrderId, pedidoId).run();
      }
    } catch (createErr) {
      console.warn(`Tentativa de recuperação de Order para pedido #${pedidoId} falhou:`, createErr?.message);
      // Se for erro 4xx definitivo comprovando que a criação foi rejeitada e nenhuma order existe
      if (createErr?.status === 400 || createErr?.status === 422) {
        await liberarReservaPedido(env, pedidoId, { novoStatus: "ERRO" });
        return { reconciliado: true, status: "LIBERADA" };
      }
      // Se for timeout ou 5xx, mantém ATIVA (política conservadora fail-safe)
      return { reconciliado: false };
    }
  }

  if (!mpOrderId) return { reconciliado: false };

  // 2. Consulta o status definitivo da Order no Mercado Pago
  try {
    const order = await mpRequest(env, `/v1/orders/${encodeURIComponent(mpOrderId)}`);
    const statusLocal = mpOrderToLocalStatus(order);

    if (statusLocal === "PAGO") {
      // Pagamento foi processado: converte a reserva em baixa definitiva
      await syncOrderPayment(env, { pedidoId, order, mpOrderId });
      return { reconciliado: true, status: "CONVERTIDA" };
    }

    if (["EXPIRADO", "CANCELADO", "FALHOU"].includes(statusLocal)) {
      // Estado terminal confirmado pelo gateway: libera a reserva com segurança
      await syncOrderPayment(env, { pedidoId, order, mpOrderId });
      await liberarReservaPedido(env, pedidoId, { novoStatus: statusLocal });
      return { reconciliado: true, status: "LIBERADA" };
    }

    // Se o status retornado ainda for PENDENTE ou desconhecido, mantém a reserva ATIVA
    return { reconciliado: false };
  } catch (queryErr) {
    console.warn(`Consulta de reconciliação para pedido #${pedidoId} falhou (mantendo reserva ativa):`, queryErr?.message);
    return { reconciliado: false };
  }
}

/**
 * Limpeza periódica/lazy de reservas expiradas que atinjam o TTL de 31 minutos.
 */
export async function limparReservasExpiradas(env) {
  try {
    const { results } = await env.DB.prepare(`
      SELECT id FROM pedidos
      WHERE status_pagamento = 'PENDENTE'
        AND reserva_status = 'ATIVA'
        AND datetime(reserva_expira_em) <= datetime('now')
      ORDER BY reserva_expira_em ASC
      LIMIT 10
    `).all();

    const pedidosExpirados = results || [];
    for (const p of pedidosExpirados) {
      await reconciliarReservaExpirada(env, p.id);
    }
  } catch (err) {
    console.warn("Falha no cleanup de reservas expiradas:", err?.message);
  }
}
