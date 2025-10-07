"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import { useRoleGate } from "@/hooks/useRoleGate";
import { ensureFirebase } from "@/lib/firebase";
import {
  normaliseOrganiserId,
  parseEventOrganiserSnapshot,
  type EventOrganiserProfile,
} from "@/lib/organisers";
import type { Product } from "@/lib/products";

interface SlotRecord {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  booked: number;
  priceClass: string | null;
  notes: string;
}

interface SlotSummary {
  slots: SlotRecord[];
  totalCapacity: number;
  totalBooked: number;
  priceClasses: string[];
}

interface PriceClassRow {
  id: string;
  key: string;
  value: string;
}

interface ProductFormState {
  exhibitorPrice: string;
  upsellVariationInput: string;
  priceClassRows: PriceClassRow[];
}

interface LeadCapturePage {
  id: string;
  name: string;
  slug: string;
  eventName: string;
  organiserId: string | null;
  projectId: string | null;
  productId: string | null;
  isActive: boolean;
  updatedAt: Date | null;
}

interface OrganiserCommitmentRecord {
  organiserId: string;
  organiserName: string | null;
  minimumGuarantee: number | null;
  exhibitorSubtotal: number;
  organiserSubtotal: number;
  guaranteeShortfall: number;
  commissionDue: number;
  depositRefundable: number;
  quantity: number;
  sources: string[];
  settlementEligibleAt: Date | null;
  eventWindowEnd: Date | null;
  items: {
    productId: string;
    variationId: string | null;
    quantity: number;
    lineTotal: number;
    role: "organiser" | "exhibitor";
  }[];
}

interface OrganiserOrderRecord {
  id: string;
  reference: string;
  status: string;
  createdAt: Date | null;
  commitments: OrganiserCommitmentRecord[];
  totals: {
    grossSubtotal: number;
    exhibitorSubtotal: number;
    organiserSubtotal: number;
  } | null;
  settlementStatus: string | null;
}

type StripeActionMessage = { tone: "success" | "error" | "info"; text: string };

type ShareFeedbackMessage = { productId: string; tone: "success" | "error"; message: string };

const STRIPE_MESSAGE_CLASSES: Record<StripeActionMessage["tone"], string> = {
  success: "text-emerald-600",
  error: "text-red-600",
  info: "text-slate-600",
};

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseProductDoc(id: string, data: DocumentData | undefined): Product {
  const payload = data ?? {};
  const rawPrice = payload?.price;
  let price = 0;
  if (typeof rawPrice === "number" && Number.isFinite(rawPrice)) {
    price = rawPrice;
  } else if (typeof rawPrice === "string") {
    const parsed = Number(rawPrice);
    if (Number.isFinite(parsed)) {
      price = parsed;
    }
  }
  return {
    ...(payload as Record<string, unknown>),
    id,
    name: typeof payload?.name === "string" ? payload.name : "Untitled product",
    description:
      typeof payload?.description === "string" ? payload.description : "Product description coming soon.",
    price,
  } as Product;
}

function generateId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignored
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildPriceClassRows(map?: Record<string, number> | null): PriceClassRow[] {
  if (!map || typeof map !== "object") {
    return [
      {
        id: generateId("price-class"),
        key: "",
        value: "",
      },
    ];
  }
  const entries = Object.entries(map)
    .filter(([key]) => typeof key === "string" && key.trim().length > 0)
    .map(([key, value]) => ({
      id: generateId("price-class"),
      key,
      value: String(value ?? ""),
    }));
  if (entries.length === 0) {
    entries.push({ id: generateId("price-class"), key: "", value: "" });
  }
  return entries;
}

function convertRowsToMap(rows: PriceClassRow[]): Record<string, number> {
  const result: Record<string, number> = {};
  rows.forEach((row) => {
    const key = row.key.trim();
    if (!key) {
      return;
    }
    const parsed = Number(row.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    result[key] = parsed;
  });
  return result;
}

async function loadSlotSummary(db: Firestore, product: Product): Promise<SlotSummary | null> {
  const config = product.campaignBooking;
  if (!config || !config.projectId || !config.bookingId) {
    return null;
  }
  const bookingRef = doc(db, "projects", config.projectId, "projectBookings", config.bookingId);
  const [bookingSnap, responsesSnap] = await Promise.all([
    getDoc(bookingRef),
    getDocs(collection(bookingRef, "responses")),
  ]);
  if (!bookingSnap.exists()) {
    return null;
  }
  const bookingData = (bookingSnap.data() as Record<string, any>) ?? {};
  const slotResponses = new Map<string, number>();
  responsesSnap.forEach((responseSnap) => {
    const response = (responseSnap.data() as Record<string, any>) ?? {};
    const slotId =
      typeof response.slotId === "string" && response.slotId.trim().length > 0
        ? response.slotId.trim()
        : null;
    if (!slotId) {
      return;
    }
    const status =
      typeof response.status === "string" && response.status.trim().length > 0
        ? response.status.trim().toLowerCase()
        : "pending";
    if (status === "cancelled" || status === "declined") {
      return;
    }
    slotResponses.set(slotId, (slotResponses.get(slotId) ?? 0) + 1);
  });

  const priceClasses = new Set<string>();
  const rawSlots: any[] = Array.isArray(bookingData.slots) ? bookingData.slots : [];
  const parsedSlots: SlotRecord[] = rawSlots
    .map((slot, index) => {
      if (!slot || typeof slot !== "object") {
        return null;
      }
      const id =
        typeof slot.id === "string" && slot.id.trim().length > 0
          ? slot.id.trim()
          : `${config.bookingId}-slot-${index + 1}`;
      const label =
        typeof slot.label === "string" && slot.label.trim().length > 0
          ? slot.label.trim()
          : `Slot ${index + 1}`;
      const startAt = typeof slot.startAt === "string" ? slot.startAt : null;
      const endAt = typeof slot.endAt === "string" ? slot.endAt : null;
      let capacity = 1;
      if (typeof slot.capacity === "number" && Number.isFinite(slot.capacity)) {
        capacity = Math.max(1, Math.round(slot.capacity));
      } else if (typeof slot.capacity === "string") {
        const parsed = Number(slot.capacity);
        if (Number.isFinite(parsed)) {
          capacity = Math.max(1, Math.round(parsed));
        }
      }
      const priceClass =
        typeof slot.priceClass === "string" && slot.priceClass.trim().length > 0
          ? slot.priceClass.trim()
          : null;
      if (priceClass) {
        priceClasses.add(priceClass);
      }
      const notes = typeof slot.notes === "string" ? slot.notes : "";
      const booked = slotResponses.get(id) ?? 0;
      return {
        id,
        label,
        startAt,
        endAt,
        capacity,
        booked,
        priceClass,
        notes,
      } satisfies SlotRecord;
    })
    .filter((slot): slot is SlotRecord => Boolean(slot));

  const totalCapacity = parsedSlots.reduce((acc, slot) => acc + Math.max(slot.capacity, 0), 0);
  const totalBooked = parsedSlots.reduce((acc, slot) => acc + Math.max(slot.booked, 0), 0);

  return {
    slots: parsedSlots,
    totalCapacity,
    totalBooked,
    priceClasses: Array.from(priceClasses),
  } satisfies SlotSummary;
}

function formatDateInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().slice(0, 16);
}

function normaliseDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString();
}

function buildCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const safe = value ?? "";
          if (/[",\n]/.test(safe)) {
            return `"${safe.replace(/"/g, '""')}"`;
          }
          return safe;
        })
        .join(",")
    )
    .join("\n");
}

export default function OrganiserClientPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["organiser", "admin"]);
  const [profile, setProfile] = useState<EventOrganiserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productForms, setProductForms] = useState<Record<string, ProductFormState>>({});
  const [productFeedback, setProductFeedback] = useState<Record<string, string>>({});
  const [slotDrafts, setSlotDrafts] = useState<Record<string, SlotRecord[]>>({});
  const [slotSummaries, setSlotSummaries] = useState<Record<string, SlotSummary | null>>({});
  const [slotSaving, setSlotSaving] = useState<string | null>(null);
  const [leadPages, setLeadPages] = useState<LeadCapturePage[]>([]);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [orders, setOrders] = useState<OrganiserOrderRecord[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [origin, setOrigin] = useState("https://pineappletapped.com");
  const [stripeActionLoading, setStripeActionLoading] = useState(false);
  const [stripeActionMessage, setStripeActionMessage] = useState<StripeActionMessage | null>(null);
  const [shareFeedback, setShareFeedback] = useState<ShareFeedbackMessage | null>(null);
  const dbRef = useRef<Firestore | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const currentOrigin = window.location.origin.replace(/\/$/, "");
      setOrigin(currentOrigin);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!allowed) {
        setProfileLoading(false);
        return;
      }
      try {
        const { auth, db } = await ensureFirebase();
        if (!auth || !db) {
          throw new Error("Firebase is unavailable");
        }
        dbRef.current = db;
        const currentUser = auth.currentUser;
        if (!currentUser) {
          setProfile(null);
          setProfileError(null);
          return;
        }
        const organiserSnap = await getDoc(doc(db, "eventOrganisers", currentUser.uid));
        if (cancelled) {
          return;
        }
        const parsed = parseEventOrganiserSnapshot(organiserSnap);
        setProfile(parsed);
        setProfileError(null);
      } catch (error) {
        console.error("Failed to load organiser profile", error);
        if (!cancelled) {
          setProfile(null);
          setProfileError("Unable to load organiser programme details. Please try again later.");
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const organiserId = useMemo(() => normaliseOrganiserId(profile?.id ?? null), [profile?.id]);

  useEffect(() => {
    if (!stripeActionMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setStripeActionMessage(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [stripeActionMessage]);

  useEffect(() => {
    if (!shareFeedback) {
      return;
    }
    const timeout = window.setTimeout(() => setShareFeedback(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [shareFeedback]);

  const launchStripeConnect = useCallback(
    async (mode: "onboarding" | "login" = "onboarding") => {
      if (!organiserId) {
        setStripeActionMessage({
          tone: "error",
          text: "Your organiser profile hasn’t finished loading yet. Refresh the page and try again.",
        });
        return;
      }
      setStripeActionLoading(true);
      setStripeActionMessage(null);
      try {
        const response = await fetch("/api/organisers/stripe/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, organiserId }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const message =
            typeof payload?.error === "string"
              ? payload.error
              : "We couldn’t prepare Stripe Connect right now. Please try again.";
          throw new Error(message);
        }
        const payload = await response.json();
        const linkUrl =
          typeof payload?.linkUrl === "string" && payload.linkUrl.trim().length > 0
            ? payload.linkUrl.trim()
            : null;
        const linkType: "onboarding" | "login" =
          payload?.linkType === "login" || payload?.linkType === "onboarding" ? payload.linkType : mode;
        const accountId =
          typeof payload?.accountId === "string" && payload.accountId.trim().length > 0
            ? payload.accountId.trim()
            : null;
        const nextStatus =
          typeof payload?.status === "string" && payload.status.trim().length > 0
            ? payload.status.trim()
            : linkType === "login"
            ? profile?.stripeStatus ?? null
            : "in_progress";
        if (accountId) {
          setProfile((prev) =>
            prev
              ? {
                  ...prev,
                  stripeAccountId: accountId,
                  stripeStatus: nextStatus ?? prev.stripeStatus ?? null,
                }
              : prev
          );
        }
        if (linkUrl && typeof window !== "undefined") {
          window.open(linkUrl, "_blank", "noopener,noreferrer");
        }
        setStripeActionMessage({
          tone: "success",
          text:
            linkType === "login"
              ? "Stripe Express dashboard opened in a new tab."
              : "Stripe Connect onboarding launched in a new tab.",
        });
      } catch (error) {
        console.error("Failed to launch organiser Stripe Connect", error);
        setStripeActionMessage({
          tone: "error",
          text:
            error instanceof Error
              ? error.message
              : "We couldn’t connect to Stripe right now. Please try again shortly.",
        });
      } finally {
        setStripeActionLoading(false);
      }
    },
    [organiserId, profile?.stripeStatus]
  );

  const handleCopyShareLink = useCallback(async (productId: string, url: string | null) => {
    if (!url) {
      setShareFeedback({
        productId,
        tone: "error",
        message: "Share link unavailable until your organiser profile finishes loading.",
      });
      return;
    }
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard-unavailable");
      }
      await navigator.clipboard.writeText(url);
      setShareFeedback({
        productId,
        tone: "success",
        message: "Link copied to clipboard. Share it with your exhibitors.",
      });
    } catch (error) {
      console.error("Failed to copy organiser share link", error);
      setShareFeedback({
        productId,
        tone: "error",
        message: "Unable to copy automatically. Highlight the link above and copy it manually.",
      });
    }
  }, []);

  const initialiseProductForm = useCallback((product: Product) => {
    setProductForms((prev) => {
      const existing = prev[product.id];
      if (existing) {
        return prev;
      }
      const organiserProgram = product.organiserProgram ?? null;
      const exhibitorPrice = organiserProgram?.exhibitorPrice ?? null;
      const upsellIds = Array.isArray(organiserProgram?.upsellVariationIds)
        ? organiserProgram?.upsellVariationIds.filter((value): value is string => typeof value === "string")
        : [];
      const rows = buildPriceClassRows(product.campaignBooking?.priceClassAdjustments ?? null);
      return {
        ...prev,
        [product.id]: {
          exhibitorPrice:
            exhibitorPrice !== null && Number.isFinite(exhibitorPrice)
              ? String(exhibitorPrice)
              : product.price.toString(),
          upsellVariationInput: upsellIds.join("\n"),
          priceClassRows: rows,
        },
      } satisfies Record<string, ProductFormState>;
    });
  }, []);

  const loadProducts = useCallback(
    async (database: Firestore, organiserProfile: EventOrganiserProfile | null) => {
      const organiserKey = organiserProfile ? normaliseOrganiserId(organiserProfile.id) : null;
      const programProductIds = Array.isArray(organiserProfile?.programProductIds)
        ? organiserProfile.programProductIds.filter((value): value is string =>
            typeof value === "string" && value.trim().length > 0
          )
        : [];
      if (!organiserKey && programProductIds.length === 0) {
        setProducts([]);
        setSlotSummaries({});
        setSlotDrafts({});
        return;
      }
      setProductsLoading(true);
      setProductsError(null);
      try {
        let loaded: Product[] = [];
        if (programProductIds.length > 0) {
          const snapshots = await Promise.all(
            programProductIds.map(async (productId) => {
              try {
                const productSnap = await getDoc(doc(database, "products", productId));
                if (!productSnap.exists()) {
                  return null;
                }
                return parseProductDoc(productSnap.id, productSnap.data());
              } catch (error) {
                console.warn("Failed to load organiser program product", productId, error);
                return null;
              }
            })
          );
          loaded = snapshots.filter((product): product is Product => Boolean(product));
        }
        if (loaded.length === 0 && organiserKey) {
          const productsQuery = query(
            collection(database, "products"),
            where("organiserProgram.organiserId", "==", organiserKey)
          );
          const snap = await getDocs(productsQuery);
          loaded = snap.docs.map((docSnap) => parseProductDoc(docSnap.id, docSnap.data()));
        }
        setProducts(loaded);
        loaded.forEach((product) => initialiseProductForm(product));
        const summaryEntries = await Promise.all(
          loaded.map(async (product) => {
            try {
              const summary = await loadSlotSummary(database, product);
              return [product.id, summary] as const;
            } catch (error) {
              console.warn("Failed to load slot summary", product.id, error);
              return [product.id, null] as const;
            }
          })
        );
        setSlotSummaries(Object.fromEntries(summaryEntries));
        setSlotDrafts((prev) => {
          const next: Record<string, SlotRecord[]> = { ...prev };
          summaryEntries.forEach(([productId, summary]) => {
            if (summary) {
              next[productId] = summary.slots.map((slot) => ({ ...slot }));
            }
          });
          return next;
        });
      } catch (error) {
        console.error("Failed to load organiser products", error);
        setProductsError("Unable to load organiser packages. Please refresh the page.");
        setProducts([]);
        setSlotSummaries({});
        setSlotDrafts({});
      } finally {
        setProductsLoading(false);
      }
    },
    [initialiseProductForm]
  );

  const loadLeadCapturePages = useCallback(
    async (database: Firestore, organiserKey: string | null, profileData: EventOrganiserProfile | null) => {
      setLeadLoading(true);
      setLeadError(null);
      try {
        const snap = await getDocs(collection(database, "expoLeadPages"));
        const items: LeadCapturePage[] = snap.docs
          .map((docSnap) => {
            const data = (docSnap.data() as Record<string, any>) ?? {};
            const pageOrganiser = normaliseOrganiserId(data.organiserId ?? data.organiserID ?? null);
            return {
              id: docSnap.id,
              name: typeof data.name === "string" ? data.name : "Untitled lead page",
              slug: typeof data.slug === "string" ? data.slug : "",
              eventName: typeof data.eventName === "string" ? data.eventName : "",
              organiserId: pageOrganiser,
              projectId: typeof data.projectId === "string" ? data.projectId : null,
              productId: typeof data.productId === "string" ? data.productId : null,
              isActive: data.isActive !== false,
              updatedAt: toDate(data.updatedAt) ?? toDate(data.createdAt),
            } satisfies LeadCapturePage;
          })
          .filter((page) => {
            if (!organiserKey) {
              return false;
            }
            if (page.organiserId && page.organiserId === organiserKey) {
              return true;
            }
            if (page.productId && profileData?.hiddenProductIds.includes(page.productId)) {
              return true;
            }
            if (page.projectId && profileData?.linkedProjectIds.includes(page.projectId)) {
              return true;
            }
            return false;
          })
          .sort((a, b) => {
            const aTime = a.updatedAt?.getTime() ?? 0;
            const bTime = b.updatedAt?.getTime() ?? 0;
            return bTime - aTime;
          });
        setLeadPages(items);
      } catch (error) {
        console.error("Failed to load organiser lead capture pages", error);
        setLeadPages([]);
        setLeadError("Unable to load lead capture assets.");
      } finally {
        setLeadLoading(false);
      }
    },
    []
  );

  const loadOrdersForOrganiser = useCallback(
    async (database: Firestore, organiserKey: string | null) => {
      setOrdersLoading(true);
      setOrdersError(null);
      if (!organiserKey) {
        setOrders([]);
        setOrdersLoading(false);
        return;
      }
      try {
        const baseCollection = collection(database, "orders");
        let docs: QueryDocumentSnapshot<DocumentData>[] = [];
        try {
          const [satisfiedSnap, pendingSnap] = await Promise.all([
            getDocs(
              query(
                baseCollection,
                where("organiser.guaranteeSatisfied", "==", true),
                orderBy("createdAt", "desc"),
                limit(50)
              )
            ),
            getDocs(
              query(
                baseCollection,
                where("organiser.guaranteeSatisfied", "==", false),
                orderBy("createdAt", "desc"),
                limit(50)
              )
            ),
          ]);
          const map = new Map<string, QueryDocumentSnapshot<DocumentData>>();
          satisfiedSnap.docs.forEach((docSnap) => map.set(docSnap.id, docSnap));
          pendingSnap.docs.forEach((docSnap) => map.set(docSnap.id, docSnap));
          docs = Array.from(map.values());
        } catch (error) {
          console.warn("Falling back to generic order fetch for organiser portal", error);
          const fallbackSnap = await getDocs(query(baseCollection, orderBy("createdAt", "desc"), limit(50)));
          docs = fallbackSnap.docs;
        }
        const parsedOrders: OrganiserOrderRecord[] = [];
        docs.forEach((docSnap) => {
          const data = (docSnap.data() as Record<string, any>) ?? {};
          const organiserData = data.organiser && typeof data.organiser === "object" ? data.organiser : null;
          if (!organiserData) {
            return;
          }
          const commitmentsRaw = Array.isArray(organiserData.commitments)
            ? (organiserData.commitments as Record<string, any>[])
            : [];
          const commitments: OrganiserCommitmentRecord[] = commitmentsRaw
            .map((commitment) => {
              const commitmentOrganiserId = normaliseOrganiserId(
                commitment?.organiserId ?? commitment?.organiserID ?? null
              );
              if (!commitmentOrganiserId || commitmentOrganiserId !== organiserKey) {
                return null;
              }
              const itemsRaw = Array.isArray(commitment?.items)
                ? (commitment.items as Record<string, any>[])
                : [];
              const items = itemsRaw
                .map((item) => {
                  const productId = typeof item.productId === "string" ? item.productId : null;
                  if (!productId) {
                    return null;
                  }
                  const quantity = normaliseNumber(item.quantity) ?? 0;
                  const lineTotal = normaliseNumber(item.lineTotal) ?? 0;
                  const role =
                    item.role === "organiser" || item.role === "exhibitor" ? item.role : "exhibitor";
                  const variationId = typeof item.variationId === "string" ? item.variationId : null;
                  return {
                    productId,
                    variationId,
                    quantity,
                    lineTotal,
                    role,
                  } satisfies OrganiserCommitmentRecord["items"][number];
                })
                .filter((value): value is OrganiserCommitmentRecord["items"][number] => Boolean(value));
              return {
                organiserId: commitmentOrganiserId,
                organiserName:
                  typeof commitment.organiserName === "string" ? commitment.organiserName : null,
                minimumGuarantee: normaliseNumber(commitment.minimumGuarantee),
                exhibitorSubtotal: normaliseNumber(commitment.exhibitorSubtotal) ?? 0,
                organiserSubtotal: normaliseNumber(commitment.organiserSubtotal) ?? 0,
                guaranteeShortfall: normaliseNumber(commitment.guaranteeShortfall) ?? 0,
                commissionDue: normaliseNumber(commitment.commissionDue) ?? 0,
                depositRefundable: normaliseNumber(commitment.depositRefundable) ?? 0,
                quantity: normaliseNumber(commitment.quantity) ?? items.reduce((acc, item) => acc + item.quantity, 0),
                sources: Array.isArray(commitment.sources)
                  ? commitment.sources.filter((value: unknown): value is string => typeof value === "string")
                  : [],
                settlementEligibleAt: toDate(commitment.settlementEligibleAt),
                eventWindowEnd: toDate(commitment.eventWindowEnd),
                items,
              } satisfies OrganiserCommitmentRecord;
            })
            .filter((value): value is OrganiserCommitmentRecord => Boolean(value));
          if (commitments.length === 0) {
            return;
          }
          const totals = organiserData.totals && typeof organiserData.totals === "object"
            ? {
                grossSubtotal: normaliseNumber(organiserData.totals.grossSubtotal) ?? 0,
                exhibitorSubtotal: normaliseNumber(organiserData.totals.exhibitorSubtotal) ?? 0,
                organiserSubtotal: normaliseNumber(organiserData.totals.organiserSubtotal) ?? 0,
              }
            : null;
          parsedOrders.push({
            id: docSnap.id,
            reference:
              typeof data.reference === "string"
                ? data.reference
                : typeof data.shortCode === "string"
                  ? data.shortCode
                  : docSnap.id,
            status: typeof data.status === "string" ? data.status : "pending",
            createdAt: toDate(data.createdAt),
            commitments,
            totals,
            settlementStatus:
              typeof organiserData?.settlement?.status === "string"
                ? organiserData.settlement.status
                : organiserData?.settlementStatus ?? null,
          });
        });
        parsedOrders.sort((a, b) => {
          const aTime = a.createdAt?.getTime() ?? 0;
          const bTime = b.createdAt?.getTime() ?? 0;
          return bTime - aTime;
        });
        setOrders(parsedOrders);
      } catch (error) {
        console.error("Failed to load organiser orders", error);
        setOrders([]);
        setOrdersError("Unable to load organiser sales data. Please refresh.");
      } finally {
        setOrdersLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const db = dbRef.current;
    if (!allowed || !db || !organiserId) {
      return;
    }
    void loadProducts(db, profile ?? null);
    void loadLeadCapturePages(db, organiserId, profile);
    void loadOrdersForOrganiser(db, organiserId);
  }, [allowed, organiserId, loadLeadCapturePages, loadOrdersForOrganiser, loadProducts, profile]);

  const handleFormChange = useCallback(
    (productId: string, updater: (form: ProductFormState) => ProductFormState) => {
      setProductForms((prev) => {
        const current = prev[productId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [productId]: updater(current),
        } satisfies Record<string, ProductFormState>;
      });
    },
    []
  );

  const handlePriceClassChange = useCallback(
    (productId: string, rowId: string, key: "key" | "value", value: string) => {
      handleFormChange(productId, (form) => ({
        ...form,
        priceClassRows: form.priceClassRows.map((row) =>
          row.id === rowId
            ? {
                ...row,
                [key]: value,
              }
            : row
        ),
      }));
    },
    [handleFormChange]
  );

  const handleAddPriceClassRow = useCallback(
    (productId: string) => {
      handleFormChange(productId, (form) => ({
        ...form,
        priceClassRows: [
          ...form.priceClassRows,
          {
            id: generateId("price-class"),
            key: "",
            value: "",
          },
        ],
      }));
    },
    [handleFormChange]
  );

  const handleRemovePriceClassRow = useCallback(
    (productId: string, rowId: string) => {
      handleFormChange(productId, (form) => {
        const filtered = form.priceClassRows.filter((row) => row.id !== rowId);
        return {
          ...form,
          priceClassRows:
            filtered.length > 0
              ? filtered
              : [{ id: generateId("price-class"), key: "", value: "" }],
        };
      });
    },
    [handleFormChange]
  );

  const handleSaveProductConfig = useCallback(
    async (product: Product) => {
      const db = dbRef.current;
      const form = productForms[product.id];
      if (!db || !form || !organiserId) {
        return;
      }
      try {
        setProductFeedback((prev) => ({ ...prev, [product.id]: "" }));
        const organiserProgram = product.organiserProgram ?? {};
        const exhibitorPriceValue = Number(form.exhibitorPrice);
        const validExhibitorPrice = Number.isFinite(exhibitorPriceValue)
          ? Number(exhibitorPriceValue.toFixed(2))
          : null;
        const upsellIds = form.upsellVariationInput
          .split(/[,\n]/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        const priceClassAdjustments = convertRowsToMap(form.priceClassRows);
        const productRef = doc(db, "products", product.id);
        await setDoc(
          productRef,
          {
            organiserProgram: {
              ...organiserProgram,
              organiserId,
              minimumGuarantee:
                organiserProgram?.minimumGuarantee ?? profile?.minimumGuarantee ?? null,
              exhibitorProductId: organiserProgram?.exhibitorProductId ?? null,
              exhibitorPrice: validExhibitorPrice,
              upsellVariationIds: upsellIds,
            },
            campaignBooking: product.campaignBooking
              ? {
                  ...product.campaignBooking,
                  priceClassAdjustments,
                }
              : null,
          },
          { merge: true }
        );
        setProductFeedback((prev) => ({
          ...prev,
          [product.id]: "Package settings saved",
        }));
      } catch (error) {
        console.error("Failed to update organiser product", product.id, error);
        setProductFeedback((prev) => ({
          ...prev,
          [product.id]: "Failed to save changes. Please try again.",
        }));
      }
    },
    [organiserId, productForms, profile?.minimumGuarantee]
  );

  const handleSlotFieldChange = useCallback(
    (productId: string, index: number, field: keyof SlotRecord, value: string) => {
      setSlotDrafts((prev) => {
        const slots = prev[productId] ? [...prev[productId]] : [];
        const existing = slots[index];
        if (!existing) {
          return prev;
        }
        const nextSlot = { ...existing };
        if (field === "capacity") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            nextSlot.capacity = Math.max(existing.booked, Math.max(1, Math.round(parsed)));
          }
        } else if (field === "startAt" || field === "endAt") {
          nextSlot[field] = normaliseDateInput(value);
        } else if (field === "notes" || field === "label") {
          nextSlot[field] = value;
        } else if (field === "priceClass") {
          nextSlot.priceClass = value.trim().length > 0 ? value.trim() : null;
        }
        slots[index] = nextSlot;
        return {
          ...prev,
          [productId]: slots,
        } satisfies Record<string, SlotRecord[]>;
      });
    },
    []
  );

  const handleAddSlot = useCallback(
    (productId: string) => {
      setSlotDrafts((prev) => {
        const slots = prev[productId] ? [...prev[productId]] : [];
        slots.push({
          id: generateId(`${productId}-slot`),
          label: `Slot ${slots.length + 1}`,
          startAt: null,
          endAt: null,
          capacity: 1,
          booked: 0,
          priceClass: null,
          notes: "",
        });
        return {
          ...prev,
          [productId]: slots,
        };
      });
    },
    []
  );

  const handleRemoveSlot = useCallback(
    (productId: string, index: number) => {
      setSlotDrafts((prev) => {
        const slots = prev[productId] ? [...prev[productId]] : [];
        if (!slots[index]) {
          return prev;
        }
        slots.splice(index, 1);
        return {
          ...prev,
          [productId]: slots,
        };
      });
    },
    []
  );

  const handleSaveSlots = useCallback(
    async (product: Product) => {
      const db = dbRef.current;
      if (!db || !product.campaignBooking || !product.campaignBooking.projectId || !product.campaignBooking.bookingId) {
        return;
      }
      const draft = slotDrafts[product.id] ?? [];
      const { bookingId, projectId } = product.campaignBooking;
      setSlotSaving(product.id);
      try {
        const bookingRef = doc(db, "projects", projectId, "projectBookings", bookingId);
        const payload = draft.map((slot, index) => ({
          id: slot.id || `${bookingId}-slot-${index + 1}`,
          label: slot.label.trim().length > 0 ? slot.label.trim() : `Slot ${index + 1}`,
          startAt: slot.startAt,
          endAt: slot.endAt,
          capacity: Math.max(slot.booked, Math.max(1, Math.round(slot.capacity))),
          priceClass: slot.priceClass ?? null,
          notes: slot.notes ?? "",
        }));
        await updateDoc(bookingRef, { slots: payload });
        if (dbRef.current) {
          const summary = await loadSlotSummary(dbRef.current, product);
          setSlotSummaries((prev) => ({ ...prev, [product.id]: summary }));
          if (summary) {
            setSlotDrafts((prev) => ({ ...prev, [product.id]: summary.slots.map((slot) => ({ ...slot })) }));
          }
        }
      } catch (error) {
        console.error("Failed to save organiser slot plan", error);
      } finally {
        setSlotSaving(null);
      }
    },
    [slotDrafts]
  );

  const totals = useMemo(() => {
    const summary = {
      minimumGuarantee: 0,
      exhibitorSubtotal: 0,
      organiserSubtotal: 0,
      guaranteeShortfall: 0,
      commissionDue: 0,
      depositRefundable: 0,
      bookedSlots: 0,
      commitmentCount: 0,
    };
    orders.forEach((order) => {
      order.commitments.forEach((commitment) => {
        summary.minimumGuarantee += commitment.minimumGuarantee ?? 0;
        summary.exhibitorSubtotal += commitment.exhibitorSubtotal;
        summary.organiserSubtotal += commitment.organiserSubtotal;
        summary.guaranteeShortfall += commitment.guaranteeShortfall;
        summary.commissionDue += commitment.commissionDue;
        summary.depositRefundable += commitment.depositRefundable;
        summary.bookedSlots += commitment.items
          .filter((item) => item.role === "exhibitor")
          .reduce((acc, item) => acc + item.quantity, 0);
        summary.commitmentCount += 1;
      });
    });
    const aggregateSlots = Object.values(slotSummaries).reduce(
      (acc, summary) => {
        if (!summary) {
          return acc;
        }
        return {
          capacity: acc.capacity + summary.totalCapacity,
          booked: acc.booked + summary.totalBooked,
        };
      },
      { capacity: 0, booked: 0 }
    );
    return {
      ...summary,
      slotCapacity: aggregateSlots.capacity,
      slotBooked: aggregateSlots.booked,
      outstandingGuarantee: Math.max(summary.minimumGuarantee - summary.exhibitorSubtotal, 0),
    };
  }, [orders, slotSummaries]);

  const metrics = useMemo(() => {
    return [
      {
        label: "Exhibitor sales",
        value: formatCurrency(totals.exhibitorSubtotal),
      },
      {
        label: "Outstanding vs guarantee",
        value: formatCurrency(totals.outstandingGuarantee),
      },
      {
        label: "Slots booked",
        value:
          totals.slotCapacity > 0
            ? `${totals.slotBooked}/${totals.slotCapacity}`
            : totals.bookedSlots.toString(),
      },
      {
        label: "Commission earned",
        value: formatCurrency(totals.commissionDue),
      },
    ];
  }, [totals]);

  const handleExport = useCallback(() => {
    if (exporting || orders.length === 0) {
      return;
    }
    setExporting(true);
    try {
      const header = [
        "Order",
        "Created",
        "Status",
        "Organiser",
        "Minimum guarantee",
        "Exhibitor subtotal",
        "Organiser subtotal",
        "Commission due",
        "Guarantee shortfall",
        "Deposit refundable",
        "Sources",
        "Event window end",
        "Settlement eligible",
        "Items",
      ];
      const rows: string[][] = [header];
      orders.forEach((order) => {
        order.commitments.forEach((commitment) => {
          const itemSummary = commitment.items
            .map((item) => `${item.productId}${item.variationId ? ` (${item.variationId})` : ""} ×${item.quantity}`)
            .join("; ");
          rows.push([
            order.reference,
            order.createdAt ? formatDate(order.createdAt) : "",
            order.status ?? "",
            commitment.organiserName ?? commitment.organiserId ?? "",
            formatCurrency(commitment.minimumGuarantee),
            formatCurrency(commitment.exhibitorSubtotal),
            formatCurrency(commitment.organiserSubtotal),
            formatCurrency(commitment.commissionDue),
            formatCurrency(commitment.guaranteeShortfall),
            formatCurrency(commitment.depositRefundable),
            commitment.sources.join("; "),
            commitment.eventWindowEnd ? formatDate(commitment.eventWindowEnd) : "",
            commitment.settlementEligibleAt ? formatDate(commitment.settlementEligibleAt) : "",
            itemSummary,
          ]);
        });
      });
      const csv = buildCsv(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `organiser-report-${organiserId ?? "partner"}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setTimeout(() => setExporting(false), 300);
    }
  }, [exporting, orders, organiserId]);

  if (guardLoading || profileLoading) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading organiser workspace…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">
          You do not have access to the organiser workspace.
        </p>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <PortalHero
          eyebrow="Partner programme"
          title="Event organiser workspace"
          description="Coordinate exhibitor filming packages, manage guaranteed coverage, and unlock revenue sharing for your events."
          metrics={metrics}
        />

        {profileError ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">
            {profileError}
          </div>
        ) : null}

        {profile ? (
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Programme overview</h2>
                <p className="text-sm text-gray-600">
                  These settings sync with Pineapple Tapped so exhibitors see the right pricing and deliverables when
                  booking through your link.
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <span className="inline-flex items-center justify-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                  {profile.active ? "Active" : "Paused"}
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  {profile.stripeAccountId ? (
                    <>
                      <button
                        type="button"
                        onClick={() => launchStripeConnect("login")}
                        className="inline-flex items-center justify-center rounded-full border border-emerald-500 px-4 py-2 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={stripeActionLoading}
                      >
                        Open Stripe dashboard
                      </button>
                      <button
                        type="button"
                        onClick={() => launchStripeConnect("onboarding")}
                        className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={stripeActionLoading}
                      >
                        Update payout details
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => launchStripeConnect("onboarding")}
                      className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={stripeActionLoading}
                    >
                      Connect Stripe payouts
                    </button>
                  )}
                </div>
                {stripeActionMessage ? (
                  <p
                    className={`text-xs ${STRIPE_MESSAGE_CLASSES[stripeActionMessage.tone]}`}
                    aria-live="polite"
                  >
                    {stripeActionMessage.text}
                  </p>
                ) : null}
              </div>
            </div>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Minimum guarantee</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">
                  {formatCurrency(profile.minimumGuarantee)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Commission rate</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">
                  {profile.commissionRate != null ? `${profile.commissionRate}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Stripe status</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">{profile.stripeStatus || "Pending"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Stripe account</dt>
                <dd className="mt-1 text-base font-semibold text-gray-900">
                  {profile.stripeAccountId || "Not connected"}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Your events & availability</h2>
              <p className="text-sm text-gray-600">
                Update exhibitor pricing, configure upsells, and adjust filming slots shared with your exhibitors.
              </p>
            </div>
            {productsLoading ? (
              <span className="text-xs text-gray-500">Loading packages…</span>
            ) : null}
          </div>
          {productsError ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{productsError}</p>
          ) : null}
          {products.length === 0 && !productsLoading ? (
            <p className="mt-4 text-sm text-gray-600">
              No organiser packages are linked to your account yet. Your Pineapple Tapped contact can connect hidden
              exhibitor products to this workspace.
            </p>
          ) : null}
          <div className="mt-6 grid gap-6">
            {products.map((product) => {
              const form = productForms[product.id];
              const summary = slotSummaries[product.id] ?? null;
              const slots = slotDrafts[product.id] ?? [];
              const shareBase = origin.endsWith("/") ? origin.slice(0, -1) : origin;
              const shareUrl =
                organiserId && shareBase
                  ? `${shareBase}/products/${product.id}?organiser=${organiserId}`
                  : null;
              return (
                <section key={product.id} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{product.name}</h3>
                      <p className="text-sm text-gray-600">{product.tagline || product.description}</p>
                    </div>
                    <div className="text-sm text-gray-500">
                      {summary ? (
                        <span>
                          {summary.totalBooked}/{summary.totalCapacity} slots booked
                        </span>
                      ) : (
                        <span>No slots configured</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-amber-900">Share with exhibitors</h4>
                        <p className="text-xs text-amber-700">
                          Send this link so exhibitors see your organiser pricing, upsells, and available slots.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyShareLink(product.id, shareUrl)}
                          className="inline-flex items-center justify-center rounded-full bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!shareUrl}
                        >
                          Copy share link
                        </button>
                        {shareUrl ? (
                          <Link
                            href={shareUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-full border border-amber-500 px-4 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
                          >
                            Open listing
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-full border border-amber-200 px-4 py-2 text-xs font-semibold text-amber-500/70"
                            disabled
                          >
                            Open listing
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3">
                      <input
                        type="text"
                        readOnly
                        value={
                          shareUrl ??
                          "Share link will appear once your organiser profile finishes loading."
                        }
                        className="w-full cursor-text select-all rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-amber-800 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                    </div>
                    {shareFeedback?.productId === product.id ? (
                      <p
                        className={`mt-2 text-xs ${
                          shareFeedback.tone === "success" ? "text-emerald-700" : "text-red-600"
                        }`}
                        aria-live="polite"
                      >
                        {shareFeedback.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-6 lg:grid-cols-2">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Exhibitor pricing & upsells</h4>
                      {form ? (
                        <form
                          className="mt-3 space-y-4"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleSaveProductConfig(product);
                          }}
                        >
                          <label className="block text-sm">
                            <span className="text-gray-700">Exhibitor price (£)</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.exhibitorPrice}
                              onChange={(event) =>
                                handleFormChange(product.id, (current) => ({
                                  ...current,
                                  exhibitorPrice: event.target.value,
                                }))
                              }
                              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                            />
                          </label>
                          <label className="block text-sm">
                            <span className="text-gray-700">Upsell variation IDs</span>
                            <textarea
                              rows={3}
                              value={form.upsellVariationInput}
                              onChange={(event) =>
                                handleFormChange(product.id, (current) => ({
                                  ...current,
                                  upsellVariationInput: event.target.value,
                                }))
                              }
                              placeholder="Enter one variation ID per line"
                              className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                            />
                          </label>
                          <div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-gray-700">Price class adjustments</span>
                              <button
                                type="button"
                                onClick={() => handleAddPriceClassRow(product.id)}
                                className="text-xs font-medium text-orange hover:text-orange/80"
                              >
                                Add class
                              </button>
                            </div>
                            <div className="mt-2 space-y-2">
                              {form.priceClassRows.map((row) => (
                                <div key={row.id} className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={row.key}
                                    onChange={(event) =>
                                      handlePriceClassChange(product.id, row.id, "key", event.target.value)
                                    }
                                    placeholder="Class code"
                                    className="w-1/2 rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                  />
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.value}
                                    onChange={(event) =>
                                      handlePriceClassChange(product.id, row.id, "value", event.target.value)
                                    }
                                    placeholder="Price delta"
                                    className="w-1/2 rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePriceClassRow(product.id, row.id)}
                                    className="rounded-full border border-transparent p-2 text-xs text-gray-500 hover:text-red-600"
                                    aria-label="Remove price class"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center rounded-full bg-orange px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
                            >
                              Save package settings
                            </button>
                            <p className="text-xs text-gray-500">{productFeedback[product.id]}</p>
                          </div>
                        </form>
                      ) : (
                        <p className="mt-2 text-sm text-gray-600">Loading configuration…</p>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-gray-900">Exhibitor filming slots</h4>
                        <button
                          type="button"
                          onClick={() => handleAddSlot(product.id)}
                          className="text-xs font-medium text-orange hover:text-orange/80"
                        >
                          Add slot
                        </button>
                      </div>
                      {slots.length === 0 ? (
                        <p className="mt-2 text-sm text-gray-600">No slots defined yet.</p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {slots.map((slot, index) => (
                            <div key={slot.id} className="rounded-xl border border-gray-200 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <label className="w-full text-xs font-medium text-gray-600">
                                  Label
                                  <input
                                    type="text"
                                    value={slot.label}
                                    onChange={(event) =>
                                      handleSlotFieldChange(product.id, index, "label", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSlot(product.id, index)}
                                  className="mt-5 text-xs text-gray-400 hover:text-red-600"
                                  aria-label="Remove slot"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <label className="text-xs font-medium text-gray-600">
                                  Start time
                                  <input
                                    type="datetime-local"
                                    value={formatDateInput(slot.startAt)}
                                    onChange={(event) =>
                                      handleSlotFieldChange(product.id, index, "startAt", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                  />
                                </label>
                                <label className="text-xs font-medium text-gray-600">
                                  End time
                                  <input
                                    type="datetime-local"
                                    value={formatDateInput(slot.endAt)}
                                    onChange={(event) =>
                                      handleSlotFieldChange(product.id, index, "endAt", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                  />
                                </label>
                              </div>
                              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                <label className="text-xs font-medium text-gray-600">
                                  Capacity
                                  <input
                                    type="number"
                                    min={slot.booked || 1}
                                    value={slot.capacity}
                                    onChange={(event) =>
                                      handleSlotFieldChange(product.id, index, "capacity", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                  />
                                </label>
                                <label className="text-xs font-medium text-gray-600">
                                  Price class
                                  <input
                                    type="text"
                                    value={slot.priceClass ?? ""}
                                    onChange={(event) =>
                                      handleSlotFieldChange(product.id, index, "priceClass", event.target.value)
                                    }
                                    className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                  />
                                </label>
                                <div className="text-xs text-gray-500">
                                  <span className="font-medium">Booked</span>
                                  <div className="mt-1 rounded-lg border border-dashed border-gray-300 px-2 py-1.5 text-sm">
                                    {slot.booked}
                                  </div>
                                </div>
                              </div>
                              <label className="mt-3 block text-xs font-medium text-gray-600">
                                Notes
                                <textarea
                                  rows={2}
                                  value={slot.notes}
                                  onChange={(event) =>
                                    handleSlotFieldChange(product.id, index, "notes", event.target.value)
                                  }
                                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
                                />
                              </label>
                            </div>
                          ))}
                        </div>
                      )}
                      {product.campaignBooking ? (
                        <button
                          type="button"
                          disabled={slotSaving === product.id}
                          onClick={() => handleSaveSlots(product)}
                          className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:bg-slate-400"
                        >
                          {slotSaving === product.id ? "Saving…" : "Save slot plan"}
                        </button>
                      ) : (
                        <p className="mt-4 text-xs text-gray-500">
                          This package is not linked to a booking schedule yet.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Lead capture assets</h2>
              <p className="text-sm text-gray-600">
                Share these kiosk pages on-site to capture interest and feed warm leads into Pineapple Tapped.
              </p>
            </div>
            {leadLoading ? <span className="text-xs text-gray-500">Loading pages…</span> : null}
          </div>
          {leadError ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{leadError}</p>
          ) : null}
          {leadPages.length === 0 && !leadLoading ? (
            <p className="mt-4 text-sm text-gray-600">
              No lead capture pages are linked yet. Ask your Pineapple Tapped producer to tag your events so they appear
              here.
            </p>
          ) : null}
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {leadPages.map((page) => {
              const shareUrl = `${origin}/expo/${page.slug}`;
              return (
                <li key={page.id} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{page.name}</h3>
                      <p className="text-xs text-gray-500">{page.eventName || page.slug}</p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium ${
                        page.isActive ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {page.isActive ? "Active" : "Draft"}
                    </span>
                  </div>
                  <div className="mt-3 break-words text-xs text-gray-600">{shareUrl}</div>
                  <div className="mt-4 flex items-center gap-2 text-xs">
                    <Link
                      href={shareUrl}
                      target="_blank"
                      className="inline-flex items-center justify-center rounded-full border border-orange px-3 py-1.5 font-medium text-orange transition hover:bg-orange/10"
                    >
                      Preview page
                    </Link>
                    <Link
                      href={`/admin/marketing/expo-pages?highlight=${page.id}`}
                      className="inline-flex items-center justify-center rounded-full border border-transparent px-3 py-1.5 font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                    >
                      Manage in portal
                    </Link>
                    <span className="ml-auto text-[11px] text-gray-400">
                      Updated {page.updatedAt ? formatDate(page.updatedAt) : "recently"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Sales & settlement report</h2>
              <p className="text-sm text-gray-600">
                Track booked slots, how close you are to the guarantee, and what commission is due after the event.
              </p>
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || orders.length === 0}
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              {exporting ? "Preparing…" : "Download CSV"}
            </button>
          </div>
          {ordersError ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{ordersError}</p>
          ) : null}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Committed guarantee</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{formatCurrency(totals.minimumGuarantee)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Exhibitor revenue</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{formatCurrency(totals.exhibitorSubtotal)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Commission earned</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{formatCurrency(totals.commissionDue)}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Outstanding guarantee</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{formatCurrency(totals.outstandingGuarantee)}</p>
            </div>
          </div>
          {ordersLoading ? (
            <p className="mt-6 text-sm text-gray-600">Loading sales activity…</p>
          ) : null}
          {orders.length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead>
                  <tr>
                    <th className="px-4 py-2 font-semibold text-gray-700">Order</th>
                    <th className="px-4 py-2 font-semibold text-gray-700">Created</th>
                    <th className="px-4 py-2 font-semibold text-gray-700">Exhibitor revenue</th>
                    <th className="px-4 py-2 font-semibold text-gray-700">Commission</th>
                    <th className="px-4 py-2 font-semibold text-gray-700">Guarantee shortfall</th>
                    <th className="px-4 py-2 font-semibold text-gray-700">Settlement status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.map((order) => (
                    <Fragment key={order.id}>
                      {order.commitments.map((commitment, index) => (
                        <tr key={`${order.id}-${commitment.organiserId}-${index}`} className="align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{order.reference}</div>
                            <div className="text-xs text-gray-500">{order.status}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{order.createdAt ? formatDate(order.createdAt) : "—"}</td>
                          <td className="px-4 py-3 text-gray-700">{formatCurrency(commitment.exhibitorSubtotal)}</td>
                          <td className="px-4 py-3 text-gray-700">{formatCurrency(commitment.commissionDue)}</td>
                          <td className={`px-4 py-3 ${commitment.guaranteeShortfall > 0 ? "text-red-600" : "text-gray-700"}`}>
                            {formatCurrency(commitment.guaranteeShortfall)}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            <div>{order.settlementStatus ?? "pending"}</div>
                            <div className="text-xs text-gray-500">
                              Eligible {commitment.settlementEligibleAt ? formatDate(commitment.settlementEligibleAt) : "TBC"}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </PortalContainer>
  );
}
