import type { D1Database } from "@cloudflare/workers-types";
import type { StatusFinanceiroAgregado } from "./types";
import { getItensComSaldo, computeWaterfallAllocations } from "./allocations";
import { reconcilePersistedAdminFact, replayOperacaoLocal } from "./adminOps";
import {
  buscarOperacao,
  chavePagamento,
  fingerprint,
  fontePagamento,
  parseOperationKey,
  prepareClaimOperacao,
  type ConflitoOperacao,
  type IdentidadeEsperada,
} from "../operacoes";
import { chargeableCapacitySql } from "../financialCoverage";
import { temEstornoAnulacaoAtivo } from "../pedidoAnulacao";

export type MetodoManual = "DINHEIRO" | "CARTAO" | "PIX_EXTERNO";

export interface RegisterAdminPaymentResult {
  ok: boolean;
  pagamentoId?: number;
  statusFinanceiro?: StatusFinanceiroAgregado;
  saldoCentavos?: number;
  /** true quando a resposta recuperou uma operação já persistida (A1). */
  replay?: boolean;
  erro?:
    | "PEDIDO_NAO_ENCONTRADO"
    | "COMANDA_ENCERRADA"
    | "VALOR_ACIMA_DO_SALDO"
    | "SALDO_INSUFICIENTE_CONCORRENCIA"
    | "OPERATION_KEY_INVALIDA"
    | "OPERACAO_INCOMPLETA"
    | "ESTORNO_ANULACAO_ATIVO"
    | ConflitoOperacao;
}

