import { useEffect, useRef, useState } from "react";
import styles from "./CategorySelect.module.css";

export type CategorySelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  options: CategorySelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
};

export function CategorySelect({ value, options, onChange, ariaLabel = "Categoria" }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`${styles.wrap} ${open ? styles.open : ""}`}>
      <select
        className={styles.native}
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span className={styles.label}>{selected?.label || "Selecione uma categoria"}</span>
        <span className={styles.chevron} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="m7 10 5 5 5-5" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className={styles.menu} role="listbox" aria-label={ariaLabel}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={`${styles.option} ${option.value === value ? styles.selected : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
