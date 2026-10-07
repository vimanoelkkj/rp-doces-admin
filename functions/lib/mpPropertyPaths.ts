// Observabilidade TEMPORÁRIA: caminho(s) da propriedade rejeitada pelo Mercado Pago, lidos só de
// `errors[].details` dos itens `unsupported_properties`. É o ÚNICO ponto em que um valor do corpo
// de erro pode ir ao log, e só passa o que tem forma estrita de caminho de propriedade (sem e-mail,
// espaço ou texto livre). `message` nunca é lido. Remover junto com `unsupportedPropertyPaths`
// (mpPost.ts, checkout.ts, requestContext.ts) quando a propriedade for identificada.

const MAX_PATHS = 8;
// Caminho de propriedade, ex.: transactions.payments[0].foo (até 128 caracteres).
const PROPERTY_PATH = /^[A-Za-z_][A-Za-z0-9_.[\]-]{0,127}$/;
const UNSUPPORTED_PROPERTIES_CODE = "unsupported_properties";
const PATH_KEYS = ["property", "field", "path"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Allowlist única do que pode sair em log: só strings com forma de caminho de propriedade, sem
 * repetição, até 8. Qualquer outra coisa (objeto, número, texto livre, e-mail) é descartada.
 */
export function sanitizePropertyPaths(raw: unknown): string[] {
  const paths: string[] = [];
  if (!Array.isArray(raw)) return paths;
  for (const value of raw) {
    if (typeof value !== "string" || !PROPERTY_PATH.test(value) || paths.includes(value)) continue;
    paths.push(value);
    if (paths.length === MAX_PATHS) break;
  }
  return paths;
}

// `details` pode ser o caminho em si (string) ou um objeto que o nomeia em property/field/path.
function pathCandidates(detail: unknown): unknown[] {
  if (typeof detail === "string") return [detail];
  return isRecord(detail) ? PATH_KEYS.map(key => detail[key]) : [];
}

/**
 * Caminhos rejeitados em `errors[].details` do corpo bruto de um 4xx. Cada item
 * `unsupported_properties` traz details como string, objeto ou array deles; o resto do corpo
 * (incluindo `message`) é ignorado. Nunca lança; sem caminho seguro devolve [].
 */
export function extractUnsupportedPropertyPaths(corpo: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(corpo);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.errors)) return [];

  const candidates: unknown[] = [];
  for (const item of parsed.errors) {
    if (!isRecord(item) || item.code !== UNSUPPORTED_PROPERTIES_CODE) continue;
    const details: unknown[] = Array.isArray(item.details) ? item.details : [item.details];
    for (const detail of details) candidates.push(...pathCandidates(detail));
  }
  return sanitizePropertyPaths(candidates);
}
