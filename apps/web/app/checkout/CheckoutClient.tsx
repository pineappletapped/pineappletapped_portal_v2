"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { FirebaseError } from "firebase/app";
import { useRouter } from "next/navigation";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

import { useLeadSourceTag } from "@/hooks/useLeadSourceTag";
import { useCart } from "@/lib/cart";
import {
  leadSourceDetailPlaceholder,
  leadSourceKindLabel,
  type LeadSourceKind,
} from "@/lib/lead-source";

import CheckoutPaymentForm from "./CheckoutPaymentForm";
import { createOrderInput } from "./buildOrderInput";
import { useCheckoutAuth, MIN_ACCOUNT_PASSWORD_LENGTH } from "./useCheckoutAuth";
import { useCheckoutPayment } from "./useCheckoutPayment";
import { useCheckoutTotals } from "./useCheckoutTotals";
import { useVoucherEvaluation } from "./useVoucherEvaluation";

const LEAD_SOURCE_OPTIONS: LeadSourceKind[] = [
  "hq",
  "franchise_referral",
  "franchise_affiliate",
  "franchise_voucher",
  "other",
];

interface CheckoutClientProps {
  publishableKey: string | null;
}

interface VoucherFeedbackMessage {
  text: string | null;
  tone: "muted" | "success" | "warning" | "error";
}

const describeAccountRequirement = (
  reason: "login-required" | "email-missing" | "password-too-short" | "password-mismatch" | null,
  context: "payment" | "checkout",
) => {
  switch (reason) {
    case "login-required":
      return context === "payment"
        ? "Sign in to continue to payment."
        : "Sign in to continue to checkout.";
    case "email-missing":
      return "Enter your email to continue.";
    case "password-too-short":
      return `Create a password with at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters to continue.`;
    case "password-mismatch":
      return "Confirm your password to continue.";
    default:
      return context === "payment"
        ? "Complete your account details to continue to payment."
        : "Complete your account details to continue to checkout.";
  }
};

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

