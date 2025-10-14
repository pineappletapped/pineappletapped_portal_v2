"use client";

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

  const callCreateOrder = useCallback(
    async (token: string | null): Promise<CreateOrderResult> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch("/api/create-order", {
        method: "POST",
        headers,
        body: JSON.stringify(orderInput),
        credentials: "include",
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (parseError) {
        if (!response.ok) {
          const error = Object.assign(new Error(`Failed to create order (${response.status})`), {
            code: "create-order-error",
          });
          throw error;
        }
        throw parseError;
      }

      const payloadRecord =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;

      if (!response.ok || !payloadRecord) {
        const message =
          payloadRecord && typeof payloadRecord.error === "string" && payloadRecord.error.trim().length > 0
            ? payloadRecord.error
            : payloadRecord && typeof payloadRecord.message === "string" && payloadRecord.message.trim().length > 0
              ? payloadRecord.message
              : `Failed to create order (${response.status})`;
        const error = Object.assign(new Error(message), {
          code:
            payloadRecord && typeof payloadRecord.code === "string" && payloadRecord.code.trim().length > 0
              ? payloadRecord.code
              : "create-order-error",
          details: payloadRecord?.details,
        });
        throw error;
      }

      const data = payloadRecord.data;
      if (!data || typeof data !== "object") {
        return {};
      }

      return data as CreateOrderResult;
    },
    [orderInput],
  );

  const initialisePayment = useCallback(async () => {
    if (initializing) {
      return false;
    }
    if (hasZeroBalance) {
      setPaymentError(
        "This order no longer requires payment. Confirm your order to continue.",
      );
      return false;
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

      const functionsInstance = await ensureFunctions();
      const createIntent = httpsCallable(functionsInstance, "stripe_createPaymentIntent");
      const intentResponse: any = await createIntent({
        orderId: createdOrderId,
        type: "deposit",
      });
      const secret: string | undefined = intentResponse.data?.clientSecret;
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
    ensureFunctions,
    ensureUser,
    hasZeroBalance,
    initializing,
    intentPayload,
    stripePromise,
    validate,
  ]);

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

      const functionsInstance = await ensureFunctions();
      const createIntent = httpsCallable(functionsInstance, "stripe_createPaymentIntent");
      const intentResponse: any = await createIntent({
        orderId: createdOrderId,
        type: "deposit",
      });
      const secret: string | undefined = intentResponse.data?.clientSecret;
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
  }, [
    callCreateOrder,
    ensureFunctions,
    ensureUser,
    intentPayload,
    onSuccess,
    validate,
    initializing,
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
