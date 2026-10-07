/// <reference types="@cloudflare/workers-types" />
import { decimalToCents, isBrazilCountryCode } from "../mp/orders/types";

import { fetchMpPayment } from "./client";
import { syncPaymentFromMp, expireLocalPayment } from "./ledgerSync";
import { resolveWebhookPayment } from "./webhook";
import { buscarPagamentosPorReferenciaExterna } from "../mpSearch";
import {
  claimRecuperacao,
  chavePagamento,
  expiracaoDecorrida,
  externalReferenceDaOperacao,
  fecharOperacaoExpirada,
  listarOperacoesInconclusivas,
  registrarFase,
  registrarObservacao
} from "../operacoes";

const RECUPERACAO_BATCH_SIZE = 4;

// B-3 — recuperação de operações cujo envio ao Mercado Pago ficou
// INCONCLUSIVO (timeout, transporte, 408/429/5xx, 2xx sem id utilizável).
//
// Antes, `fase='ENVIO_INCONCLUSIVO'` era estado MORTO: nada no código o lia.
// Sem `mp_payment_id`, `reconcilePendingPixPayments` não seleciona a
// tentativa e o polling público não consulta o provedor — então a única
// recuperação possível era o webhook. Se ele não chegasse, uma cobrança
// realmente criada e realmente paga nunca seria descoberta.
//
// INVARIANTE CENTRAL: uma operação inconclusiva pode significar (A) o
// provedor não criou nada, ou (B) criou e perdemos a resposta. Esta função
// NUNCA assume A nem B. Ela apenas OBSERVA o provedor com uma operação de
// leitura, pela identidade que o A1 já persistiu, e delega toda decisão
// financeira aos mecanismos existentes:
//
//   busca read-only (propõe um id)
//     -> fetchMpPayment (ÚNICA fonte de autoridade financeira — B2)
//     -> resolveWebhookPayment (associação guardada por CAS, sem duplicar)
//     -> syncPaymentFromMp (matriz de transição + reconciliação B3 + B4)
//
// Nunca faz POST, nunca gera nova identidade, nunca cria pedido, tentativa
// ou fato financeiro, e nunca libera reserva por conta própria: a liberação
// só acontece dentro de `finalizePayment`, sob os guards do B4, quando o
// estado terminal foi estabelecido pelos mecanismos autoritativos.
//
// Não é cron nem job: roda oportunisticamente, junto das reconciliações que
// já existem no GET administrativo, em lote pequeno e com throttle.
export async function recuperarOperacoesInconclusivas(env: {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
}): Promise<void> {
  // Const local: narrowing preservado dentro das closures de Promise.allSettled.
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return;

  const candidatas = await listarOperacoesInconclusivas(env.DB, RECUPERACAO_BATCH_SIZE);
  if (!candidatas.length) return;

  await Promise.allSettled(
    candidatas.map(async operacao => {
      try {
        // Throttle adquirido ANTES de qualquer chamada externa: concorrência
        // e falhas de rede não viram uma rajada de buscas.
        if (!(await claimRecuperacao(env.DB, operacao.operation_key))) return;

        const referencia = externalReferenceDaOperacao(operacao);
        if (!referencia) {
          await registrarObservacao(env.DB, operacao.operation_key, "BUSCA:REFERENCIA_AUSENTE");
          return;
        }

        const busca = await buscarPagamentosPorReferenciaExterna(
          token,
          referencia,
          operacao.criado_em
        );

        if (busca.resultado === "INDISPONIVEL") {
          // Não observamos nada. Isso não é rejeição, não perde identidade e
          // pode ser repetido no próximo ciclo.
          await registrarObservacao(
            env.DB,
            operacao.operation_key,
            `BUSCA:INDISPONIVEL:${busca.motivo}`
          );
          return;
        }

        if (busca.resultado === "NENHUM") {
          // Zero compatíveis NÃO prova que o provedor não criou o recurso.
          // Nada de FALHOU, nada de CANCELADO, nada de liberar reserva — a
          // menos que o prazo terminal do Pix (TTL persistido + 24h) já tenha
          // decorrido. Nesse caso a ausência observada deixa de ser ambígua o
          // bastante para fechar a operação como EXPIRADA, reutilizando o
          // fluxo existente (expireLocalPayment -> finalizePayment -> B4). A
          // operação só é fechada se a expiração do ledger SUCCEDER; se o
          // guard B4 segurar a reserva (outro Pix pendente), `expireLocalPayment`
          // lança e a operação permanece na fila.
          if (operacao.pagamento_id != null && expiracaoDecorrida(operacao)) {
            if (operacao.tipo !== "PIX_ADMIN_REGENERACAO") {
              await expireLocalPayment(env.DB, operacao.pagamento_id);
            }
            await fecharOperacaoExpirada(env.DB, operacao.operation_key);
            return;
          }
          await registrarObservacao(env.DB, operacao.operation_key, "BUSCA:NENHUM");
          return;
        }

        if (busca.resultado === "AMBIGUO") {
          // Mais de um candidato: não escolhemos arbitrariamente e não
          // estabelecemos verdade financeira. Fica visível para intervenção.
          console.error(
            "Recuperação de operação inconclusiva: múltiplos candidatos no Mercado Pago",
            {
              operationKey: operacao.operation_key,
              pedidoId: operacao.pedido_id,
              candidatos: busca.mpOrderIds
            }
          );
          await registrarObservacao(
            env.DB,
            operacao.operation_key,
            `BUSCA:AMBIGUO:${busca.quantidade}`
          );
          return;
        }

        // Exatamente um candidato. A partir daqui a busca não decide mais
        // nada: o GET verificado é que produz autoridade financeira.
        const payment = await fetchMpPayment(token, busca.mpOrderId);

        if (operacao.tipo === "PIX_ADMIN_REGENERACAO") {
          const chaveB = chavePagamento(operacao.operation_key);
          let bRow = await env.DB.prepare(
            `SELECT id, status FROM pedido_pagamentos WHERE idempotency_key = ? LIMIT 1`
          )
            .bind(chaveB)
            .first<{ id: number; status: string }>();

          if (!bRow) {
            // 9-H: B criado remotamente e persistência local falhou antes do batch.
            // Executa batch atômico para persistir B sem criar outro pagamento no MP.
            const txData = (
              payment as {
                point_of_interaction?: {
                  transaction_data?: {
                    qr_code?: string;
                    qr_code_base64?: string;
                    ticket_url?: string;
                  };
                };
              }
            ).point_of_interaction?.transaction_data;
            const req = operacao.mp_request
              ? (JSON.parse(operacao.mp_request) as {
                  total_amount?: string;
                  transaction_amount?: number;
                })
              : null;
            const valorCentavos =
              decimalToCents(req?.total_amount) ??
              (req?.transaction_amount ? Math.round(Number(req.transaction_amount) * 100) : 0);
            if (
              payment.external_reference !== referencia ||
              decimalToCents(payment.total_amount) !== valorCentavos ||
              decimalToCents(payment.transaction_amount) !== valorCentavos ||
              payment.payment_method_id !== "pix" ||
              payment.payment_method_type !== "bank_transfer" ||
              !isBrazilCountryCode(payment.country_code)
            ) {
              await registrarObservacao(
                env.DB,
                operacao.operation_key,
                "BUSCA:SUCESSOR_DIVERGENTE"
              );
              return;
            }

            const recoveryStatements = [
              env.DB.prepare(
                `UPDATE pedido_pagamentos
                 SET status = 'CANCELADO',
                     cancelado_em = COALESCE(cancelado_em, CURRENT_TIMESTAMP),
                     atualizado_em = CURRENT_TIMESTAMP
                 WHERE id = ? AND status = 'PENDENTE'
                   AND LOWER(COALESCE(mp_status, '')) NOT IN ('approved', 'refunded')`
              ).bind(operacao.pagamento_id),
              env.DB.prepare(
                `INSERT INTO pedido_pagamentos (
                   pedido_id, metodo, origem, valor_centavos, status,
                   registrado_por_usuario_id, idempotency_key, substitui_pagamento_id,
                   mp_order_id, mp_payment_id, mp_status, mp_qr_code, mp_qr_code_base64, mp_ticket_url, pix_expira_em
                 )
                 VALUES (?, 'PIX_MP', 'ADMIN', ?, 'PENDENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                operacao.pedido_id,
                valorCentavos,
                (operacao as { ator_usuario_id?: number | null }).ator_usuario_id ?? null,
                chaveB,
                operacao.pagamento_id,
                payment.order_id,
                String(payment.id),
                payment.status,
                txData?.qr_code ?? null,
                txData?.qr_code_base64 ?? null,
                txData?.ticket_url ?? null,
                (payment as { date_of_expiration?: string }).date_of_expiration ?? null
              ),
              env.DB.prepare(
                `UPDATE pedido_operacoes
                 SET fase = 'REMOTO_CONHECIDO',
                     mp_payment_id = ?,
                     pagamento_id = (SELECT id FROM pedido_pagamentos WHERE idempotency_key = ?),
                     atualizado_em = CURRENT_TIMESTAMP
                 WHERE operation_key = ?`
              ).bind(String(payment.id), chaveB, operacao.operation_key)
            ];

            await env.DB.batch(recoveryStatements);
            bRow = await env.DB.prepare(
              `SELECT id, status FROM pedido_pagamentos WHERE idempotency_key = ? LIMIT 1`
            )
              .bind(chaveB)
              .first<{ id: number; status: string }>();
          }

          if (bRow) {
            await registrarFase(env.DB, operacao.operation_key, {
              fase: "REMOTO_CONHECIDO",
              mpPaymentId: String(payment.id)
            });
            await syncPaymentFromMp(env.DB, bRow.id, payment, env);
          }
          return;
        }

        const resolvido = await resolveWebhookPayment(env.DB, payment);

        if (resolvido.kind !== "found") {
          console.error("Recuperação de operação inconclusiva: associação não resolvida", {
            operationKey: operacao.operation_key,
            pedidoId: operacao.pedido_id,
            mpPaymentId: busca.mpOrderId,
            kind: resolvido.kind
          });
          await registrarObservacao(
            env.DB,
            operacao.operation_key,
            `BUSCA:ASSOCIACAO_${resolvido.kind.toUpperCase()}`
          );
          return;
        }

        // A resolução é boa o bastante para o webhook (que parte do recurso
        // remoto e pergunta "de quem é isto?"), mas AQUI a pergunta é outra:
        // "este recurso é da tentativa que ESTA operação registrou?". Uma
        // recuperação só pode sincronizar o pagamento que o claim A1 já
        // apontava. Se divergir, a busca descobriu uma identidade que não é
        // nossa — nada é promovido, nada é associado, nada é liberado, e o
        // caso fica visível (`operacoesInconclusivas`) para intervenção.
        //
        // Hoje nenhum caminho conhecido diverge (SITE resolve pelo
        // token_publico do próprio pedido e ambiguidade vira `ambiguous`;
        // ADMIN resolve pela idempotency_key derivada da operation key), mas
        // produção ainda carrega histórico não auditado: esta asserção é o
        // que impede que um dado antigo decida por nós. Fail-closed de
        // propósito — `pagamento_id` ausente também diverge.
        if (resolvido.pagamentoId !== operacao.pagamento_id) {
          console.error(
            "Recuperação de operação inconclusiva: pagamento resolvido diverge da operação",
            {
              operationKey: operacao.operation_key,
              pedidoId: operacao.pedido_id,
              mpPaymentId: busca.mpOrderId,
              pagamentoDaOperacao: operacao.pagamento_id,
              pagamentoResolvido: resolvido.pagamentoId
            }
          );
          await registrarObservacao(env.DB, operacao.operation_key, "BUSCA:ASSOCIACAO_DIVERGENTE");
          return;
        }

        // Identidade remota agora é conhecida. A fase deixa de ser
        // inconclusiva e o replay da MESMA operationKey (A1) passa a
        // recuperar o resultado a partir das linhas persistidas.
        await registrarFase(env.DB, operacao.operation_key, {
          fase: "REMOTO_CONHECIDO",
          mpPaymentId: String(payment.id)
        });

        // Estado financeiro decidido só aqui, pelo caminho compartilhado.
        await syncPaymentFromMp(env.DB, resolvido.pagamentoId, payment, env);
      } catch (err) {
        console.error("Falha ao recuperar operação inconclusiva", operacao.operation_key, err);
      }
    })
  );
}
