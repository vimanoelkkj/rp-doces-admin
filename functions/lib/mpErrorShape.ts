// Observabilidade TEMPORÁRIA do corpo de erro 4xx do Mercado Pago: descreve somente a
// ESTRUTURA (nomes de chaves, tipos e contagens) para descobrir o formato real do erro.
// Nunca valores — nem `message`, ids, payer, e-mail, QR ou qualquer parte do payload.
// Remover junto com `errorShape` e `detailsShape` (mpPost.ts, checkout.ts, requestContext.ts)
// quando o formato estiver mapeado.

const FIELD_TYPES = ["string", "number", "boolean", "object", "array", "null"] as const;

type MpErrorFieldType = (typeof FIELD_TYPES)[number];
type MpErrorBodyType = MpErrorFieldType | "invalid_json";

// Campos de topo cujo conteúdo também é descrito: tamanho (arrays), nomes das chaves dos
// itens (arrays de objetos) ou nomes das chaves (objetos).
const STRUCTURED_FIELDS = ["cause", "details", "errors", "error", "data", "metadata"] as const;
type StructuredField = (typeof STRUCTURED_FIELDS)[number];

type StructuredDetail = {
  [K in `${StructuredField}Length`]?: number;
} & {
  [K in `${StructuredField}ItemKeys` | `${StructuredField}Keys`]?: readonly string[];
};

export type MpErrorShape = Readonly<
  {
    bodyType: MpErrorBodyType;
    topLevelKeys: readonly string[];
    fieldTypes: Readonly<Record<string, MpErrorFieldType>>;
  } & StructuredDetail
>;

const MAX_KEYS = 32;
const MAX_ITEMS_SCANNED = 20;
// Só nomes com cara de identificador de schema: chaves dinâmicas que carreguem valores
// (e-mail, ids numéricos, texto livre) não passam.
const SAFE_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldType(value: unknown): value is MpErrorFieldType {
  return FIELD_TYPES.some(type => type === value);
}

function isBodyType(value: unknown): value is MpErrorBodyType {
  return value === "invalid_json" || isFieldType(value);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

function safeNames(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const names: string[] = [];
  for (const name of raw) {
    if (typeof name !== "string" || !SAFE_KEY_NAME.test(name) || names.includes(name)) continue;
    names.push(name);
    if (names.length === MAX_KEYS) break;
  }
  return names;
}

/**
 * Allowlist única da forma que pode sair em log: reconstrói o objeto campo a campo e
 * descarta tudo que não seja nome seguro, tipo conhecido ou contagem inteira. Objeto
 * arbitrário (ex.: o próprio corpo do erro) não passa — sem `bodyType` válido vira undefined.
 */
export function sanitizeMpErrorShape(raw: unknown): MpErrorShape | undefined {
  if (!isRecord(raw)) return undefined;
  const bodyType = raw.bodyType;
  if (!isBodyType(bodyType)) return undefined;

  const typedFields: [string, MpErrorFieldType][] = [];
  for (const [name, type] of Object.entries(isRecord(raw.fieldTypes) ? raw.fieldTypes : {})) {
    if (typedFields.length === MAX_KEYS) break;
    if (SAFE_KEY_NAME.test(name) && isFieldType(type)) typedFields.push([name, type]);
  }

  const detail: StructuredDetail = {};
  for (const field of STRUCTURED_FIELDS) {
    const length = raw[`${field}Length`];
    if (typeof length === "number" && Number.isSafeInteger(length) && length >= 0) {
      detail[`${field}Length` as const] = length;
    }
    const itemKeys = safeNames(raw[`${field}ItemKeys`]);
    if (itemKeys) detail[`${field}ItemKeys` as const] = itemKeys;
    const keys = safeNames(raw[`${field}Keys`]);
    if (keys) detail[`${field}Keys` as const] = keys;
  }

  return Object.freeze({
    bodyType,
    topLevelKeys: safeNames(raw.topLevelKeys) ?? [],
    fieldTypes: Object.fromEntries(typedFields),
    ...detail
  });
}

/**
 * Descreve a estrutura do corpo de erro (texto bruto da resposta). Corpo vazio não tem o que
 * descrever (undefined). Nunca lança: JSON ilegível vira `bodyType: "invalid_json"`.
 */
export function describeMpErrorShape(corpo: string): MpErrorShape | undefined {
  if (!corpo) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(corpo);
  } catch {
    return sanitizeMpErrorShape({ bodyType: "invalid_json" });
  }
  if (!isRecord(parsed)) return sanitizeMpErrorShape({ bodyType: typeOf(parsed) });

  // Candidato bruto (só nomes, tipos e contagens): o que sai daqui passa pela allowlist acima.
  const candidate: Record<string, unknown> = {
    bodyType: "object",
    topLevelKeys: Object.keys(parsed),
    fieldTypes: Object.fromEntries(
      Object.entries(parsed).map(([name, value]) => [name, typeOf(value)])
    )
  };
  for (const field of STRUCTURED_FIELDS) {
    const value = parsed[field];
    if (Array.isArray(value)) {
      candidate[`${field}Length`] = value.length;
      const itemKeys = value
        .slice(0, MAX_ITEMS_SCANNED)
        .flatMap(item => (isRecord(item) ? Object.keys(item) : []));
      if (itemKeys.length > 0) candidate[`${field}ItemKeys`] = itemKeys;
    } else if (isRecord(value)) {
      candidate[`${field}Keys`] = Object.keys(value);
    }
  }
  return sanitizeMpErrorShape(candidate);
}

