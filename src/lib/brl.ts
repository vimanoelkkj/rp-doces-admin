const MAX_CENT_DIGITS = 11;

export function formatBrlInput(value: string): string {
  const rawDigits = value.replace(/\D/g, "").slice(0, MAX_CENT_DIGITS);
  const digits = rawDigits.padStart(3, "0");
  const integer = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  const cents = digits.slice(-2);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${grouped},${cents}`;
}

export function formatCentsAsBrlInput(cents: number): string {
  return formatBrlInput(String(Math.max(0, Math.trunc(cents))));
}

export function parseBrlInputToCents(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,2}(?:\.\d{3})*),\d{2}$/.test(value)) return null;
  const cents = Number(value.replace(/\./g, "").replace(",", ""));
  return Number.isSafeInteger(cents) ? cents : null;
}
