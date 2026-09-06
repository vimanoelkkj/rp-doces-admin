import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./DateTimeField.module.css";

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
};

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

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
  ) return null;

  return date.toISOString();
}

function parseDateText(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function DateTimeField({ value, onChange }: Props) {
  const initial = partsFromIso(value);
  const [dateText, setDateText] = useState(initial.date);
  const [timeText, setTimeText] = useState(initial.time);
  const [invalid, setInvalid] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseDateText(initial.date) ?? new Date());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = partsFromIso(value);
    setDateText(next.date);
    setTimeText(next.time);
    setInvalid(false);
    const parsed = parseDateText(next.date);
    if (parsed) setViewDate(parsed);
  }, [value]);

  useEffect(() => {
    if (!calendarOpen) return;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setCalendarOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [calendarOpen]);

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
    setViewDate(now);
    setInvalid(false);
    onChange(now.toISOString());
  }

  function clear() {
    setDateText("");
    setTimeText("");
    setInvalid(false);
    onChange(null);
  }

  const days = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [viewDate]);

  const selected = parseDateText(dateText);
  const monthTitle = viewDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.fields}>
        <div className={styles.field}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="dd/mm/aaaa"
            aria-label="Data"
            value={dateText}
            onFocus={() => setCalendarOpen(true)}
            onChange={event => {
              const next = maskDate(event.target.value);
              setDateText(next);
              commit(next, timeText);
            }}
          />
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Abrir calendário"
            onClick={() => setCalendarOpen(open => !open)}
          >
            ▦
          </button>

          {calendarOpen && (
            <div className={styles.calendar} role="dialog" aria-label="Escolher data">
              <div className={styles.calendarHeader}>
                <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>‹</button>
                <strong>{monthTitle}</strong>
                <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>›</button>
              </div>
              <div className={styles.weekdays}>
                {WEEKDAYS.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
              </div>
              <div className={styles.days}>
                {days.map(day => {
                  const outside = day.getMonth() !== viewDate.getMonth();
                  const active = selected && day.toDateString() === selected.toDateString();
                  const today = day.toDateString() === new Date().toDateString();
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      className={`${outside ? styles.outside : ""} ${active ? styles.selected : ""} ${today ? styles.today : ""}`}
                      onClick={() => {
                        const next = `${pad(day.getDate())}/${pad(day.getMonth() + 1)}/${day.getFullYear()}`;
                        const nextTime = timeText || "00:00";
                        setDateText(next);
                        if (!timeText) setTimeText(nextTime);
                        setViewDate(day);
                        setCalendarOpen(false);
                        commit(next, nextTime);
                      }}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
