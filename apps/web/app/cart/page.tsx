"use client";

import { useCart } from "@/lib/cart";
import { VAT_RATE } from "@/lib/vat";
import { useRouter } from "next/navigation";

export default function CartPage() {
  const { items, remove } = useCart();
  const productTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const rentalTotal = items.reduce(
    (sum, i) => sum + (i.rentalTotal || 0) * i.quantity,
    0
  );
  const subtotal = productTotal + rentalTotal;
  const vat = subtotal * VAT_RATE;
  const total = subtotal + vat;
  const router = useRouter();

  const checkout = () => {
    if (items.length === 0) return;
    router.push("/checkout");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Your Cart</h1>
      {items.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <div className="space-y-4">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between border p-2 rounded"
            >
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-gray-600">
                  {new Date(item.date).toLocaleDateString()}
                </p>
                {item.variation && (
                  <p className="text-sm text-gray-600">{item.variation}</p>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="block">£{(item.price * item.quantity).toFixed(2)}</span>
                  {item.rentalTotal && (
                    <span className="block text-xs text-gray-600">
                      £{(item.rentalTotal * item.quantity).toFixed(2)} rent
                    </span>
                  )}
                </div>
                <button
                  className="text-sm text-red-600"
                  onClick={() => remove(idx)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-between font-semibold pt-4 border-t">
            <span>Subtotal</span>
            <span>£{productTotal.toFixed(2)}</span>
          </div>
          {rentalTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span>Rental Subtotal</span>
              <span>£{rentalTotal.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span>VAT (20%)</span>
            <span>£{vat.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>£{total.toFixed(2)}</span>
          </div>
          <button className="btn w-full" onClick={checkout}>
            Checkout
          </button>
        </div>
      )}
    </div>
  );
}
