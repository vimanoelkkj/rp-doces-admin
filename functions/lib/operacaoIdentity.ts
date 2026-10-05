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
  | "PIX_ADMIN_REGENERACAO"
  | "ITEM_ADICAO_ADMIN"
  | "ITEM_CANCELAMENTO_ADMIN"
  | "ITEM_TROCA_ADMIN";

export type OperacaoEscopo = "SITE" | "ADMIN";

// Versão do formato canônico do fingerprint. Se algum dia o conteúdo
// vinculado a uma key mudar de forma, esta versão sobe e operações antigas
// param de ser comparáveis — nesse caso a leitura é tratada como conflito
// (estável e seguro), nunca como "payload igual".
export const FINGERPRINT_VERSAO = 1;

// Aceita UUID, ULID e formatos equivalentes; recusa string vazia, valor
// trivial e chave longa demais para caber num índice com folga.
const OPERATION_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type OperationKeyResult =
  { ok: true; key: string } | { ok: false; erro: "OPERATION_KEY_INVALIDA" };

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
export const chaveCancelamento = (key: string) => `a1:${key}:cancel`;

// Uma anulação de pedido pode precisar estornar mais de um pagamento PIX_MP
// (ex.: pedido pago em duas cobranças). `pedido_operacoes.operation_key` é
// UNIQUE por linha, então um único clique do admin — uma única key recebida
// do cliente — deriva uma sub-key ESTÁVEL por pagamento, permitindo duas
// (ou mais) intenções de refund nascerem do mesmo clique sem colidir e sem
// que um retry do mesmo pagamento produza uma segunda intenção.
export const chaveAnulacaoRefund = (key: string, pagamentoId: number) =>
  `a1:${key}:anul:${pagamentoId}`;

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

export type ConflitoOperacao =
  "OPERACAO_CONFLITO_TIPO" | "OPERACAO_CONFLITO_ESCOPO" | "OPERACAO_CONFLITO_PAYLOAD";

export interface IdentidadeEsperada {
  tipo: OperacaoTipo;
  escopo: OperacaoEscopo;
  atorUsuarioId: number | null;
  fingerprint: string;
}

interface IdentidadeOperacao {
  tipo: OperacaoTipo;
  escopo: OperacaoEscopo;
  ator_usuario_id: number | null;
  fingerprint_versao: number;
  fingerprint: string;
}

// A key só vale para o tipo/escopo/ator em que nasceu. Reaproveitá-la em
// outro contexto é conflito, não uma segunda operação.
export function conflitoOperacao(
  operacao: IdentidadeOperacao,
  esperado: IdentidadeEsperada
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
