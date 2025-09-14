"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";

export default function CartStatus() {
  const { items } = useCart();
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <Link href="/cart" className="relative btn btn-sm btn-ghost">
      Cart{count > 0 && <span className="ml-1">({count})</span>}
    </Link>
  );
}
