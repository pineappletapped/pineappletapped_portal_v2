"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { httpsCallable, httpsCallableFromURL, type Functions } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import { useCart } from "@/lib/cart";
import { ensureFirebase, functionsBaseUrl, loadAuthModule } from "@/lib/firebase";
import { useLeadSourceTag } from "@/hooks/useLeadSourceTag";
import {
  leadSourceDetailPlaceholder,
  leadSourceKindLabel,
  type LeadSourceKind,
} from "@/lib/lead-source";
import { VAT_RATE } from "@/lib/vat";
import {
  DEFAULT_FUNCTION_BASE,
  LEGACY_FUNCTION_BASES,
  buildCallableEndpointsFromBases,
  normaliseBaseUrl,
  normaliseCallableEndpoint,
  resolveHostedAppBases,
} from "@/lib/callableEndpoints";
import CheckoutPaymentForm from "./CheckoutPaymentForm";

const LEAD_SOURCE_OPTIONS: LeadSourceKind[] = [
  "hq",
  "franchise_referral",
  "franchise_affiliate",
  "franchise_voucher",
  "other",
];

const ZERO_BALANCE_TOLERANCE = 0.005;
const MIN_ACCOUNT_PASSWORD_LENGTH = 8;

const EXPLICIT_CREATE_ORDER_ENDPOINT = process.env.NEXT_PUBLIC_CREATE_ORDER_ENDPOINT;
const PUBLIC_FUNCTIONS_BASE_URL = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL;
const PUBLIC_FIREBASE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_URL;
type AccountRequirementReason =
  | "login-required"
  | "email-missing"
  | "password-too-short"
  | "password-mismatch"
  | null;

interface AccountRequirementState {
  ready: boolean;
  reason: AccountRequirementReason;
}

interface VoucherRecord {
  type?: string | null;
  amount?: number | null;
  locations?: unknown;
  productIds?: unknown;
  categoryIds?: unknown;
}

interface VoucherFetchState {
  code: string | null;
  checking: boolean;
  data: VoucherRecord | null;
  error: string | null;
}

interface VoucherEvaluationResult {
  status:
    | "idle"
    | "checking"
    | "applied"
    | "invalid"
    | "ineligible"
    | "error"
    | "awaiting-location"
    | "awaiting-items";
  discount: number;
  message: string | null;
}

interface CreateOrderResult {
  orderId?: string;
  price?: number;
  netTotal?: number;
  discountAmount?: number;
  voucherDiscount?: number;
  [key: string]: unknown;
}

