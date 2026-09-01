import { useEffect, useState } from "react";

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

export function MoneyInput({
  valueCents,
  onValueCentsChange,
  minCents = 0,
  maxCents = 10_000_000,
  placeholder = "0,00"
}: Props) {
  const [text, setText] = useState(() => formatCents(valueCents));

  useEffect(() => {
    setText(formatCents(valueCents));
  }, [valueCents]);

  function applyCents(nextCents: number | null) {
    if (nextCents === null) {
      setText("");
      onValueCentsChange(null);
      return;
    }

    const clamped = Math.min(maxCents, Math.max(0, nextCents));
    setText(formatCents(clamped));
    onValueCentsChange(clamped);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={text}
      onFocus={event => event.currentTarget.select()}
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey) return;

        if (/^\d$/.test(event.key)) {
          event.preventDefault();
          const current = valueCents ?? 0;
          applyCents(current * 10 + Number(event.key));
          return;
        }

        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          const current = valueCents ?? 0;
          const next = Math.floor(current / 10);
          applyCents(next > 0 ? next : null);
        }
      }}
      onPaste={event => {
        event.preventDefault();
        const digits = event.clipboardData.getData("text").replace(/\D/g, "");
        if (!digits) return;
        applyCents(Number(digits));
      }}
      onChange={() => {}}
      onBlur={() => {
        if (valueCents !== null && valueCents < minCents) {
          applyCents(minCents);
        }
      }}
    />
  );
}