// Lê o saldo, calcula a cascata em memória, e só então grava — pagamento +
// alocações no MESMO batch(), atômico. A condição de saldo do INSERT do
// pagamento é reavaliada NO MOMENTO DA ESCRITA (subquery, não o valor lido
// em JS antes): se duas requisições concorrentes disputarem o mesmo saldo,
// a que commitar primeiro vence; quando a segunda executar a mesma
// condição, o saldo já está reduzido de verdade e ela falha de forma
// determinística (zero linhas no INSERT do pagamento -> subquery das
// alocações resolve pagamento_id=NULL -> constraint NOT NULL derruba o
// batch inteiro -> nenhum DELETE de compensação necessário).
//
// Dívida residual conhecida e aceita: isso fecha com certeza o
// overpayment agregado do pedido (SUM(pagamentos PAGO) <= valor_total),
// mas não torna a distribuição por item serializável — duas requisições
// concorrentes ainda podem calcular a cascata sobre a mesma fotografia
// antiga dos itens antes de uma delas commitar.
export async function registerAdminPayment(
  db: D1Database,
  params: {
    pedidoId: number;
    metodo: MetodoManual;
    valorCentavos: number;
    usuarioId: number;
    observacao?: string;
    /**
     * A1: identidade lógica criada pelo cliente ANTES do primeiro envio.
     * Obrigatória no endpoint HTTP; opcional aqui porque o helper também é
     * chamado por caminhos internos que não representam uma intenção
     * repetível do operador.
     */
    operationKey?: string | null;
  },
): Promise<RegisterAdminPaymentResult> {
  const observacao = (params.observacao ?? "").slice(0, 300);

  // A1 — identidade da intenção. O fingerprint cobre exatamente o conteúdo
  // que define "este recebimento", já normalizado do mesmo jeito que será
  // persistido: pedido, método, valor e observação.
  let operationKey: string | null = null;
  let identidade: IdentidadeEsperada | null = null;
  if (params.operationKey != null) {
    const parsed = parseOperationKey(params.operationKey);
    if (!parsed.ok) return { ok: false, erro: parsed.erro };
    operationKey = parsed.key;
    identidade = {
      tipo: "PAGAMENTO_ADMIN",
      escopo: "ADMIN",
      atorUsuarioId: params.usuarioId,
      fingerprint: fingerprint({
        pedidoId: params.pedidoId,
        metodo: params.metodo,
        valorCentavos: params.valorCentavos,
        observacao,
      }),
    };

    // Lookup ANTES dos guards dependentes do estado atual: se a resposta
    // HTTP anterior se perdeu e o pedido já mudou de estado (por exemplo
    // ficou PAGO), o retry precisa RECUPERAR o pagamento original em vez de
    // ser reinterpretado como uma nova tentativa contra o estado novo.
    const existente = await buscarOperacao(db, operationKey);
    if (existente) {
      const replay = await replayOperacaoLocal(db, existente, identidade, "PAGAMENTO");
      return replay.ok
        ? {
            ok: true,
            pagamentoId: replay.id,
            replay: true,
            statusFinanceiro: replay.statusFinanceiro,
            saldoCentavos: replay.saldoCentavos,
          }
        : { ok: false, erro: replay.erro };
    }
  }

  const pedido = await db
    .prepare(`SELECT status_comanda, status_pedido FROM pedidos WHERE id = ?`)
    .bind(params.pedidoId)
    .first<{ status_comanda: string; status_pedido: string }>();
  if (!pedido) return { ok: false, erro: "PEDIDO_NAO_ENCONTRADO" };
  // ENTREGUE encerra a comanda automaticamente por trigger, mas isso é um
  // estado operacional: o recebimento ainda pode acontecer depois da
  // entrega. A exceção é deliberadamente estreita; CANCELADO e qualquer
  // outro pedido com comanda encerrada continuam bloqueados.
  if (
    pedido.status_comanda !== "ABERTA" &&
    pedido.status_pedido !== "ENTREGUE"
  ) {
    return { ok: false, erro: "COMANDA_ENCERRADA" };
  }
  if (await temEstornoAnulacaoAtivo(db, params.pedidoId)) {
    return { ok: false, erro: "ESTORNO_ANULACAO_ATIVO" };
  }

  const itens = await getItensComSaldo(db, params.pedidoId);
  const waterfall = computeWaterfallAllocations(itens, params.valorCentavos);
  if (!waterfall.ok) return { ok: false, erro: waterfall.erro };

  // Placeholders financeiros PURAMENTE LOCAIS criados na abertura manual do
  // pedido (ex.: A_COMBINAR) — nunca um PIX_MP, mesmo PENDENTE e mesmo sem
  // mp_payment_id ainda gravado: `metodo='PIX_MP'` por si só já representa
  // uma cobrança que pode estar viva no Mercado Pago (Pix administrativo,
  // passo futuro), e um pagamento manual não tem autoridade pra fingir que
  // ela deixou de existir — só o Mercado Pago decide isso. Cancela TODOS os
  // placeholders locais elegíveis (nunca LIMIT 1): se por algum motivo mais
  // de um existir, um `LIMIT 1` deixaria os demais órfãos ao lado do
  // pagamento PAGO que estamos prestes a inserir — mesmo bug documentado em
  // produção. Nunca cancela PENDENTE de origem SITE (Pix do cliente ainda
  // pode confirmar sozinho).
  const placeholdersLocais = await db
    .prepare(
      `SELECT id FROM pedido_pagamentos
       WHERE pedido_id = ? AND status = 'PENDENTE' AND origem = 'ADMIN' AND metodo != 'PIX_MP'
       ORDER BY id ASC`,
    )
    .bind(params.pedidoId)
    .all<{ id: number }>();
  // Só um pode ir no `substitui_pagamento_id` (é uma FK simples) — é uma
  // trilha de auditoria best-effort, não a fonte de verdade do cancelamento
  // (que é a condição do UPDATE abaixo, aplicada a todos os elegíveis).
  const primeiroPlaceholderLocal = placeholdersLocais.results[0]?.id ?? null;

  // Chave técnica de correlação dentro do batch. A partir do A1 ela é
  // DERIVADA da operation key quando existe uma: o UNIQUE parcial de
  // `pedido_pagamentos.idempotency_key` passa a ser uma segunda proteção
  // atômica — o mesmo pagamento não pode nascer duas vezes para a mesma
  // intenção, nem sob concorrência, nem depois de um retry. Sem operation
  // key (caminho interno), continua sendo um UUID por chamada.
  const idempotencyKey = operationKey ? chavePagamento(operationKey) : crypto.randomUUID();

  const statements = [
    db
      .prepare(
        `INSERT INTO pedido_pagamentos (
           pedido_id, metodo, origem, valor_centavos, status,
           registrado_por_usuario_id, observacao, idempotency_key, pago_em,
           substitui_pagamento_id
         )
         SELECT ?, ?, 'ADMIN', ?, 'PAGO', ?, ?, ?, CURRENT_TIMESTAMP, ?
         WHERE ? <= ${chargeableCapacitySql()}`,
      )
      .bind(
        params.pedidoId,
        params.metodo,
        params.valorCentavos,
        params.usuarioId,
        observacao,
        idempotencyKey,
        primeiroPlaceholderLocal,
        params.valorCentavos,
        params.pedidoId,
      ),
    ...waterfall.alocacoes.map((a) =>
      db
        .prepare(
          `INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
           SELECT (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?), ?, ?`,
        )
        .bind(idempotencyKey, a.itemId, a.valorCentavos),
    ),
    ...(placeholdersLocais.results.length > 0
      ? [
          db
            .prepare(
              `UPDATE pedido_pagamentos SET status = 'CANCELADO', cancelado_em = CURRENT_TIMESTAMP
               WHERE pedido_id = ? AND status = 'PENDENTE' AND origem = 'ADMIN' AND metodo != 'PIX_MP'
                 AND EXISTS (SELECT 1 FROM pedido_pagamentos WHERE idempotency_key = ?)`,
            )
            .bind(params.pedidoId, idempotencyKey),
        ]
      : []),
    // Claim A1 por último e CONDICIONADO ao fato: se o guard de saldo
    // recusou a escrita do pagamento, a fonte não devolve linha e nenhuma
    // operação é registrada — nunca sobra um claim apontando para um
    // pagamento que não existe. Continua atômico: claim e fato estão no
    // MESMO batch (uma transação), então ou os dois existem ou nenhum.
    ...(operationKey && identidade
      ? [
          prepareClaimOperacao(db, {
            key: operationKey,
            ...identidade,
            fase: "CONCLUIDA",
            fonte: fontePagamento(idempotencyKey),
          }),
        ]
      : []),
  ];

  // A1 — recuperação da operação vencedora numa disputa pela mesma key.
  // Duas requisições concorrentes com a mesma key colidem no UNIQUE de
  // `pedido_pagamentos.idempotency_key` (ou no de `operation_key`); o batch
  // do perdedor é revertido inteiro e ele relê a vencedora em vez de
  // devolver um erro que convidaria a criar um segundo fato financeiro.
  const recuperarVencedora = async (): Promise<RegisterAdminPaymentResult | null> => {
    if (!operationKey || !identidade) return null;
    const vencedora = await buscarOperacao(db, operationKey);
    if (!vencedora) return null;
    const replay = await replayOperacaoLocal(db, vencedora, identidade, "PAGAMENTO");
    return replay.ok
      ? {
          ok: true,
          pagamentoId: replay.id,
          replay: true,
          statusFinanceiro: replay.statusFinanceiro,
          saldoCentavos: replay.saldoCentavos,
        }
      : { ok: false, erro: replay.erro };
  };

  let batchResults;
  try {
    batchResults = await db.batch(statements);
  } catch {
    // Pode ser a condição de saldo (outra requisição consumiu o saldo entre
    // nossa leitura e o commit) ou a disputa da mesma operation key. Nada
    // foi gravado (rollback do batch inteiro) — não há nada para compensar.
    // A releitura por key distingue os dois casos de forma determinística.
    const vencedora = await recuperarVencedora();
    if (vencedora) return vencedora;
    return { ok: false, erro: "SALDO_INSUFICIENTE_CONCORRENCIA" };
  }

  const pagamentoId = Number(batchResults[0]?.meta?.last_row_id || 0);
  if (!pagamentoId) {
    const vencedora = await recuperarVencedora();
    if (vencedora) return vencedora;
    return { ok: false, erro: "SALDO_INSUFICIENTE_CONCORRENCIA" };
  }

  const derivados = await reconcilePersistedAdminFact(db, params.pedidoId, "PAGAMENTO", pagamentoId);
  return { ok: true, pagamentoId, ...derivados };
}
