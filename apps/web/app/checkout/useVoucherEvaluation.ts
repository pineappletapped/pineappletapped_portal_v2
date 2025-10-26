"use client";

import { useCallback, useMemo, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";

import type { CartItem } from "@/lib/cart";
import type { Voucher } from "../../../../shared/types/commerce";
import { ensureFirebase } from "@/lib/firebase";

export type VoucherStatus =
  | "idle"
  | "checking"
  | "applied"
  | "invalid"
  | "ineligible"
  | "awaiting-items"
  | "awaiting-location"
  | "error";

export interface VoucherState {
  status: VoucherStatus;
  code: string | null;
  discount: number;
  message: string | null;
  record: Voucher | null;
}

const createInitialState = (): VoucherState => ({
  status: "idle",
  code: null,
  discount: 0,
  message: null,
  record: null,
});

const normaliseList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
};

const normaliseLocationList = (value: unknown): string[] =>
  normaliseList(value).map((entry) => entry.toLowerCase());

const evaluateVoucher = (
  record: Voucher,
  code: string,
  items: CartItem[],
  location: string,
): VoucherState => {
  if (items.length === 0) {
    return {
      status: "awaiting-items",
      code,
      discount: 0,
      message: "Add items to your cart to use this voucher.",
      record,
    };
  }

  const allowedLocations = normaliseLocationList(record.locations);
  const trimmedLocation = location.trim();
  const normalisedLocation = trimmedLocation.toLowerCase();

  if (allowedLocations.length > 0) {
    if (!normalisedLocation) {
      return {
        status: "awaiting-location",
        code,
        discount: 0,
        message: "Enter the shoot location to use this voucher.",
        record,
      };
    }
    if (!allowedLocations.includes(normalisedLocation)) {
      return {
        status: "ineligible",
        code,
        discount: 0,
        message: "This voucher is not valid for the selected location.",
        record,
      };
    }
  }

  const allowedProductIds = new Set(normaliseList(record.productIds));
  const allowedCategoryIds = new Set(normaliseList(record.categoryIds));

  let eligibleSubtotal = 0;

  items.forEach((item) => {
    const matchesProduct =
      allowedProductIds.size === 0 || allowedProductIds.has(item.id);
    const matchesCategory =
      allowedCategoryIds.size === 0 ||
      (typeof item.category === "string" && allowedCategoryIds.has(item.category));

    if (matchesProduct && matchesCategory) {
      eligibleSubtotal += item.price * item.quantity;
    }
  });

  if (eligibleSubtotal <= 0) {
    return {
      status: "ineligible",
      code,
      discount: 0,
      message: "This voucher does not apply to the items in your cart.",
      record,
    };
  }

  const rawAmount = record.amount ?? 0;
  const amount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      status: "ineligible",
      code,
      discount: 0,
      message: "This voucher is not currently offering a discount.",
      record,
    };
  }

  const type = typeof record.type === "string" ? record.type : "percentage";
  let computedDiscount = 0;

  if (type === "percentage") {
    computedDiscount = eligibleSubtotal * (amount / 100);
  } else if (type === "fixed") {
    computedDiscount = Math.min(amount, eligibleSubtotal);
  } else {
    computedDiscount = eligibleSubtotal * (amount / 100);
  }

  if (computedDiscount <= 0) {
    return {
      status: "ineligible",
      code,
      discount: 0,
      message: "This voucher has no eligible value for your cart.",
      record,
    };
  }

  return {
    status: "applied",
    code,
    discount: computedDiscount,
    message: null,
    record,
  };
};

export function useVoucherEvaluation(items: CartItem[], location: string) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<VoucherState>(createInitialState);

  const apply = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setState(createInitialState());
      return;
    }

    setState({
      status: "checking",
      code: trimmed,
      discount: 0,
      message: null,
      record: null,
    });

    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firebase database is unavailable.");
      }

      const voucherQuery = query(
        collection(db, "vouchers"),
        where("code", "==", trimmed),
        limit(1),
      );

      const snapshot = await getDocs(voucherQuery);
      if (snapshot.empty) {
        setState({
          status: "invalid",
          code: trimmed,
          discount: 0,
          message: "Voucher code not recognised.",
          record: null,
        });
        return;
      }

      const record = snapshot.docs[0].data() as Voucher;
      setState(evaluateVoucher(record, trimmed, items, location));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't validate that voucher. Try again.";
      setState({
        status: "error",
        code: trimmed,
        discount: 0,
        message,
        record: null,
      });
    }
  }, [input, items, location]);

  const clear = useCallback(() => {
    setInput("");
    setState(createInitialState());
  }, []);

  const appliedDiscount = useMemo(
    () => (state.status === "applied" ? Math.max(0, state.discount) : 0),
    [state],
  );

  return {
    input,
    setInput,
    state,
    apply,
    clear,
    appliedDiscount,
  };
}
