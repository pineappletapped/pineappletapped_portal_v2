"use client";

import { useState, type FormEvent } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

interface CheckoutPaymentFormProps {
  orderId: string;
  disabled?: boolean;
  onSuccess: (orderId: string) => void;
  onError?: (message: string | null) => void;
}

export default function CheckoutPaymentForm({
  orderId,
  disabled = false,
  onSuccess,
  onError,
}: CheckoutPaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stripe || !elements) {
      setMessage("Payment form is still loading. Please try again.");
      return;
    }
    if (disabled || submitting) {
      return;
    }
    if (typeof window === "undefined") {
      setMessage("Payments are only available in the browser.");
      return;
    }

    setSubmitting(true);
    setMessage(null);
    onError?.(null);

    try {
      const returnUrl = `${window.location.origin}/orders/${orderId}`;
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });

      if (result.error) {
        const errorMessage =
          result.error.message || "Payment could not be completed.";
        setMessage(errorMessage);
        onError?.(errorMessage);
        return;
      }

      const paymentIntent = result.paymentIntent;
      if (
        paymentIntent &&
        (paymentIntent.status === "succeeded" ||
          paymentIntent.status === "processing" ||
          paymentIntent.status === "requires_capture")
      ) {
        onSuccess(orderId);
        return;
      }

      const fallbackMessage = "Payment could not be completed. Please try again.";
      setMessage(fallbackMessage);
      onError?.(fallbackMessage);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Payment failed. Please try again.";
      setMessage(errorMessage);
      onError?.(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      <div aria-live="polite" className="min-h-[1.25rem] text-sm text-red-600">
        {message ? <span role="alert">{message}</span> : null}
      </div>
      <button
        type="submit"
        className="btn w-full"
        disabled={!stripe || !elements || submitting || disabled}
      >
        {submitting ? "Processing..." : "Complete Order"}
      </button>
    </form>
  );
}
