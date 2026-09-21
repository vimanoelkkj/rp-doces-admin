/// <reference types="@cloudflare/workers-types" />

import { requireUser, sameOrigin } from "../../../../../lib/auth";
import { getPedidoAnulacao } from "../../../../../lib/pedidoValido";
import { listarPagamentosMpReembolsaveis } from "../../../../../lib/pedidoAnulacao";
import {
  getPixMpRefundIntentForPagamento,
  reconcilePixMpRefundIntent,
  recoverPixMpRefundIntentsForPedido,
  type PixMpRefundIntentView,
} from "../../../../../lib/mpRefundIntent";
import {
  chaveAnulacaoRefund,
  fingerprint,
  OPERACAO_MENSAGENS,
  parseOperationKey,
  type IdentidadeEsperada,
} from "../../../../../lib/operacoes";

interface Env { DB: D1Database; MP_ACCESS_TOKEN?: string }

interface PernaEstorno {
  pagamentoId: number;
  valorCentavos: number;
  restanteCentavos: number;
  intencao: PixMpRefundIntentView | null;
}

const MESSAGES: Record<string, string> = {
  MERCADO_PAGO_NAO_CONFIGURADO: "Mercado Pago não está configurado neste ambiente.",
  REFUND_REMOTO_EM_ANDAMENTO: "Já existe um estorno remoto em andamento para este pagamento.",
  ...OPERACAO_MENSAGENS,
};

const fail = (message: string, status: number, code?: string) =>
  Response.json({ error: message, ...(code ? { code } : {}) }, { status });

async function montarPernas(db: D1Database, pedidoId: number): Promise<PernaEstorno[]> {
  const pendentes = await listarPagamentosMpReembolsaveis(db, pedidoId);
  return Promise.all(pendentes.map(async (p) => ({
    ...p,
    intencao: await getPixMpRefundIntentForPagamento(db, { pedidoId, pagamentoId: p.pagamentoId }),
  })));
}

// GET: estado atual dos pagamentos PIX_MP ainda reembolsáveis deste pedido,
// para o modal de exclusão decidir o que mostrar sem o cliente calcular
// nada. Roda a mesma recuperação oportunista de `reconcileLiveTabPedido`
// antes de ler, para um PROCESSANDO parado não ficar preso até o próximo
// carregamento da tela do pedido.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  const pedidoId = Number(params.id);
  if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) return fail("Id inválido", 400);

  if (env.MP_ACCESS_TOKEN && !(await getPedidoAnulacao(env.DB, pedidoId))) {
    try { await recoverPixMpRefundIntentsForPedido(env.DB, env.MP_ACCESS_TOKEN, pedidoId, 10); }
    catch (error) { console.error("Recuperacao oportunista de estorno de anulacao", { pedidoId }, error); }
  }

  const pernas = await montarPernas(env.DB, pedidoId);
  const restanteTotalCentavos = pernas.reduce((soma, p) => soma + p.restanteCentavos, 0);
  return Response.json({ pedidoId, restanteTotalCentavos, pernas });
};

// POST: dispara (ou reconcilia) o estorno de TODAS as pernas PIX_MP ainda
// reembolsáveis do pedido, a partir de uma única operationKey do cliente. O
// valor de cada perna é sempre calculado pelo servidor — o corpo da
// requisição não carrega nenhum valor financeiro. Cada pagamento é uma
// intenção independente (chave derivada por pagamento_id): uma perna
// confirmada e outra inconclusiva no mesmo clique é um resultado válido, e
// um novo clique com a MESMA key só reprocessa o que ainda não confirmou.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!sameOrigin(request)) return fail("Origem inválida", 403);
  const auth = await requireUser(env.DB, request);
  if ("error" in auth) return auth.error;
  const pedidoId = Number(params.id);
  if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) return fail("Id inválido", 400);
  if (await getPedidoAnulacao(env.DB, pedidoId)) {
    return fail("Pedido anulado. O histórico está disponível somente para consulta.", 409, "PEDIDO_ANULADO");
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return fail("JSON inválido", 400); }
  const parsed = parseOperationKey(body.operationKey);
  if (!parsed.ok) return fail(MESSAGES.OPERATION_KEY_INVALIDA, 400, parsed.erro);

  if (!env.MP_ACCESS_TOKEN) {
    const pernas = await montarPernas(env.DB, pedidoId);
    if (pernas.length === 0) return Response.json({ pedidoId, restanteTotalCentavos: 0, pernas });
    return fail(MESSAGES.MERCADO_PAGO_NAO_CONFIGURADO, 409, "MERCADO_PAGO_NAO_CONFIGURADO");
  }

  try {
    const pendentes = await listarPagamentosMpReembolsaveis(env.DB, pedidoId);
    for (const pendente of pendentes) {
      const legOperationKey = chaveAnulacaoRefund(parsed.key, pendente.pagamentoId);
      const identity: IdentidadeEsperada = {
        tipo: "REFUND_ADMIN", escopo: "ADMIN", atorUsuarioId: auth.user.id,
        fingerprint: fingerprint({
          pedidoId, pagamentoId: pendente.pagamentoId, valorCentavos: pendente.restanteCentavos,
        }),
      };
      const resultado = await reconcilePixMpRefundIntent(env.DB, {
        pedidoId, pagamentoId: pendente.pagamentoId, usuarioId: auth.user.id,
        operationKey: legOperationKey, fingerprint: identity.fingerprint,
        valorCentavos: pendente.restanteCentavos, accessToken: env.MP_ACCESS_TOKEN,
      });
      // Um conflito aqui só pode vir de uma reutilização incompatível da
      // sub-key derivada (nunca do cliente) — segue para as demais pernas em
      // vez de abortar o estorno inteiro por causa de uma perna corrompida.
      if (resultado.ok === false) {
        console.error("Conflito ao reconciliar estorno de anulacao", { pedidoId, pendente }, resultado.erro);
      }
    }
  } catch (error) {
    console.error("Erro ao processar estorno de anulacao", { pedidoId }, error);
    return fail("Erro interno ao processar o estorno", 500);
  }

  const pernas = await montarPernas(env.DB, pedidoId);
  const restanteTotalCentavos = pernas.reduce((soma, p) => soma + p.restanteCentavos, 0);
  return Response.json({ pedidoId, restanteTotalCentavos, pernas },
    { status: restanteTotalCentavos > 0 ? 202 : 200 });
};
