/// <reference types="@cloudflare/workers-types" />

// A1 — contrato de identidade lógica das operações de escrita.
//
// PROPRIEDADE FUNDAMENTAL
//   mesma intenção + mesma operation key + mesmo payload
//     => mesma operação e mesmo resultado lógico;
//   mesma operation key + payload incompatível
//     => conflito estável, sem nova escrita financeira;
//   nova operation key
//     => nova intenção legítima, sujeita aos guards normais do domínio.
//
// A key é criada pelo CLIENTE antes da primeira tentativa de envio. O
// servidor nunca a gera: uma key gerada no servidor a cada POST é
// exatamente o defeito A1 (cada retry nascia como uma intenção nova).
//
// O que NÃO identifica uma intenção, por decisão explícita: valor, horário,
// WhatsApp, hash do carrinho. Carrinho é intenção de compra em construção,
// não uma operação de checkout. Duas intenções diferentes podem ter payload
// idêntico e continuam sendo duas operações legítimas — por isso a
// deduplicação é pela KEY, e o fingerprint serve somente para detectar
// reutilização INCOMPATÍVEL da mesma key.

export type OperacaoTipo =
  | "CHECKOUT_SITE"
  | "PEDIDO_ADMIN"
  | "PAGAMENTO_ADMIN"
  | "REFUND_ADMIN"
  | "PIX_ADMIN"
  | "PIX_ADMIN_REGENERACAO";

export type OperacaoEscopo = "SITE" | "ADMIN";

// LOCAL_CRIADA ......... claim + fato local persistidos; para operações MP,
//                        o envio ainda não produziu resultado conhecido.
// ENVIO_INCONCLUSIVO ... o POST remoto ocorreu e NÃO é possível provar se o
//                        Mercado Pago criou o recurso (timeout, transporte,
//                        5xx, corpo ilegível). Não é sucesso nem rejeição.
// REMOTO_CONHECIDO ..... o `mp_payment_id` é conhecido, mas a gravação local
//                        posterior pode ter falhado.
// CONCLUIDA ............ resultado lógico final, replayável.
// RECUSADA ............. rejeição COMPROVADAMENTE definitiva do provedor.
export type OperacaoFase =
  | "LOCAL_CRIADA"
  | "ENVIO_INCONCLUSIVO"
  | "REMOTO_CONHECIDO"
  | "CONCLUIDA"
  | "RECUSADA";

// Versão do formato canônico do fingerprint. Se algum dia o conteúdo
// vinculado a uma key mudar de forma, esta versão sobe e operações antigas
// param de ser comparáveis — nesse caso a leitura é tratada como conflito
// (estável e seguro), nunca como "payload igual".
export const FINGERPRINT_VERSAO = 1;

// Aceita UUID, ULID e formatos equivalentes; recusa string vazia, valor
// trivial e chave longa demais para caber num índice com folga.
const OPERATION_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type OperationKeyResult =
  | { ok: true; key: string }
  | { ok: false; erro: "OPERATION_KEY_INVALIDA" };

export function parseOperationKey(raw: unknown): OperationKeyResult {
  if (typeof raw !== "string") return { ok: false, erro: "OPERATION_KEY_INVALIDA" };
  const key = raw.trim();
  if (!OPERATION_KEY_RE.test(key)) return { ok: false, erro: "OPERATION_KEY_INVALIDA" };
  return { ok: true, key };
}

// Identidades técnicas DERIVADAS da operation key, nunca UUIDs novos por
// chamada. Como `pedidos.idempotency_key`, `pedido_pagamentos.
// idempotency_key` e `pedido_reembolsos.idempotency_key` já são UNIQUE, a
// derivação transforma esses índices existentes numa segunda proteção
// atômica independente da tabela de operações: o MESMO fato não pode nascer
// duas vezes para a mesma key nem sob concorrência, nem depois de um retry.
export const chavePedido = (key: string) => `a1:${key}`;
export const chavePagamento = (key: string) => `a1:${key}:pag`;
export const chaveReembolso = (key: string) => `a1:${key}:ref`;

// `X-Idempotency-Key` do Mercado Pago. Estável por operação lógica: timeout,
// erro de transporte, 5xx ambíguo, resposta local perdida ou sucesso remoto
// seguido de falha local NUNCA produzem uma key MP nova.
export const chaveMp = (key: string) => `a1:${key}:mp`;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const origem = value as Record<string, unknown>;
    const destino: Record<string, unknown> = {};
    for (const chave of Object.keys(origem).sort()) {
      if (origem[chave] === undefined) continue;
      destino[chave] = canonical(origem[chave]);
    }
    return destino;
  }
  return value;
}

