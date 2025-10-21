"use client";

// This file is a modified version of the original
// `apps/web/app/checkout/useCheckoutPayment.ts` from the
// `pineappletapped_portal_v2` repository.  It implements a
// zero‑balance order bypass by calling `completeZeroBalanceOrder()`
// whenever the cart total is zero (e.g. when a voucher code reduces
// the entire balance to zero).  The dependency array for
// `initialisePayment` has also been updated to include
// `completeZeroBalanceOrder`.

import { useCallback, useMemo, useRef, useState } from "react";
import type { FirebaseError } from "firebase/app";
import { type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable, type Functions } from "firebase/functions";

import { ensureFirebase } from "@/lib/firebase";

import { createIntentPayload, type CheckoutOrderInput } from "./buildOrderInput";
import { ZERO_BALANCE_TOLERANCE } from "./useCheckoutTotals";

interface UseCheckoutPaymentArgs {
  orderInput: CheckoutOrderInput;
  hasZeroBalance: boolean;
  stripePromise: Promise<unknown> | null;
  ensureUser: () => Promise<User>;
  validate: () => string | null;
  onSuccess: (orderId: string) => void;
}

interface CreateOrderResult {
  orderId?: string;
  price?: number;
  netTotal?: number;
  discountAmount?: number;
  voucherDiscount?: number;
  [key: string]: unknown;
}