export default function CheckoutClient({ publishableKey }: CheckoutClientProps) {
  const router = useRouter();
  const { items, clear } = useCart();

  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [allowLocationOverride, setAllowLocationOverride] = useState(false);

  const [loginPassword, setLoginPassword] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const loginErrorRef = useRef<HTMLDivElement | null>(null);

  const presetLocation = useMemo(() => {
    const entry = items.find(
      (item) => typeof item.location === "string" && item.location.trim().length > 0,
    );
    return entry ? entry.location!.trim() : "";
  }, [items]);

  const presetPostalCode = useMemo(() => {
    const entry = items.find(
      (item) => typeof item.postalCode === "string" && item.postalCode.trim().length > 0,
    );
    return entry ? entry.postalCode!.trim() : "";
  }, [items]);

  useEffect(() => {
    if (!location && presetLocation) {
      setLocation(presetLocation);
    }
  }, [location, presetLocation]);

  useEffect(() => {
    if (!postalCode && presetPostalCode) {
      setPostalCode(presetPostalCode);
    }
  }, [postalCode, presetPostalCode]);

  const venueLocked = useMemo(
    () =>
      items.length > 0 &&
      items.every(
        (item) =>
          item.coverage?.matchType === "venue" &&
          typeof item.location === "string" &&
          item.location.trim().length > 0,
      ),
    [items],
  );

  useEffect(() => {
    if (!venueLocked) {
      setAllowLocationOverride(false);
    }
  }, [venueLocked]);

  const auth = useCheckoutAuth({
    onKnownEmail: setEmail,
    onKnownName: (value) => {
      if (!name) {
        setName(value);
      }
    },
  });

  const {
    state: leadSourceState,
    setState: setLeadSourceState,
    value: leadSourceValue,
  } = useLeadSourceTag(null);

  const voucher = useVoucherEvaluation(items, location);

  const totals = useCheckoutTotals(items, voucher.appliedDiscount, auth.discount);

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  const voucherFeedback: VoucherFeedbackMessage = useMemo(() => {
    switch (voucher.state.status) {
      case "checking":
        return { text: "Checking voucher…", tone: "muted" };
      case "applied":
        return {
          text: `Voucher applied${
            voucher.state.code ? ` (${voucher.state.code})` : ""
          } – £${totals.voucherDiscount.toFixed(2)} off.`,
          tone: "success",
        };
      case "invalid":
        return { text: "Voucher code not recognised.", tone: "error" };
      case "awaiting-location":
      case "awaiting-items":
      case "ineligible":
        return { text: voucher.state.message, tone: "warning" };
      case "error":
        return {
          text: voucher.state.message || "We couldn't validate that voucher. Try again.",
          tone: "error",
        };
      default:
        return { text: null, tone: "muted" };
    }
  }, [voucher.state, totals.voucherDiscount]);

  const voucherMessageClass = useMemo(() => {
    switch (voucherFeedback.tone) {
      case "success":
        return "text-emerald-600";
      case "warning":
        return "text-amber-600";
      case "error":
        return "text-red-600";
      default:
        return "text-gray-500";
    }
  }, [voucherFeedback]);

  const accountRequirement = useMemo(() => {
    if (auth.user) {
      return null;
    }
    if (authMode === "login") {
      return "login-required" as const;
    }
    if (!email.trim()) {
      return "email-missing" as const;
    }
    if (registerPassword.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
      return "password-too-short" as const;
    }
    if (registerPassword !== confirmPassword) {
      return "password-mismatch" as const;
    }
    return null;
  }, [auth.user, authMode, email, registerPassword, confirmPassword]);

  const ensureCheckoutUser = useCallback(async () => {
    if (auth.user) {
      return auth.user;
    }
    if (authMode === "login") {
      throw new Error("Sign in to continue to checkout.");
    }
    const created = await auth.ensureUser(email, registerPassword, name, confirmPassword);
    if (!created) {
      throw new Error(
        auth.error || "Create your portal account by setting a password before continuing.",
      );
    }
    return created;
  }, [auth, authMode, email, registerPassword, name, confirmPassword]);

  const validateBeforeSubmit = useCallback(() => {
    if (items.length === 0) {
      return "Add items to your cart to continue.";
    }
    if (!name.trim()) {
      return "Please enter your name before continuing.";
    }
    if (!postalCode.trim()) {
      return "Please provide a postcode for the shoot location.";
    }
    if (!auth.user && accountRequirement) {
      return describeAccountRequirement(accountRequirement, "checkout");
    }
    return null;
  }, [items.length, name, postalCode, auth.user, accountRequirement]);

  const orderInput = useMemo(
    () =>
      createOrderInput({
        items,
        rentalTotal: totals.rentalTotal,
        userEmail: auth.user?.email || "",
        fallbackEmail: email,
        customerName: name,
        companyName: company,
        location,
        postalCode,
        projectName,
        voucher: voucher.state.code ?? voucher.input,
        leadSource: leadSourceValue,
      }),
    [
      items,
      totals.rentalTotal,
      auth.user?.email,
      email,
      name,
      company,
      location,
      postalCode,
      projectName,
      voucher.state.code,
      voucher.input,
      leadSourceValue,
    ],
  );

  const handleOrderSuccess = useCallback(
    (createdOrderId: string) => {
      clear();
      router.push(`/orders/${createdOrderId}`);
    },
    [clear, router],
  );

  const payment = useCheckoutPayment({
    orderInput,
    hasZeroBalance: totals.hasZeroBalance,
    stripePromise,
    ensureUser: ensureCheckoutUser,
    validate: validateBeforeSubmit,
    onSuccess: handleOrderSuccess,
  });

  useEffect(() => {
    if (loginError && loginErrorRef.current) {
      loginErrorRef.current.focus();
    }
  }, [loginError]);

  useEffect(() => {
    if (
      auth.status === "ready" &&
      auth.user &&
      !totals.hasZeroBalance &&
      !payment.clientSecret &&
      !payment.initializing &&
      items.length > 0 &&
      name.trim() &&
      stripePromise
    ) {
      void payment.initialisePayment();
    }
  }, [
    auth.status,
    auth.user,
    totals.hasZeroBalance,
    payment.clientSecret,
    payment.initializing,
    payment.initialisePayment,
    items.length,
    name,
    stripePromise,
  ]);

  const handleLogin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLoginError(null);
      try {
        await auth.login(email, loginPassword);
      } catch (error) {
        console.error("Failed to sign in", error);
        const firebaseError = error as Partial<FirebaseError> | null;
        if (firebaseError && typeof firebaseError === "object" && "code" in firebaseError) {
          switch (firebaseError.code) {
            case "auth/wrong-password":
            case "auth/invalid-credential":
              setLoginError("Incorrect email or password. Try again or reset your password.");
              break;
            case "auth/user-not-found":
              setLoginError("No account exists for that email. Create an account or contact support for help.");
              break;
            case "auth/too-many-requests":
              setLoginError("Too many failed attempts. Reset your password or wait before trying again.");
              break;
            default:
              setLoginError(firebaseError.message || "We couldn't sign you in. Please try again.");
              break;
          }
        } else if (error instanceof Error && error.message) {
          setLoginError(error.message);
        } else {
          setLoginError("We couldn't sign you in. Check your details and try again.");
        }
      }
    },
    [auth, email, loginPassword],
  );

  const handleLeadSourceKindChange = useCallback(
    (kind: LeadSourceKind) => {
      setLeadSourceState((prev) => {
        const detail =
          kind === "hq"
            ? ""
            : kind === "franchise_voucher"
              ? prev.detail || voucher.input
              : prev.detail;
        return { kind, detail: detail ?? "" };
      });
    },
    [setLeadSourceState, voucher.input],
  );

  const voucherLabel = voucher.state.code ?? (voucher.input.trim() || null);

  const zeroBalanceMessage = totals.hasZeroBalance
    ? "Your voucher covers the full balance. Confirm your order to continue."
    : describeAccountRequirement(accountRequirement, "payment");

  const zeroBalanceButtonDisabled =
    payment.initializing || (!auth.user && Boolean(accountRequirement));

  return (
    <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
      <div className="space-y-6">
        {auth.status === "ready" && !auth.user && (
          authMode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-3 rounded border p-4" noValidate>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">Login</h2>
                <button
                  type="button"
                  className="text-sm font-semibold text-orange"
                  onClick={() => {
                    setAuthMode("register");
                    setLoginPassword("");
                    setLoginError(null);
                  }}
                >
                  New customer? Create an account
                </button>
              </div>
              {loginError ? (
                <div
                  ref={loginErrorRef}
                  className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                  role="alert"
                  tabIndex={-1}
                >
                  {loginError}
                </div>
              ) : null}
              <input
                className="input input-bordered w-full"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (loginError) {
                    setLoginError(null);
                  }
                }}
                autoComplete="email"
                required
              />
              <input
                className="input input-bordered w-full"
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(event) => {
                  setLoginPassword(event.target.value);
                  if (loginError) {
                    setLoginError(null);
                  }
                }}
                autoComplete="current-password"
                required
              />
              <button className="btn w-full" type="submit">
                Sign In
              </button>
            </form>
          ) : (
            <div className="space-y-3 rounded border p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">Create Account</h2>
                <button
                  type="button"
                  className="text-sm font-semibold text-orange"
                  onClick={() => {
                    setAuthMode("login");
                    setRegisterPassword("");
                    setConfirmPassword("");
                    auth.clearError();
                  }}
                >
                  Already registered? Sign in
                </button>
              </div>
              <p className="text-sm text-gray-600">
                Enter your email and customer details below, then set a password to create your Pineapple
                Tapped portal account during checkout.
              </p>
              <p className="text-xs text-gray-500">
                We&apos;ll confirm your order and send account access details to the email you provide.
              </p>
            </div>
          )
        )}

        <div className="space-y-2">
          <h2 className="font-semibold">Customer Details</h2>
          {!auth.user && (
            <input
              className="input input-bordered w-full"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                auth.clearError();
              }}
              required
            />
          )}
          {!auth.user && authMode === "register" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="input input-bordered w-full"
                type="password"
                placeholder="Create password"
                value={registerPassword}
                onChange={(event) => {
                  setRegisterPassword(event.target.value);
                  auth.clearError();
                }}
                autoComplete="new-password"
                required
                minLength={MIN_ACCOUNT_PASSWORD_LENGTH}
              />
              <input
                className="input input-bordered w-full"
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  auth.clearError();
                }}
                autoComplete="new-password"
                required
              />
            </div>
          )}
          <input
            className="input input-bordered w-full"
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <input
            className="input input-bordered w-full"
            type="text"
            placeholder="Company (optional)"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
          <textarea
            className="textarea textarea-bordered w-full"
            placeholder="Project or shoot notes (optional)"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            rows={3}
          />
          <div className="space-y-2 rounded border p-3">
            <div className="flex items-center justify-between">
              <label className="font-medium">Shoot location</label>
              {venueLocked ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-orange"
                  onClick={() => setAllowLocationOverride((value) => !value)}
                >
                  {allowLocationOverride ? "Use cart location" : "Override"}
                </button>
              ) : null}
            </div>
            <input
              className="input input-bordered w-full"
              type="text"
              placeholder="Venue or address"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              disabled={venueLocked && !allowLocationOverride}
              required
            />
            <input
              className="input input-bordered w-full"
              type="text"
              placeholder="Postcode"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2 rounded border p-4">
          <h3 className="font-semibold">How did you hear about us?</h3>
          <select
            className="select select-bordered w-full"
            value={leadSourceState.kind}
            onChange={(event) => handleLeadSourceKindChange(event.target.value as LeadSourceKind)}
          >
            {LEAD_SOURCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {leadSourceKindLabel(option)}
              </option>
            ))}
          </select>
          {leadSourceState.kind !== "hq" ? (
            <input
              className="input input-bordered w-full"
              type="text"
              placeholder={leadSourceDetailPlaceholder(leadSourceState.kind)}
              value={leadSourceState.detail}
              onChange={(event) =>
                setLeadSourceState((prev) => ({ ...prev, detail: event.target.value }))
              }
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="font-semibold">Order Summary</h2>
        <div className="space-y-2 rounded border p-4">
          {items.length === 0 ? (
            <p className="text-sm text-gray-500">Your cart is empty.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {items.map((item, index) => {
                const bookingDate = item.date?.trim() || null;
                const hasRental = (item.rentalTotal || 0) > 0;
                return (
                  <li key={index} className="space-y-1">
                    <div className="flex justify-between">
                      <span>
                        {item.name} x {item.quantity}
                      </span>
                      <span>£{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                    {bookingDate ? (
                      <div className="text-xs text-gray-500">Date: {bookingDate}</div>
                    ) : null}
                    {hasRental ? (
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Rental</span>
                        <span>£{((item.rentalTotal || 0) * item.quantity).toFixed(2)}</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-2 rounded border p-4 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>£{totals.productTotal.toFixed(2)}</span>
          </div>
          {totals.rentalTotal > 0 ? (
            <div className="flex justify-between">
              <span>Rental subtotal</span>
              <span>£{totals.rentalTotal.toFixed(2)}</span>
            </div>
          ) : null}
          {totals.voucherDiscount > 0 ? (
            <div className="flex justify-between text-emerald-700">
              <span>
                Voucher discount{voucherLabel ? ` (${voucherLabel})` : ""}
              </span>
              <span>-£{totals.voucherDiscount.toFixed(2)}</span>
            </div>
          ) : null}
          {totals.discountPercent > 0 ? (
            <div className="flex justify-between">
              <span>Discount ({totals.discountPercent}%)</span>
              <span>-£{totals.discountAmount.toFixed(2)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span>VAT (20%)</span>
            <span>£{totals.vat.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>£{totals.grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <div className="space-y-2 rounded border p-4">
          <div className="flex items-center gap-2">
            <input
              className="input input-bordered grow"
              placeholder="Voucher code"
              value={voucher.input}
              onChange={(event) => voucher.setInput(event.target.value)}
            />
            <button type="button" className="btn" onClick={voucher.apply}>
              Apply
            </button>
            {voucher.state.status !== "idle" ? (
              <button type="button" className="btn btn-ghost" onClick={voucher.clear}>
                Clear
              </button>
            ) : null}
          </div>
          <div className={classNames("min-h-[1.25rem] text-xs", voucherMessageClass)}>
            {voucherFeedback.text ?? "\u00a0"}
          </div>
        </div>

        <div className="space-y-4 rounded border p-4">
          {payment.paymentError || auth.error ? (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {payment.paymentError || auth.error}
            </div>
          ) : null}

          {totals.hasZeroBalance ? (
            <>
              <p className="text-sm text-gray-600">{zeroBalanceMessage}</p>
              <button
                type="button"
                className="btn w-full"
                onClick={() => void payment.completeZeroBalanceOrder()}
                disabled={zeroBalanceButtonDisabled}
              >
                {payment.initializing ? "Submitting order..." : "Proceed with order"}
              </button>
            </>
          ) : payment.clientSecret && payment.orderId && stripePromise ? (
            <>
              {payment.paymentDetailsStale ? (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Your customer or cart details have changed. Refresh your payment session before
                  confirming.
                </div>
              ) : null}
              <Elements stripe={stripePromise} options={{ clientSecret: payment.clientSecret }}>
                <CheckoutPaymentForm
                  orderId={payment.orderId}
                  disabled={payment.paymentDetailsStale || payment.initializing}
                  onSuccess={handleOrderSuccess}
                  onError={payment.reportPaymentError}
                />
              </Elements>
              <button
                type="button"
                className="btn btn-ghost w-full"
                onClick={() => void payment.initialisePayment()}
                disabled={payment.initializing}
              >
                Refresh payment details
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn w-full"
              onClick={() => void payment.initialisePayment()}
              disabled={payment.initializing || !!validateBeforeSubmit() || !stripePromise}
            >
              {payment.initializing ? "Preparing payment..." : "Continue to payment"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
