import type { D1Database } from "@cloudflare/workers-types";
import type { StatusFinanceiroAgregado } from "./types";
import { reconcilePersistedAdminFact, replayOperacaoLocal } from "./adminOps";
import {
  buscarOperacao,
  chaveReembolso,
  fingerprint,
  fonteReembolso,
  parseOperationKey,
  prepareClaimOperacao,
  type ConflitoOperacao,
  type IdentidadeEsperada,
} from "../operacoes";

// Passo 5: reembolso manual (sem falar com o Mercado Pago). Nunca muta
// pedido_pagamentos — grava só em pedido_reembolsos. O pagamento original
// continua PAGO pra sempre, mesmo devolvido 100%: ver a nota no relatório
// do Passo 5 sobre por que flipar o status pra 'REEMBOLSADO' produziria
// uma armadilha matemática (bruto deixaria de contar o pagamento, mas o
// reembolso continuaria sendo subtraído, gerando contribuição negativa).

// B-2 — métodos cujo estorno pode ser REGISTRADO manualmente no ledger.
//
// `PIX_MP` entrou aqui, e isso NÃO significa que passamos a chamar a API de
// refund do Mercado Pago (continua fora de escopo, nenhuma chamada remota
// acontece neste caminho). Significa apenas que a operadora pode registrar
// no ledger um estorno que ela JÁ executou por fora do sistema — no painel
// do Mercado Pago ou por outro meio.
//
// Sem isso o sistema tinha um beco sem saída com dinheiro real: cliente paga
// Pix, desiste, a operadora devolve o valor, e o ledger continuava afirmando
// que o dinheiro estava retido. O guard de cancelamento exige líquido zero
// ("Faça o estorno antes de cancelar"), então o pedido ficava PAGO para
// sempre, impossível de cancelar, e só recuperável com SQL direto no banco.
//
// `origem='MANUAL'` (gravado abaixo) continua correto e é deliberado: descreve
// QUEM criou este fato — o operador, não a nossa integração. `'MERCADO_PAGO'`
// fica reservado para quando/se existir sincronização automática de refund,
// que não é isto.
//
// `OUTRO` segue fora: existe no schema por paridade com produção, mas este
// endpoint não cria pagamentos com esse método, então também não os estorna.
const METODOS_MANUAIS_REEMBOLSAVEIS: ReadonlySet<string> = new Set([
  "DINHEIRO",
  "CARTAO",
  "PIX_EXTERNO",
  "PIX_MP",
]);

const STATUS_PEDIDO_REEMBOLSAVEIS: ReadonlySet<string> = new Set([
  "NOVO",
  "PREPARANDO",
  "PRONTO",
]);

export interface RegisterRefundResult {
  ok: boolean;
  reembolsoId?: number;
  statusFinanceiro?: StatusFinanceiroAgregado;
  saldoCentavos?: number;
  /** true quando a resposta recuperou uma operação já persistida (A1). */
  replay?: boolean;
  erro?:
    | "PEDIDO_NAO_ENCONTRADO"
    | "STATUS_PEDIDO_NAO_REEMBOLSAVEL"
    | "REFUND_REQUER_FLUXO_COMANDA"
    | "PAGAMENTO_NAO_ENCONTRADO"
    | "METODO_NAO_REEMBOLSAVEL_MANUALMENTE"
    | "REFUND_PIX_MP_REMOTO_EM_ANDAMENTO"
    | "VALOR_INVALIDO"
    | "SALDO_REEMBOLSAVEL_INSUFICIENTE"
    | "OPERATION_KEY_INVALIDA"
    | "OPERACAO_INCOMPLETA"
    | ConflitoOperacao;
}

