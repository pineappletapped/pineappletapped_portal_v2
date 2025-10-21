"use client";

import { useCart } from "@/lib/cart";
import { VAT_RATE } from "@/lib/vat";
import { useRouter } from "next/navigation";

export default function CartPage() {
  const { items, remove, updateQuantity } = useCart();
  const getQuantity = (item: (typeof items)[number]) => {
    if (typeof item !== "object" || item === null || !("quantity" in item)) {
      return 1;
    }
    const parsed = Number((item as { quantity?: unknown }).quantity);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  const productTotal = items.reduce(
    (sum, item) => sum + item.price * getQuantity(item),
    0
  );
  const rentalTotal = items.reduce(
    (sum, item) => sum + (item.rentalTotal || 0) * getQuantity(item),
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
          {items.map((item, idx) => {
            const quantity = getQuantity(item);
            const decreaseLabel =
              quantity === 1
                ? `Remove ${item.name} from cart`
                : `Decrease quantity of ${item.name}`;
            const slot = item.campaignBooking;
            const parseDateTime = (value: string | null | undefined) => {
              if (!value) return null;
              const normalised =
                /^\d{4}-\d{2}-\d{2}$/.test(value)
                  ? `${value}T00:00:00`
                  : value;
              const parsed = new Date(normalised);
              return Number.isNaN(parsed.getTime()) ? null : parsed;
            };
            const exhibitionDetails = (() => {
              const selection = item.exhibition;
              if (!selection) {
                return null;
              }
              const show = parseDateTime(selection.showDate ?? null);
              const setup =
                selection.setupIncluded && selection.setupDate
                  ? parseDateTime(selection.setupDate)
                  : null;
              return {
                showLabel: show ? show.toLocaleDateString() : null,
                setupLabel: setup ? setup.toLocaleDateString() : null,
                setupIncluded: Boolean(selection.setupIncluded && setup),
              };
            })();
            const dateLabel = (() => {
              if (slot) {
                const start = parseDateTime(slot.slotStartAt);
                const end = parseDateTime(slot.slotEndAt);
                if (start && end) {
                  return `${start.toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })} – ${end.toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`;
                }
                if (start) {
                  return start.toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  });
                }
                if (end) {
                  return `Ends ${end.toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`;
                }
              }
              if (exhibitionDetails?.showLabel) {
                return exhibitionDetails.showLabel;
              }
              const kitRange = (() => {
                if (!item.kitItems || item.kitItems.length === 0) {
                  return null;
                }
                const parsed = item.kitItems
                  .map((entry) => ({
                    start: parseDateTime(entry.start),
                    end: parseDateTime(entry.end),
                  }))
                  .filter(
                    (entry): entry is { start: Date; end: Date } =>
                      Boolean(entry.start) && Boolean(entry.end)
                  );
                if (parsed.length === 0) {
                  return null;
                }
                const startDate = new Date(
                  Math.min(...parsed.map((entry) => entry.start.getTime()))
                );
                const endDate = new Date(
                  Math.max(...parsed.map((entry) => entry.end.getTime()))
                );
                return { startDate, endDate };
              })();
              if (kitRange) {
                const startLabel = kitRange.startDate.toLocaleDateString();
                const endLabel = kitRange.endDate.toLocaleDateString();
                return startLabel === endLabel
                  ? startLabel
                  : `${startLabel} – ${endLabel}`;
              }
              const fallback = parseDateTime(item.date);
              if (fallback) {
                return fallback.toLocaleDateString();
              }
              return "To be scheduled";
            })();
            const timeSlotDetails = (() => {
              const slotSelection = item.timeSlot;
              if (!slotSelection) {
                return null;
              }
              if (slotSelection.label) {
                return `Time: ${slotSelection.label}`;
              }
              const start = parseDateTime(slotSelection.start);
              const end = parseDateTime(slotSelection.end);
              if (start && end) {
                const startLabel = start.toLocaleTimeString("en-GB", {
                  timeStyle: "short",
                });
                const endLabel = end.toLocaleTimeString("en-GB", {
                  timeStyle: "short",
                });
                return `Time: ${startLabel} – ${endLabel}`;
              }
              if (start) {
                const startLabel = start.toLocaleTimeString("en-GB", {
                  timeStyle: "short",
                });
                return `Time: ${startLabel}`;
              }
              return null;
            })();

            const itemKey = `${item.id}-${idx}`;

            return (
              <div
                key={itemKey}
                className="flex flex-wrap items-center justify-between gap-4 rounded border p-4"
              >
                <div className="min-w-[12rem] flex-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-gray-600">{dateLabel}</p>
                  {exhibitionDetails?.setupIncluded && exhibitionDetails.setupLabel && (
                    <p className="text-xs text-gray-500">
                      Setup day: {exhibitionDetails.setupLabel}
                    </p>
                  )}
                  {slot && (
                    <p className="text-xs text-gray-500">
                      Slot: {slot.slotLabel}
                    </p>
                  )}
                  {timeSlotDetails && (
                    <p className="text-xs text-gray-500">{timeSlotDetails}</p>
                  )}
                  {item.variation && (
                    <p className="text-sm text-gray-600">{item.variation}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div
                    className="flex items-center gap-2"
                    role="group"
                    aria-label={`Quantity for ${item.name}`}
                  >
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, quantity - 1)}
                      aria-label={decreaseLabel}
                      className="flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-lg leading-none text-gray-700 transition hover:border-gray-400 focus-visible:border-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
                    >
                      <span aria-hidden="true">-</span>
                    </button>
                    <span
                      className="min-w-[2ch] text-center text-sm font-medium"
                      aria-live="polite"
                    >
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, quantity + 1)}
                      aria-label={`Increase quantity of ${item.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-lg leading-none text-gray-700 transition hover:border-gray-400 focus-visible:border-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="block">
                      £{(item.price * quantity).toFixed(2)}
                    </span>
                    {item.rentalTotal && (
                      <span className="block text-xs text-gray-600">
                        £{(item.rentalTotal * quantity).toFixed(2)} rent
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="text-sm text-red-600 transition hover:text-red-700 focus-visible:underline"
                    onClick={() => remove(idx)}
                    aria-label={`Remove ${item.name} from cart`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
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