// Serialização canônica e versionada do conteúdo vinculado à key. Ordem de
// chaves normalizada para que a mesma intenção enviada duas vezes produza
// exatamente a mesma string, independente da ordem em que o cliente montou
// o JSON. Nunca inclui horário, id gerado pelo servidor ou preço resolvido
// pelo servidor: esses são congelados no fato persistido, não na identidade.
export function fingerprint(payload: unknown): string {
  return `${FINGERPRINT_VERSAO}:${JSON.stringify(canonical(payload))}`;
}

export interface OperacaoRow {
  id: number;
  operation_key: string;
  tipo: OperacaoTipo;
  escopo: OperacaoEscopo;
  ator_usuario_id: number | null;
  fingerprint_versao: number;
  fingerprint: string;
  fase: OperacaoFase;
  pedido_id: number | null;
  pagamento_id: number | null;
  reembolso_id: number | null;
  resultado: string | null;
  erro: string | null;
  mp_idempotency_key: string | null;
  mp_request: string | null;
  mp_payment_id: string | null;
}

const COLUNAS_OPERACAO = `id, operation_key, tipo, escopo, ator_usuario_id,
  fingerprint_versao, fingerprint, fase, pedido_id, pagamento_id, reembolso_id,
  resultado, erro, mp_idempotency_key, mp_request, mp_payment_id`;

// Este lookup roda ANTES dos guards dependentes do estado atual do domínio.
// É o que permite recuperar um sucesso anterior cujo resultado HTTP se
// perdeu: o estado do pedido pode ter mudado no meio-tempo, e o retry não
// pode ser reinterpretado como uma nova tentativa contra o estado novo.
export async function buscarOperacao(
  db: D1Database,
  key: string,
): Promise<OperacaoRow | null> {
  return await db
    .prepare(`SELECT ${COLUNAS_OPERACAO} FROM pedido_operacoes WHERE operation_key = ? LIMIT 1`)
    .bind(key)
    .first<OperacaoRow>();
}

export type ConflitoOperacao =
  | "OPERACAO_CONFLITO_TIPO"
  | "OPERACAO_CONFLITO_ESCOPO"
  | "OPERACAO_CONFLITO_PAYLOAD";

export interface IdentidadeEsperada {
  tipo: OperacaoTipo;
  escopo: OperacaoEscopo;
  atorUsuarioId: number | null;
  fingerprint: string;
}

// A key só vale para o tipo/escopo/ator em que nasceu. Reaproveitá-la em
// outro contexto é conflito, não uma segunda operação.
export function conflitoOperacao(
  operacao: OperacaoRow,
  esperado: IdentidadeEsperada,
): ConflitoOperacao | null {
  if (operacao.tipo !== esperado.tipo) return "OPERACAO_CONFLITO_TIPO";
  if (operacao.escopo !== esperado.escopo) return "OPERACAO_CONFLITO_ESCOPO";
  if ((operacao.ator_usuario_id ?? null) !== (esperado.atorUsuarioId ?? null)) {
    return "OPERACAO_CONFLITO_ESCOPO";
  }
  if (Number(operacao.fingerprint_versao) !== FINGERPRINT_VERSAO) {
    return "OPERACAO_CONFLITO_PAYLOAD";
  }
  if (operacao.fingerprint !== esperado.fingerprint) return "OPERACAO_CONFLITO_PAYLOAD";
  return null;
}

// Fonte do claim: um SELECT que devolve pedido_id/pagamento_id/reembolso_id
// do fato recém-inserido NO MESMO batch, resolvido pelas chaves derivadas.
//
// Se o guard de domínio do fato tiver recusado a escrita (saldo, capacidade,
// substituível, estoque), esse SELECT não devolve linha nenhuma e o claim
// simplesmente não é inserido — a operação não é registrada e o chamador
// devolve o erro de domínio normal. Nunca fica um claim órfão apontando
// para um fato que não existe.
export interface ClaimFonte {
  sql: string;
  args: unknown[];
}

export function fontePagamento(chave: string): ClaimFonte {
  return {
    sql: `SELECT pedido_id AS pedido_id, id AS pagamento_id, NULL AS reembolso_id
          FROM pedido_pagamentos WHERE idempotency_key = ?`,
    args: [chave],
  };
}

export function fonteReembolso(chave: string): ClaimFonte {
  return {
    sql: `SELECT pedido_id AS pedido_id, pagamento_id AS pagamento_id, id AS reembolso_id
          FROM pedido_reembolsos WHERE idempotency_key = ?`,
    args: [chave],
  };
}

