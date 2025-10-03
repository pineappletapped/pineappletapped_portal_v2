import { db, getDb } from "./firebase";
import type { PriceTiers } from "./pricing";

async function loadFirestore() {
  try {
    const database = await getDb();
    if (!database) return null;
    return await import("firebase/firestore");
  } catch {
    return null;
  }
}

function decodeValue(v: any): any {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("arrayValue" in v)
    return (v.arrayValue.values || []).map((val: any) => decodeValue(val));
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields: any) {
  const obj: any = {};
  for (const [k, val] of Object.entries(fields || {})) {
    obj[k] = decodeValue(val);
  }
  return obj;
}

async function fetchServerProducts(
  categoryId?: string
): Promise<Product[]> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "pineapple-tapped---portal";
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    "AIzaSyCNf650E4LdnQ7Tk4fBf2DOxKJxGhU8jgE";
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "products" }],
      where: categoryId
        ? {
            fieldFilter: {
              field: { fieldPath: "category" },
              op: "EQUAL",
              value: { stringValue: categoryId },
            },
          }
        : undefined,
    },
  };
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("fetch failed");
  const json = await res.json();
  const now = new Date();
  return json
    .filter((r: any) => r.document)
    .map((r: any) => ({ id: r.document.name.split("/").pop()!, ...decodeFields(r.document.fields) }))
    .filter((p: any) => {
      if (p.category !== "exhibition-videography") return true;
      const end =
        parseProductDate(p.eventEndDate) ||
        parseProductDate(p.eventDate) ||
        parseProductDate(p.eventStartDate);
      if (!end) return true;
      return end.getTime() >= now.getTime();
    });
}

export interface ProductTask {
  title: string;
  forCustomer: boolean;
  subtasks?: string[];
}

export type DeliverableType =
  | "long-form-video"
  | "short-form-vertical"
  | "photo"
  | "photo-set"
  | "thumbnail"
  | "audio-licence"
  | "document";

export interface ProductDeliverable {
  title: string;
  /** Classification used to show an appropriate icon for the deliverable. */
  type?: DeliverableType;
  /** Optional text describing what the customer will receive. */
  description?: string;
  /** Optional thumbnail image for visual deliverable previews. */
  thumbnailUrl?: string;
  /** If provided, limits the deliverable to the matching variation IDs. */
  variationIds?: string[];
}

export interface ProductModifierDeliverable {
  type?: DeliverableType | null;
  label?: string | null;
}

export interface ProductBudgetOverride {
  labourFilming?: number | null;
  labourEditing?: number | null;
  labour?: number | null;
  kitMode?: "manual" | "guided" | null;
  kitManual?: number | null;
  kitGuidance?: number | null;
  kit?: number | null;
  travelMiles?: number | null;
  travelRate?: number | null;
  travelCost?: number | null;
  parking?: number | null;
  labourCrew?: number | null;
}

export interface ProductCrewRoleOverride {
  roleId: string;
  quantity?: number | null;
  unitRate?: number | null;
  includeInBudget?: boolean | null;
}

export interface ProductModifierSelection {
  groupId: string;
  optionId: string;
  price?: number;
  priceTiers?: PriceTiers | null;
  budgetOverrides?: ProductBudgetOverride;
  crewOverrides?: ProductCrewRoleOverride[];
  deliverable?: ProductModifierDeliverable;
}

export interface ProductVariation {
  id: string;
  name: string;
  price: number;
  priceTiers?: PriceTiers | null;
  features?: string[];
  budgetOverrides?: ProductBudgetOverride;
  crewOverrides?: ProductCrewRoleOverride[];
}

export interface ProductVideoLink {
  url: string;
  title?: string;
}

export interface ProductSpec {
  overview?: string;
  preparation?: string;
  filming?: string;
  editing?: string;
  delivery?: string;
  notes?: string;
}