// --- Estrutura de `errors[].details` dos itens `unsupported_properties` ---------------------
// O MP lista ali a propriedade rejeitada, mas o formato real é desconhecido. Só tipos, nomes de
// chaves e tamanhos — nunca o conteúdo de uma string. No máximo 2 níveis abaixo de `details`,
// 20 itens inspecionados e 32 chaves por nível.

const UNSUPPORTED_PROPERTIES_CODE = "unsupported_properties";

export interface MpDetailsShape {
  readonly type: MpErrorFieldType;
  // Arrays: tamanho, tipos dos itens e, só em `details`, o formato dos itens objeto/array.
  readonly length?: number;
  readonly itemTypes?: readonly MpErrorFieldType[];
  readonly objectItemKeys?: readonly string[];
  readonly objectItemFieldTypes?: Readonly<Record<string, MpErrorFieldType>>;
  readonly arrayItemLengths?: readonly number[];
  // Objetos: chaves, tipo de cada uma e, só em `details`, o formato dos filhos object/array.
  readonly keys?: readonly string[];
  readonly fieldTypes?: Readonly<Record<string, MpErrorFieldType>>;
  readonly nested?: Readonly<Record<string, MpDetailsShape>>;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeFieldTypes(raw: unknown): Record<string, MpErrorFieldType> | undefined {
  if (!isRecord(raw)) return undefined;
  const typed: [string, MpErrorFieldType][] = [];
  for (const [name, type] of Object.entries(raw)) {
    if (typed.length === MAX_KEYS) break;
    if (SAFE_KEY_NAME.test(name) && isFieldType(type)) typed.push([name, type]);
  }
  return Object.fromEntries(typed);
}

function sanitizeNestedDetails(raw: unknown): Record<string, MpDetailsShape> | undefined {
  if (!isRecord(raw)) return undefined;
  const children: [string, MpDetailsShape][] = [];
  for (const [name, child] of Object.entries(raw)) {
    if (children.length === MAX_KEYS) break;
    const node = SAFE_KEY_NAME.test(name) ? sanitizeDetailsNode(child, false) : undefined;
    if (node) children.push([name, node]);
  }
  return Object.fromEntries(children);
}

function sanitizeDetailsNode(raw: unknown, allowNested: boolean): MpDetailsShape | undefined {
  if (!isRecord(raw)) return undefined;
  const type = raw.type;
  if (!isFieldType(type)) return undefined;

  const node: { -readonly [K in keyof MpDetailsShape]: MpDetailsShape[K] } = { type };
  if (isCount(raw.length)) node.length = raw.length;
  if (Array.isArray(raw.itemTypes))
    node.itemTypes = [...new Set(raw.itemTypes.filter(isFieldType))];
  const objectItemKeys = safeNames(raw.objectItemKeys);
  if (objectItemKeys?.length) node.objectItemKeys = objectItemKeys;
  const objectItemFieldTypes = safeFieldTypes(raw.objectItemFieldTypes);
  if (objectItemFieldTypes && Object.keys(objectItemFieldTypes).length > 0) {
    node.objectItemFieldTypes = objectItemFieldTypes;
  }
  if (Array.isArray(raw.arrayItemLengths)) {
    const lengths = raw.arrayItemLengths.filter(isCount).slice(0, MAX_ITEMS_SCANNED);
    if (lengths.length > 0) node.arrayItemLengths = lengths;
  }
  const keys = safeNames(raw.keys);
  if (keys) node.keys = keys;
  const fieldTypes = safeFieldTypes(raw.fieldTypes);
  if (fieldTypes) node.fieldTypes = fieldTypes;
  const nested = allowNested ? sanitizeNestedDetails(raw.nested) : undefined;
  if (nested && Object.keys(nested).length > 0) node.nested = nested;
  return Object.freeze(node);
}

/**
 * Allowlist única da estrutura de `details` que pode ir a log (mesmo papel de
 * `sanitizeMpErrorShape`): tipo conhecido, nomes seguros, contagens inteiras, no máximo um nível
 * de `nested`. Objeto arbitrário (ex.: o próprio `details`) não passa — sem `type` válido vira
 * undefined.
 */
export function sanitizeMpDetailsShape(raw: unknown): MpDetailsShape | undefined {
  return sanitizeDetailsNode(raw, true);
}

// Candidato bruto de um nó (só tipos, nomes e tamanhos). `depth` 0 é o próprio `details`;
// 1 é um filho direto, de que só se descreve o primeiro nível. Nada abaixo disso é inspecionado.
function detailsCandidate(value: unknown, depth: 0 | 1): Record<string, unknown> {
  const candidate: Record<string, unknown> = { type: typeOf(value) };
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, MAX_ITEMS_SCANNED);
    candidate.length = value.length;
    candidate.itemTypes = items.map(item => typeOf(item));
    if (depth === 0) {
      // Tipo de cada campo = o da primeira ocorrência entre os itens objeto.
      const fieldTypes = new Map<string, string>();
      for (const item of items.filter(isRecord)) {
        for (const [name, child] of Object.entries(item)) {
          if (!fieldTypes.has(name)) fieldTypes.set(name, typeOf(child));
        }
      }
      if (fieldTypes.size > 0) {
        candidate.objectItemKeys = [...fieldTypes.keys()];
        candidate.objectItemFieldTypes = Object.fromEntries(fieldTypes);
      }
      const lengths = items.filter(Array.isArray).map(item => item.length);
      if (lengths.length > 0) candidate.arrayItemLengths = lengths;
    }
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    candidate.keys = entries.map(([name]) => name);
    candidate.fieldTypes = Object.fromEntries(
      entries.map(([name, child]) => [name, typeOf(child)])
    );
    if (depth === 0) {
      candidate.nested = Object.fromEntries(
        entries
          .filter(([, child]) => typeof child === "object" && child !== null)
          .map(([name, child]) => [name, detailsCandidate(child, 1)])
      );
    }
  }
  return candidate;
}

/**
 * Descreve a estrutura de `errors[].details` do primeiro item `unsupported_properties` que tenha
 * `details` (texto bruto da resposta). Nunca lança; sem esse item, ou com JSON ilegível, devolve
 * undefined.
 */
export function describeUnsupportedDetailsShape(corpo: string): MpDetailsShape | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(corpo);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.errors)) return undefined;
  for (const item of parsed.errors) {
    if (!isRecord(item) || item.code !== UNSUPPORTED_PROPERTIES_CODE) continue;
    if (!Object.hasOwn(item, "details")) continue;
    return sanitizeMpDetailsShape(detailsCandidate(item.details, 0));
  }
  return undefined;
}
