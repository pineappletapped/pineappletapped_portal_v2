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

    const genericCode = (error as { code?: unknown }).code;
    if (typeof genericCode === "string") {
      switch (genericCode) {
        case "unauthenticated":
          return "Sign in to continue with your order.";
        case "permission-denied":
          return "You do not have permission to complete this order.";
        case "invalid-argument":
          return "Checkout details were incomplete. Review your information and try again.";
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
  const lastIntentPayloadRef = useRef<string | null>(null);

  const intentPayload = useMemo(() => createIntentPayload(orderInput), [orderInput]);
  const orderRequestBody = useMemo(() => JSON.stringify(orderInput), [orderInput]);
  const paymentDetailsStale = useMemo(
    () => lastIntentPayloadRef.current !== null && lastIntentPayloadRef.current !== intentPayload,
    [intentPayload],
  );
  const callCreateOrder = useCallback(
    async (idToken: string): Promise<CreateOrderResult> => {
      const response = await fetch("/api/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: orderRequestBody,
        cache: "no-store",
      });

      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch (error) {
          const parseError = new Error("Order service returned invalid JSON.");
          (parseError as Error & { details?: unknown }).details = {
            responseSnippet: text.slice(0, 200),
          };
          throw parseError;
        }
      }

      if (!response.ok) {
        const message =
          (payload && typeof payload === "object" && payload !== null && "error" in payload &&
            typeof (payload as { error: unknown }).error === "string"
            ? ((payload as { error: string }).error as string)
            : `Order service responded with ${response.status}`);
        const error = new Error(message);
        if (payload && typeof payload === "object" && payload !== null) {
          const record = payload as Record<string, unknown>;
          if (typeof record.code === "string") {
            (error as Error & { code?: string }).code = record.code;
          }
          if ("details" in record) {
            (error as Error & { details?: unknown }).details = record.details;
          }
        }
        throw error;
      }

      if (!payload || typeof payload !== "object") {
        return {};
      }

      return payload as CreateOrderResult;
    },
    [orderRequestBody],
  );

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
      const token = await user.getIdToken();
      const orderData = await callCreateOrder(token);
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
      const parseCurrency = (value: unknown): number | null => {
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === "string") {
          const normalised = Number(value.replace(/[^0-9.-]+/g, ""));
          return Number.isFinite(normalised) ? normalised : null;
        }
        return null;
      };

      const scheduleDueAmounts = Array.isArray((snapData as { paymentSchedule?: unknown }).paymentSchedule)
        ? ((snapData as { paymentSchedule?: unknown[] }).paymentSchedule ?? [])
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }
              const statusRaw = (entry as { status?: unknown }).status;
              const status = typeof statusRaw === "string" ? statusRaw.toLowerCase() : "";
              if (!status || !["due", "pending", "overdue"].includes(status)) {
                return null;
              }
              const gross = parseCurrency((entry as { grossAmount?: unknown }).grossAmount);
              if (gross !== null) {
                return gross;
              }
              return parseCurrency((entry as { netAmount?: unknown }).netAmount);
            })
            .filter((value): value is number => value !== null && Number.isFinite(value))
        : [];

      const dueNowCandidates = [
        parseCurrency((orderData as { depositAmount?: unknown }).depositAmount),
        parseCurrency((orderData as { depositDue?: unknown }).depositDue),
        parseCurrency((snapData as { depositAmount?: unknown }).depositAmount),
        parseCurrency((snapData as { depositDue?: unknown }).depositDue),
        parseCurrency((snapData as { balanceDue?: unknown }).balanceDue),
        ...scheduleDueAmounts,
      ].filter((value): value is number => value !== null && Number.isFinite(value));

      const depositFullySatisfied =
        dueNowCandidates.length > 0 &&
        dueNowCandidates.every((value) => Math.abs(value) <= ZERO_BALANCE_TOLERANCE);

      const serverPrice = parseCurrency(orderData.price ?? snapData.price ?? 0) ?? 0;
      const serverNetTotal = parseCurrency(orderData.netTotal ?? snapData.netTotal ?? 0) ?? 0;
      const orderTotalsZero = [serverPrice, serverNetTotal]
        .filter((value): value is number => Number.isFinite(value))
        .every((value) => Math.abs(value) <= ZERO_BALANCE_TOLERANCE);

      if (depositFullySatisfied || orderTotalsZero) {
        if (depositFullySatisfied && !orderTotalsZero) {
          console.info("Zero deposit order confirmed", {
            createdOrderId,
            dueNowCandidates,
            price: serverPrice,
            netTotal: serverNetTotal,
          });
        } else {
          console.info("Zero balance order confirmed", {
            createdOrderId,
            price: serverPrice,
            netTotal: serverNetTotal,
          });
        }

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
      const token = await user.getIdToken();
      const orderData = await callCreateOrder(token);
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
