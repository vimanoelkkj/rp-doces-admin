import { financialStatus, ledgerPaymentMethod, ledgerPaymentStatus } from "./orderLedger.js";

export async function ensureLegacyPaymentMaterialized(env, pedidoId) {
  const existing = await env.DB.prepare(
    "SELECT id FROM pedido_pagamentos WHERE pedido_id = ? LIMIT 1"
  )
    .bind(pedidoId)
    .first();
  if (existing) return { ok: true, materialized: false, paymentId: Number(existing.id) };

  const pedido = await env.DB.prepare("SELECT * FROM pedidos WHERE id = ? LIMIT 1")
    .bind(pedidoId)
    .first();
  if (!pedido || Number(pedido.valor_total_centavos || 0) <= 0) {
    return { ok: true, materialized: false, paymentId: null };
  }

  const status = ledgerPaymentStatus(pedido.status_pagamento);
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO pedido_pagamentos (
       pedido_id, metodo, origem, valor_centavos, status,
       mp_order_id, mp_payment_id, mp_status, mp_status_detail,
       mp_ticket_url, mp_qr_code, mp_qr_code_base64,
       idempotency_key, criado_em, atualizado_em, pago_em, cancelado_em,
       pix_expira_em
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)`
  )
    .bind(
      pedidoId,
      ledgerPaymentMethod(pedido.metodo_pagamento),
      pedido.origem_pedido === "SITE" ? "SITE" : "ADMIN",
      Number(pedido.valor_total_centavos),
      status,
      pedido.mp_order_id || null,
      pedido.mp_payment_id || null,
      pedido.mp_status || null,
      pedido.mp_status_detail || null,
      pedido.mp_ticket_url || null,
      pedido.mp_qr_code || null,
      pedido.mp_qr_code_base64 || null,
      pedido.idempotency_key || `legacy:${pedidoId}`,
      pedido.criado_em || null,
      pedido.atualizado_em || null,
      status === "PAGO" ? pedido.pago_em || pedido.atualizado_em || null : null,
      status === "CANCELADO" ? pedido.atualizado_em || null : null,
      pedido.pix_expira_em || null
    )
    .run();

  let paymentId = Number(inserted?.meta?.last_row_id || 0);
  if (!paymentId) {
    const found = await env.DB.prepare(
      "SELECT id FROM pedido_pagamentos WHERE pedido_id = ? ORDER BY id LIMIT 1"
    )
      .bind(pedidoId)
      .first();
    paymentId = Number(found?.id || 0);
  }

  if (paymentId) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
       SELECT ?, id, valor_total_centavos
       FROM pedido_itens
       WHERE pedido_id = ? AND valor_total_centavos > 0`
    )
      .bind(paymentId, pedidoId)
      .run();
  }

  return { ok: true, materialized: Boolean(paymentId), paymentId: paymentId || null };
}