interface VoucherFeedbackMessage {
  text: string | null;
  tone: "muted" | "success" | "warning" | "error";
}

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
  const router = useRouter();
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );
  const stripeConfigError = publishableKey ? null : "Stripe publishable key is not configured.";

  const [email, setEmail] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [voucher, setVoucher] = useState("");
  const [allowLocationOverride, setAllowLocationOverride] = useState(false);
  const [voucherFetch, setVoucherFetch] = useState<VoucherFetchState>({
    code: null,
    checking: false,
    data: null,
    error: null,
  });
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
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const authRef = useRef<Auth | null>(null);
  const functionsRef = useRef<Functions | null>(null);
  const lastIntentPayload = useRef<string | null>(null);
  const loginErrorRef = useRef<HTMLDivElement | null>(null);
  const authEmail = currentUser?.email || "";
  const accountRequirement = useMemo<AccountRequirementState>(() => {
    if (currentUser) {
      return { ready: true, reason: null };
    }
    if (authMode === "login") {
      return { ready: false, reason: "login-required" };
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ready: false, reason: "email-missing" };
    }
    if (registerPassword.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
      return { ready: false, reason: "password-too-short" };
    }
    if (registerPassword !== confirmPassword) {
      return { ready: false, reason: "password-mismatch" };
    }
    return { ready: true, reason: null };
  }, [
    authMode,
    confirmPassword,
    currentUser,
    email,
    registerPassword,
  ]);
  const describeAccountRequirement = useCallback(
    (reason: AccountRequirementReason, context: "payment" | "checkout") => {
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
    },
    [],
  );
  const switchToLogin = useCallback(() => {
    setAuthMode("login");
    setAccountError(null);
    setRegisterPassword("");
    setConfirmPassword("");
  }, [setAccountError, setAuthMode, setConfirmPassword, setRegisterPassword]);
  const switchToRegister = useCallback(() => {
    setAuthMode("register");
    setLoginError(null);
    setAccountError(null);
    setRegisterPassword("");
    setConfirmPassword("");
  }, [
    setAccountError,
    setAuthMode,
    setConfirmPassword,
    setLoginError,
    setRegisterPassword,
  ]);
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
  const primaryCartLocation = useMemo(() => {
    const entry = items.find(
      (item) => typeof item.location === "string" && item.location.trim().length > 0
    );
    return entry ? entry.location!.trim() : "";
  }, [items]);
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
  useEffect(() => {
    if (location.trim().length === 0 && primaryCartLocation) {
      setLocation(primaryCartLocation);
    }
  }, [location, primaryCartLocation]);

  const parseDateTime = useCallback((value: string | null | undefined) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    const dateWithMinutesPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    const normalised = dateOnlyPattern.test(trimmed)
      ? `${trimmed}T00:00:00`
      : dateWithMinutesPattern.test(trimmed)
        ? `${trimmed}:00`
        : trimmed;
    const parsed = new Date(normalised);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, []);

  const formatDateLabel = useCallback(
    (value: string | null | undefined) => {
      const parsed = parseDateTime(value);
      if (!parsed) return null;
      return parsed.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    },
    [parseDateTime]
  );

  const formatTimeSlotLabel = useCallback(
    (
      slot:
        | null
        | undefined
        | {
            start?: string | null;
            end?: string | null;
            label?: string | null;
          }
    ) => {
      if (!slot) {
        return null;
      }
      if (typeof slot.label === "string" && slot.label.trim().length > 0) {
        return slot.label.trim();
      }
      const start = parseDateTime(slot.start ?? null);
      const end = parseDateTime(slot.end ?? null);
      if (start && end) {
        return `${start.toLocaleTimeString("en-GB", { timeStyle: "short" })} – ${end.toLocaleTimeString("en-GB", { timeStyle: "short" })}`;
      }
      if (start) {
        return start.toLocaleTimeString("en-GB", { timeStyle: "short" });
      }
      return null;
    },
    [parseDateTime]
  );

  useEffect(() => {
    const trimmed = voucher.trim();
    if (!trimmed) {
      setVoucherFetch({ code: null, checking: false, data: null, error: null });
      return;
    }

    let cancelled = false;
    const requestCode = trimmed;
    setVoucherFetch((prev) => ({
      code: requestCode,
      checking: true,
      data: prev.code === requestCode ? prev.data : null,
      error: null,
    }));

    const timeoutId = setTimeout(async () => {
      try {
        const { db } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        if (!db) {
          throw new Error("Firebase database is unavailable.");
        }
        const voucherQuery = query(
          collection(db, "vouchers"),
          where("code", "==", requestCode),
          limit(1)
        );
        const snapshot = await getDocs(voucherQuery);
        if (cancelled) {
          return;
        }
        if (snapshot.empty) {
          setVoucherFetch({ code: requestCode, checking: false, data: null, error: null });
          return;
        }
        const record = snapshot.docs[0].data() as VoucherRecord;
        setVoucherFetch({ code: requestCode, checking: false, data: record, error: null });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "We couldn't validate that voucher. Try again.";
        setVoucherFetch({ code: requestCode, checking: false, data: null, error: message });
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [voucher]);
  const shouldShowLocationInput = !venueLocked || allowLocationOverride;
  const voucherEvaluation: VoucherEvaluationResult = useMemo(() => {
    const trimmedVoucher = voucher.trim();
    if (!trimmedVoucher) {
      return { status: "idle", discount: 0, message: null };
    }
    if (voucherFetch.code !== trimmedVoucher) {
      return { status: "checking", discount: 0, message: null };
    }
    if (voucherFetch.checking) {
      return { status: "checking", discount: 0, message: null };
    }
    if (voucherFetch.error) {
      return { status: "error", discount: 0, message: voucherFetch.error };
    }
    const data = voucherFetch.data;
    if (!data) {
      return {
        status: "invalid",
        discount: 0,
        message: "Voucher code not recognised.",
      };
    }
    if (items.length === 0) {
      return {
        status: "awaiting-items",
        discount: 0,
        message: "Add items to your cart to use this voucher.",
      };
    }
    const record = data as Record<string, unknown>;
    const rawLocations = Array.isArray(record.locations)
      ? (record.locations as unknown[])
          .map((value) =>
            typeof value === "string" ? value.trim().toLowerCase() : ""
          )
          .filter((value) => value.length > 0)
      : [];
    const trimmedLocation = location.trim();
    const normalisedLocation = trimmedLocation.toLowerCase();
    if (rawLocations.length > 0) {
      if (!normalisedLocation) {
        return {
          status: "awaiting-location",
          discount: 0,
          message: "Enter the shoot location to use this voucher.",
        };
      }
      if (!rawLocations.includes(normalisedLocation)) {
        return {
          status: "ineligible",
          discount: 0,
          message: "This voucher is not valid for the selected location.",
        };
      }
    }
    const rawProductIds = Array.isArray(record.productIds)
      ? (record.productIds as unknown[])
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0)
      : [];
    const rawCategoryIds = Array.isArray(record.categoryIds)
      ? (record.categoryIds as unknown[])
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0)
      : [];
    let eligibleSubtotal = 0;
    items.forEach((item) => {
      const matchesProduct =
        rawProductIds.length === 0 || rawProductIds.includes(item.id);
      const matchesCategory =
        rawCategoryIds.length === 0 ||
        (typeof item.category === "string" &&
          rawCategoryIds.includes(item.category));
      if (matchesProduct && matchesCategory) {
        eligibleSubtotal += item.price * item.quantity;
      }
    });
    if (eligibleSubtotal <= 0) {
      return {
        status: "ineligible",
        discount: 0,
        message: "This voucher does not apply to the items in your cart.",
      };
    }
    const amountValue = (record.amount ?? 0) as unknown;
    const amount =
      typeof amountValue === "number" ? amountValue : Number(amountValue);
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        status: "ineligible",
        discount: 0,
        message: "This voucher is not currently offering a discount.",
      };
    }
    const typeValue = record.type;
    const voucherType =
      typeof typeValue === "string" ? typeValue : "percentage";
    let computedDiscount = 0;
    if (voucherType === "percentage") {
      computedDiscount = eligibleSubtotal * (amount / 100);
    } else if (voucherType === "fixed") {
      computedDiscount = Math.min(amount, eligibleSubtotal);
    } else {
      computedDiscount = eligibleSubtotal * (amount / 100);
    }
    if (computedDiscount <= 0) {
      return {
        status: "ineligible",
        discount: 0,
        message: "This voucher has no eligible value for your cart.",
      };
    }
    const normalisedDiscount = Math.min(productTotal, computedDiscount);
    return { status: "applied", discount: normalisedDiscount, message: null };
  }, [items, location, productTotal, voucher, voucherFetch]);
  const voucherDiscount = Math.min(
    productTotal,
    Math.max(0, voucherEvaluation.discount)
  );
  const subtotalAfterVoucher = Math.max(0, productTotal - voucherDiscount);
  const discountAmount = Math.min(
    subtotalAfterVoucher,
    subtotalAfterVoucher * (discount / 100)
  );
  const finalTotal = Math.max(
    0,
    subtotalAfterVoucher - discountAmount + rentalTotal
  );
  const vat = finalTotal * VAT_RATE;
  const rawGrandTotal = finalTotal + vat;
  const hasZeroBalance = rawGrandTotal <= ZERO_BALANCE_TOLERANCE;
  const grandTotal = hasZeroBalance ? 0 : rawGrandTotal;
  const voucherFeedback: VoucherFeedbackMessage = useMemo(() => {
    const appliedCode = voucherFetch.code;
    switch (voucherEvaluation.status) {
      case "checking":
        return { text: "Checking voucher…", tone: "muted" };
      case "error":
        return {
          text:
            voucherEvaluation.message ||
            "We couldn't validate that voucher. Try again.",
          tone: "error",
        };
      case "invalid":
        return {
          text: voucherEvaluation.message || "Voucher code not recognised.",
          tone: "error",
        };
      case "awaiting-location":
      case "awaiting-items":
      case "ineligible":
        return {
          text: voucherEvaluation.message,
          tone: "warning",
        };
      case "applied":
        return {
          text: `Voucher applied${
            appliedCode ? ` (${appliedCode})` : ""
          } – £${voucherDiscount.toFixed(2)} off.`,
          tone: "success",
        };
      default:
        return { text: null, tone: "muted" };
    }
  }, [voucherEvaluation, voucherDiscount, voucherFetch.code]);
  const voucherLabel = voucherFetch.code ?? (voucher.trim() || null);
  const voucherFeedbackClass =
    voucherFeedback.tone === "success"
      ? "text-emerald-600"
      : voucherFeedback.tone === "error"
        ? "text-red-600"
        : voucherFeedback.tone === "warning"
          ? "text-amber-600"
          : "text-gray-500";
  const orderInput = useMemo(() => {
    type OrganiserLineRole = "organiser" | "exhibitor";
    type OrganiserAccumulator = {
      key: string;
      organiserId: string | null;
      programEnabled: boolean;
      programProductIds: Set<string>;
      commissionRate: number | null;
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
            organiserId: item.organiser.organiserId ?? null,
            minimumGuarantee: item.organiser.minimumGuarantee ?? null,
            exhibitorProductId: item.organiser.exhibitorProductId ?? null,
            exhibitorPrice: item.organiser.exhibitorPrice ?? null,
            upsellVariationIds: item.organiser.upsellVariationIds ?? [],
            commissionRate: item.organiser.commissionRate ?? null,
            programEnabled: item.organiser.programEnabled === true,
            programKey:
              typeof item.organiser.programKey === "string" &&
              item.organiser.programKey.trim().length > 0
                ? item.organiser.programKey.trim()
                : item.organiser.organiserId
                  ? item.organiser.organiserId
                  : `program:${item.id}`,
            programProductId:
              typeof item.organiser.programProductId === "string" &&
              item.organiser.programProductId.trim().length > 0
                ? item.organiser.programProductId.trim()
                : item.id,
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
        const organiserKey = organiser.programKey;
        const existing = organiserMap.get(organiserKey);
        const accumulator: OrganiserAccumulator = existing ?? {
          key: organiserKey,
          organiserId: organiser.organiserId ?? null,
          programEnabled: organiser.programEnabled,
          programProductIds: new Set<string>(),
          commissionRate: organiser.commissionRate ?? null,
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

        if (organiser.organiserId && !accumulator.organiserId) {
          accumulator.organiserId = organiser.organiserId;
        }
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
        if (organiser.commissionRate != null) {
          accumulator.commissionRate = organiser.commissionRate;
        }
        if (organiser.programEnabled) {
          accumulator.programEnabled = true;
        }
        if (organiser.programProductId) {
          accumulator.programProductIds.add(organiser.programProductId);
        } else {
          accumulator.programProductIds.add(item.id);
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

        organiserMap.set(organiserKey, accumulator);
      }
      const orderFormResponses = Array.isArray(item.orderFormResponses)
        ? item.orderFormResponses.map((response) => ({
            fieldId:
              typeof response.fieldId === "string" && response.fieldId.trim().length > 0
                ? response.fieldId.trim()
                : "",
            label:
              typeof response.label === "string" && response.label.trim().length > 0
                ? response.label.trim()
                : "",
            value:
              typeof response.value === "string"
                ? response.value
                : response.value != null
                  ? String(response.value)
                  : "",
            required: response.required === true,
            type: response.type === "long-text" ? "long-text" : "short-text",
            description:
              typeof response.description === "string" && response.description.trim().length > 0
                ? response.description.trim()
                : null,
          }))
        : [];
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
        orderFormResponses,
        timeSlot: item.timeSlot ?? null,
        coverage: item.coverage ?? null,
        campaignBooking,
        organiser,
      };
    });
    const organiserSummary = Array.from(organiserMap.values()).map((entry) => ({
      organiserKey: entry.key,
      organiserId: entry.organiserId,
      programEnabled: entry.programEnabled,
      programProductIds: Array.from(entry.programProductIds),
      commissionRate: entry.commissionRate,
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
          orderFormResponses: item.orderFormResponses,
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
  const zeroBalanceBlockingMessage = useMemo(() => {
    if (items.length === 0) {
      return "Add items to your cart to continue.";
    }
    if (!accountRequirement.ready) {
      return describeAccountRequirement(accountRequirement.reason, "checkout");
    }
    if (!name) {
      return "Enter your name to continue.";
    }
    if (!orderInput.postalCode) {
      return "Enter a postcode for the shoot location.";
    }
    return null;
  }, [
    accountRequirement.ready,
    accountRequirement.reason,
    describeAccountRequirement,
    items.length,
    name,
    orderInput.postalCode,
  ]);
  const zeroBalanceMessage = zeroBalanceBlockingMessage
    ? zeroBalanceBlockingMessage
    : "Your voucher covers the full balance. Confirm your order to continue.";
  const zeroBalanceMessageClass = zeroBalanceBlockingMessage
    ? "text-sm text-gray-500"
    : "text-sm text-emerald-700";
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
      await signInWithEmailAndPassword(instance, email, loginPassword);
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

  const describeCallableError = useCallback((error: unknown): string => {
    const fallbackMessage = "We couldn't complete your order. Please try again.";
    if (!error) {
      return fallbackMessage;
    }
    if (typeof error === "string") {
      return error;
    }
    if (error instanceof Error) {
      const firebaseError = error as FirebaseError;
      const extractDetailMessage = (payload: unknown): string | null => {
        if (!payload || typeof payload !== "object") {
          return null;
        }
        const candidate = payload as Record<string, unknown>;
        const nestedMessage = candidate.message;
        if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
          return nestedMessage;
        }
        return null;
      };

      const customData = firebaseError?.customData;
      const detailFromCustomData = extractDetailMessage(
        customData && typeof customData === "object"
          ? (customData as Record<string, unknown>).details ?? null
          : null
      );
      if (detailFromCustomData) {
        return detailFromCustomData;
      }
      const details = (firebaseError as FirebaseError & { details?: unknown }).details;
      if (typeof details === "string" && details.trim().length > 0) {
        return details;
      }
      const detailObject = extractDetailMessage(details ?? null);
      if (detailObject) {
        return detailObject;
      }
      if (Array.isArray(details) && details.length > 0) {
        for (let idx = details.length - 1; idx >= 0; idx -= 1) {
          const attempt = details[idx];
          if (!attempt || typeof attempt !== "object") {
            continue;
          }
          const attemptRecord = attempt as Record<string, unknown>;
          const attemptError = attemptRecord.error;
          if (attemptError && attemptError === error) {
            continue;
          }
          const attemptMessage = describeCallableError(attemptError ?? null);
          if (attemptMessage && attemptMessage !== fallbackMessage) {
            const endpoint = attemptRecord.endpoint;
            if (typeof endpoint === "string" && endpoint.trim().length > 0) {
              return `Order service at ${endpoint} responded: ${attemptMessage}`;
            }
            return attemptMessage;
          }
        }
      }
      const rawMessage = firebaseError.message?.trim();
      if (rawMessage) {
        const normalised = rawMessage.replace(/^firebaseerror:\s*/i, "");
        if (normalised && normalised.toLowerCase() !== "internal") {
          return normalised;
        }
      }
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      const messageValue = (error as Record<string, unknown>).message;
      if (typeof messageValue === "string" && messageValue.trim().length > 0) {
        return messageValue;
      }
    }
    return fallbackMessage;
  }, []);

  const callCreateOrderViaApi = useCallback(
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
          const error = Object.assign(
            new Error(`Failed to create order (${response.status})`),
            { code: "create-order-error" },
          );
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

  const callCreateOrderViaCallable = useCallback(async (): Promise<CreateOrderResult> => {
    const { functions } = await ensureFirebase();
    const functionsInstance = functionsRef.current ?? functions ?? null;
    if (!functionsInstance) {
      throw Object.assign(new Error("Firebase functions are unavailable."), {
        code: "create-order-functions-unavailable",
      });
    }

    functionsRef.current = functionsInstance;

    const extractCallableResult = (result: any): CreateOrderResult => {
      const data =
        (result && typeof result === "object"
          ? result.data ?? result.result?.data ?? result.result ?? null
          : null) ?? null;

      if (!data || typeof data !== "object") {
        return {};
      }

      return data as CreateOrderResult;
    };

    const attemptErrors: Array<{ endpoint: string | null; error: unknown }> = [];

    const invokeCallable = async (
      callable: ReturnType<typeof httpsCallable>,
      endpoint: string | null,
    ): Promise<CreateOrderResult | null> => {
      try {
        const result: any = await callable(orderInput);
        return extractCallableResult(result);
      } catch (error) {
        console.warn(
          endpoint
            ? `createOrder callable attempt via ${endpoint} failed`
            : "createOrder callable default attempt failed",
          error,
        );
        attemptErrors.push({ endpoint, error });
        return null;
      }
    };

    const defaultResult = await invokeCallable(
      httpsCallable(functionsInstance, "createOrder"),
      null,
    );
    if (defaultResult !== null) {
      return defaultResult;
    }

    const explicitEndpoint = normaliseCallableEndpoint(
      EXPLICIT_CREATE_ORDER_ENDPOINT,
      "createOrder",
    );
    const host = typeof window !== "undefined" ? window.location.host : null;
    const hostBases = resolveHostedAppBases(host);
    const defaultBase = normaliseBaseUrl(functionsBaseUrl);

    let candidateEndpoints: string[];
    if (explicitEndpoint) {
      candidateEndpoints = [explicitEndpoint];
    } else {
      candidateEndpoints = buildCallableEndpointsFromBases("createOrder", [
        functionsBaseUrl,
        PUBLIC_FUNCTIONS_BASE_URL,
        PUBLIC_FIREBASE_FUNCTIONS_URL,
        ...hostBases,
        DEFAULT_FUNCTION_BASE,
        ...LEGACY_FUNCTION_BASES,
      ]);

      if (defaultBase) {
        candidateEndpoints = candidateEndpoints.filter(
          (endpoint) => !endpoint.startsWith(`${defaultBase}/`),
        );
      }
    }

    for (const endpoint of candidateEndpoints) {
      const callable = httpsCallableFromURL(functionsInstance, endpoint);
      const result = await invokeCallable(callable, endpoint);
      if (result !== null) {
        return result;
      }
    }

    const lastError = attemptErrors.length ? attemptErrors[attemptErrors.length - 1].error : null;
    if (lastError instanceof Error) {
      if (!("details" in lastError)) {
        (lastError as Error & { details?: unknown }).details = attemptErrors;
      }
      throw lastError;
    }

    const aggregatedError = Object.assign(
      new Error("Failed to create order via callable endpoints."),
      { code: "create-order-callable-failed", details: attemptErrors },
    );
    throw aggregatedError;
  }, [orderInput]);

  const callCreateOrder = useCallback(
    async (token: string | null): Promise<CreateOrderResult> => {
      try {
        return await callCreateOrderViaApi(token);
      } catch (apiError) {
        console.warn("createOrder API proxy failed, retrying callable", apiError);
        try {
          return await callCreateOrderViaCallable();
        } catch (callableError) {
          console.error("createOrder callable fallback failed", callableError);
          if (callableError instanceof Error) {
            if (!("cause" in callableError)) {
              (callableError as Error & { cause?: unknown }).cause = apiError;
            }
            throw callableError;
          }
          throw apiError instanceof Error ? apiError : new Error("Failed to create order.");
        }
      }
    },
    [callCreateOrderViaApi, callCreateOrderViaCallable],
  );

  const ensureCheckoutUser = useCallback(async (): Promise<User | null> => {
    if (currentUser) {
      return currentUser;
    }
    if (authMode === "login") {
      return null;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setAccountError("Enter your email address to create an account.");
      return null;
    }
    if (registerPassword.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
      setAccountError(
        `Password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters long.`,
      );
      return null;
    }
    if (registerPassword !== confirmPassword) {
      setAccountError("Passwords do not match. Check and try again.");
      return null;
    }
    if (isRegistering) {
      return null;
    }

    setAccountError(null);
    setIsRegistering(true);

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
      const credential = await createUserWithEmailAndPassword(
        instance,
        trimmedEmail,
        registerPassword,
      );
      const createdUser = credential.user;
      if (!createdUser) {
        throw new Error("Account was created without a user session.");
      }

      if (trimmedEmail !== email) {
        setEmail(trimmedEmail);
      }

      const displayName = name.trim();
      if (displayName.length > 0) {
        try {
          await updateProfile(createdUser, { displayName });
        } catch (profileError) {
          console.warn("Failed to update display name after registration", profileError);
        }
      }

      setAccountError(null);
      return createdUser;
    } catch (error) {
      console.error("Failed to register checkout account", error);
      let message =
        "We couldn't create your account. Try again or contact support for help.";
      const firebaseErr = error as Partial<FirebaseError> | null;
      if (firebaseErr && typeof firebaseErr === "object" && "code" in firebaseErr) {
        switch (firebaseErr.code) {
          case "auth/email-already-in-use":
            message = "An account already exists for that email. Sign in instead.";
            setAuthMode("login");
            setLoginError(message);
            break;
          case "auth/weak-password":
            message =
              firebaseErr.message ||
              `Password must be at least ${MIN_ACCOUNT_PASSWORD_LENGTH} characters long.`;
            break;
          case "auth/invalid-email":
            message = "Enter a valid email address.";
            break;
          default:
            message = firebaseErr.message || message;
            break;
        }
      } else if (error instanceof Error && error.message) {
        message = error.message;
      }
      setAccountError(message);
      return null;
    } finally {
      setIsRegistering(false);
    }
  }, [
    authMode,
    confirmPassword,
    currentUser,
    email,
    isRegistering,
    name,
    registerPassword,
    setAccountError,
    setAuthMode,
    setEmail,
    setIsRegistering,
    setLoginError,
  ]);

  const initializePaymentIntent = useCallback(async () => {
    if (initializingPayment) {
      return false;
    }
    if (isRegistering) {
      setPaymentError(
        "We're creating your account. Please wait a moment and try again.",
      );
      return false;
    }
    if (hasZeroBalance) {
      setPaymentError(
        "This order no longer requires payment. Proceed with the order instead.",
      );
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
      let authUser = currentUser;
      if (!authUser) {
        authUser = await ensureCheckoutUser();
      }
      if (!authUser) {
        setPaymentError(
          authMode === "register"
            ? accountError ||
                "Create your portal account by setting a password before continuing."
            : "Sign in to continue to payment.",
        );
        return false;
      }

      let functionsInstance = functionsRef.current;
      if (!functionsInstance) {
        const { functions } = await ensureFirebase();
        functionsInstance = functions ?? null;
        functionsRef.current = functionsInstance;
      }
      if (!functionsInstance) {
        throw new Error("Firebase functions are unavailable.");
      }

      const token = await authUser.getIdToken();
      const orderData = await callCreateOrder(token);
      const createdOrderId: string | undefined =
        typeof orderData.orderId === "string" ? orderData.orderId : undefined;
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
      const message = describeCallableError(error);
      setPaymentError(message);
      setOrderId(null);
      setClientSecret(null);
      return false;
    } finally {
      setInitializingPayment(false);
    }
  }, [
    accountError,
    authMode,
    callCreateOrder,
    currentIntentPayload,
    currentUser,
    describeCallableError,
    ensureCheckoutUser,
    hasZeroBalance,
    initializingPayment,
    isRegistering,
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
      stripePromise &&
      !hasZeroBalance
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
    hasZeroBalance,
  ]);

  const handlePaymentSuccess = useCallback(
    (completedOrderId: string) => {
      clear();
      router.push(`/orders/${completedOrderId}`);
    },
    [clear, router]
  );

  const completeZeroBalanceOrder = useCallback(async () => {
    if (initializingPayment) {
      return false;
    }
    if (isRegistering) {
      setPaymentError(
        "We're creating your account. Please wait a moment and try again.",
      );
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

    setInitializingPayment(true);
    setPaymentError(null);

    try {
      let authUser = currentUser;
      if (!authUser) {
        authUser = await ensureCheckoutUser();
      }
      if (!authUser) {
        setPaymentError(
          authMode === "register"
            ? accountError ||
                "Create your portal account by setting a password before continuing."
            : "Sign in to continue to checkout.",
        );
        return false;
      }

      const { db, functions } = await ensureFirebase();
      const functionsInstance = functionsRef.current ?? functions ?? null;
      if (!functionsInstance) {
        throw new Error("Firebase functions are unavailable.");
      }
      functionsRef.current = functionsInstance;

      const token = await authUser.getIdToken();
      const orderData = await callCreateOrder(token);
      const createdOrderId: string | undefined =
        typeof orderData.orderId === "string" ? orderData.orderId : undefined;
      const serverPriceValue = orderData.price;
      const serverNetTotalValue = orderData.netTotal;
      const serverVoucherDiscountValue = orderData.voucherDiscount;
      const serverDiscountAmountValue = orderData.discountAmount;
      const serverPrice =
        typeof serverPriceValue === "number" && Number.isFinite(serverPriceValue)
          ? serverPriceValue
          : null;
      const serverNetTotal =
        typeof serverNetTotalValue === "number" && Number.isFinite(serverNetTotalValue)
          ? serverNetTotalValue
          : null;
      const serverZeroBalance = [serverPrice, serverNetTotal]
        .filter((value): value is number => value !== null)
        .some((value) => Math.abs(value) <= ZERO_BALANCE_TOLERANCE);
      if (!createdOrderId) {
        throw new Error("Failed to create order.");
      }

      if (serverZeroBalance) {
        setOrderId(createdOrderId);
        setClientSecret(null);
        lastIntentPayload.current = currentIntentPayload;
        handlePaymentSuccess(createdOrderId);
        return true;
      }

      if (!db) {
        throw new Error("We couldn't verify the order total. Please try again.");
      }
      const orderSnap = await getDoc(doc(db, "orders", createdOrderId));
      if (!orderSnap.exists) {
        throw new Error("Order could not be verified. Please try again.");
      }
      const snapData = orderSnap.data() ?? {};
      const priceValue = Number(
        snapData.price ?? (serverPrice !== null ? serverPrice : 0)
      );
      const netTotalValue = Number(
        snapData.netTotal ?? (serverNetTotal !== null ? serverNetTotal : 0)
      );
      const voucherDiscountValue =
        serverVoucherDiscountValue ?? snapData.voucherDiscount ?? null;
      const discountAmountValue =
        serverDiscountAmountValue ?? snapData.discountAmount ?? null;
      const normalisedPrice = Number.isFinite(priceValue) ? priceValue : 0;
      const normalisedNetTotal = Number.isFinite(netTotalValue)
        ? netTotalValue
        : 0;
      if (
        Math.abs(normalisedPrice) <= ZERO_BALANCE_TOLERANCE ||
        Math.abs(normalisedNetTotal) <= ZERO_BALANCE_TOLERANCE
      ) {
        console.info("Zero balance order confirmed", {
          createdOrderId,
          price: normalisedPrice,
          netTotal: normalisedNetTotal,
          voucherDiscount: voucherDiscountValue,
          discountAmount: discountAmountValue,
        });
        setOrderId(createdOrderId);
        setClientSecret(null);
        lastIntentPayload.current = currentIntentPayload;
        handlePaymentSuccess(createdOrderId);
        return true;
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
      setPaymentError(
        "Voucher no longer covers the full balance. Complete the payment below to finish your order."
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
      setInitializingPayment(false);
    }
  }, [
    accountError,
    authMode,
    callCreateOrder,
    currentIntentPayload,
    currentUser,
    describeCallableError,
    ensureCheckoutUser,
    handlePaymentSuccess,
    initializingPayment,
    isRegistering,
    items.length,
    orderInput,
  ]);


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
          authMode === "login" ? (
            <form
              onSubmit={login}
              className="space-y-3 rounded border p-4"
              noValidate
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">Login</h2>
                <button
                  type="button"
                  className="text-sm font-semibold text-orange"
                  onClick={switchToRegister}
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
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
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
          ) : (
            <div className="space-y-3 rounded border p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">Create Account</h2>
                <button
                  type="button"
                  className="text-sm font-semibold text-orange"
                  onClick={switchToLogin}
                >
                  Already registered? Sign in
                </button>
              </div>
              <p className="text-sm text-gray-600">
                Enter your email and customer details below, then set a password to
                create your Pineapple Tapped portal account during checkout.
              </p>
              <p className="text-xs text-gray-500">
                We&apos;ll confirm your order and send account access details to the
                email you provide.
              </p>
            </div>
          )
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
                if (accountError) {
                  setAccountError(null);
                }
              }}
              required
            />
          )}
          {!currentUser && authMode === "register" && (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="input input-bordered w-full"
                  type="password"
                  placeholder="Create password"
                  value={registerPassword}
                  onChange={(e) => {
                    setRegisterPassword(e.target.value);
                    if (accountError) {
                      setAccountError(null);
                    }
                  }}
                  autoComplete="new-password"
                  minLength={MIN_ACCOUNT_PASSWORD_LENGTH}
                  required
                />
                <input
                  className="input input-bordered w-full"
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (accountError) {
                      setAccountError(null);
                    }
                  }}
                  autoComplete="new-password"
                  required
                />
              </div>
              <p className="text-xs text-gray-500">
                Password must be at least {MIN_ACCOUNT_PASSWORD_LENGTH} characters long.
              </p>
              {accountError ? (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  {accountError}
                </div>
              ) : null}
            </div>
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
          {items.map((item, idx) => {
            const bookingDateLabel =
              formatDateLabel(item.date ?? null) ||
              formatDateLabel(item.timeSlot?.start ?? null) ||
              null;
            const timeSlotLabel = formatTimeSlotLabel(item.timeSlot ?? null);
            return (
              <div key={idx} className="text-sm">
                <div className="flex justify-between">
                  <span>
                    {item.name} x {item.quantity}
                  </span>
                  <span>£{(item.price * item.quantity).toFixed(2)}</span>
                </div>
                {bookingDateLabel || timeSlotLabel ? (
                  <div className="text-xs text-gray-500 space-y-0.5">
                    {bookingDateLabel ? <div>Date: {bookingDateLabel}</div> : null}
                    {timeSlotLabel ? <div>Time: {timeSlotLabel}</div> : null}
                  </div>
                ) : null}
              {item.rentalTotal ? (
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Rental</span>
                  <span>£{(item.rentalTotal * item.quantity).toFixed(2)}</span>
                </div>
              ) : null}
              </div>
            );
          })}
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
        {voucherDiscount > 0 && (
          <div className="flex justify-between text-sm text-emerald-700">
            <span>
              Voucher discount{voucherLabel ? ` (${voucherLabel})` : ""}
            </span>
            <span>-£{voucherDiscount.toFixed(2)}</span>
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
        <div className={`min-h-[1.25rem] text-xs ${voucherFeedbackClass}`}>
          {voucherFeedback.text ?? "\u00a0"}
        </div>
        <div className="border rounded p-4 space-y-4">
          {paymentError ? (
            <div
              className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {paymentError}
            </div>
          ) : null}
          {hasZeroBalance ? (
            <>
              <p className={zeroBalanceMessageClass}>{zeroBalanceMessage}</p>
              <button
                type="button"
                className="btn w-full"
                onClick={completeZeroBalanceOrder}
                disabled={
                  Boolean(zeroBalanceBlockingMessage) ||
                  initializingPayment ||
                  isRegistering
                }
              >
                {initializingPayment
                  ? "Submitting order..."
                  : "Proceed with order"}
              </button>
            </>
          ) : clientSecret && orderId && stripePromise ? (
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
                  : !accountRequirement.ready
                    ? describeAccountRequirement(accountRequirement.reason, "payment")
                    : !name
                      ? "Enter your name to continue."
                      : !orderInput.postalCode
                        ? "Enter a postcode for the shoot location."
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
                  !accountRequirement.ready ||
                  !name ||
                  !orderInput.postalCode ||
                  Boolean(stripeConfigError) ||
                  !stripePromise ||
                  isRegistering
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
