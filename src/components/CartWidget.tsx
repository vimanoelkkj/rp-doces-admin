import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { CartItem } from "../context/CartContext";
import "./CartWidget.css";

interface CartWidgetProps {
  items: CartItem[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onUpdateQuantity: (id: number, quantity: number) => void;
  onRemoveItem: (id: number) => void;
}

export default function CartWidget({
  items,
  isOpen,
  onOpen,
  onClose,
  onUpdateQuantity,
  onRemoveItem,
}: CartWidgetProps) {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0,
  );

  // Detecção de mobile para transição bottom-sheet vs scale bottom-right
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 768px)").matches
      : typeof window !== "undefined"
        ? window.innerWidth <= 768
        : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia("(max-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Reação à adição de produto (bump sutil no FAB ao aumentar totalItems)
  const [isBumping, setIsBumping] = useState(false);
  const prevTotalRef = useRef(totalItems);

  useEffect(() => {
    if (totalItems > prevTotalRef.current && prevTotalRef.current > 0) {
      setIsBumping(true);
      const timer = setTimeout(() => setIsBumping(false), 300);
      return () => clearTimeout(timer);
    }
    prevTotalRef.current = totalItems;
  }, [totalItems]);

  // Acessibilidade: gerenciar foco ao abrir/fechar e lock de scroll
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const cartFabRef = useRef<HTMLButtonElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const openedByFabRef = useRef(false);

  useEffect(() => {
    let frameId: number | null = null;

    if (isOpen) {
      const activeEl = document.activeElement as HTMLElement | null;
      lastFocusedElementRef.current = activeEl;
      openedByFabRef.current = Boolean(
        activeEl && (
          activeEl === cartFabRef.current ||
          cartFabRef.current?.contains(activeEl) ||
          activeEl.classList.contains("cart-fab") ||
          Boolean(activeEl.closest?.(".cart-fab"))
        ),
      );

      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      document.body.style.paddingRight = `${scrollbarWidth}px`;
      document.body.style.overflow = "hidden";

      frameId = requestAnimationFrame(() => {
        closeButtonRef.current?.focus();
      });
    } else {
      document.body.style.paddingRight = "";
      document.body.style.overflow = "";

      const previousElement = lastFocusedElementRef.current;
      const wasOpenedByFab = openedByFabRef.current;
      lastFocusedElementRef.current = null;
      openedByFabRef.current = false;

      if (previousElement && document.contains(previousElement)) {
        previousElement.focus?.();
      } else if (wasOpenedByFab) {
        frameId = requestAnimationFrame(() => {
          if (cartFabRef.current && document.contains(cartFabRef.current)) {
            cartFabRef.current.focus();
          }
        });
      }
    }

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      document.body.style.paddingRight = "";
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Acessibilidade: Escape e Focus Trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleCheckout = () => {
    onClose();
    navigate("/checkout");
  };

  // Variantes de animação
  const fabSpring = shouldReduceMotion
    ? { duration: 0.15 }
    : { type: "spring" as const, stiffness: 400, damping: 25 };

  const modalVariants = {
    initial: shouldReduceMotion
      ? { opacity: 0 }
      : isMobile
        ? { opacity: 0, y: 32 }
        : { opacity: 0, scale: 0.9 },
    animate: shouldReduceMotion
      ? { opacity: 1 }
      : isMobile
        ? { opacity: 1, y: 0 }
        : { opacity: 1, scale: 1 },
    exit: shouldReduceMotion
      ? { opacity: 0 }
      : isMobile
        ? { opacity: 0, y: 32 }
        : { opacity: 0, scale: 0.9 },
  };

  const modalTransition = shouldReduceMotion
    ? { duration: 0.15 }
    : isMobile
      ? { type: "spring" as const, damping: 30, stiffness: 320 }
      : { type: "spring" as const, damping: 30, stiffness: 350 };

  return createPortal(
    <>
      {/* Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="cart-overlay"
            className="cart-overlay"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: shouldReduceMotion ? 0.15 : 0.25,
              ease: "easeInOut",
            }}
          />
        )}
      </AnimatePresence>

      {/* FAB */}
      <AnimatePresence>
        {!isOpen && totalItems > 0 && (
          <motion.button
            ref={cartFabRef}
            key="cart-fab"
            className="cart-fab"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpen();
            }}
            aria-label="Abrir carrinho"
            initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            animate={
              shouldReduceMotion
                ? { opacity: 1 }
                : isBumping
                  ? { scale: [1, 1.12, 0.98, 1], opacity: 1 }
                  : { scale: 1, opacity: 1 }
            }
            exit={shouldReduceMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            whileHover={shouldReduceMotion ? undefined : { scale: 1.05 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
            transition={
              isBumping
                ? { duration: 0.3, ease: "easeOut" }
                : fabSpring
            }
          >
            <svg width="20" height="18" viewBox="0 0 14 12" fill="none">
              <path
                d="M1.26841 5.9508L-0.00036931 -2.38419e-05H13.5479L12.2305 5.95881C12.1524 6.31533 11.9555 6.6344 11.6724 6.86334C11.3894 7.09227 11.037 7.21736 10.6736 7.21795H2.86522C2.49388 7.22625 2.13129 7.10426 1.83984 6.87298C1.54839 6.6417 1.34632 6.31559 1.26841 5.9508Z"
                fill="#FFFFFF"
              />
              <path
                d="M2.29851 11.99C2.73945 11.99 3.09691 11.6309 3.09691 11.188C3.09691 10.7451 2.73945 10.386 2.29851 10.386C1.85756 10.386 1.5001 10.7451 1.5001 11.188C1.5001 11.6309 1.85756 11.99 2.29851 11.99Z"
                fill="#FFFFFF"
              />
              <path
                d="M11.0809 11.99C11.5219 11.99 11.8793 11.6309 11.8793 11.188C11.8793 10.7451 11.5219 10.386 11.0809 10.386C10.64 10.386 10.2825 10.7451 10.2825 11.188C10.2825 11.6309 10.64 11.99 11.0809 11.99Z"
                fill="#FFFFFF"
              />
            </svg>
            <motion.span
              key={totalItems}
              className="cart-fab-badge"
              initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.5, y: -4, opacity: 0 }}
              animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, y: 0, opacity: 1 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0.1 }
                  : { type: "spring", stiffness: 500, damping: 22 }
              }
            >
              {totalItems}
            </motion.span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Modal — etapa "cart" */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="cart-modal"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-modal-title"
            className="cart-modal"
            style={{
              transformOrigin: isMobile ? "bottom center" : "bottom right",
            }}
            variants={modalVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={modalTransition}
          >
            <div className="cart-step cart-step--active">
              <div className="cart-modal-header">
                <h2 id="cart-modal-title">Seu pedido</h2>
                <button
                  ref={closeButtonRef}
                  className="cart-close-btn"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onClose();
                  }}
                  aria-label="Fechar"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M1 1L13 13M13 1L1 13"
                      stroke="#634738"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {items.length === 0 ? (
                  <motion.div
                    key="cart-empty-view"
                    className="cart-modal-items"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: shouldReduceMotion ? 0.1 : 0.2 }}
                  >
                    <p className="cart-empty">Seu carrinho está vazio</p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="cart-filled-view"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                      minHeight: 0,
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: shouldReduceMotion ? 0.1 : 0.2 }}
                  >
                    <div className="cart-modal-items">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {items.map((item) => (
                          <motion.div
                            key={item.id}
                            layout="position"
                            className="cart-item"
                            initial={
                              shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }
                            }
                            animate={
                              shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
                            }
                            exit={
                              shouldReduceMotion
                                ? { opacity: 0 }
                                : { opacity: 0, x: -24, scale: 0.98 }
                            }
                            transition={
                              shouldReduceMotion
                                ? { duration: 0.1 }
                                : {
                                    layout: { duration: 0.25, ease: "easeOut" },
                                    opacity: { duration: 0.18 },
                                    x: { duration: 0.2, ease: "easeOut" },
                                    scale: { duration: 0.2 },
                                    y: { duration: 0.2, ease: "easeOut" },
                                  }
                            }
                          >
                            <img
                              src={item.image}
                              alt={item.name}
                              className="cart-item-img"
                            />
                            <div className="cart-item-info">
                              <span className="cart-item-name">{item.name}</span>
                              <span className="cart-item-price">
                                R$ {item.price.toFixed(2).replace(".", ",")}
                              </span>
                              <div className="cart-qty-controls">
                                <button
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    onUpdateQuantity(item.id, item.quantity - 1);
                                  }}
                                  aria-label={`Diminuir quantidade de ${item.name}`}
                                >
                                  −
                                </button>
                                <motion.span
                                  key={item.quantity}
                                  initial={
                                    shouldReduceMotion
                                      ? { opacity: 0 }
                                      : { opacity: 0, y: -4 }
                                  }
                                  animate={
                                    shouldReduceMotion
                                      ? { opacity: 1 }
                                      : { opacity: 1, y: 0 }
                                  }
                                  transition={
                                    shouldReduceMotion
                                      ? { duration: 0.08 }
                                      : { duration: 0.15, ease: "easeOut" }
                                  }
                                >
                                  {item.quantity}
                                </motion.span>
                                <button
                                  onClick={(e) => {
                                    e.currentTarget.blur();
                                    onUpdateQuantity(item.id, item.quantity + 1);
                                  }}
                                  disabled={
                                    item.disponibilidade !== undefined &&
                                    item.quantity >= item.disponibilidade
                                  }
                                  aria-disabled={
                                    item.disponibilidade !== undefined &&
                                    item.quantity >= item.disponibilidade
                                      ? "true"
                                      : undefined
                                  }
                                  aria-label={`Aumentar quantidade de ${item.name}`}
                                  title={
                                    item.disponibilidade !== undefined &&
                                    item.quantity >= item.disponibilidade
                                      ? "Limite de estoque atingido"
                                      : undefined
                                  }
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <button
                              className="cart-remove-btn"
                              onClick={() => onRemoveItem(item.id)}
                              aria-label="Remover"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 14 16"
                                fill="none"
                              >
                                <path
                                  d="M1 4H13M5 4V2H9V4M3 4V14H11V4"
                                  stroke="#8C7A76"
                                  strokeWidth="1.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>

                    <div className="cart-modal-footer">
                      <div className="cart-total">
                        <span>TOTAL</span>
                        <span className="cart-total-value">
                          R$ {totalPrice.toFixed(2).replace(".", ",")}
                        </span>
                      </div>
                      <p className="cart-notice">
                        Os pedidos do cardápio do dia devem ser retirados
                        diretamente em nosso salão parceiro, Tempori Concept no
                        Cambuí.
                      </p>
                      <button
                        className="cart-checkout-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          handleCheckout();
                        }}
                      >
                        CONTINUAR PARA PAGAMENTO
                      </button>
                      <button
                        className="cart-continue-btn"
                        onClick={(e) => {
                          e.currentTarget.blur();
                          onClose();
                        }}
                      >
                        Continuar comprando
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