export async function getComandaFinancialState(env, pedidoId) {
  const pedido = await env.DB.prepare(
    `SELECT * FROM pedidos WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();
  if (!pedido) return null;

  const { results: itens } = await env.DB.prepare(
    `SELECT id, pedido_id, produto_id, produto_nome, quantidade,
            valor_unitario_centavos, valor_total_centavos, estoque_baixado_em,
            adicionado_por_usuario_id, adicionado_em
     FROM pedido_itens
     WHERE pedido_id = ?
     ORDER BY id`
  )
    .bind(pedidoId)
    .all();

  const { results: pagamentos } = await env.DB.prepare(
    `SELECT id, pedido_id, metodo, origem, valor_centavos, status,
            mp_order_id, mp_payment_id, mp_status, mp_status_detail,
            mp_ticket_url, mp_qr_code, mp_qr_code_base64, pix_expira_em,
            idempotency_key, substitui_pagamento_id, registrado_por_usuario_id,
            observacao, criado_em, atualizado_em, pago_em, cancelado_em
     FROM pedido_pagamentos
     WHERE pedido_id = ?
     ORDER BY criado_em ASC, id ASC`
  )
    .bind(pedidoId)
    .all();

  const total = (itens || []).reduce((sum, item) => sum + Number(item.valor_total_centavos || 0), 0);
  const pago = (pagamentos || [])
    .filter(payment => String(payment.status).toUpperCase() === "PAGO")
    .reduce((sum, payment) => sum + Number(payment.valor_centavos || 0), 0);

  return {
    pedido,
    itens: itens || [],
    pagamentos: pagamentos || [],
    total_centavos: total,
    pago_centavos: pago,
    saldo_centavos: Math.max(0, total - pago),
    credito_centavos: Math.max(0, pago - total),
    status_financeiro: financialStatus(total, pago)
  };
}

export async function allocatePaidPayment(env, pagamentoId, pedidoId, valorCentavos) {
  const valor = Number(valorCentavos || 0);
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    return { ok: false, erro: "VALOR_INVALIDO" };
  }

  const existing = await env.DB.prepare(
    `SELECT COALESCE(SUM(valor_centavos), 0) AS total
     FROM pedido_pagamento_alocacoes
     WHERE pagamento_id = ?`
  )
    .bind(pagamentoId)
    .first();
  const alreadyAllocated = Number(existing?.total || 0);
  if (alreadyAllocated >= valor) return { ok: true, alocado_centavos: alreadyAllocated };

  const remainingToAllocate = valor - alreadyAllocated;
  const { results } = await env.DB.prepare(
    `SELECT pi.id, pi.valor_total_centavos,
            COALESCE(SUM(CASE
              WHEN pp.status = 'PAGO' AND pp.id <> ? THEN a.valor_centavos
              ELSE 0
            END), 0) AS pago_centavos
     FROM pedido_itens pi
     LEFT JOIN pedido_pagamento_alocacoes a ON a.pedido_item_id = pi.id
     LEFT JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id
     WHERE pi.pedido_id = ?
     GROUP BY pi.id, pi.valor_total_centavos
     ORDER BY pi.id ASC`
  )
    .bind(pagamentoId, pedidoId)
    .all();

  let restante = remainingToAllocate;
  const statements = [];
  for (const item of results || []) {
    if (restante <= 0) break;
    const totalItem = Number(item.valor_total_centavos || 0);
    const pagoItem = Math.min(totalItem, Number(item.pago_centavos || 0));
    const abertoItem = Math.max(0, totalItem - pagoItem);
    if (!abertoItem) continue;
    const parcela = Math.min(abertoItem, restante);
    statements.push(
      env.DB.prepare(
        `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
         VALUES (?, ?, ?)
         ON CONFLICT(pagamento_id, pedido_item_id)
         DO UPDATE SET valor_centavos = valor_centavos + excluded.valor_centavos`
      ).bind(pagamentoId, item.id, parcela)
    );
    restante -= parcela;
  }

  if (restante > 0) return { ok: false, erro: "VALOR_ACIMA_DO_SALDO" };
  if (statements.length) await env.DB.batch(statements);
  return { ok: true, alocado_centavos: valor };
}

export async function syncManualPaidOrder(env, pedidoId, usuarioId = null) {
  const pedido = await env.DB.prepare(
    `SELECT id, origem_pedido, metodo_pagamento, valor_total_centavos,
            idempotency_key, pago_em
     FROM pedidos
     WHERE id = ? LIMIT 1`
  )
    .bind(pedidoId)
    .first();

  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  if (String(pedido.origem_pedido || "").toUpperCase() !== "MANUAL") {
    return { ok: false, erro: "PEDIDO_NAO_MANUAL" };
  }

  const total = Number(pedido.valor_total_centavos || 0);
  if (!Number.isSafeInteger(total) || total <= 0) return { ok: false, erro: "VALOR_INVALIDO" };

  const { results } = await env.DB.prepare(
    `SELECT id, status, valor_centavos, idempotency_key, mp_order_id
     FROM pedido_pagamentos
     WHERE pedido_id = ?
     ORDER BY id ASC`
  )
    .bind(pedidoId)
    .all();

  const pagamentos = results || [];
  const pago = pagamentos
    .filter(item => String(item.status || "").toUpperCase() === "PAGO")
    .reduce((sum, item) => sum + Number(item.valor_centavos || 0), 0);
  const restante = Math.max(0, total - pago);

  const legacyKeys = new Set([String(pedido.idempotency_key || ""), `legacy:${pedidoId}`]);
  const placeholders = pagamentos.filter(item =>
    String(item.status || "").toUpperCase() === "PENDENTE" &&
    !item.mp_order_id &&
    legacyKeys.has(String(item.idempotency_key || ""))
  );

  if (placeholders.length) {
    await env.DB.batch(
      placeholders.map(item =>
        env.DB.prepare(
          `UPDATE pedido_pagamentos
           SET status = 'CANCELADO', cancelado_em = CURRENT_TIMESTAMP,
               atualizado_em = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'PENDENTE'`
        ).bind(item.id)
      )
    );
  }

  if (!restante) {
    await recalculateComanda(env, pedidoId);
    return { ok: true, pagamento_id: null, valor_centavos: 0, ja_quitado: true };
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO pedido_pagamentos (
       pedido_id, metodo, origem, valor_centavos, status,
       registrado_por_usuario_id, observacao, idempotency_key, pago_em
     ) VALUES (?, ?, 'ADMIN', ?, 'PAGO', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`
  )
    .bind(
      pedidoId,
      ledgerPaymentMethod(pedido.metodo_pagamento),
      restante,
      usuarioId,
      "Quitação de pedido manual",
      `manual-paid:${pedidoId}:${crypto.randomUUID()}`,
      pedido.pago_em || null
    )
    .run();

  const pagamentoId = Number(inserted?.meta?.last_row_id || 0);
  if (!pagamentoId) return { ok: false, erro: "PAGAMENTO_NAO_REGISTRADO" };

  const allocation = await allocatePaidPayment(env, pagamentoId, pedidoId, restante);
  if (!allocation.ok) {
    await env.DB.prepare("DELETE FROM pedido_pagamentos WHERE id = ?").bind(pagamentoId).run();
    return allocation;
  }

  await recalculateComanda(env, pedidoId);
  return { ok: true, pagamento_id: pagamentoId, valor_centavos: restante, ja_quitado: false };
}

