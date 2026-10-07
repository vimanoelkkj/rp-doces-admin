import { MP_ORDERS_URL } from "./mp/orders/client";

// Search proposes an ORD candidate; only the subsequent Orders GET is authoritative.
export const MP_PAYMENTS_SEARCH_URL = MP_ORDERS_URL;

// Mesmo prazo do GET autoritativo: é uma consulta, não uma criação.
export const MP_PAYMENT_SEARCH_TIMEOUT_MS = 5000;

export type MpSearchResultado =
  /** Exatamente um pagamento remoto compatível com a referência persistida. */
  | { resultado: "UNICO"; mpOrderId: string }
  /** Nenhum pagamento compatível. NÃO prova que o provedor não criou nada. */
  | { resultado: "NENHUM" }
  /** Mais de um candidato compatível: não decidimos qual é o nosso. */
  | { resultado: "AMBIGUO"; quantidade: number; mpOrderIds: string[] }
  /** Não foi possível observar (rede, prazo, HTTP não-2xx, corpo ilegível). */
  | { resultado: "INDISPONIVEL"; motivo: string };

interface PagamentoBuscado {
  id?: number | string;
  external_reference?: string | null;
}

export async function buscarPagamentosPorReferenciaExterna(
  accessToken: string,
  externalReference: string,
  createdAt: string
): Promise<MpSearchResultado> {
  const referencia = String(externalReference || "").trim();
  if (!referencia) return { resultado: "INDISPONIVEL", motivo: "REFERENCIA_AUSENTE" };

  const created = Date.parse(
    createdAt.includes("T") ? createdAt : `${createdAt.replace(" ", "T")}Z`
  );
  if (!Number.isFinite(created)) return { resultado: "INDISPONIVEL", motivo: "JANELA_AUSENTE" };
  const url = new URL(MP_PAYMENTS_SEARCH_URL);
  url.searchParams.set("begin_date", new Date(created - 5 * 60_000).toISOString());
  url.searchParams.set("end_date", new Date(created + 60 * 60_000).toISOString());
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "100");
  url.searchParams.set("type", "online");
  // Orders sorting and RFC 3339 bounds follow the provider search contract.
  url.searchParams.set("sort_by", "created_date");
  url.searchParams.set("sort_order", "asc");
  url.searchParams.set("external_reference", referencia);

  const controller = new AbortController();
  const prazo = setTimeout(() => controller.abort(), MP_PAYMENT_SEARCH_TIMEOUT_MS);

  // O prazo vale para a consulta INTEIRA, headers e corpo (como em fetchMpPayment):
  // um corpo que nunca termina também vira TIMEOUT, em vez de prender o chamador.
  let corpo: {
    data?: PagamentoBuscado[];
    paging?: { total?: number };
    pagination?: { total?: number };
  } | null = null;
  try {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal
      });
    } catch {
      // Falha de observação NUNCA é rejeição: a operação continua inconclusiva
      // e a consulta pode ser repetida depois.
      return {
        resultado: "INDISPONIVEL",
        motivo: controller.signal.aborted ? "TIMEOUT" : "TRANSPORTE"
      };
    }

    if (!response.ok) {
      return { resultado: "INDISPONIVEL", motivo: `HTTP_${response.status}` };
    }

    try {
      corpo = (await response.json()) as {
        data?: PagamentoBuscado[];
        paging?: { total?: number };
        pagination?: { total?: number };
      };
    } catch {
      // Abort durante o corpo é prazo estourado; qualquer outra falha segue ilegível.
      if (controller.signal.aborted) return { resultado: "INDISPONIVEL", motivo: "TIMEOUT" };
      corpo = null;
    }
  } finally {
    clearTimeout(prazo);
  }
  if (!corpo || !Array.isArray(corpo.data)) {
    return { resultado: "INDISPONIVEL", motivo: "RESPOSTA_ILEGIVEL" };
  }

  const total = Number(corpo.paging?.total ?? corpo.pagination?.total ?? corpo.data.length);
  if (!Number.isSafeInteger(total) || total < corpo.data.length || total > corpo.data.length)
    return { resultado: "INDISPONIVEL", motivo: "PAGINACAO_INCOMPLETA" };
  if (corpo.data.length >= 100)
    return { resultado: "INDISPONIVEL", motivo: "PAGINACAO_INCOMPLETA" };

  // O filtro do provedor é tratado como dica, não como garantia: só contam
  // resultados cuja `external_reference` é EXATAMENTE a nossa, e que têm um
  // id utilizável. Nossa referência é única por tentativa por construção
  // (token_publico no SITE, idempotency_key da tentativa no ADMIN), então um
  // compatível é inequívoco — e mais de um é tratado como ambiguidade, nunca
  // resolvido por "o mais recente".
  const compativeis = corpo.data
    .filter(p => String(p?.external_reference ?? "").trim() === referencia)
    .map(p => String(p?.id ?? "").trim())
    .filter(id => /^ORD[A-Za-z0-9]+$/.test(id));

  const distintos = [...new Set(compativeis)];
  if (distintos.length === 0) return { resultado: "NENHUM" };
  if (distintos.length > 1) {
    return { resultado: "AMBIGUO", quantidade: distintos.length, mpOrderIds: distintos };
  }
  return { resultado: "UNICO", mpOrderId: distintos[0] };
}
