"use client";

import { createContext, useContext, useState, ReactNode } from "react";
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
  clear: () => void;
}

const CartContext = createContext<CartContextProps | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const add = (product: ProductInput) => {
    setItems((prev) => {
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
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const clear = () => setItems([]);

  return (
    <CartContext.Provider value={{ items, add, remove, clear }}>
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

