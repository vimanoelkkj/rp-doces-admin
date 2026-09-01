import { json, bodyJson, sameOrigin } from "../../../../lib/http.js";
import { requireUser } from "../../../../lib/auth.js";
import { baixarEstoquePedido } from "../../../../lib/stock.js";
import {
  ensureLegacyPaymentMaterialized,
  getComandaFinancialState,
  registerAdminPayment,
  recalculateComanda
} from "../../../../lib/comandaLedger.js";
import {
  findPendingPixCharge,
  reconcilePixCharge,
  cancelPendingPixCharge,
  createPixCharge
} from "../../../../lib/comandaPix.js";
import { logEvent } from "../../../../lib/logger.js";

const MANUAL_METHODS = new Set(["PIX_EXTERNO", "CARTAO", "DINHEIRO"]);
const PIX_DECISIONS = new Set(["CANCELAR", "MANTER"]);

async function settlePendingPixDecision(env, pedidoId, decision) {
  let pending = await findPendingPixCharge(env, pedidoId);
  if (!pending) return { ok: true, pending: null, activePendingCents: 0 };

  const reconciled = await reconcilePixCharge(env, pedidoId, pending);
  if (!reconciled.ok) return { ok: false, erro: "PIX_RECONCILIACAO_FALHOU", httpStatus: 502 };

  if (reconciled.status === "PAGO") {
    await recalculateComanda(env, pedidoId);
    return { ok: true, pending: null, paidDuringReconcile: true, activePendingCents: 0 };
  }
  if (["CANCELADO", "EXPIRADO", "REEMBOLSADO", "FALHOU"].includes(reconciled.status)) {
    return { ok: true, pending: null, activePendingCents: 0 };
  }

  pending = await findPendingPixCharge(env, pedidoId);
  if (!decision) {
    return {
      ok: false,
      erro: "DECISAO_PIX_NECESSARIA",
      httpStatus: 409,
      pix_pendente: {
        id: pending?.id,
        valor_centavos: Number(pending?.valor_centavos || 0),
        mp_order_id: pending?.mp_order_id || null
      }
    };
  }

  if (decision === "CANCELAR") {
    const canceled = await cancelPendingPixCharge(env, pedidoId, pending);
    if (!canceled.ok) {
      if (canceled.pago) {
        await recalculateComanda(env, pedidoId);
        return { ok: true, pending: null, paidDuringReconcile: true, activePendingCents: 0 };
      }
      return { ok: false, erro: canceled.erro || "PIX_CANCELAMENTO_FALHOU", httpStatus: 502 };
    }
    return { ok: true, pending: null, canceledPaymentId: Number(pending.id), activePendingCents: 0 };
  }

  return {
    ok: true,
    pending,
    activePendingCents: Number(pending?.valor_centavos || 0)
  };
}

async function lowerStockIfSettled(env, pedidoId, statusFinanceiro) {
  if (statusFinanceiro !== "PAGO") return { ok: true, baixado: false };
  return baixarEstoquePedido(env, pedidoId);
}

