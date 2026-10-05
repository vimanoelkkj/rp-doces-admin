import type React from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface MobileMenuDrawerProps {
  menuOpen: boolean;
  menuRef: React.RefObject<HTMLElement>;
  menuButtonRef: React.RefObject<HTMLButtonElement>;
  dragOffset: number;
  isDragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragHandleClick: () => void;
  onClose: () => void;
  onNavigate: (hash: string) => void;
}

export default function MobileMenuDrawer({
  menuOpen,
  menuRef,
  menuButtonRef,
  dragOffset,
  isDragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDragHandleClick,
  onClose,
  onNavigate
}: MobileMenuDrawerProps) {
  return (
    <>
      <button
        type="button"
        className={`mobile-menu-overlay ${menuOpen ? "mobile-menu-overlay--open" : ""}`}
        onClick={() => {
          onClose();
          menuButtonRef.current?.focus();
        }}
        aria-label="Fechar menu"
      />
      <nav
        ref={menuRef}
        id="mobile-menu-drawer"
        aria-label="Menu principal"
        className={`mobile-menu ${menuOpen ? "mobile-menu--open" : ""} ${isDragging ? "mobile-menu--dragging" : ""}`}
        style={
          menuOpen && dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined
        }
      >
        <button
          type="button"
          className="mobile-menu-close"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={onDragHandleClick}
          aria-label="Fechar menu"
          title="Arraste para baixo para fechar"
        >
          <svg width="56" height="6" viewBox="0 0 56 6" fill="none" aria-hidden="true">
            <path
              d="M1 3C9 1 18 5 28 3C38 1 47 5 55 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="mobile-menu-links">
          <button
            type="button"
            className="mobile-menu-link"
            onClick={() => onNavigate("#cardapio")}
          >
            <span className="mobile-menu-link-content">
              <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  className="mobile-menu-link-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 11l1.5 9h11l1.5-9H5z" />
                  <path d="M4 11c0-2.2 1.8-4 4-4 1 0 2 .5 2.8 1.2.7-.7 1.8-1.2 2.8-1.2 2.2 0 4 1.8 4 4" />
                  <circle cx="12" cy="4.5" r="1.5" fill="currentColor" stroke="none" />
                  <path d="M9 14v4M12 14v4M15 14v4" strokeWidth="1.5" />
                </svg>
              </span>
              <span className="mobile-menu-link-text">
                Cardápio
                <svg
                  className="mobile-menu-underline"
                  width="42"
                  height="6"
                  viewBox="0 0 42 6"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1.5 3.5C10 1.5 24 4.8 40.5 2.2"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </button>

          <button type="button" className="mobile-menu-link" onClick={() => onNavigate("#sobre")}>
            <span className="mobile-menu-link-content">
              <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  className="mobile-menu-link-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </span>
              <span className="mobile-menu-link-text">
                Sobre
                <svg
                  className="mobile-menu-underline"
                  width="42"
                  height="6"
                  viewBox="0 0 42 6"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1.5 3.5C10 1.5 24 4.8 40.5 2.2"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </button>

          <button
            type="button"
            className="mobile-menu-link"
            onClick={() => onNavigate("#onde-estamos")}
          >
            <span className="mobile-menu-link-content">
              <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  className="mobile-menu-link-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <span className="mobile-menu-link-text">
                Onde estamos
                <svg
                  className="mobile-menu-underline"
                  width="42"
                  height="6"
                  viewBox="0 0 42 6"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1.5 3.5C10 1.5 24 4.8 40.5 2.2"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </button>

          <button type="button" className="mobile-menu-link" onClick={() => onNavigate("#contato")}>
            <span className="mobile-menu-link-content">
              <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  className="mobile-menu-link-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </span>
              <span className="mobile-menu-link-text">
                Contato
                <svg
                  className="mobile-menu-underline"
                  width="42"
                  height="6"
                  viewBox="0 0 42 6"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1.5 3.5C10 1.5 24 4.8 40.5 2.2"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