export async function recalculateComanda(env, pedidoId) {
  const state = await getComandaFinancialState(env, pedidoId);
  if (!state) return null;

  const quantidade = state.itens.reduce((sum, item) => sum + Number(item.quantidade || 0), 0);
  const resumo = state.itens.length === 1
    ? String(state.itens[0].produto_nome || "Produto")
    : `Pedido com ${state.itens.length} itens`;
  const unico = state.itens.length === 1 ? state.itens[0] : null;

  await env.DB.prepare(
    `UPDATE pedidos SET
       produto_id = ?, produto_nome = ?, quantidade = ?,
       valor_unitario_centavos = ?, valor_total_centavos = ?,
       status_pagamento = ?,
       pago_em = CASE
         WHEN ? = 'PAGO' AND pago_em IS NULL THEN CURRENT_TIMESTAMP
         WHEN ? <> 'PAGO' THEN NULL
         ELSE pago_em
       END,
       atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      unico?.produto_id ?? null,
      resumo,
      quantidade,
      unico ? Number(unico.valor_unitario_centavos || 0) : 0,
      state.total_centavos,
      state.status_financeiro,
      state.status_financeiro,
      state.status_financeiro,
      pedidoId
    )
    .run();

  return {
    ...state,
    quantidade,
    status_financeiro: state.status_financeiro
  };
}

export async function registerAdminPayment(env, {
  pedidoId,
  metodo,
  valorCentavos,
  usuarioId = null,
  observacao = ""
}) {
  await ensureLegacyPaymentMaterialized(env, pedidoId);
  const state = await getComandaFinancialState(env, pedidoId);
  if (!state) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  if (String(state.pedido.status_comanda || "ABERTA") !== "ABERTA") {
    return { ok: false, erro: "COMANDA_ENCERRADA" };
  }

  const valor = Number(valorCentavos || 0);
  if (!Number.isSafeInteger(valor) || valor <= 0 || valor > state.saldo_centavos) {
    return { ok: false, erro: "VALOR_INVALIDO", saldo_centavos: state.saldo_centavos };
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO pedido_pagamentos (
       pedido_id, metodo, origem, valor_centavos, status,
       registrado_por_usuario_id, observacao, pago_em
     ) VALUES (?, ?, 'ADMIN', ?, 'PAGO', ?, ?, CURRENT_TIMESTAMP)`
  )
    .bind(pedidoId, metodo, valor, usuarioId, String(observacao || "").slice(0, 300))
    .run();
  const pagamentoId = Number(inserted?.meta?.last_row_id || 0);
  if (!pagamentoId) return { ok: false, erro: "PAGAMENTO_NAO_REGISTRADO" };

  const allocation = await allocatePaidPayment(env, pagamentoId, pedidoId, valor);
  if (!allocation.ok) {
    await env.DB.prepare("DELETE FROM pedido_pagamentos WHERE id = ?").bind(pagamentoId).run();
    return allocation;
  }

  const updated = await recalculateComanda(env, pedidoId);
  return {
    ok: true,
    pagamento_id: pagamentoId,
    status_financeiro: updated?.status_financeiro || "PENDENTE",
    saldo_centavos: updated?.saldo_centavos ?? state.saldo_centavos
  };
}