export async function registerManualRefund(
  db: D1Database,
  params: {
    pedidoId: number;
    pagamentoId: number;
    valorCentavos: number;
    usuarioId: number;
    motivo?: string;
    /** A1: ver nota em `registerAdminPayment`. */
    operationKey?: string | null;
  },
): Promise<RegisterRefundResult> {
  const motivo = (params.motivo ?? "").slice(0, 300);

  // A1 — identidade da intenção de devolver dinheiro. Uma mudança posterior
  // do saldo reembolsável não pode transformar o retry desta mesma intenção
  // numa nova devolução.
  let operationKey: string | null = null;
  let identidade: IdentidadeEsperada | null = null;
  if (params.operationKey != null) {
    const parsed = parseOperationKey(params.operationKey);
    if (!parsed.ok) return { ok: false, erro: parsed.erro };
    operationKey = parsed.key;
    identidade = {
      tipo: "REFUND_ADMIN",
      escopo: "ADMIN",
      atorUsuarioId: params.usuarioId,
      fingerprint: fingerprint({
        pedidoId: params.pedidoId,
        pagamentoId: params.pagamentoId,
        valorCentavos: params.valorCentavos,
        motivo,
      }),
    };

    // Lookup antes dos guards de estado (status do pedido, método,
    // saldo reembolsável).
    const existente = await buscarOperacao(db, operationKey);
    if (existente) {
      const replay = await replayOperacaoLocal(db, existente, identidade, "REEMBOLSO");
      return replay.ok
        ? {
            ok: true,
            reembolsoId: replay.id,
            replay: true,
            statusFinanceiro: replay.statusFinanceiro,
            saldoCentavos: replay.saldoCentavos,
          }
        : { ok: false, erro: replay.erro };
    }
  }

  const pedido = await db
    .prepare(`SELECT status_pedido, origem_pedido, status_comanda FROM pedidos WHERE id = ?`)
    .bind(params.pedidoId)
    .first<{ status_pedido: string; origem_pedido: string; status_comanda: string }>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  // A1 (auditoria Comanda Viva) — o refund manual genérico não sabe a qual
  // item atribuir o estorno: ele nunca grava em `pedido_reembolso_alocacoes`
  // nem em `pedido_item_troca_reembolso_alocacoes`. Numa comanda MANUAL
  // ainda ABERTA isso trava permanentemente `COBERTURA_INDETERMINADA` em
  // qualquer cancelamento/troca futuro do pedido, sem caminho de reparo.
  // Pedidos do site ou comandas já ENCERRADAS mantêm o comportamento
  // anterior (não participam do fluxo por item).
  if (pedido.origem_pedido === "MANUAL" && pedido.status_comanda === "ABERTA") {
    return { ok: false, erro: "REFUND_REQUER_FLUXO_COMANDA" };
  }
  if (!STATUS_PEDIDO_REEMBOLSAVEIS.has(pedido.status_pedido)) {
    return { ok: false, erro: "STATUS_PEDIDO_NAO_REEMBOLSAVEL" };
  }

  const pagamento = await db
    .prepare(
      `SELECT id, metodo, valor_centavos, status
       FROM pedido_pagamentos WHERE id = ? AND pedido_id = ? LIMIT 1`,
    )
    .bind(params.pagamentoId, params.pedidoId)
    .first<{ id: number; metodo: string; valor_centavos: number; status: string }>();
  if (!pagamento || pagamento.status !== "PAGO") {
    return { ok: false, erro: "PAGAMENTO_NAO_ENCONTRADO" };
  }
  if (!METODOS_MANUAIS_REEMBOLSAVEIS.has(pagamento.metodo)) {
    // Sobra `OUTRO`: existe no schema por paridade com produção, mas este
    // endpoint não aceita criar pagamentos com esse método, então também
    // não os estorna. `PIX_MP` passou a ser registrável no B-2 — ver a nota
    // em METODOS_MANUAIS_REEMBOLSAVEIS.
    return { ok: false, erro: "METODO_NAO_REEMBOLSAVEL_MANUALMENTE" };
  }
  if (pagamento.metodo === "PIX_MP") {
    const intencaoAtiva = await db.prepare(`SELECT 1 FROM pedido_reembolso_pix_mp_intencoes
      WHERE pagamento_id=? AND status IN ('PENDENTE','PROCESSANDO','INCONCLUSIVO') LIMIT 1`)
      .bind(params.pagamentoId).first();
    if (intencaoAtiva) return { ok: false, erro: "REFUND_PIX_MP_REMOTO_EM_ANDAMENTO" };
  }
  // O estorno só pode ser registrado sobre um pagamento efetivamente
  // confirmado (`status = 'PAGO'`, validado acima) — e o registro NUNCA muta
  // o pagamento original, que permanece um fato histórico íntegro. Nenhuma
  // chamada remota ao Mercado Pago acontece aqui, inclusive para PIX_MP.

  if (!Number.isSafeInteger(params.valorCentavos) || params.valorCentavos <= 0) {
    return { ok: false, erro: "VALOR_INVALIDO" };
  }

  // Derivada da operation key quando existe: o UNIQUE de
  // `pedido_reembolsos.idempotency_key` garante at-most-once do refund em si.
  const idempotencyKey = operationKey ? chaveReembolso(operationKey) : crypto.randomUUID();

  const insercao = db
    .prepare(
      `INSERT INTO pedido_reembolsos (
         pedido_id, pagamento_id, origem, metodo, valor_centavos, status,
         idempotency_key, registrado_por_usuario_id, motivo, devolveu_estoque, concluido_em
       )
       SELECT ?, ?, 'MANUAL', ?, ?, 'REEMBOLSADO', ?, ?, ?, 0, CURRENT_TIMESTAMP
       WHERE ? <= (
         SELECT pp.valor_centavos - COALESCE(
           (SELECT SUM(valor_centavos) FROM pedido_reembolsos WHERE pagamento_id = pp.id AND status = 'REEMBOLSADO'), 0)
         FROM pedido_pagamentos pp WHERE pp.id = ?
       )`,
    )
    .bind(
      params.pedidoId,
      params.pagamentoId,
      pagamento.metodo,
      params.valorCentavos,
      idempotencyKey,
      params.usuarioId,
      motivo,
      params.valorCentavos,
      params.pagamentoId,
    );

  const recuperarVencedora = async (): Promise<RegisterRefundResult | null> => {
    if (!operationKey || !identidade) return null;
    const vencedora = await buscarOperacao(db, operationKey);
    if (!vencedora) return null;
    const replay = await replayOperacaoLocal(db, vencedora, identidade, "REEMBOLSO");
    return replay.ok
      ? {
          ok: true,
          reembolsoId: replay.id,
          replay: true,
          statusFinanceiro: replay.statusFinanceiro,
          saldoCentavos: replay.saldoCentavos,
        }
      : { ok: false, erro: replay.erro };
  };

  // Com operation key, o refund e o claim vivem no MESMO batch (atômico).
  // Sem key, o caminho continua sendo exatamente o `.run()` de uma única
  // instrução que já existia — nenhuma mudança de comportamento nos
  // chamadores internos.
  let result;
  try {
    result = operationKey && identidade
      ? (
          await db.batch([
            insercao,
            prepareClaimOperacao(db, {
              key: operationKey,
              ...identidade,
              fase: "CONCLUIDA",
              fonte: fonteReembolso(idempotencyKey),
            }),
          ])
        )[0]
      : await insercao.run();
  } catch (err) {
    // Disputa da mesma key (UNIQUE de `idempotency_key` do refund ou de
    // `operation_key`): o batch do perdedor foi revertido inteiro e ele
    // recupera a vencedora. Qualquer outra falha continua propagando, como
    // antes — não é papel deste helper mascarar erro inesperado.
    const vencedora = await recuperarVencedora();
    if (vencedora) return vencedora;
    throw err;
  }

  if (Number(result?.meta?.changes || 0) === 0) {
    // Saldo reembolsável recalculado no momento da escrita não cobriu o
    // valor pedido — outra requisição pode ter consumido o saldo entre
    // nossa leitura e o commit. Determinístico, sem DELETE de compensação
    // (mesmo padrão do 4d). O claim também não foi inserido: sua fonte
    // depende da existência do refund.
    return { ok: false, erro: "SALDO_REEMBOLSAVEL_INSUFICIENTE" };
  }

  const reembolsoId = Number(result.meta.last_row_id);
  const derivados = await reconcilePersistedAdminFact(db, params.pedidoId, "REEMBOLSO", reembolsoId);
  return { ok: true, reembolsoId, ...derivados };
}
