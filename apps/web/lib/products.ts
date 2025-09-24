import { db, getDb } from "./firebase";

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
      if (!p.eventDate) return true;
      return new Date(p.eventDate) >= now;
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
}

export interface ProductModifierSelection {
  groupId: string;
  optionId: string;
  price?: number;
}

export interface ProductVariation {
  id: string;
  name: string;
  price: number;
  features?: string[];
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
  price: number;
  imageUrl?: string;
  requirements?: string;
  deliveryTime?: string;
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
  /** Optional date for time-limited products such as Exhibition Videography */
  eventDate?: string;
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
  budget?: ProductBudget;
  productSpec?: ProductSpec;
  crewRoles?: ProductCrewRole[];
}

// Fallback sample products if Firestore is unavailable
const sampleProducts: Product[] = [
  {
    id: "TLQUINBJIT2RC56SP6CEEPFG",
    name: "BID Video Packages",
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
        if (!p.eventDate) return true;
        return new Date(p.eventDate) >= now;
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
        if (!p.eventDate) return true;
        return new Date(p.eventDate) >= now;
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

