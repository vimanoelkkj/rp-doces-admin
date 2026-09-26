// Dia comercial da loja. A R&P Doces opera em Campinas/SP, então "hoje" e
// qualquer filtro/agrupamento diário seguem America/Sao_Paulo — nunca o
// timezone do servidor (UTC) nem o do navegador do administrador.
//
// Timestamps persistidos no D1 estão em UTC: `CURRENT_TIMESTAMP` grava
// "YYYY-MM-DD HH:MM:SS" em UTC, e timestamps ISO do Mercado Pago
// (`date_approved`, com offset explícito, p.ex. "-04:00") são normalizados
// para UTC pelas funções de data do SQLite. Os valores gravados não mudam;
// só a leitura converte para o dia da loja.

export const STORE_TIMEZONE = "America/Sao_Paulo";

// SQLite não conhece fusos IANA. O Brasil não tem horário de verão desde 2019
// (Decreto 9.772/2019), então America/Sao_Paulo é UTC-03:00 fixo. Este é o
// ÚNICO lugar com esse offset; se o horário de verão voltar, basta trocar
// aqui (e `storeToday`, que já usa o fuso IANA, continua correto).
const STORE_UTC_OFFSET_SQL_MODIFIER = "-3 hours";

// Expressão SQL da data comercial (YYYY-MM-DD) de um timestamp UTC.
export function storeDateSql(timestampSql: string): string {
  return `date(${timestampSql}, '${STORE_UTC_OFFSET_SQL_MODIFIER}')`;
}

// Data comercial atual da loja (YYYY-MM-DD). Fonte única do "hoje" do backend.
export function storeToday(now: Date = new Date()): string {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