const describeCallableError = (error: unknown): string => {
  const fallback = "We couldn't complete your order. Please try again.";
  if (!error) {
    return fallback;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    const firebaseError = error as FirebaseError;
    if (firebaseError.code) {
      const code = firebaseError.code.replace(/^functions\//, "");
      switch (code) {
        case "permission-denied":
          return "You do not have permission to complete this order.";
        case "invalid-argument":
          return "Checkout details were incomplete. Review your information and try again.";
        case "not-found":
          return "We couldn't find the checkout service. Try again in a moment.";
        case "deadline-exceeded":
        case "resource-exhausted":
        case "aborted":
        case "unavailable":
          return "The checkout service is busy. Try again in a few seconds.";
        default:
          break;
      }
    }

    const message = firebaseError.message?.replace(/^FirebaseError:\s*/i, "") || firebaseError.message;
    if (message && message.toLowerCase() !== "internal") {
      return message;
    }
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
  }

  return fallback;
};

export interface CheckoutPaymentState {
  clientSecret: string | null;
  orderId: string | null;
  paymentError: string | null;
  initializing: boolean;
  paymentDetailsStale: boolean;
  initialisePayment: () => Promise<boolean>;
  completeZeroBalanceOrder: () => Promise<boolean>;
  resetPaymentError: () => void;
  intentPayload: string;
  reportPaymentError: (message: string | null) => void;
}

export function useCheckoutPayment({
  orderInput,
  hasZeroBalance,
  stripePromise,
  ensureUser,
  validate,
  onSuccess,
}: UseCheckoutPaymentArgs): CheckoutPaymentState {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const functionsRef = useRef<Functions | null>(null);
  const lastIntentPayloadRef = useRef<string | null>(null);

  const intentPayload = useMemo(() => createIntentPayload(orderInput), [orderInput]);
  const paymentDetailsStale = useMemo(
    () => lastIntentPayloadRef.current !== null && lastIntentPayloadRef.current !== intentPayload,
    [intentPayload],
  );

  const ensureFunctions = useCallback(async () => {
    if (functionsRef.current) {
      return functionsRef.current;
    }
    const { functions } = await ensureFirebase();
    if (!functions) {
      throw new Error("Firebase functions are unavailable.");
    }
    functionsRef.current = functions;
    return functions;
  }, []);

  const callCreateOrder = useCallback(async (): Promise<CreateOrderResult> => {
    const functionsInstance = await ensureFunctions();
    const callable = httpsCallable(functionsInstance, "createOrder");
    const response = await callable(orderInput);
    const payload = response?.data;
    if (!payload || typeof payload !== "object") {
      return {};
    }
    return payload as CreateOrderResult;
  }, [ensureFunctions, orderInput]);

  const completeZeroBalanceOrder = useCallback(async () => {
    if (initializing) {
      return false;
    }

    const validationError = validate();
    if (validationError) {
      setPaymentError(validationError);
      return false;
    }

    setInitializing(true);
    setPaymentError(null);

    try {
      const user = await ensureUser();
      await user.getIdToken();
      const orderData = await callCreateOrder();
      const createdOrderId: string | undefined =
        typeof orderData.orderId === "string" ? orderData.orderId : undefined;
      if (!createdOrderId) {
        throw new Error("Failed to create order.");
      }

      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("We couldn't verify the order total. Please try again.");
      }

      const orderSnap = await getDoc(doc(db, "orders", createdOrderId));
      if (!orderSnap.exists()) {
        throw new Error("Order could not be verified. Please try again.");
      }

      const snapData = orderSnap.data() ?? {};
      const serverPrice = Number(orderData.price ?? snapData.price ?? 0);
      const serverNetTotal = Number(orderData.netTotal ?? snapData.netTotal ?? 0);
      const zeroBalance = [serverPrice, serverNetTotal]
        .filter((value): value is number => Number.isFinite(value))
        .some((value) => Math.abs(value) <= ZERO_BALANCE_TOLERANCE);

      if (zeroBalance) {
        setOrderId(createdOrderId);
        setClientSecret(null);
        lastIntentPayloadRef.current = intentPayload;
        onSuccess(createdOrderId);
        return true;
      }

      const secret =
        typeof orderData.clientSecret === "string" && orderData.clientSecret.trim().length > 0
          ? orderData.clientSecret
          : null;
      if (!secret) {
        throw new Error("Payment session could not be created.");
      }

      setOrderId(createdOrderId);
      setClientSecret(secret);
      lastIntentPayloadRef.current = intentPayload;
      setPaymentError(
        "Voucher no longer covers the full balance. Complete the payment below to finish your order.",
      );
      return false;
    } catch (error) {
      console.error("Failed to submit zero-balance order", error);
      const message = describeCallableError(error);
      setPaymentError(message);
      setOrderId(null);
      setClientSecret(null);
      return false;
    } finally {
      setInitializing(false);
    }
  }, [callCreateOrder, ensureUser, intentPayload, onSuccess, validate, initializing]);

  const initialisePayment = useCallback(async () => {
    if (initializing) {
      return false;
    }
    if (hasZeroBalance) {
      // If the order has zero balance (voucher covers the full amount),
      // bypass payment entirely by completing the order directly.
      return await completeZeroBalanceOrder();
    }

    const validationError = validate();
    if (validationError) {
      setPaymentError(validationError);
      return false;
    }

    if (!stripePromise) {
      setPaymentError("Payment configuration is unavailable. Please try again later.");
      return false;
    }

    setInitializing(true);
    setPaymentError(null);

    try {
      const user = await ensureUser();
      await user.getIdToken();
      const orderData = await callCreateOrder();
      const createdOrderId: string | undefined =
        typeof orderData.orderId === "string" ? orderData.orderId : undefined;
      if (!createdOrderId) {
        throw new Error("Failed to create order.");
      }

      const secret =
        typeof orderData.clientSecret === "string" && orderData.clientSecret.trim().length > 0
          ? orderData.clientSecret
          : null;
      if (!secret) {
        throw new Error("Payment session could not be created.");
      }

      setOrderId(createdOrderId);
      setClientSecret(secret);
      lastIntentPayloadRef.current = intentPayload;
      return true;
    } catch (error) {
      console.error("Failed to initialise payment intent", error);
      const message = describeCallableError(error);
      setPaymentError(message);
      setOrderId(null);
      setClientSecret(null);
      return false;
    } finally {
      setInitializing(false);
    }
  }, [
    callCreateOrder,
    ensureUser,
    hasZeroBalance,
    initializing,
    intentPayload,
    stripePromise,
    validate,
    completeZeroBalanceOrder,
  ]);

  const resetPaymentError = useCallback(() => setPaymentError(null), []);
  const reportPaymentError = useCallback((message: string | null) => setPaymentError(message), []);

  return {
    clientSecret,
    orderId,
    paymentError,
    initializing,
    paymentDetailsStale,
    initialisePayment,
    completeZeroBalanceOrder,
    resetPaymentError,
    intentPayload,
    reportPaymentError,
  };
}

export { describeCallableError };
