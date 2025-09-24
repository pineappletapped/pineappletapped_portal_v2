"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { ProductModifierSelection } from "@/lib/products";

export interface CartItem {
  id: string;
  name: string;
  price: number;
  variation?: string;
  date: string;
  quantity: number;
  modifiers?: ProductModifierSelection[];
  kitItems?: { id: string; start: string; end: string }[];
  rentalTotal?: number;
}

interface ProductInput {
  id: string;
  name: string;
  price: number;
  variation?: string;
  date: string;
  modifiers?: ProductModifierSelection[];
  kitItems?: { id: string; start: string; end: string }[];
  rentalTotal?: number;
}

interface CartContextProps {
  items: CartItem[];
  add: (product: ProductInput) => void;
  remove: (index: number) => void;
  updateQuantity: (index: number, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextProps | undefined>(undefined);

const STORAGE_KEY = "pineapple-tapped-cart";

const isBrowser = typeof window !== "undefined";

function loadStoredItems(): CartItem[] {
  if (!isBrowser) {
    return [];
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is CartItem =>
        item && typeof item === "object" && "id" in item && "quantity" in item
      );
    }
  } catch (error) {
    console.warn("Failed to parse stored cart items", error);
  }

  window.localStorage.removeItem(STORAGE_KEY);
  return [];
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => loadStoredItems());
  const persistTimeout = useRef<number | null>(null);

  const persistCart = useCallback((nextItems: CartItem[]) => {
    if (!isBrowser) {
      return;
    }

    if (persistTimeout.current !== null) {
      window.clearTimeout(persistTimeout.current);
    }

    persistTimeout.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
      } catch (error) {
        console.warn("Failed to persist cart items", error);
      }
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimeout.current !== null) {
        window.clearTimeout(persistTimeout.current);
      }
    };
  }, []);

  const updateItems = useCallback(
    (updater: (prev: CartItem[]) => CartItem[]) => {
      setItems((prev) => {
        const next = updater(prev);
        persistCart(next);
        return next;
      });
    },
    [persistCart]
  );

  const add = (product: ProductInput) => {
    updateItems((prev) => {
      const existing = prev.find(
        (i) =>
          i.id === product.id &&
          i.date === product.date &&
          i.variation === product.variation &&
          JSON.stringify(i.modifiers || []) ===
            JSON.stringify(product.modifiers || [])
      );
      if (existing) {
        return prev.map((i) =>
          i === existing ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const remove = (index: number) => {
    updateItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateQuantity = (index: number, quantity: number) => {
    updateItems((prev) => {
      if (index < 0 || index >= prev.length) {
        return prev;
      }

      if (!Number.isFinite(quantity)) {
        return prev;
      }

      if (quantity <= 0) {
        return prev.filter((_, i) => i !== index);
      }

      const normalized = Math.max(1, Math.round(quantity));
      const target = prev[index];

      if (target.quantity === normalized) {
        return prev;
      }

      return prev.map((item, i) =>
        i === index ? { ...item, quantity: normalized } : item
      );
    });
  };

  const clear = () => {
    updateItems(() => []);
  };

  return (
    <CartContext.Provider
      value={{ items, add, remove, updateQuantity, clear }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}

