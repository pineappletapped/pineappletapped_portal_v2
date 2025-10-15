"use client";

import { useMemo } from "react";

import type { CartItem } from "@/lib/cart";
import { VAT_RATE } from "@/lib/vat";

export const ZERO_BALANCE_TOLERANCE = 0.005;

export interface CheckoutTotals {
  productTotal: number;
  rentalTotal: number;
  voucherDiscount: number;
  discountPercent: number;
  discountAmount: number;
  subtotal: number;
  vat: number;
  grandTotal: number;
  hasZeroBalance: boolean;
}

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

export function useCheckoutTotals(
  items: CartItem[],
  voucherDiscount: number,
  discountPercent: number,
): CheckoutTotals {
  const productTotal = useMemo(
    () =>
      sum(
        items.map((item) => {
          const lineTotal = item.price * item.quantity;
          return Number.isFinite(lineTotal) ? lineTotal : 0;
        }),
      ),
    [items],
  );

  const rentalTotal = useMemo(
    () =>
      sum(
        items.map((item) => {
          const lineRental = (item.rentalTotal || 0) * item.quantity;
          return Number.isFinite(lineRental) ? lineRental : 0;
        }),
      ),
    [items],
  );

  const boundedVoucherDiscount = Math.min(productTotal, Math.max(0, voucherDiscount));
  const subtotalAfterVoucher = Math.max(0, productTotal - boundedVoucherDiscount);
  const normalisedDiscountPercent = Math.max(0, discountPercent);
  const discountAmount = Math.min(
    subtotalAfterVoucher,
    subtotalAfterVoucher * (normalisedDiscountPercent / 100),
  );

  const subtotal = Math.max(0, subtotalAfterVoucher - discountAmount + rentalTotal);
  const vat = subtotal * VAT_RATE;
  const rawGrandTotal = subtotal + vat;
  const hasZeroBalance = rawGrandTotal <= ZERO_BALANCE_TOLERANCE;
  const grandTotal = hasZeroBalance ? 0 : rawGrandTotal;

  return useMemo(
    () => ({
      productTotal,
      rentalTotal,
      voucherDiscount: boundedVoucherDiscount,
      discountPercent: normalisedDiscountPercent,
      discountAmount,
      subtotal,
      vat,
      grandTotal,
      hasZeroBalance,
    }),
    [
      productTotal,
      rentalTotal,
      boundedVoucherDiscount,
      normalisedDiscountPercent,
      discountAmount,
      subtotal,
      vat,
      grandTotal,
      hasZeroBalance,
    ],
  );
}
