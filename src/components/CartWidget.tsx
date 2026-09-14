import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import "./CartWidget.css";

interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

interface CartWidgetProps {
  items: CartItem[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onUpdateQuantity: (id: number, quantity: number) => void;
  onRemoveItem: (id: number) => void;
}

const EMPTY_TRANSITION_MS = 220;
const CLOSE_ANIMATION_MS = 400;

export default function CartWidget({
  items,
  isOpen,
  onOpen,
  onClose,
  onUpdateQuantity,
  onRemoveItem,
}: CartWidgetProps) {
  const navigate = useNavigate();

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  // Mantém o componente montado durante a animação de fechamento: sem isso,
  // fechar com o carrinho vazio desmontava na hora, sem deixar o CSS animar.
  const [shouldRender, setShouldRender] = useState(totalItems > 0 || isOpen);

  useEffect(() => {
    if (totalItems > 0 || isOpen) {
      setShouldRender(true);
      return;
    }
    const timer = setTimeout(() => setShouldRender(false), CLOSE_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [totalItems, isOpen]);

  // Só troca o conteúdo exibido (lista <-> vazio) depois de um fade-out,
  // pra não trocar de estado sem transição quando o último item é removido.
  const [displayItems, setDisplayItems] = useState(items);
  const [isTransitioningEmpty, setIsTransitioningEmpty] = useState(false);

  useEffect(() => {
    const wasEmpty = displayItems.length === 0;
    const isEmpty = items.length === 0;

    if (wasEmpty === isEmpty) {
      setDisplayItems(items);
      return;
    }

    setIsTransitioningEmpty(true);
    const timer = setTimeout(() => {
      setDisplayItems(items);
      setIsTransitioningEmpty(false);
    }, EMPTY_TRANSITION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const displayTotalPrice = displayItems.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0,
  );

  useEffect(() => {
    if (isOpen) {
      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      document.body.style.paddingRight = `${scrollbarWidth}px`;
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.paddingRight = "";
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.paddingRight = "";
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleCheckout = () => {
    onClose();
    navigate("/checkout");
  };

  if (!shouldRender) return null;

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className={`cart-overlay ${isOpen ? "cart-overlay--visible" : ""}`}
        onClick={onClose}
      />

      {/* FAB */}
      <button
        className={`cart-fab ${isOpen || totalItems === 0 ? "cart-fab--hidden" : ""}`}
        onClick={onOpen}
        aria-label="Abrir carrinho"
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
        <span className="cart-fab-badge">{totalItems}</span>
      </button>

      {/* Modal — etapa "cart" */}
      <div className={`cart-modal ${isOpen ? "cart-modal--open" : ""}`}>
        <div className="cart-step cart-step--active">
          <div className="cart-modal-header">
            <h2>Seu pedido</h2>
            <button
              className="cart-close-btn"
              onClick={onClose}
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
          <div
            className={`cart-modal-items ${isTransitioningEmpty ? "cart-modal-items--fading" : ""}`}
          >
            {displayItems.length === 0 ? (
              <p className="cart-empty">Seu carrinho está vazio</p>
            ) : (
              displayItems.map((item) => (
                <div key={item.id} className="cart-item">
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
                        onClick={() =>
                          onUpdateQuantity(item.id, item.quantity - 1)
                        }
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        onClick={() =>
                          onUpdateQuantity(item.id, item.quantity + 1)
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
                    <svg width="14" height="14" viewBox="0 0 14 16" fill="none">
                      <path
                        d="M1 4H13M5 4V2H9V4M3 4V14H11V4"
                        stroke="#8C7A76"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
          {displayItems.length > 0 && (
            <div
              className={`cart-modal-footer ${isTransitioningEmpty ? "cart-modal-footer--fading" : ""}`}
            >
              <div className="cart-total">
                <span>TOTAL</span>
                <span className="cart-total-value">
                  R$ {displayTotalPrice.toFixed(2).replace(".", ",")}
                </span>
              </div>
              <p className="cart-notice">
                Os pedidos do cardápio do dia devem ser retirados diretamente
                em nosso salão parceiro, Tempori Concept no Cambuí.
              </p>
              <button className="cart-checkout-btn" onClick={handleCheckout}>
                CONTINUAR PARA PAGAMENTO
              </button>
              <button className="cart-continue-btn" onClick={onClose}>
                Continuar comprando
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