export function fontePedidoComPagamento(
  chaveDoPedido: string,
  chaveDoPagamento: string,
): ClaimFonte {
  return {
    sql: `SELECT p.id AS pedido_id, pp.id AS pagamento_id, NULL AS reembolso_id
          FROM pedidos p
          JOIN pedido_pagamentos pp ON pp.pedido_id = p.id AND pp.idempotency_key = ?
          WHERE p.idempotency_key = ?`,
    args: [chaveDoPagamento, chaveDoPedido],
  };
}

export interface ClaimParams extends IdentidadeEsperada {
  key: string;
  fase: OperacaoFase;
  mpIdempotencyKey?: string | null;
  mpRequest?: string | null;
  resultado?: string | null;
  fonte: ClaimFonte;
}

// INSERT comum (nunca `INSERT OR IGNORE`): a violação do UNIQUE de
// `operation_key` precisa DERRUBAR o batch inteiro do perdedor, não ser
// silenciosamente ignorada enquanto os demais efeitos seguem executando.
export function prepareClaimOperacao(
  db: D1Database,
  params: ClaimParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO pedido_operacoes (
         operation_key, tipo, escopo, ator_usuario_id, fingerprint_versao, fingerprint,
         fase, mp_idempotency_key, mp_request, resultado,
         pedido_id, pagamento_id, reembolso_id
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, f.pedido_id, f.pagamento_id, f.reembolso_id
       FROM (${params.fonte.sql}) f`,
    )
    .bind(
      params.key,
      params.tipo,
      params.escopo,
      params.atorUsuarioId,
      FINGERPRINT_VERSAO,
      params.fingerprint,
      params.fase,
      params.mpIdempotencyKey ?? null,
      params.mpRequest ?? null,
      params.resultado ?? null,
      ...params.fonte.args,
    );
}

// `CONCLUIDA` e `RECUSADA` são terminais: uma resposta tardia do provedor
// nunca reabre uma operação já resolvida. Campos omitidos são preservados
// (COALESCE), nunca apagados.
export async function registrarFase(
  db: D1Database,
  key: string,
  patch: {
    fase: OperacaoFase;
    mpPaymentId?: string | null;
    resultado?: string | null;
    erro?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE pedido_operacoes
       SET fase = ?,
           mp_payment_id = COALESCE(?, mp_payment_id),
           resultado = COALESCE(?, resultado),
           erro = COALESCE(?, erro),
           atualizado_em = CURRENT_TIMESTAMP
       WHERE operation_key = ? AND fase NOT IN ('CONCLUIDA', 'RECUSADA')`,
    )
    .bind(
      patch.fase,
      patch.mpPaymentId ?? null,
      patch.resultado ?? null,
      patch.erro ?? null,
      key,
    )
    .run();
}

// Contrato HTTP compartilhado pelos endpoints A1. `code` estruturado, nunca
// só texto: o frontend precisa distinguir conflito de payload (não tentar de
// novo com a mesma key) de operação em processamento (não tentar de novo de
// jeito nenhum, só reler o estado).
export const OPERACAO_MENSAGENS: Record<string, string> = {
  OPERATION_KEY_INVALIDA: "Identificação da operação ausente ou inválida",
  OPERACAO_CONFLITO_TIPO:
    "Esta identificação de operação já foi usada para outro tipo de operação.",
  OPERACAO_CONFLITO_ESCOPO:
    "Esta identificação de operação pertence a outro contexto ou operador.",
  OPERACAO_CONFLITO_PAYLOAD:
    "Esta identificação de operação já foi usada com dados diferentes. Nenhuma alteração foi feita.",
  OPERACAO_INCOMPLETA:
    "A operação anterior com esta identificação ficou incompleta. Verifique o pedido antes de repetir.",
  OPERACAO_EM_PROCESSAMENTO:
    "Esta operação já foi iniciada e ainda não foi concluída. Atualize e verifique antes de tentar de novo.",
};

export const OPERACAO_HTTP_STATUS: Record<string, number> = {
  OPERATION_KEY_INVALIDA: 400,
  OPERACAO_CONFLITO_TIPO: 409,
  OPERACAO_CONFLITO_ESCOPO: 409,
  OPERACAO_CONFLITO_PAYLOAD: 409,
  OPERACAO_INCOMPLETA: 409,
  OPERACAO_EM_PROCESSAMENTO: 409,
};

export function parseResultado<T>(operacao: OperacaoRow): T | null {
  if (!operacao.resultado) return null;
  try {
    return JSON.parse(operacao.resultado) as T;
  } catch {
    // Snapshot corrompido nunca impede o replay: o chamador reconstrói o
    // resultado a partir das linhas persistidas (que são a fonte da verdade).
    return null;
  }
}