export interface ProductCampaignBookingDetails {
  /** Project document that owns the booking session. */
  projectId: string;
  /** Booking template identifier inside the projectBookings subcollection. */
  bookingId: string;
  /** Optional public slug used for storefront landing pages. */
  slug?: string | null;
  /**
   * Optional mapping of price class codes to adjustments that should be added on top of the
   * product base price when a slot declares that price class.
   */
  priceClassAdjustments?: Record<string, number> | null;
}

export interface ProductCrewRole {
  id: string;
  roleId?: string | null;
  title: string;
  description?: string;
  instructions?: string;
  quantity?: number;
  unitRate?: number;
  includeInBudget?: boolean;
}

export interface CrewRoleTemplate {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  defaultQuantity?: number;
  defaultRate?: number;
  defaultIncludeInBudget?: boolean;
}

export interface ProductSEO {
  title?: string;
  description?: string;
  keywords?: string;
  socialImageUrl?: string;
}

export interface ProductBudget {
  labourFilming?: number;
  labourEditing?: number;
  labour?: number;
  kitMode?: "manual" | "guided";
  kitManual?: number;
  kitGuidance?: number;
  kit?: number;
  travelMiles?: number;
  travelRate?: number;
  travelCost?: number;
  parking?: number;
  labourCrew?: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  tagline?: string;
  /**
   * Controls how customers engage with the product.
   * "ecommerce" keeps the instant checkout flow, while "quote"
   * routes enquiries through the bespoke quote workflow.
   */
  salesMode?: "ecommerce" | "quote";
  price: number;
  priceTiers?: PriceTiers | null;
  imageUrl?: string;
  requirements?: string;
  deliveryTime?: string;
  /** Details about on-site operations shared with the customer. */
  operationsInfo?: string;
  /** Optional Google Drive folder ID used as the template when provisioning client deliverables. */
  driveTemplateFolderId?: string;
  /** Optional override for the deliverables folder name created per order. Defaults to the product name. */
  driveFolderName?: string;
  deliverables?: ProductDeliverable[];
  modifiers?: ProductModifierSelection[];
  /** Modifier group IDs enabled for this product. */
  modifierGroups?: string[];
  variations?: ProductVariation[];
  storyboardImages?: string[];
  /** @deprecated replaced by exampleVideos */
  exampleWorkUrl?: string | null;
  exampleVideos?: ProductVideoLink[];
  category?: string;
  /** Optional slug exposed on the public campaigns/{slug} route. */
  campaignSlug?: string | null;
  /** Optional booking configuration linked to a workflow booking template. */
  campaignBooking?: ProductCampaignBookingDetails | null;
  /** Optional single date maintained for backwards compatibility. */
  eventDate?: string;
  /** Start date for multi-day events such as exhibitions. */
  eventStartDate?: string | null;
  /** End date for multi-day events such as exhibitions. */
  eventEndDate?: string | null;
  /** Optional setup day offered before the show opens. */
  eventSetupDate?: string | null;
  /** Venue name used for Exhibition Videography filtering */
  venue?: string;
  /** Linked venue reference for pulling travel details */
  venueId?: string;
  hidden?: boolean;
  requiredKit?: { groupId: string; items: string[] }[];
  defaultTasks?: ProductTask[];
  seo?: ProductSEO;
  workflowId?: string;
  labourCost?: number;
  defaultKitCost?: number;
  /** Number of days the crew is expected to be on-site. */
  onsiteDays?: number | null;
  /** Minutes spent setting up on site before filming begins. */
  onsiteSetupMinutes?: number | null;
  /** Minutes allocated to the primary filming window. */
  onsiteShootMinutes?: number | null;
  /** Minutes required to wrap down and break down kit on site. */
  onsiteBreakdownMinutes?: number | null;
  /** Earliest customer bookable arrival time in HH:mm (24h). */
  onsiteTimeWindowStart?: string | null;
  /** Latest customer bookable finish time in HH:mm (24h). */
  onsiteTimeWindowEnd?: string | null;
  budget?: ProductBudget;
  productSpec?: ProductSpec;
  crewRoles?: ProductCrewRole[];
}

