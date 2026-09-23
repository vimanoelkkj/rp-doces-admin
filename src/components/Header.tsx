import { useState, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./Header.css";

interface HeaderProps {
  cartCount?: number;
  minimal?: boolean;
  onCartClick?: () => void;
}

export default function Header({ minimal }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isCardapio = location.pathname === "/cardapio";
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
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

        {!minimal && (
          <div className="header-actions">
            <button
              className={`mobile-menu-btn ${menuOpen ? "mobile-menu-btn--open" : ""}`}
              aria-label="Menu"
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        )}
      </header>

      {createPortal(
        <>
          <div
            className={`mobile-menu-overlay ${menuOpen ? "mobile-menu-overlay--open" : ""}`}
            onClick={closeMenu}
          />
          <nav
            ref={menuRef}
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
            <div className="mobile-menu-links">
              <button onClick={() => handleMenuLink("#cardapio")}>
                Cardápio
              </button>
              <button onClick={() => handleMenuLink("#sobre")}>Sobre</button>
              <button onClick={() => handleMenuLink("#onde-estamos")}>
                Onde estamos
              </button>
              <button onClick={() => handleMenuLink("#contato")}>
                Contato
              </button>
            </div>
          </nav>
        </>,
        document.body,
      )}
    </>
  );
}
