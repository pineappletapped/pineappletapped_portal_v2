import { renderHook } from "@testing-library/react";
import type { CartItem } from "@/lib/cart";

import { useCheckoutTotals, ZERO_BALANCE_TOLERANCE } from "../useCheckoutTotals";

describe("useCheckoutTotals", () => {
  const baseItem: CartItem = {
    id: "prod_123",
    name: "Campaign shoot",
    price: 250,
    quantity: 1,
    date: "2024-05-01",
  };

  it("reports a non-zero balance when voucher coverage is partial", () => {
    const { result } = renderHook(() => useCheckoutTotals([baseItem], 50, 0));
    expect(result.current.grandTotal).toBeGreaterThan(ZERO_BALANCE_TOLERANCE);
    expect(result.current.hasZeroBalance).toBe(false);
  });

  it("flags zero balance when voucher covers the product total", () => {
    const { result } = renderHook(() => useCheckoutTotals([baseItem], 250, 0));
    expect(result.current.grandTotal).toBe(0);
    expect(result.current.hasZeroBalance).toBe(true);
  });
});
