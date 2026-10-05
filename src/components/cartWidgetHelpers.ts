import type { CartItem } from "../context/CartContext";

export function formatPrice(price: number): string {
  return `R$ ${price.toFixed(2).replace(".", ",")}`;
}

export function calculateCartTotals(items: CartItem[]): {
  totalItems: number;
  totalPrice: number;
} {
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return { totalItems, totalPrice };
}

export function getFabSpring(shouldReduceMotion: boolean | null) {
  return shouldReduceMotion
    ? { duration: 0.15 }
    : { type: "spring" as const, stiffness: 400, damping: 25 };
}

export function getModalVariants(shouldReduceMotion: boolean | null, isMobile: boolean) {
  return {
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
        : { opacity: 0, scale: 0.9 }
  };
}

export function getModalTransition(shouldReduceMotion: boolean | null, isMobile: boolean) {
  return shouldReduceMotion
    ? { duration: 0.15 }
    : isMobile
      ? { type: "spring" as const, damping: 30, stiffness: 320 }
      : { type: "spring" as const, damping: 30, stiffness: 350 };
}
