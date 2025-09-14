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

async function fetchServerCategories(): Promise<Category[]> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "pineapple-tapped---portal";
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    "AIzaSyCNf650E4LdnQ7Tk4fBf2DOxKJxGhU8jgE";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/categories?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed");
  const json = await res.json();
  return (json.documents || [])
    .map((d: any) => ({
      id: d.name.split("/").pop()!,
      ...decodeFields(d.fields),
    }))
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  howWeWork?: string;
  parentId?: string | null;
  headerImage?: string;
  layout?: "grid" | "list";
  order?: number;
}

const sampleCategories: Category[] = [
  {
    id: "video-production",
    name: "Video Production & Events",
    slug: "video-production",
    description: "Professional video production and event coverage services.",
    howWeWork: "We plan, shoot, and edit to deliver compelling stories.",
    parentId: null,
    headerImage: "/placeholder.jpg",
    layout: "grid",
    order: 0,
  },
  {
    id: "live-streaming",
    name: "Live Streaming",
    slug: "live-streaming",
    description: "Broadcast your events live to your audience.",
    howWeWork: "Our crew handles the tech so you can focus on the event.",
    parentId: null,
    headerImage: "/placeholder.jpg",
    layout: "grid",
    order: 1,
  },
];

export async function getCategories(): Promise<Category[]> {
  if (typeof window === "undefined") {
    try {
      return await fetchServerCategories();
    } catch {
      return sampleCategories;
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDocs(fs.collection(db, "categories"));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch {
    return sampleCategories;
  }
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (typeof window === "undefined") {
    try {
      const all = await fetchServerCategories();
      return all.find((c) => c.slug === slug) || null;
    } catch {
      return sampleCategories.find((c) => c.slug === slug) || null;
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDocs(fs.collection(db, "categories"));
    const match = snap.docs.find((d) => (d.data() as any).slug === slug);
    if (!match) return null;
    return { id: match.id, ...(match.data() as any) } as Category;
  } catch {
    return sampleCategories.find((c) => c.slug === slug) || null;
  }
}

export async function createCategory(data: Omit<Category, "id">) {
  const fs = await loadFirestore();
  if (!fs) return;
  await fs.addDoc(fs.collection(db, "categories"), data);
}

export async function getCategory(id: string): Promise<Category | null> {
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDoc(fs.doc(db, "categories", id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as any) };
  } catch {
    return sampleCategories.find((c) => c.id === id) || null;
  }
}
