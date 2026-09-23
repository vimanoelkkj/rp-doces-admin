import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import {
  calculateAddQuantity,
  calculateUpdateQuantity,
  reconcileCartWithCatalog,
  ItemWithAvailability,
} from "./cartReconciliation";

export interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
  disponibilidade?: number;
}

const STORAGE_KEY = "rp-doces:cart";

function loadStoredCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

interface CartContextType {
  cartItems: CartItem[];
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  addToCart: (item: Omit<CartItem, "quantity">) => void;
  updateQuantity: (id: number, qty: number) => void;
  removeItem: (id: number) => void;
  clearCart: () => void;
  reconcileWithProducts: (catalog: ItemWithAvailability[]) => boolean;
  totalItems: number;
  totalPrice: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>(loadStoredCart);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cartItems));
    } catch {
      // localStorage indisponível (modo privado, etc.) — carrinho segue funcionando só em memória.
    }
  }, [cartItems]);

  const addToCart = (item: Omit<CartItem, "quantity">) => {
    // Produto com disponibilidade 0 não pode ser adicionado
    if (item.disponibilidade !== undefined && item.disponibilidade <= 0) {
      return;
    }

    setCartItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        const disp =
          item.disponibilidade !== undefined
            ? item.disponibilidade
            : existing.disponibilidade;
        const newQty = calculateAddQuantity(existing.quantity, disp);
        if (newQty === existing.quantity) {
          return prev;
        }
        return prev.map((i) =>
          i.id === item.id
            ? { ...i, quantity: newQty, ...(disp !== undefined ? { disponibilidade: disp } : {}) }
            : i,
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, qty: number) => {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.id === id);
      if (!existing) return prev;

      const newQty = calculateUpdateQuantity(qty, existing.disponibilidade);
      if (newQty <= 0) {
        return prev.filter((i) => i.id !== id);
      }
      return prev.map((i) => (i.id === id ? { ...i, quantity: newQty } : i));
    });
  };

  const removeItem = (id: number) => {
    setCartItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearCart = () => setCartItems([]);

  const reconcileWithProducts = useCallback(
    (catalog: ItemWithAvailability[]): boolean => {
      let wasAdjusted = false;
      setCartItems((prev) => {
        const { reconciled, adjusted } = reconcileCartWithCatalog(prev, catalog);
        wasAdjusted = adjusted;
        if (adjusted) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
          } catch {
            // localStorage indisponível
          }
          return reconciled;
        }
        return prev;
      });
      return wasAdjusted;
    },
    [],
  );

  const totalItems = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = cartItems.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0,
  );

  return (
    <CartContext.Provider
      value={{
        cartItems,
        cartOpen,
        setCartOpen,
        addToCart,
        updateQuantity,
        removeItem,
        clearCart,
        reconcileWithProducts,
        totalItems,
        totalPrice,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
