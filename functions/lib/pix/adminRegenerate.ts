/// <reference types="@cloudflare/workers-types" />

import { preparePedidoPhysicalProjection } from "../stock";
import { postPagamentoMp, cancelarPagamentoMp } from "../mpPost";
import { fetchMpPayment, syncPaymentFromMp, type MpPaymentResponse } from "../paymentSync";
import { chaveCancelamento, registrarFase } from "../operacoes";
import type { GerarPixAdminResult, GerarPixAdminSucesso } from "./types";

export interface RegenerateAdminPixArgs {
  env: {
    DB: D1Database;
    MP_ACCESS_TOKEN: string;
  };
  pedidoId: number;
  usuarioId: number;
  substituiId: number;
  operationKey: string;
  valorCentavos: number;
  idempotencyKey: string;
  mpIdempotencyKey: string;
  mpRequest: {
    transaction_amount: number;
    description: string;
    payment_method_id: string;
    date_of_expiration: string;
    external_reference: string;
    payer: {
      email: string;
      first_name: string;
    };
  };
  reservaStatements: D1PreparedStatement[];
  waterfall: {
    alocacoes: Array<{
      itemId: number;
      valorCentavos: number;
    }>;
  };
}

export async function regenerateAdminPix(
  args: RegenerateAdminPixArgs,
): Promise<GerarPixAdminResult> {
  const db = args.env.DB;
  const cancelKey = chaveCancelamento(args.operationKey);

  // 2. Proteção obrigatória pós-claim contra TOCTOU:
  // Releia o pagamento predecessor A no banco antes de qualquer GET/PUT/POST no MP.
  const aPosClaim = await db
    .prepare(
      `SELECT id, pedido_id, metodo, origem, status, mp_payment_id
       FROM pedido_pagamentos
       WHERE id = ?`,
    )
    .bind(args.substituiId)
    .first<{
      id: number;
      pedido_id: number;
      metodo: string;
      origem: string;
      status: string;
      mp_payment_id: string | null;
    }>();

  const sucessorIncompativel = await db
    .prepare(
      `SELECT 1 FROM pedido_pagamentos suc
       WHERE suc.substitui_pagamento_id = ?
         AND suc.status IN ('PENDENTE', 'PAGO')
       LIMIT 1`,
    )
    .bind(args.substituiId)
    .first();

  if (
    !aPosClaim ||
    aPosClaim.pedido_id !== args.pedidoId ||
    aPosClaim.metodo !== "PIX_MP" ||
    aPosClaim.origem !== "ADMIN" ||
    aPosClaim.status !== "PENDENTE" ||
    !aPosClaim.mp_payment_id ||
    sucessorIncompativel !== null
  ) {
    await registrarFase(db, args.operationKey, {
      fase: "RECUSADA",
      erro: "PIX_PARA_SUBSTITUIR_INVALIDO",
    });
    return { ok: false, erro: "PIX_PARA_SUBSTITUIR_INVALIDO" };
  }

  // 3. Inspeção remota de A
  let mpA: MpPaymentResponse;
  try {
    mpA = await fetchMpPayment(args.env.MP_ACCESS_TOKEN, aPosClaim.mp_payment_id);
  } catch {
    await registrarFase(db, args.operationKey, {
      fase: "ENVIO_INCONCLUSIVO",
      erro: "CONSULTA_PREDECESSOR_FALHOU",
    });
    return { ok: false, erro: "MERCADO_PAGO_INDISPONIVEL" };
  }

  const statusRemotoA = String(mpA.status || "").toLowerCase();

  if (statusRemotoA === "approved") {
    await syncPaymentFromMp(db, aPosClaim.id, mpA);
    await registrarFase(db, args.operationKey, {
      fase: "RECUSADA",
      erro: "PIX_SUBSTITUTO_JA_PAGO",
    });
    return { ok: false, erro: "PIX_SUBSTITUTO_JA_PAGO" };
  }

  let aConfirmadoNaoPagavel = false;
  let aStatusCancelado = "CANCELADO";

  if (statusRemotoA === "cancelled") {
    aConfirmadoNaoPagavel = true;
    if (mpA.status_detail === "expired") {
      aStatusCancelado = "EXPIRADO";
    }
  } else if (statusRemotoA === "rejected") {
    aConfirmadoNaoPagavel = true;
  } else if (
    statusRemotoA === "pending" ||
    statusRemotoA === "in_process" ||
    statusRemotoA === "authorized"
  ) {
    const cancelResultado = await cancelarPagamentoMp(
      args.env.MP_ACCESS_TOKEN,
      aPosClaim.mp_payment_id,
      cancelKey,
    );

    if (cancelResultado.resultado === "SUCESSO" && cancelResultado.status === "cancelled") {
      aConfirmadoNaoPagavel = true;
      if (cancelResultado.statusDetail === "expired") {
        aStatusCancelado = "EXPIRADO";
      }
    } else {
      // Cancelamento inconclusivo: reconsulta A
      let reconsulta: MpPaymentResponse | null = null;
      try {
        reconsulta = await fetchMpPayment(args.env.MP_ACCESS_TOKEN, aPosClaim.mp_payment_id);
      } catch {
        reconsulta = null;
      }

      if (reconsulta && reconsulta.status === "cancelled") {
        aConfirmadoNaoPagavel = true;
        if (reconsulta.status_detail === "expired") {
          aStatusCancelado = "EXPIRADO";
        }
      } else if (reconsulta && reconsulta.status === "approved") {
        await syncPaymentFromMp(db, aPosClaim.id, reconsulta);
        await registrarFase(db, args.operationKey, {
          fase: "RECUSADA",
          erro: "PIX_SUBSTITUTO_JA_PAGO",
        });
        return { ok: false, erro: "PIX_SUBSTITUTO_JA_PAGO" };
      } else {
        // Continua pending/in_process/authorized ou consulta falhou:
        await registrarFase(db, args.operationKey, {
          fase: "ENVIO_INCONCLUSIVO",
          erro: "CANCELAMENTO_INCONCLUSIVO",
        });
        return { ok: false, erro: "MERCADO_PAGO_INDISPONIVEL" };
      }
    }
  } else {
    // Estados financeiros inesperados (refunded, charged_back, in_mediation, desconhecido): FAIL CLOSED
    await registrarFase(db, args.operationKey, {
      fase: "RECUSADA",
      erro: "PIX_PARA_SUBSTITUIR_INVALIDO",
    });
    return { ok: false, erro: "PIX_PARA_SUBSTITUIR_INVALIDO" };
  }

  if (!aConfirmadoNaoPagavel) {
    await registrarFase(db, args.operationKey, {
      fase: "ENVIO_INCONCLUSIVO",
      erro: "CANCELAMENTO_INCONCLUSIVO",
    });
    return { ok: false, erro: "MERCADO_PAGO_INDISPONIVEL" };
  }

  // 4. Criação remota de B
  const envio = await postPagamentoMp(args.env.MP_ACCESS_TOKEN, args.mpIdempotencyKey, args.mpRequest);

  if (envio.resultado === "AMBIGUO") {
    await registrarFase(db, args.operationKey, {
      fase: "ENVIO_INCONCLUSIVO",
      erro: `AMBIGUO:${envio.motivo}`,
    });
    return { ok: false, erro: "MERCADO_PAGO_INDISPONIVEL" };
  }

  if (envio.resultado === "RECUSA_DEFINITIVA") {
    await registrarFase(db, args.operationKey, {
      fase: "RECUSADA",
      erro: `RECUSA_DEFINITIVA:${envio.httpStatus}`,
    });
    return { ok: false, erro: "MERCADO_PAGO_RECUSOU" };
  }

  const payment = envio.payment;
  const txData = payment.point_of_interaction?.transaction_data;
  const reservaExpiraEmSincronizada = payment.date_of_expiration
    ? new Date(Date.parse(payment.date_of_expiration) + 60_000).toISOString()
    : null;

  const sucesso: GerarPixAdminSucesso = {
    ok: true,
    pagamentoId: 0,
    valorCentavos: args.valorCentavos,
    mpPaymentId: String(payment.id),
    mpStatus: payment.status,
    qrCode: txData?.qr_code ?? null,
    qrCodeBase64: txData?.qr_code_base64 ?? null,
    ticketUrl: txData?.ticket_url ?? null,
    expiresAt: payment.date_of_expiration,
  };

  // 5. Persistência atômica após criação remota
  const finalStatements = [
    ...args.reservaStatements,
    preparePedidoPhysicalProjection(db, args.pedidoId),
    db
      .prepare(
        `UPDATE pedido_pagamentos
         SET status = ?,
             cancelado_em = COALESCE(cancelado_em, CURRENT_TIMESTAMP),
             atualizado_em = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'PENDENTE'`,
      )
      .bind(aStatusCancelado, args.substituiId),
    db
      .prepare(
        `INSERT INTO pedido_pagamentos (
           pedido_id, metodo, origem, valor_centavos, status,
           registrado_por_usuario_id, idempotency_key, substitui_pagamento_id,
           mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64, mp_ticket_url, pix_expira_em
         )
         VALUES (?, 'PIX_MP', 'ADMIN', ?, 'PENDENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        args.pedidoId,
        args.valorCentavos,
        args.usuarioId,
        args.idempotencyKey,
        args.substituiId,
        String(payment.id),
        payment.status,
        txData?.qr_code ?? null,
        txData?.qr_code_base64 ?? null,
        txData?.ticket_url ?? null,
        payment.date_of_expiration,
      ),
    ...args.waterfall.alocacoes.map((a) =>
      db
        .prepare(
          `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
           SELECT (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?), ?, ?`,
        )
        .bind(args.idempotencyKey, a.itemId, a.valorCentavos),
    ),
    db
      .prepare(
        `UPDATE pedido_operacoes
         SET fase = 'CONCLUIDA',
             mp_payment_id = ?,
             pagamento_id = (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?),
             resultado = ?,
             atualizado_em = CURRENT_TIMESTAMP
         WHERE operation_key = ?`,
      )
      .bind(
        String(payment.id),
        args.idempotencyKey,
        JSON.stringify(sucesso),
        args.operationKey,
      ),
  ];

  if (reservaExpiraEmSincronizada) {
    finalStatements.push(
      db
        .prepare(`UPDATE pedidos SET reserva_expira_em = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(reservaExpiraEmSincronizada, args.pedidoId),
    );
  }

  const batchResults = await db.batch(finalStatements);
  const bInsertIndex = args.reservaStatements.length + 2;
  let bPagamentoId = Number(batchResults[bInsertIndex]?.meta?.last_row_id || 0);
  if (!bPagamentoId) {
    const bRow = await db
      .prepare(`SELECT id FROM pedido_pagamentos WHERE idempotency_key = ? LIMIT 1`)
      .bind(args.idempotencyKey)
      .first<{ id: number }>();
    bPagamentoId = Number(bRow?.id || 0);
  }
  sucesso.pagamentoId = bPagamentoId;

  return sucesso;
}
