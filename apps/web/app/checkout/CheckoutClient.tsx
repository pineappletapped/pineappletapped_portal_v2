"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { httpsCallable, type Functions } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { signInWithEmailAndPassword, type Auth, type User } from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import { useCart } from "@/lib/cart";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";
import { useLeadSourceTag } from "@/hooks/useLeadSourceTag";
import {
  leadSourceDetailPlaceholder,
  leadSourceKindLabel,
  type LeadSourceKind,
} from "@/lib/lead-source";
import { VAT_RATE } from "@/lib/vat";
import CheckoutPaymentForm from "./CheckoutPaymentForm";

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

function CheckoutClient({ publishableKey }: CheckoutClientProps) {
  const { items, clear } = useCart();
  const productTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const rentalTotal = items.reduce(
    (sum, i) => sum + (i.rentalTotal || 0) * i.quantity,
    0
  );
  const [discount, setDiscount] = useState(0);
  const discountAmount = productTotal * (discount / 100);
  const finalTotal = productTotal - discountAmount + rentalTotal;
  const vat = finalTotal * VAT_RATE;
  const grandTotal = finalTotal + vat;
  const router = useRouter();
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );
  const stripeConfigError = publishableKey ? null : "Stripe publishable key is not configured.";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [voucher, setVoucher] = useState("");
  const [allowLocationOverride, setAllowLocationOverride] = useState(false);
  const {
    state: leadSourceState,
    setState: setLeadSourceState,
    value: leadSourceValue,
  } = useLeadSourceTag(voucher || null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [initializingPayment, setInitializingPayment] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const authRef = useRef<Auth | null>(null);
  const functionsRef = useRef<Functions | null>(null);
  const lastIntentPayload = useRef<string | null>(null);
  const loginErrorRef = useRef<HTMLDivElement | null>(null);
  const authEmail = currentUser?.email || "";
  const venueLocked = useMemo(
    () =>
      items.length > 0 &&
      items.every(
        (item) =>
          item.coverage?.matchType === "venue" &&
          typeof item.location === "string" &&
          item.location.trim().length > 0
      ),
    [items]
  );
  const lockedVenueLocation = useMemo(() => {
    const preset = items.find(
      (item) => typeof item.location === "string" && item.location.trim().length > 0
    );
    return preset ? preset.location!.trim() : "";
  }, [items]);
  useEffect(() => {
    if (!venueLocked) {
      return;
    }
    if (!location.trim().length && lockedVenueLocation) {
      setLocation(lockedVenueLocation);
    }
  }, [venueLocked, lockedVenueLocation, location]);
  useEffect(() => {
    if (!venueLocked) {
      setAllowLocationOverride(false);
    }
  }, [venueLocked]);
  const shouldShowLocationInput = !venueLocked || allowLocationOverride;
  const orderInput = useMemo(() => {
    type OrganiserLineRole = "organiser" | "exhibitor";
    type OrganiserAccumulator = {
      organiserId: string;
      minimumGuarantee: number | null;
      exhibitorProductId: string | null;
      exhibitorPrice: number | null;
      upsellVariationIds: Set<string>;
      sources: Set<string>;
      quantity: number;
      grossSubtotal: number;
      exhibitorSubtotal: number;
      organiserSubtotal: number;
      items: {
        productId: string;
        variation: string | null;
        quantity: number;
        unitPrice: number;
        lineTotal: number;
        role: OrganiserLineRole;
      }[];
    };

    const organiserMap = new Map<string, OrganiserAccumulator>();

    const itemPayload = items.map((item) => {
      const warnings = Array.isArray(item.kitWarnings)
        ? item.kitWarnings
            .map((warning) => (typeof warning === "string" ? warning.trim() : ""))
            .filter((warning) => warning.length > 0)
        : [];
      const campaignBooking = item.campaignBooking
        ? {
            projectId: item.campaignBooking.projectId,
            bookingId: item.campaignBooking.bookingId,
            slotId: item.campaignBooking.slotId,
            slotLabel: item.campaignBooking.slotLabel,
            slotStartAt: item.campaignBooking.slotStartAt ?? null,
            slotEndAt: item.campaignBooking.slotEndAt ?? null,
            priceClass: item.campaignBooking.priceClass ?? null,
            priceAdjustment: item.campaignBooking.priceAdjustment ?? 0,
          }
        : null;
      const organiser = item.organiser
        ? {
            organiserId: item.organiser.organiserId,
            minimumGuarantee: item.organiser.minimumGuarantee ?? null,
            exhibitorProductId: item.organiser.exhibitorProductId ?? null,
            exhibitorPrice: item.organiser.exhibitorPrice ?? null,
            upsellVariationIds: item.organiser.upsellVariationIds ?? [],
            source: item.organiser.source ?? null,
            lineRole:
              item.organiser.exhibitorProductId &&
              item.organiser.exhibitorProductId === item.id
                ? ("exhibitor" as OrganiserLineRole)
                : ("organiser" as OrganiserLineRole),
          }
        : null;

      if (organiser) {
        const quantity = Math.max(1, item.quantity);
        const lineTotal = item.price * quantity;
        const existing = organiserMap.get(organiser.organiserId);
        const accumulator: OrganiserAccumulator = existing ?? {
          organiserId: organiser.organiserId,
          minimumGuarantee: organiser.minimumGuarantee ?? null,
          exhibitorProductId: organiser.exhibitorProductId ?? null,
          exhibitorPrice: organiser.exhibitorPrice ?? null,
          upsellVariationIds: new Set<string>(),
          sources: new Set<string>(),
          quantity: 0,
          grossSubtotal: 0,
          exhibitorSubtotal: 0,
          organiserSubtotal: 0,
          items: [],
        };

        if (organiser.minimumGuarantee != null) {
          accumulator.minimumGuarantee =
            accumulator.minimumGuarantee == null
              ? organiser.minimumGuarantee
              : Math.max(accumulator.minimumGuarantee, organiser.minimumGuarantee);
        }
        if (organiser.exhibitorProductId) {
          accumulator.exhibitorProductId = organiser.exhibitorProductId;
        }
        if (organiser.exhibitorPrice != null) {
          accumulator.exhibitorPrice = organiser.exhibitorPrice;
        }
        organiser.upsellVariationIds.forEach((id) => {
          if (typeof id === "string" && id.trim().length > 0) {
            accumulator.upsellVariationIds.add(id.trim());
          }
        });
        if (organiser.source) {
          accumulator.sources.add(organiser.source);
        }

        accumulator.quantity += quantity;
        accumulator.grossSubtotal += lineTotal;
        if (organiser.lineRole === "exhibitor") {
          accumulator.exhibitorSubtotal += lineTotal;
        } else {
          accumulator.organiserSubtotal += lineTotal;
        }
        accumulator.items.push({
          productId: item.id,
          variation: item.variation ?? null,
          quantity,
          unitPrice: item.price,
          lineTotal,
          role: organiser.lineRole,
        });

        organiserMap.set(organiser.organiserId, accumulator);
      }
      return {
        id: item.id,
        quantity: item.quantity,
        rentalTotal: item.rentalTotal ?? 0,
        modifiers: (item.modifiers ?? []).map((mod) => ({ ...mod })),
        kitStatus: item.kitStatus === "pending" ? "pending" : "confirmed",
        kitWarnings: warnings,
        variation: item.variation ?? null,
        date: item.date ?? null,
        location: item.location ?? null,
        postalCode: item.postalCode ?? null,
        exhibition: item.exhibition ?? null,
        timeSlot: item.timeSlot ?? null,
        coverage: item.coverage ?? null,
        campaignBooking,
        organiser,
      };
    });
    const organiserSummary = Array.from(organiserMap.values()).map((entry) => ({
      organiserId: entry.organiserId,
      minimumGuarantee: entry.minimumGuarantee,
      exhibitorProductId: entry.exhibitorProductId,
      exhibitorPrice: entry.exhibitorPrice,
      upsellVariationIds: Array.from(entry.upsellVariationIds),
      sources: Array.from(entry.sources),
      quantity: entry.quantity,
      grossSubtotal: entry.grossSubtotal,
      exhibitorSubtotal: entry.exhibitorSubtotal,
      organiserSubtotal: entry.organiserSubtotal,
      items: entry.items,
    }));

    const kitItemsPayload = items.flatMap((item) => item.kitItems || []);
    const kitReservationStatus = items.some((item) => item.kitStatus === "pending")
      ? "pending"
      : "confirmed";
    const kitReservationWarnings = Array.from(
      new Set(
        items.flatMap((item) =>
          Array.isArray(item.kitWarnings)
            ? item.kitWarnings
                .map((warning) => (typeof warning === "string" ? warning.trim() : ""))
                .filter((warning) => warning.length > 0)
            : []
        )
      )
    );
    return {
      items: itemPayload,
      kitItems: kitItemsPayload,
      rentalSubtotal: rentalTotal,
      kitReservationStatus,
      kitReservationWarnings,
      userEmail: authEmail || email,
      customerName: name,
      companyName: company || null,
      location: location || null,
      postalCode: postalCode || null,
      projectName: projectName || null,
      voucher: voucher || null,
      leadSource: leadSourceValue,
      organisers: organiserSummary,
    };
  }, [
    items,
    rentalTotal,
    authEmail,
    email,
    name,
    company,
    location,
    postalCode,
    projectName,
    voucher,
    leadSourceValue,
  ]);
  const currentIntentPayload = useMemo(
    () =>
      JSON.stringify({
        ...orderInput,
        items: orderInput.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          rentalTotal: item.rentalTotal,
          modifiers: (item.modifiers ?? []).map((mod) => ({
            groupId: mod.groupId,
            optionId: mod.optionId,
            price: mod.price ?? null,
          })),
          kitStatus: item.kitStatus,
          kitWarnings: item.kitWarnings,
          variation: item.variation,
          date: item.date,
          location: item.location,
          postalCode: item.postalCode,
          coverage: item.coverage,
          timeSlot: item.timeSlot ?? null,
          exhibition: item.exhibition ?? null,
          campaignBooking: item.campaignBooking,
          organiser: item.organiser,
        })),
        kitItems: orderInput.kitItems.map((kit) => ({
          id: kit.id,
          name: kit.name ?? null,
          category: kit.category ?? null,
          start: kit.start,
          end: kit.end,
        })),
        kitReservationStatus: orderInput.kitReservationStatus,
        kitReservationWarnings: orderInput.kitReservationWarnings,
        organisers: orderInput.organisers,
      }),
    [orderInput]
  );
  const paymentDetailsStale =
    lastIntentPayload.current !== null &&
    lastIntentPayload.current !== currentIntentPayload;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db, functions } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || !db) {
          throw new Error("Firebase auth or database is unavailable.");
        }

        authRef.current = auth;
        functionsRef.current = functions ?? null;

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== "function") {
          throw new Error("Firebase auth listener helper is unavailable.");
        }

        unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
          if (cancelled) {
            return;
          }

          setCurrentUser(user);
          if (user) {
            try {
              setEmail(user.email || "");
              setName(user.displayName || "");
              const snap = await getDoc(doc(db, "users", user.uid));
              setDiscount((snap.data()?.discount as number) || 0);
            } catch (error) {
              console.error("Failed to load user discount", error);
              setDiscount(0);
            }
          } else {
            setDiscount(0);
          }
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to initialise Firebase for checkout", error);
          setCurrentUser(null);
          setDiscount(0);
        }
      } finally {
        if (!cancelled) {
          setAuthReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      setClientSecret(null);
      setOrderId(null);
      lastIntentPayload.current = null;
      setPaymentError(null);
    }
  }, [items.length]);

  useEffect(() => {
    if (!currentUser) {
      setClientSecret(null);
      setOrderId(null);
      lastIntentPayload.current = null;
      setPaymentError(null);
    } else {
      setLoginError(null);
    }
    setIsLoggingIn(false);
  }, [currentUser]);

  useEffect(() => {
    if (loginError && loginErrorRef.current) {
      loginErrorRef.current.focus();
    }
  }, [loginError]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      let instance = authRef.current;
      if (!instance) {
        const { auth } = await ensureFirebase();
        instance = auth ?? null;
        authRef.current = instance;
      }
      if (!instance) {
        throw new Error("Firebase auth is unavailable.");
      }
      await signInWithEmailAndPassword(instance, email, password);
    } catch (err) {
      console.error(err);
      let message = "We couldn't sign you in. Check your email and password, then try again.";
      const firebaseErr = err as Partial<FirebaseError> | null;
      if (firebaseErr && typeof firebaseErr === "object" && "code" in firebaseErr) {
        switch (firebaseErr.code) {
          case "auth/wrong-password":
          case "auth/invalid-credential":
            message = "Incorrect email or password. Try again or reset your password.";
            break;
          case "auth/user-not-found":
            message = "No account exists for that email. Create an account or contact support for help.";
            break;
          case "auth/too-many-requests":
            message = "Too many failed attempts. Reset your password or wait a moment before trying again.";
            break;
          default:
            message = firebaseErr.message || message;
            break;
        }
      } else if (err instanceof Error && err.message) {
        message = err.message;
      }
      setLoginError(message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const initializePaymentIntent = useCallback(async () => {
    if (initializingPayment) {
      return false;
    }
    if (!currentUser) {
      setPaymentError("Sign in to continue to payment.");
      return false;
    }
    if (items.length === 0) {
      setPaymentError("Your cart is empty.");
      return false;
    }
    if (!orderInput.customerName) {
      setPaymentError("Please enter your name before continuing.");
      return false;
    }
    if (!orderInput.postalCode) {
      setPaymentError("Please provide a postcode for the shoot location.");
      return false;
    }
    if (!stripePromise) {
      setPaymentError(stripeConfigError || "Payment configuration is unavailable.");
      return false;
    }

    setInitializingPayment(true);
    setPaymentError(null);

    try {
      let functionsInstance = functionsRef.current;
      if (!functionsInstance) {
        const { functions } = await ensureFirebase();
        functionsInstance = functions ?? null;
        functionsRef.current = functionsInstance;
      }
      if (!functionsInstance) {
        throw new Error("Firebase functions are unavailable.");
      }

      const createOrder = httpsCallable(functionsInstance, "createOrder");
      const orderRes: any = await createOrder(orderInput);
      const createdOrderId: string | undefined = orderRes.data?.orderId;
      if (!createdOrderId) {
        throw new Error("Failed to create order.");
      }

      const createIntent = httpsCallable(
        functionsInstance,
        "stripe_createPaymentIntent"
      );
      const intentRes: any = await createIntent({
        orderId: createdOrderId,
        type: "deposit",
      });
      const secret: string | undefined = intentRes.data?.clientSecret;
      if (!secret) {
        throw new Error("Payment session could not be created.");
      }

      setOrderId(createdOrderId);
      setClientSecret(secret);
      lastIntentPayload.current = currentIntentPayload;
      return true;
    } catch (error) {
      console.error("Failed to initialise payment intent", error);
      const message =
        error instanceof Error ? error.message : "Could not start payment.";
      setPaymentError(message);
      setOrderId(null);
      setClientSecret(null);
      return false;
    } finally {
      setInitializingPayment(false);
    }
  }, [
    currentUser,
    currentIntentPayload,
    initializingPayment,
    items.length,
    orderInput,
    stripePromise,
    stripeConfigError,
  ]);

  useEffect(() => {
    if (
      authReady &&
      currentUser &&
      !clientSecret &&
      !initializingPayment &&
      items.length > 0 &&
      name &&
      stripePromise
    ) {
      void initializePaymentIntent();
    }
  }, [
    authReady,
    clientSecret,
    currentUser,
    initializePaymentIntent,
    initializingPayment,
    items.length,
    name,
    stripePromise,
  ]);

  const handlePaymentSuccess = useCallback(
    (completedOrderId: string) => {
      clear();
      router.push(`/orders/${completedOrderId}`);
    },
    [clear, router]
  );

  const handleLeadSourceKindChange = (kind: LeadSourceKind) => {
    setLeadSourceState((prev) => {
      const nextDetail =
        kind === "hq"
          ? ""
          : kind === "franchise_voucher"
            ? prev.detail || voucher
            : prev.detail;
      return { kind, detail: nextDetail ?? "" };
    });
  };

  return (
    <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
      <div className="space-y-6">
        {authReady && !currentUser && (
          <form onSubmit={login} className="space-y-2 border p-4 rounded" noValidate>
            <h2 className="font-semibold">Login</h2>
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
              onChange={(e) => {
                setEmail(e.target.value);
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
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (loginError) {
                  setLoginError(null);
                }
              }}
              autoComplete="current-password"
              required
            />
            <button className="btn w-full" type="submit" disabled={isLoggingIn}>
              {isLoggingIn ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        <div className="space-y-2">
          <h2 className="font-semibold">Customer Details</h2>
          {!currentUser && (
            <input
              className="input input-bordered w-full"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (loginError) {
                  setLoginError(null);
                }
              }}
              required
            />
          )}
          <input
            className="input input-bordered w-full"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input input-bordered w-full"
            placeholder="Company Name"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          {venueLocked && !allowLocationOverride ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">
                Filming at {lockedVenueLocation || "the booked venue"}
              </p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-orange"
                onClick={() => setAllowLocationOverride(true)}
              >
                Use a different location
              </button>
            </div>
          ) : null}
          {shouldShowLocationInput && (
            <input
              className="input input-bordered w-full"
              placeholder="Shooting Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}
          <input
            className="input input-bordered w-full"
            placeholder="Postcode"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value.toUpperCase())}
            required
          />
          <input
            className="input input-bordered w-full"
            placeholder="Project Name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
          <fieldset className="space-y-3 rounded border p-4">
            <legend className="text-sm font-semibold">Lead Source</legend>
            <p className="text-xs text-gray-600">
              Tag the lead before checkout so franchise royalties and commissions
              are allocated correctly.
            </p>
            <div className="grid gap-2">
              {LEAD_SOURCE_OPTIONS.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="leadSource"
                    value={option}
                    checked={leadSourceState.kind === option}
                    onChange={() => handleLeadSourceKindChange(option)}
                  />
                  {leadSourceKindLabel(option)}
                </label>
              ))}
            </div>
            {leadSourceState.kind !== "hq" && (
              <input
                className="input input-bordered w-full"
                placeholder={leadSourceDetailPlaceholder(leadSourceState.kind)}
                value={leadSourceState.detail}
                onChange={(e) =>
                  setLeadSourceState((prev) => ({
                    ...prev,
                    detail: e.target.value,
                  }))
                }
              />
            )}
          </fieldset>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="font-semibold">Order Summary</h2>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="text-sm">
              <div className="flex justify-between">
                <span>
                  {item.name} x {item.quantity}
                </span>
                <span>£{(item.price * item.quantity).toFixed(2)}</span>
              </div>
              {(() => {
                const parseDateTime = (value: string | null | undefined) => {
                  if (!value) return null;
                  const normalised =
                    /^\d{4}-\d{2}-\d{2}$/.test(value)
                      ? `${value}T00:00:00`
                      : value;
                  const parsed = new Date(normalised);
                  return Number.isNaN(parsed.getTime()) ? null : parsed;
                };
                const slot = item.timeSlot;
                if (!slot) {
                  return null;
                }
                if (slot.label) {
                  return (
                    <div className="text-xs text-gray-500">Time: {slot.label}</div>
                  );
                }
                const start = parseDateTime(slot.start);
                const end = parseDateTime(slot.end);
                if (start && end) {
                  return (
                    <div className="text-xs text-gray-500">
                      Time: {start.toLocaleTimeString("en-GB", { timeStyle: "short" })} – {" "}
                      {end.toLocaleTimeString("en-GB", { timeStyle: "short" })}
                    </div>
                  );
                }
                if (start) {
                  return (
                    <div className="text-xs text-gray-500">
                      Time: {start.toLocaleTimeString("en-GB", { timeStyle: "short" })}
                    </div>
                  );
                }
                return null;
              })()}
              {item.rentalTotal ? (
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Rental</span>
                  <span>£{(item.rentalTotal * item.quantity).toFixed(2)}</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex justify-between font-semibold border-t pt-2">
          <span>Subtotal</span>
          <span>£{productTotal.toFixed(2)}</span>
        </div>
        {rentalTotal > 0 && (
          <div className="flex justify-between text-sm">
            <span>Rental Subtotal</span>
            <span>£{rentalTotal.toFixed(2)}</span>
          </div>
        )}
        {discount > 0 && (
          <div className="flex justify-between text-sm">
            <span>Discount ({discount}%)</span>
            <span>-£{discountAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span>VAT (20%)</span>
          <span>£{vat.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>£{grandTotal.toFixed(2)}</span>
        </div>
        <input
          className="input input-bordered w-full"
          placeholder="Voucher code"
          value={voucher}
          onChange={(e) => setVoucher(e.target.value)}
        />
        <div className="border rounded p-4 space-y-4">
          {paymentError ? (
            <div
              className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {paymentError}
            </div>
          ) : null}
          {clientSecret && orderId && stripePromise ? (
            <>
              {paymentDetailsStale ? (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Your customer or cart details have changed. Refresh your
                  payment session before confirming.
                </div>
              ) : null}
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CheckoutPaymentForm
                  orderId={orderId}
                  disabled={paymentDetailsStale || initializingPayment}
                  onSuccess={handlePaymentSuccess}
                  onError={setPaymentError}
                />
              </Elements>
              {paymentDetailsStale ? (
                <button
                  type="button"
                  className="btn btn-ghost w-full"
                  onClick={initializePaymentIntent}
                  disabled={initializingPayment}
                >
                  {initializingPayment
                    ? "Refreshing..."
                    : "Refresh payment details"}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                {items.length === 0
                  ? "Add items to your cart to continue."
                  : !currentUser
                  ? "Sign in to continue to payment."
                  : !name
                  ? "Enter your name to continue."
                  : stripeConfigError
                  ? stripeConfigError
                  : !stripePromise
                  ? "Payment is currently unavailable."
                  : "Prepare your payment details to enter card information."}
              </p>
              <button
                type="button"
                className="btn w-full"
                onClick={initializePaymentIntent}
                disabled={
                  initializingPayment ||
                  items.length === 0 ||
                  !currentUser ||
                  !name ||
                  Boolean(stripeConfigError) ||
                  !stripePromise
                }
              >
                {initializingPayment
                  ? "Preparing payment..."
                  : "Prepare payment"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CheckoutClient;
