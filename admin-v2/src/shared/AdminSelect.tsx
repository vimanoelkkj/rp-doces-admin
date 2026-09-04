import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { createPortal } from "react-dom";

export type AdminSelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  value: T;
  options: ReadonlyArray<AdminSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
};

type MenuPosition = Pick<CSSProperties, "top" | "bottom" | "left" | "width" | "maxHeight">;

function menuPosition(trigger: HTMLElement, menu: HTMLElement | null): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const viewportPadding = mobile ? 12 : 10;
  const gap = 8;
  const availableWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
  const width = Math.min(Math.max(rect.width, mobile ? 220 : 200), availableWidth);
  const measuredHeight = menu?.scrollHeight || 260;
  const wantedHeight = Math.min(measuredHeight, window.innerHeight * (mobile ? 0.58 : 0.5));
  const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
  const roomAbove = rect.top - viewportPadding;
  const placeAbove = roomBelow < Math.min(wantedHeight, 240) && roomAbove > roomBelow;
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
  );
  const availableHeight = Math.max(120, (placeAbove ? roomAbove : roomBelow) - gap);

  return {
    width,
    left,
    maxHeight: Math.min(wantedHeight, availableHeight),
    ...(placeAbove
      ? { top: "auto", bottom: Math.max(viewportPadding, window.innerHeight - rect.top + gap) }
      : { top: Math.min(window.innerHeight - viewportPadding, rect.bottom + gap), bottom: "auto" })
  };
}

export function AdminSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  style,
  disabled = false
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const current = options.find(option => option.value === value) || options[0];

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPosition(menuPosition(trigger, menuRef.current));
  }, []);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(frame);
  }, [open, options, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const reposition = () => updatePosition();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };

    window.addEventListener("resize", reposition, { passive: true });
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", keydown);
    };
  }, [close, open, updatePosition]);

  function openFromKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    if (!disabled) setOpen(true);
  }

  function choose(option: AdminSelectOption<T>) {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        style={style}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen(currentOpen => !currentOpen)}
        onKeyDown={openFromKeyboard}
      >
        <span>{current?.label || "Selecionar"}</span>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            color: "var(--muted)",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform .15s ease"
          }}
        >
          <path d="m7 9 5 5 5-5" />
        </svg>
      </button>

      {open
        ? createPortal(
            <div className="rp-mobile-filter-overlay">
              <button
                className="rp-mobile-filter-backdrop"
                type="button"
                aria-label="Fechar seletor"
                onClick={() => close(true)}
              />
              <div
                ref={menuRef}
                id={listboxId}
                className="rp-mobile-filter-menu"
                role="listbox"
                aria-label={ariaLabel}
                style={position}
              >
                {options.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className="rp-mobile-filter-option"
                    role="option"
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    onClick={() => choose(option)}
                  >
                    <span>{option.label}</span>
                    <span className="rp-mobile-filter-radio" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