export async function syncComandaPixCharge(env, {
  pedidoId,
  mpOrderId,
  status,
  mpPaymentId = null,
  mpStatus = null,
  mpStatusDetail = null,
  ticketUrl = null,
  qrCode = null,
  qrCodeBase64 = null
}) {
  const payment = await env.DB.prepare(
    `SELECT id, valor_centavos, status, origem
     FROM pedido_pagamentos
     WHERE pedido_id = ? AND mp_order_id = ?
     LIMIT 1`
  )
    .bind(pedidoId, String(mpOrderId))
    .first();
  if (!payment) return { ok: false, matched: false };

  const before = String(payment.status || "PENDENTE").toUpperCase();
  const next = String(status || "PENDENTE").toUpperCase();

  await env.DB.prepare(
    `UPDATE pedido_pagamentos SET
       status = ?, mp_payment_id = COALESCE(?, mp_payment_id),
       mp_status = ?, mp_status_detail = ?,
       mp_ticket_url = COALESCE(?, mp_ticket_url),
       mp_qr_code = COALESCE(?, mp_qr_code),
       mp_qr_code_base64 = COALESCE(?, mp_qr_code_base64),
       atualizado_em = CURRENT_TIMESTAMP,
       pago_em = CASE WHEN ? = 'PAGO' AND pago_em IS NULL THEN CURRENT_TIMESTAMP ELSE pago_em END,
       cancelado_em = CASE WHEN ? = 'CANCELADO' AND cancelado_em IS NULL THEN CURRENT_TIMESTAMP ELSE cancelado_em END
     WHERE id = ?`
  )
    .bind(
      next,
      mpPaymentId,
      mpStatus,
      mpStatusDetail,
      ticketUrl,
      qrCode,
      qrCodeBase64,
      next,
      next,
      payment.id
    )
    .run();

  if (next === "PAGO" && before !== "PAGO") {
    const allocation = await allocatePaidPayment(env, payment.id, pedidoId, Number(payment.valor_centavos));
    if (!allocation.ok) return { ok: false, matched: true, erro: allocation.erro };
  }

  const updated = await recalculateComanda(env, pedidoId);
  return {
    ok: true,
    matched: true,
    pagamento_id: Number(payment.id),
    payment_origin: payment.origem,
    transitioned_to_paid: before !== "PAGO" && next === "PAGO",
    status_financeiro: updated?.status_financeiro || "PENDENTE",
    saldo_centavos: updated?.saldo_centavos || 0
  };
}
