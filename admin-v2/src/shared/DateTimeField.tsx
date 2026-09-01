import { useEffect, useState } from "react";
import styles from "./DateTimeField.module.css";

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function partsFromIso(value: string | null): { date: string; time: string } {
  if (!value) return { date: "", time: "" };

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };

  return {
    date: `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  };
}

function maskDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function maskTime(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function toIso(dateText: string, timeText: string): string | null {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dateText);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeText);
  if (!dateMatch || !timeMatch) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date.toISOString();
}

export function DateTimeField({ value, onChange }: Props) {
  const initial = partsFromIso(value);
  const [dateText, setDateText] = useState(initial.date);
  const [timeText, setTimeText] = useState(initial.time);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const next = partsFromIso(value);
    setDateText(next.date);
    setTimeText(next.time);
    setInvalid(false);
  }, [value]);

  function commit(nextDate: string, nextTime: string) {
    if (!nextDate && !nextTime) {
      setInvalid(false);
      onChange(null);
      return;
    }

    const nextValue = toIso(nextDate, nextTime);
    if (!nextValue) {
      setInvalid(nextDate.length === 10 && nextTime.length === 5);
      return;
    }

    setInvalid(false);
    onChange(nextValue);
  }

  function useNow() {
    const now = new Date();
    const nextDate = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const nextTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setDateText(nextDate);
    setTimeText(nextTime);
    setInvalid(false);
    onChange(now.toISOString());
  }

  function clear() {
    setDateText("");
    setTimeText("");
    setInvalid(false);
    onChange(null);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="dd/mm/aaaa"
            aria-label="Data"
            value={dateText}
            onChange={event => {
              const next = maskDate(event.target.value);
              setDateText(next);
              commit(next, timeText);
            }}
          />
          <span className={styles.icon} aria-hidden="true">▦</span>
        </div>

        <div className={styles.field}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="hh:mm"
            aria-label="Hora"
            value={timeText}
            onChange={event => {
              const next = maskTime(event.target.value);
              setTimeText(next);
              commit(dateText, next);
            }}
          />
          <span className={styles.icon} aria-hidden="true">◷</span>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={useNow}>Agora</button>
        {(dateText || timeText) && <button type="button" onClick={clear}>Limpar</button>}
      </div>

      {invalid && <small className={styles.error}>Informe uma data e hora válidas.</small>}
    </div>
  );
}
