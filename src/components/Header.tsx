import { useState, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStoreTheme } from "../context/StoreThemeContext";
import "./Header.css";

interface HeaderProps {
  cartCount?: number;
  minimal?: boolean;
  onCartClick?: () => void;
}

export default function Header({ minimal }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useStoreTheme();
  const isCardapio = location.pathname === "/cardapio";
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const dragStartYRef = useRef(0);
  const dragOffsetRef = useRef(0);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const suppressHandleClickRef = useRef(false);
  const pendingHashRef = useRef<string | null>(null);

  const closeMenu = () => {
    dragOffsetRef.current = 0;
    dragPointerIdRef.current = null;
    dragMovedRef.current = false;
    setDragOffset(0);
    setIsDragging(false);
    setMenuOpen(false);
  };

  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        menuButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      window.scrollTo(0, scrollY);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) return;
    const targetHash = pendingHashRef.current;
    if (!targetHash) return;
    pendingHashRef.current = null;

    if (location.pathname !== "/") {
      navigate("/" + targetHash);
      return;
    }

    let innerFrameId: number;
    const frameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        const id = targetHash.replace(/^#/, "");
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
          window.history.replaceState(null, "", targetHash);
        }
      });
    });

    return () => {
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(innerFrameId);
    };
  }, [menuOpen, location.pathname, navigate]);

  useEffect(() => {
    if (location.pathname === "/" && location.hash) {
      const targetHash = location.hash;
      let innerFrameId: number;
      const frameId = requestAnimationFrame(() => {
        innerFrameId = requestAnimationFrame(() => {
          const id = targetHash.replace(/^#/, "");
          const el = document.getElementById(id);
          if (el) {
            el.scrollIntoView({ behavior: "smooth" });
          }
        });
      });

      return () => {
        cancelAnimationFrame(frameId);
        cancelAnimationFrame(innerFrameId);
      };
    }
  }, [location.pathname, location.hash]);

  const handleMenuLink = (hash: string) => {
    if (!menuOpen) return;
    pendingHashRef.current = hash;
    closeMenu();
  };

  const handleDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!menuOpen || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    dragStartYRef.current = event.clientY;
    dragOffsetRef.current = 0;
    dragPointerIdRef.current = event.pointerId;
    dragMovedRef.current = false;
    suppressHandleClickRef.current = false;
    setDragOffset(0);
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) return;

    const offset = Math.max(0, event.clientY - dragStartYRef.current);
    if (offset > 4) dragMovedRef.current = true;

    dragOffsetRef.current = offset;
    setDragOffset(offset);
  };

  const finishDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) => {
    if (dragPointerIdRef.current !== event.pointerId) return;

    const moved = dragMovedRef.current;
    const menuHeight = menuRef.current?.getBoundingClientRect().height ?? 320;
    const closeThreshold = Math.max(72, Math.min(120, menuHeight * 0.25));
    const shouldClose =
      !cancelled && moved && dragOffsetRef.current >= closeThreshold;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    suppressHandleClickRef.current = moved;
    dragPointerIdRef.current = null;
    dragMovedRef.current = false;
    setIsDragging(false);

    if (shouldClose) {
      closeMenu();
      return;
    }

    dragOffsetRef.current = 0;
    setDragOffset(0);
  };

  const handleDragHandleClick = () => {
    if (suppressHandleClickRef.current) {
      suppressHandleClickRef.current = false;
      return;
    }

    closeMenu();
  };

  return (
    <>
      <header className="header">
        <Link to="/" className="logo">
          <div className="logo-circle">
            <svg
              className="header-cake"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
            >
              <path
                d="M16.6672 17.5V10.8336C16.6672 10.3916 16.4916 9.96772 16.179 9.65518C15.8664 9.34263 15.4425 9.16704 15.0004 9.16704H4.99962C4.55755 9.16704 4.1336 9.34263 3.82101 9.65518C3.50842 9.96772 3.33282 10.3916 3.33282 10.8336V17.5M3.33282 13.3335C3.33282 13.3335 3.74952 12.5002 4.99962 12.5002C6.24972 12.5002 7.08312 14.1668 8.33322 14.1668C9.58332 14.1668 10.4167 12.5002 11.6668 12.5002C12.9169 12.5002 13.7503 14.1668 15.0004 14.1668C16.2505 14.1668 16.6672 13.3335 16.6672 13.3335M1.66602 17.5H18.334M5.83302 6.66716V9.16704M10 6.66716V9.16704M14.167 6.66716V9.16704"
                stroke="#634738"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle
                className="flame flame-1"
                cx="5.833"
                cy="3.334"
                r="1.2"
                fill="#d38b80"
              />
              <circle
                className="flame flame-2"
                cx="10"
                cy="3.334"
                r="1.2"
                fill="#d38b80"
              />
              <circle
                className="flame flame-3"
                cx="14.167"
                cy="3.334"
                r="1.2"
                fill="#d38b80"
              />
            </svg>
          </div>
          <span className="logo-text">R&amp;P Doces</span>
        </Link>

        {!isCardapio && !minimal && (
          <nav className="main-nav">
            <a href="#cardapio">Cardápio</a>
            <a href="#sobre">Sobre</a>
            <a href="#onde-estamos">Onde estamos</a>
            <a href="#contato">Contato</a>
          </nav>
        )}

        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={
              theme === "light" ? "Ativar modo escuro" : "Ativar modo claro"
            }
            title={theme === "light" ? "Modo escuro" : "Modo claro"}
          >
            {theme === "light" ? (
              <svg
                className="theme-toggle-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg
                className="theme-toggle-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

          {!minimal && (
            <button
              ref={menuButtonRef}
              type="button"
              className={`mobile-menu-btn ${menuOpen ? "mobile-menu-btn--open" : ""}`}
              aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu-drawer"
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </header>

      {createPortal(
        <>
          <div
            className={`mobile-menu-overlay ${menuOpen ? "mobile-menu-overlay--open" : ""}`}
            onClick={closeMenu}
          />
          <nav
            ref={menuRef}
            id="mobile-menu-drawer"
            aria-label="Menu principal"
            className={`mobile-menu ${menuOpen ? "mobile-menu--open" : ""} ${isDragging ? "mobile-menu--dragging" : ""}`}
            style={
              menuOpen && dragOffset > 0
                ? { transform: `translateY(${dragOffset}px)` }
                : undefined
            }
          >
            <button
              type="button"
              className="mobile-menu-close"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={(event) => finishDrag(event)}
              onPointerCancel={(event) => finishDrag(event, true)}
              onClick={handleDragHandleClick}
              aria-label="Fechar menu"
              title="Arraste para baixo para fechar"
            />
            <div className="mobile-menu-mini-wave" aria-hidden="true">
              <svg width="56" height="6" viewBox="0 0 56 6" fill="none">
                <path
                  d="M1 3C9 1 18 5 28 3C38 1 47 5 55 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="mobile-menu-links">
              <button
                type="button"
                className="mobile-menu-link"
                onClick={() => handleMenuLink("#cardapio")}
              >
                <span className="mobile-menu-link-content">
                  <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                    <svg
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

              <button
                type="button"
                className="mobile-menu-link"
                onClick={() => handleMenuLink("#sobre")}
              >
                <span className="mobile-menu-link-content">
                  <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                    <svg
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
                onClick={() => handleMenuLink("#onde-estamos")}
              >
                <span className="mobile-menu-link-content">
                  <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                    <svg
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

              <button
                type="button"
                className="mobile-menu-link"
                onClick={() => handleMenuLink("#contato")}
              >
                <span className="mobile-menu-link-content">
                  <span className="mobile-menu-link-icon-wrap" aria-hidden="true">
                    <svg
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
        </>,
        document.body,
      )}
    </>
  );
}
