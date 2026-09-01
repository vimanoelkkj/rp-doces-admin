import { useEffect, useRef, useState } from "react";

type Props = {
  valueCents: number | null;
  onValueCentsChange: (value: number | null) => void;
  minCents?: number;
  maxCents?: number;
  placeholder?: string;
};

function formatCents(valueCents: number | null): string {
  if (valueCents === null) return "";

  return (valueCents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseMoneyInput(value: string): number | null {
  const sanitized = value.replace(/[^\d,.]/g, "");
  if (!sanitized) return null;

  const comma = sanitized.lastIndexOf(",");
  const dot = sanitized.lastIndexOf(".");
  const separator = Math.max(comma, dot);

  if (separator < 0) {
    const reais = Number(sanitized.replace(/\D/g, ""));
    return Number.isFinite(reais) ? reais * 100 : null;
  }

  const integerDigits = sanitized.slice(0, separator).replace(/\D/g, "") || "0";
  const decimalDigits = sanitized.slice(separator + 1).replace(/\D/g, "").slice(0, 2);
  const reais = Number(integerDigits);
  const centavos = Number((decimalDigits + "00").slice(0, 2));

  if (!Number.isFinite(reais) || !Number.isFinite(centavos)) return null;
  return reais * 100 + centavos;
}

export function MoneyInput({
  valueCents,
  onValueCentsChange,
  minCents = 0,
  maxCents = 10_000_000,
  placeholder = "0,00"
}: Props) {
  const [text, setText] = useState(() => formatCents(valueCents));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(formatCents(valueCents));
  }, [valueCents]);

  function commit(raw: string) {
    const parsed = parseMoneyInput(raw);
    if (parsed === null) {
      onValueCentsChange(null);
      return;
    }

    onValueCentsChange(Math.min(maxCents, Math.max(minCents, parsed)));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={event => {
        const next = event.target.value.replace(/[^\d,.]/g, "");
        setText(next);
        commit(next);
      }}
      onBlur={() => {
        focusedRef.current = false;
        setText(formatCents(valueCents));
      }}
    />
  );
}
