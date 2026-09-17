/// <reference types="@cloudflare/workers-types" />

// B-3 — observação READ-ONLY do Mercado Pago por identidade já persistida.
//
// CONTRATO VERIFICADO na documentação oficial da Mercado Pago (Payments API,
// "Search payments"), consultada antes desta implementação:
//
//   * Método/rota: GET https://api.mercadopago.com/v1/payments/search
//   * Autenticação: Bearer com o access token do painel.
//   * `sort` e `criteria` são OBRIGATÓRIOS (`criteria` aceita "asc"/"desc").
//   * `external_reference` é um filtro ACEITO e opcional.
//   * Resposta: { paging: { total, limit, offset }, results: [ ...pagamentos ] }.
//   * `limit`/`offset` não são documentados como parâmetros de entrada; o
//     `paging` da resposta traz limit 30 por padrão.
//   * Zero correspondências => HTTP 200 com `results` vazio (não é erro).
//   * Cada item de `results` traz `id`, `status`, `status_detail`,
//     `external_reference`, entre outros.
//   * Limitações documentadas: a busca cobre os ÚLTIMOS DOZE MESES a partir
//     da consulta; intervalo de `range` deve ser < 365 dias; erro 1000 quando
//     o número de linhas excede os limites.
//
// É uma operação de LEITURA. Ela nunca cria cobrança, nunca repete o POST e
// nunca tem autoridade financeira: o que ela produz é, no máximo, um
// CANDIDATO a `mp_payment_id`. A verdade financeira continua nascendo
// exclusivamente do GET verificado do B2 (`fetchMpPayment`), que é executado
// depois, sobre o id proposto aqui.

export const MP_PAYMENTS_SEARCH_URL = "https://api.mercadopago.com/v1/payments/search";

// Mesmo prazo do GET autoritativo: é uma consulta, não uma criação.
export const MP_PAYMENT_SEARCH_TIMEOUT_MS = 5000;

export type MpSearchResultado =
  /** Exatamente um pagamento remoto compatível com a referência persistida. */
  | { resultado: "UNICO"; mpPaymentId: string }
  /** Nenhum pagamento compatível. NÃO prova que o provedor não criou nada. */
  | { resultado: "NENHUM" }
  /** Mais de um candidato compatível: não decidimos qual é o nosso. */
  | { resultado: "AMBIGUO"; quantidade: number; mpPaymentIds: string[] }
  /** Não foi possível observar (rede, prazo, HTTP não-2xx, corpo ilegível). */
  | { resultado: "INDISPONIVEL"; motivo: string };

interface PagamentoBuscado {
  id?: number | string;
  external_reference?: string | null;
}

export async function buscarPagamentosPorReferenciaExterna(
  accessToken: string,
  externalReference: string,
): Promise<MpSearchResultado> {
  const referencia = String(externalReference || "").trim();
  if (!referencia) return { resultado: "INDISPONIVEL", motivo: "REFERENCIA_AUSENTE" };

  const url = new URL(MP_PAYMENTS_SEARCH_URL);
  // `sort` e `criteria` são obrigatórios conforme a referência oficial.
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");
  url.searchParams.set("external_reference", referencia);

  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_PAYMENT_SEARCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } catch {
    // Falha de observação NUNCA é rejeição: a operação continua inconclusiva
    // e a consulta pode ser repetida depois.
    return {
      resultado: "INDISPONIVEL",
      motivo: controller.signal.aborted ? "TIMEOUT" : "TRANSPORTE",
    };
  } finally {
    clearTimeout(prazo);
  }

  if (!response.ok) {
    return { resultado: "INDISPONIVEL", motivo: `HTTP_${response.status}` };
  }

  let corpo: { results?: PagamentoBuscado[] } | null = null;
  try {
    corpo = (await response.json()) as { results?: PagamentoBuscado[] };
  } catch {
    corpo = null;
  }
  if (!corpo || !Array.isArray(corpo.results)) {
    return { resultado: "INDISPONIVEL", motivo: "RESPOSTA_ILEGIVEL" };
  }

  // O filtro do provedor é tratado como dica, não como garantia: só contam
  // resultados cuja `external_reference` é EXATAMENTE a nossa, e que têm um
  // id utilizável. Nossa referência é única por tentativa por construção
  // (token_publico no SITE, idempotency_key da tentativa no ADMIN), então um
  // compatível é inequívoco — e mais de um é tratado como ambiguidade, nunca
  // resolvido por "o mais recente".
  const compativeis = corpo.results
    .filter((p) => String(p?.external_reference ?? "").trim() === referencia)
    .map((p) => String(p?.id ?? "").trim())
    .filter((id) => id && id !== "0");

  const distintos = [...new Set(compativeis)];
  if (distintos.length === 0) return { resultado: "NENHUM" };
  if (distintos.length > 1) {
    return { resultado: "AMBIGUO", quantidade: distintos.length, mpPaymentIds: distintos };
  }
  return { resultado: "UNICO", mpPaymentId: distintos[0] };
}
