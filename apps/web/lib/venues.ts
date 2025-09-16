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

function decodeValue(value: any): any {
  if (value == null) return null;
  if ("stringValue" in value) return value.stringValue as string;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue as string;
  if ("arrayValue" in value)
    return (value.arrayValue.values || []).map((v: any) => decodeValue(v));
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(fields || {})) {
    result[key] = decodeValue(val);
  }
  return result;
}

function getProjectConfig() {
  return {
    projectId:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      "pineapple-tapped---portal",
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      "AIzaSyCNf650E4LdnQ7Tk4fBf2DOxKJxGhU8jgE",
  };
}

export interface Venue {
  id?: string;
  name: string;
  address?: string | null;
  parkingTips?: string | null;
  accessInfo?: string | null;
  internetInfo?: string | null;
  parkingRate?: number | null;
  mileageFromWellingborough?: number | null;
  notes?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

async function fetchServerVenues(): Promise<Venue[]> {
  const { projectId, apiKey } = getProjectConfig();
  let url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/venues?key=${apiKey}`;
  const results: Venue[] = [];
  while (url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load venues");
    const json = await res.json();
    const docs: any[] = json.documents || [];
    for (const doc of docs) {
      results.push({
        id: doc.name.split("/").pop(),
        ...(decodeFields(doc.fields || {}) as Venue),
      });
    }
    const token = json.nextPageToken;
    url = token
      ? `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/venues?key=${apiKey}&pageToken=${token}`
      : "";
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

async function fetchServerVenue(id: string): Promise<Venue | null> {
  const { projectId, apiKey } = getProjectConfig();
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/venues/${id}?key=${apiKey}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = await res.json();
  const fields = decodeFields(json.fields || {});
  return { id: json.name.split("/").pop(), ...(fields as Venue) };
}

export async function listVenues(): Promise<Venue[]> {
  if (typeof window === "undefined") {
    try {
      return await fetchServerVenues();
    } catch {
      return [];
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) return [];
    const snap = await fs.getDocs(fs.collection(db, "venues"));
    const venues = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Venue));
    return venues.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function getVenue(id: string): Promise<Venue | null> {
  if (!id) return null;
  if (typeof window === "undefined") {
    try {
      return await fetchServerVenue(id);
    } catch {
      return null;
    }
  }
  try {
    const fs = await loadFirestore();
    if (!fs) return null;
    const snap = await fs.getDoc(fs.doc(db, "venues", id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as any) } as Venue;
  } catch {
    return null;
  }
}