export interface ProductOnsiteTiming {
  setupMinutes: number;
  shootMinutes: number;
  breakdownMinutes: number;
  totalMinutes: number;
  windowStartMinutes: number;
  windowEndMinutes: number;
}

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

const parseProductDate = (value: unknown): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).toDate === "function"
  ) {
    try {
      const converted = (value as any).toDate();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const toDateKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export interface ProductEventWindow {
  start: Date | null;
  end: Date | null;
  setup: Date | null;
}

export const getProductEventWindow = (product: Product): ProductEventWindow => {
  const start =
    parseProductDate(product.eventStartDate) ||
    parseProductDate(product.eventDate);
  let end =
    parseProductDate(product.eventEndDate) ||
    parseProductDate(product.eventDate) ||
    start;
  if (start && end && end.getTime() < start.getTime()) {
    end = start;
  }
  const setup = parseProductDate(product.eventSetupDate);
  return { start: start ?? null, end: end ?? null, setup: setup ?? null };
};

export const getProductEventRangeLabel = (
  product: Product,
  locale?: string
): string | null => {
  const { start, end } = getProductEventWindow(product);
  if (!start) {
    return null;
  }
  const resolvedEnd = end ?? start;
  const startLabel = start.toLocaleDateString(locale);
  const endLabel = resolvedEnd.toLocaleDateString(locale);
  if (start.getTime() === resolvedEnd.getTime()) {
    return startLabel;
  }
  return `${startLabel} – ${endLabel}`;
};

export const getProductEventMonthKeys = (product: Product): string[] => {
  const { start, end } = getProductEventWindow(product);
  if (!start) {
    return [];
  }
  const resolvedEnd = end ?? start;
  const months = new Set<string>();
  for (
    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    cursor.getTime() <= resolvedEnd.getTime();
    cursor = new Date(cursor.getTime() + DAY_IN_MS)
  ) {
    months.add(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  if (months.size === 0) {
    months.add(`${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return Array.from(months);
};

export const resolveProductOnsiteDays = (
  product: Product
): number | null => {
  const raw = (product as any)?.onsiteDays;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const timing = resolveProductOnsiteTiming(product);
  if (timing) {
    const days = timing.totalMinutes / (24 * 60);
    return days > 0 ? days : null;
  }
  return null;
};

const parseMinutes = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Number(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
};

const parseWindowTime = (value: unknown): number | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    return null;
  }
  const [hoursStr, minutesStr] = trimmed.split(":");
  const hours = Number.parseInt(hoursStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
};

export const resolveProductOnsiteTiming = (
  product: Product
): ProductOnsiteTiming | null => {
  const setup = parseMinutes((product as any)?.onsiteSetupMinutes);
  const shoot = parseMinutes((product as any)?.onsiteShootMinutes);
  const breakdown = parseMinutes((product as any)?.onsiteBreakdownMinutes);
  const total = setup + shoot + breakdown;
  if (total <= 0) {
    return null;
  }
  const defaultStart = 8 * 60;
  const defaultEnd = 18 * 60;
  const startMinutes =
    parseWindowTime((product as any)?.onsiteTimeWindowStart) ?? defaultStart;
  let endMinutes =
    parseWindowTime((product as any)?.onsiteTimeWindowEnd) ?? defaultEnd;
  if (endMinutes <= startMinutes) {
    endMinutes = startMinutes + total;
  }
  if (endMinutes - startMinutes < total) {
    endMinutes = startMinutes + total;
  }
  return {
    setupMinutes: setup,
    shootMinutes: shoot,
    breakdownMinutes: breakdown,
    totalMinutes: total,
    windowStartMinutes: startMinutes,
    windowEndMinutes: endMinutes,
  };
};

const formatMinutesSummary = (minutes: number, locale?: string): string => {
  if (minutes <= 0) {
    return "0 mins";
  }
  let hours = Math.floor(minutes / 60);
  let remainder = Math.round(minutes - hours * 60);
  if (remainder >= 60) {
    hours += Math.floor(remainder / 60);
    remainder %= 60;
  }
  if (remainder === 0 && hours > 0) {
    const formatter = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    });
    const label = formatter.format(hours);
    return `${label} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours === 1 ? "" : "s"} ${remainder} min${
      remainder === 1 ? "" : "s"
    }`;
  }
  return `${remainder} min${remainder === 1 ? "" : "s"}`;
};

const formatCompactMinutes = (minutes: number): string => {
  if (minutes <= 0) {
    return "0m";
  }
  let hours = Math.floor(minutes / 60);
  let remainder = Math.round(minutes - hours * 60);
  if (remainder >= 60) {
    hours += Math.floor(remainder / 60);
    remainder %= 60;
  }
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (remainder > 0 || parts.length === 0) {
    parts.push(`${remainder}m`);
  }
  return parts.join(" ");
};

export const formatProductOnsiteDuration = (
  product: Product,
  locale?: string
): string | null => {
  const timing = resolveProductOnsiteTiming(product);
  if (timing) {
    const totalLabel = formatMinutesSummary(timing.totalMinutes, locale);
    const breakdownParts: string[] = [];
    if (timing.setupMinutes > 0) {
      breakdownParts.push(`Setup ${formatCompactMinutes(timing.setupMinutes)}`);
    }
    if (timing.shootMinutes > 0) {
      breakdownParts.push(`Shoot ${formatCompactMinutes(timing.shootMinutes)}`);
    }
    if (timing.breakdownMinutes > 0) {
      breakdownParts.push(
        `Breakdown ${formatCompactMinutes(timing.breakdownMinutes)}`
      );
    }
    const breakdown =
      breakdownParts.length > 0 ? ` (${breakdownParts.join(" · ")})` : "";
    return `${totalLabel} on site${breakdown}`;
  }
  const days = resolveProductOnsiteDays(product);
  if (!days) {
    return null;
  }
  if (Math.abs(days - 0.5) < 0.01) {
    return "Half day on site";
  }
  if (Math.abs(days - 1) < 0.01) {
    return "1 day on site";
  }
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: days % 1 === 0 ? 0 : 1,
  });
  return `${formatter.format(days)} days on site`;
};

// Fallback sample products if Firestore is unavailable
const sampleProducts: Product[] = [
  {
    id: "TLQUINBJIT2RC56SP6CEEPFG",
    name: "BID Video Packages",
    salesMode: "ecommerce",
    description:
      "Help your town shine with high-impact, ready-to-share video content. Includes 3x business videos and 1x community spotlight.",
    tagline: "Showcase your BID in style",
    price: 850,
    category: "video-production",
    storyboardImages: ["/placeholder.jpg"],
    exampleWorkUrl: "https://example.com/work1",
    exampleVideos: [
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Sample highlight reel",
      },
      {
        url: "https://vimeo.com/123456789",
        title: "Community spotlight teaser",
      },
    ],
    productSpec: {
      overview:
        "Film three participating businesses and a hero community spotlight to build awareness for the BID.",
      filming:
        "Capture exterior establishing shots, two interview setups, and b-roll for each location.",
      editing:
        "Deliver colour graded 4K masters with captions and square cutdowns for social.",
      delivery:
        "Upload the final videos to the client portal with export notes and thumbnail options.",
      notes:
        "Share the production brief with assigned crew at least 48 hours before filming.",
    },
    crewRoles: [
      {
        id: "lead-videographer",
        title: "Lead Videographer",
        quantity: 1,
        unitRate: 275,
        instructions:
          "Responsible for directing interviews, camera setup, and ensuring schedule adherence.",
        includeInBudget: true,
      },
      {
        id: "video-editor",
        title: "Video Editor",
        quantity: 1,
        unitRate: 220,
        instructions: "Edit four deliverables with brand-approved lower-thirds and captions.",
        includeInBudget: true,
      },
    ],
  },
  {
    id: "LIVE_STREAM_BASIC",
    name: "Live Stream Package",
    salesMode: "ecommerce",
    description: "Stream your event live with our complete crew and equipment.",
    tagline: "Broadcast your event worldwide",
    price: 500,
    category: "live-streaming",
    storyboardImages: ["/placeholder.jpg"],
    exampleWorkUrl: "https://example.com/work2",
    exampleVideos: [
      {
        url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        title: "Livestream capture demo",
      },
    ],
  },
];

export async function getProducts(): Promise<Product[]> {
  if (typeof window === "undefined") {
    try {
      return await fetchServerProducts();
    } catch {
      return sampleProducts;
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDocs(fs.collection(db, "products"));
    const now = new Date();
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((p) => {
        if (p.category !== "exhibition-videography") return true;
        const end =
          parseProductDate(p.eventEndDate) ||
          parseProductDate(p.eventDate) ||
          parseProductDate(p.eventStartDate);
        if (!end) return true;
        return end.getTime() >= now.getTime();
      });
  } catch {
    return sampleProducts;
  }
}

export async function getProductsByCategory(
  categoryId: string
): Promise<Product[]> {
  if (typeof window === "undefined") {
    try {
      return await fetchServerProducts(categoryId);
    } catch {
      return sampleProducts.filter((p) => p.category === categoryId);
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const q = fs.query(fs.collection(db, "products"), fs.where("category", "==", categoryId));
    const snap = await fs.getDocs(q);
    const now = new Date();
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((p) => {
        if (p.category !== "exhibition-videography") return true;
        const end =
          parseProductDate(p.eventEndDate) ||
          parseProductDate(p.eventDate) ||
          parseProductDate(p.eventStartDate);
        if (!end) return true;
        return end.getTime() >= now.getTime();
      });
  } catch {
    return sampleProducts.filter((p) => p.category === categoryId);
  }
}

export async function createProduct(data: Omit<Product, "id">) {
  const fs = await loadFirestore();
  if (!fs) return;
  await fs.addDoc(fs.collection(db, "products"), data);
}

export async function updateProduct(id: string, data: Partial<Omit<Product, "id">>) {
  const fs = await loadFirestore();
  if (!fs) return;
  await fs.updateDoc(fs.doc(db, "products", id), data);
}

export async function getProduct(id: string): Promise<Product | null> {
  if (typeof window === "undefined") {
    try {
      const all = await fetchServerProducts();
      return all.find((p) => p.id === id) || null;
    } catch {
      return sampleProducts.find((p) => p.id === id) || null;
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDoc(fs.doc(db, "products", id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as any) };
  } catch {
    return sampleProducts.find((p) => p.id === id) || null;
  }
}

export async function getProductByCampaignSlug(
  slug: string
): Promise<Product | null> {
  const normalised = slug.trim().toLowerCase();
  if (!normalised) {
    return null;
  }
  if (typeof window === "undefined") {
    try {
      const all = await fetchServerProducts();
      return (
        all.find((product) =>
          typeof product.campaignSlug === "string"
            ? product.campaignSlug.trim().toLowerCase() === normalised
            : false
        ) || null
      );
    } catch {
      return (
        sampleProducts.find((product) =>
          typeof product.campaignSlug === "string"
            ? product.campaignSlug.trim().toLowerCase() === normalised
            : false
        ) || null
      );
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const query = fs.query(
      fs.collection(db, "products"),
      fs.where("campaignSlug", "==", slug)
    );
    const snap = await fs.getDocs(query);
    if (snap.empty) {
      return null;
    }
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...(docSnap.data() as any) };
  } catch {
    return (
      sampleProducts.find((product) =>
        typeof product.campaignSlug === "string"
          ? product.campaignSlug.trim().toLowerCase() === normalised
          : false
      ) || null
    );
  }
}

