import { useEffect, useRef, useState } from "react";
import styles from "./ManualOrderSelect.module.css";

export type ManualOrderSelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  id?: string;
  value: T;
  options: Array<ManualOrderSelectOption<T>>;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (value: T) => void;
};

export function ManualOrderSelect<T extends string>({
  id,
  value,
  options,
  disabled = false,
  ariaLabel,
  onChange
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = options.find(option => option.value === value) ?? options[0];

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={rootRef} className={`${styles.root} ${open ? styles.open : ""}`}>
      <button
        id={id}
        className={styles.trigger}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(currentOpen => !currentOpen)}
      >
        <span>{current?.label ?? "Selecionar"}</span>
        <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 10 4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div className={styles.options} role="listbox" aria-label={ariaLabel}>
          {options.map(option => (
            <button
              key={option.value}
              className={`${styles.option} ${option.value === value ? styles.selected : ""}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
