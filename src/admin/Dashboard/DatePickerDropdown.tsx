import { useEffect, useRef, useState } from "react";

interface DatePickerDropdownProps {
  value: Date;
  onChange: (date: Date) => void;
  // Dia comercial atual da loja; sem ele, cai no relógio local.
  today?: Date;
}

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isAfterToday(d: Date, today: Date) {
  const dOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return dOnly.getTime() > todayOnly.getTime();
}

function formatDisplay(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function buildMonthGrid(viewYear: number, viewMonth: number): Date[] {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

const IconCalendar = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="12" height="11" rx="1.5" />
    <path d="M5 1.5v3M11 1.5v3M2 7h12" />
  </svg>
);

const IconChevron = ({ direction }: { direction: "left" | "right" }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {direction === "left" ? (
      <polyline points="9,2 4,7 9,12" />
    ) : (
      <polyline points="5,2 10,7 5,12" />
    )}
  </svg>
);

export { formatDisplay };

export default function DatePickerDropdown({
  value,
  onChange,
  today: todayProp,
}: DatePickerDropdownProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setViewYear(value.getFullYear());
    setViewMonth(value.getMonth());
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const goToPrevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const goToNextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const days = buildMonthGrid(viewYear, viewMonth);
  const today = todayProp ?? new Date();
  const isViewingCurrentOrFutureMonth =
    viewYear > today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth >= today.getMonth());

  return (
    <div
      className={`dash-date-dropdown${open ? " dash-date-dropdown--open" : ""}`}
      ref={ref}
    >
      <button
        type="button"
        className="dash-date-picker"
        onClick={() => setOpen((o) => !o)}
      >
        <IconCalendar />
        <span>{formatDisplay(value)}</span>
      </button>

      {open && (
        <div className="dash-date-panel">
          <div className="dash-date-nav">
            <button
              type="button"
              className="dash-date-nav-btn"
              onClick={goToPrevMonth}
            >
              <IconChevron direction="left" />
            </button>
            <span className="dash-date-month-label">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              className="dash-date-nav-btn"
              onClick={goToNextMonth}
              disabled={isViewingCurrentOrFutureMonth}
            >
              <IconChevron direction="right" />
            </button>
          </div>

          <div className="dash-date-weekdays">
            {WEEKDAYS.map((w, i) => (
              <span className="dash-date-weekday" key={i}>
                {w}
              </span>
            ))}
          </div>

          <div className="dash-date-grid">
            {days.map((d, i) => {
              const outsideMonth = d.getMonth() !== viewMonth;
              const isToday = isSameDay(d, today);
              const isSelected = isSameDay(d, value);
              const isFuture = isAfterToday(d, today);
              return (
                <button
                  type="button"
                  key={i}
                  className={[
                    "dash-date-day",
                    outsideMonth ? "dash-date-day--muted" : "",
                    isToday ? "dash-date-day--today" : "",
                    isSelected ? "dash-date-day--selected" : "",
                    isFuture ? "dash-date-day--disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={isFuture}
                  onClick={() => {
                    onChange(d);
                    setOpen(false);
                  }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