export async function onRequestPost({ request, env, params }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;

  const pedidoId = Number(params.id);
  const body = await bodyJson(request);
  const action = String(body?.acao || "").toUpperCase();
  const pixDecisionRaw = body?.pix_pendente == null ? null : String(body.pix_pendente).toUpperCase();
  const pixDecision = pixDecisionRaw && PIX_DECISIONS.has(pixDecisionRaw) ? pixDecisionRaw : null;

  if (!Number.isInteger(pedidoId) || pedidoId < 1) return json({ erro: "Pedido inválido." }, 400);
  if (pixDecisionRaw && !pixDecision) return json({ erro: "Decisão sobre o Pix inválida." }, 400);

  await ensureLegacyPaymentMaterialized(env, pedidoId);

  let state = await getComandaFinancialState(env, pedidoId);
  if (!state) return json({ erro: "Pedido não encontrado." }, 404);
  if (String(state.pedido.status_comanda || "ABERTA").toUpperCase() !== "ABERTA") {
    return json({ erro: "Esta comanda já foi encerrada." }, 409);
  }

  if (action === "REGISTRAR") {
    const method = String(body?.metodo || "").toUpperCase();
    if (!MANUAL_METHODS.has(method)) return json({ erro: "Forma de pagamento inválida." }, 400);

    const pendingDecision = await settlePendingPixDecision(env, pedidoId, pixDecision);
    if (!pendingDecision.ok) {
      return json(
        { erro: pendingDecision.erro, pix_pendente: pendingDecision.pix_pendente || undefined },
        pendingDecision.httpStatus || 409
      );
    }

    state = await getComandaFinancialState(env, pedidoId);
    const requested = body?.valor_centavos == null ? state.saldo_centavos : Number(body.valor_centavos);
    const maxWithoutOvercharge = Math.max(0, state.saldo_centavos - pendingDecision.activePendingCents);
    if (!Number.isSafeInteger(requested) || requested <= 0 || requested > maxWithoutOvercharge) {
      return json({
        erro: pendingDecision.activePendingCents
          ? "Esse valor pode gerar cobrança acima do saldo porque há um Pix pendente mantido."
          : "Valor de pagamento inválido.",
        saldo_centavos: state.saldo_centavos,
        pix_pendente_centavos: pendingDecision.activePendingCents
      }, 400);
    }

    const result = await registerAdminPayment(env, {
      pedidoId,
      metodo: method,
      valorCentavos: requested,
      usuarioId: auth.user.id,
      observacao: body?.observacao || ""
    });
    if (!result.ok) return json({ erro: "Não foi possível registrar o pagamento." }, 409);

    const stock = await lowerStockIfSettled(env, pedidoId, result.status_financeiro);
    if (!stock.ok) {
      logEvent("error", "comanda.stock_conversion_failed", { pedido_id: pedidoId });
      return json({
        ok: true,
        aviso: "Pagamento registrado, mas a baixa de estoque precisa ser reconciliada.",
        ...result
      }, 200);
    }

    logEvent("info", "comanda.payment_registered", {
      pedido_id: pedidoId,
      payment_method: method,
      total_centavos: requested
    });
    return json({ ok: true, ...result });
  }

  if (action === "GERAR_PIX") {
    const pendingDecision = await settlePendingPixDecision(env, pedidoId, pixDecision);
    if (!pendingDecision.ok) {
      return json(
        { erro: pendingDecision.erro, pix_pendente: pendingDecision.pix_pendente || undefined },
        pendingDecision.httpStatus || 409
      );
    }

    state = await getComandaFinancialState(env, pedidoId);
    const requested = body?.valor_centavos == null ? state.saldo_centavos : Number(body.valor_centavos);
    const maxWithoutOvercharge = Math.max(0, state.saldo_centavos - pendingDecision.activePendingCents);
    if (!Number.isSafeInteger(requested) || requested <= 0 || requested > maxWithoutOvercharge) {
      return json({
        erro: pendingDecision.activePendingCents
          ? "O novo Pix ultrapassaria o saldo livre da comanda."
          : "Valor da cobrança Pix inválido.",
        saldo_centavos: state.saldo_centavos,
        pix_pendente_centavos: pendingDecision.activePendingCents
      }, 400);
    }

    const created = await createPixCharge(env, {
      pedidoId,
      valorCentavos: requested,
      usuarioId: auth.user.id,
      clientRequestId: body?.client_request_id,
      substituiPagamentoId: pendingDecision.canceledPaymentId || null
    });
    if (!created.ok) {
      return json({ erro: created.erro || "Não foi possível gerar o Pix." }, created.httpStatus || 502);
    }

    const current = await getComandaFinancialState(env, pedidoId);
    const stock = await lowerStockIfSettled(env, pedidoId, current?.status_financeiro);
    if (!stock.ok) logEvent("error", "comanda.stock_conversion_failed", { pedido_id: pedidoId });

    logEvent("info", "comanda.pix_created", {
      pedido_id: pedidoId,
      total_centavos: requested
    });
    return json({
      ok: true,
      pagamento: created.pagamento,
      status_financeiro: current?.status_financeiro || "PENDENTE",
      saldo_centavos: current?.saldo_centavos || 0
    }, created.reused ? 200 : 201);
  }

  if (action === "CANCELAR_PIX") {
    const pending = await findPendingPixCharge(env, pedidoId);
    if (!pending) return json({ ok: true, cancelado: false });
    const canceled = await cancelPendingPixCharge(env, pedidoId, pending);
    if (!canceled.ok) {
      if (canceled.pago) return json({ erro: "O Pix foi pago antes do cancelamento." }, 409);
      return json({ erro: "Não foi possível cancelar o Pix pendente." }, 502);
    }
    return json({ ok: true, cancelado: Boolean(canceled.cancelado) });
  }

  return json({ erro: "Ação de pagamento inválida." }, 400);
}
