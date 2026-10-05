import { forwardRef } from "react";
import { motion } from "motion/react";
import type { CartItem } from "../context/CartContext";
import { formatPrice } from "./cartWidgetHelpers";

interface CartItemRowProps {
  item: CartItem;
  shouldReduceMotion: boolean | null;
  onUpdateQuantity: (id: number, quantity: number) => void;
  onRemoveItem: (id: number) => void;
}

export const CartItemRow = forwardRef<HTMLDivElement, CartItemRowProps>(function CartItemRow(
  { item, shouldReduceMotion, onUpdateQuantity, onRemoveItem },
  ref
) {
  const isAtStockLimit =
    item.disponibilidade !== undefined && item.quantity >= item.disponibilidade;

  return (
    <motion.div
      ref={ref}
      layout="position"
      className="cart-item"
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.98 }}
      transition={
        shouldReduceMotion
          ? { duration: 0.1 }
          : {
              layout: { duration: 0.25, ease: "easeOut" },
              opacity: { duration: 0.18 },
              x: { duration: 0.2, ease: "easeOut" },
              scale: { duration: 0.2 },
              y: { duration: 0.2, ease: "easeOut" }
            }
      }
    >
      <img src={item.image} alt={item.name} className="cart-item-img" />
      <div className="cart-item-info">
        <span className="cart-item-name">{item.name}</span>
        <span className="cart-item-price">{formatPrice(item.price)}</span>
        <div className="cart-qty-controls">
          <button
            type="button"
            onClick={e => {
              e.currentTarget.blur();
              onUpdateQuantity(item.id, item.quantity - 1);
            }}
            aria-label={`Diminuir quantidade de ${item.name}`}
          >
            −
          </button>
          <motion.span
            key={item.quantity}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={
              shouldReduceMotion ? { duration: 0.08 } : { duration: 0.15, ease: "easeOut" }
            }
          >
            {item.quantity}
          </motion.span>
          <button
            type="button"
            onClick={e => {
              e.currentTarget.blur();
              onUpdateQuantity(item.id, item.quantity + 1);
            }}
            disabled={isAtStockLimit}
            aria-disabled={isAtStockLimit ? "true" : undefined}
            aria-label={`Aumentar quantidade de ${item.name}`}
            title={isAtStockLimit ? "Limite de estoque atingido" : undefined}
          >
            +
          </button>
        </div>
      </div>
      <button
        type="button"
        className="cart-remove-btn"
        onClick={() => onRemoveItem(item.id)}
        aria-label="Remover"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 16" fill="none">
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
  );
});

export default CartItemRow;
