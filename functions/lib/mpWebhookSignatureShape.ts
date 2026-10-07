// Observabilidade TEMPORÁRIA do 401 do webhook do Mercado Pago: descreve só a ESTRUTURA da
// entrada da validação de assinatura (o que existe, tamanho/formato/caixa do data.id e quais
// partes entram no manifest). Nunca o secret, o v1, o hash esperado/recebido, o x-signature ou o
// x-request-id brutos, o data.id, o corpo, a query, headers ou qualquer PII. Só é chamada quando
// a assinatura FALHA. Remover junto com `webhookSignature` (webhooks/mercadopago.ts,
// requestContext.ts) quando o 401 estiver diagnosticado.

const SEGMENT_NAMES = ["ts", "v1"] as const;
const DATA_ID_SOURCES = ["query-data.id", "query-data_id", "body", "none"] as const;
const DATA_ID_FORMATS = ["order", "numeric", "other", "empty"] as const;
const DATA_ID_CASES = ["lower", "upper", "mixed", "neutral"] as const;

type SignatureSegmentName = (typeof SEGMENT_NAMES)[number];
export type WebhookDataIdSource = (typeof DATA_ID_SOURCES)[number];
type WebhookDataIdFormat = (typeof DATA_ID_FORMATS)[number];
type WebhookDataIdCase = (typeof DATA_ID_CASES)[number];

export interface WebhookSignatureShape {
  readonly hasSignature: boolean;
  readonly hasRequestId: boolean;
  readonly hasTs: boolean;
  readonly hasV1: boolean;
  readonly signatureSegments: number;
  readonly signatureSegmentNames: readonly SignatureSegmentName[];
  readonly dataIdSource: WebhookDataIdSource;
  readonly dataIdLength: number;
  readonly dataIdFormat: WebhookDataIdFormat;
  readonly dataIdCase: WebhookDataIdCase;
  readonly manifestParts: {
    readonly id: boolean;
    readonly requestId: boolean;
    readonly ts: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return allowed.some(item => item === value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function dataIdFormat(dataId: string): WebhookDataIdFormat {
  if (!dataId) return "empty";
  if (/^ORD[A-Za-z0-9]+$/.test(dataId)) return "order";
  return /^\d+$/.test(dataId) ? "numeric" : "other";
}

// Só as letras contam: sem letras é "neutral".
function dataIdCase(dataId: string): WebhookDataIdCase {
  const letters = dataId.replace(/[^A-Za-z]/g, "");
  if (!letters) return "neutral";
  if (letters === letters.toLowerCase()) return "lower";
  return letters === letters.toUpperCase() ? "upper" : "mixed";
}

/**
 * Descreve a entrada da validação (headers + o data.id que foi usado) sem expor nenhum valor.
 * Usa o mesmo parsing de `validateMpWebhookSignature` (paymentSync/webhook.ts), só para saber o
 * que existe; não lê o corpo nem altera a request.
 */
export function describeWebhookSignatureInput(
  request: Request,
  dataId: string,
  dataIdSource: WebhookDataIdSource
): WebhookSignatureShape {
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const segments = signature ? signature.split(",") : [];
  const parts = Object.fromEntries(segments.map(part => part.trim().split("=")));
  const hasTs = Boolean(parts.ts);
  return Object.freeze({
    hasSignature: signature !== "",
    hasRequestId: requestId !== "",
    hasTs,
    hasV1: Boolean(parts.v1),
    signatureSegments: segments.length,
    signatureSegmentNames: SEGMENT_NAMES.filter(name => Object.hasOwn(parts, name)),
    dataIdSource,
    dataIdLength: dataId.length,
    dataIdFormat: dataIdFormat(dataId),
    dataIdCase: dataIdCase(dataId),
    manifestParts: Object.freeze({ id: dataId !== "", requestId: requestId !== "", ts: hasTs })
  });
}

/**
 * Allowlist única do que pode sair em log: reconstrói o objeto campo a campo (booleanos, enums
 * fechados, contagens inteiras e nomes de segmento só entre ts/v1). Qualquer campo extra é
 * descartado e qualquer valor fora do domínio invalida o objeto inteiro (undefined).
 */
export function sanitizeWebhookSignatureShape(raw: unknown): WebhookSignatureShape | undefined {
  if (!isRecord(raw) || !isRecord(raw.manifestParts)) return undefined;
  const { hasSignature, hasRequestId, hasTs, hasV1 } = raw;
  const { id, requestId, ts } = raw.manifestParts;
  const { signatureSegments, dataIdSource, dataIdLength, dataIdFormat, dataIdCase } = raw;
  if (
    typeof hasSignature !== "boolean" ||
    typeof hasRequestId !== "boolean" ||
    typeof hasTs !== "boolean" ||
    typeof hasV1 !== "boolean" ||
    typeof id !== "boolean" ||
    typeof requestId !== "boolean" ||
    typeof ts !== "boolean" ||
    !isCount(signatureSegments) ||
    !isCount(dataIdLength) ||
    !oneOf(DATA_ID_SOURCES, dataIdSource) ||
    !oneOf(DATA_ID_FORMATS, dataIdFormat) ||
    !oneOf(DATA_ID_CASES, dataIdCase)
  ) {
    return undefined;
  }
  const names = Array.isArray(raw.signatureSegmentNames) ? raw.signatureSegmentNames : [];
  return Object.freeze({
    hasSignature,
    hasRequestId,
    hasTs,
    hasV1,
    signatureSegments,
    signatureSegmentNames: SEGMENT_NAMES.filter(name => names.includes(name)),
    dataIdSource,
    dataIdLength,
    dataIdFormat,
    dataIdCase,
    manifestParts: Object.freeze({ id, requestId, ts })
  });
}
