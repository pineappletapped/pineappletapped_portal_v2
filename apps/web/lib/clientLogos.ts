import { db, getDb } from './firebase';

async function loadFirestore() {
  if (typeof window === "undefined") return null;
  try {
    const database = await getDb();
    if (!database) return null;
    return await import("firebase/firestore");
  } catch {
    return null;
  }
}

async function fetchServerClientLogos(): Promise<ClientLogo[]> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "pineapple-tapped---portal";
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    "AIzaSyCNf650E4LdnQ7Tk4fBf2DOxKJxGhU8jgE";
  const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/clientLogos?key=${apiKey}`;
  const response = await fetch(endpoint, {
    next: { revalidate: 300 },
  });
  if (!response.ok) {
    throw new Error("Failed to fetch client logos");
  }
  const payload = await response.json();
  const documents: any[] = Array.isArray(payload.documents)
    ? payload.documents
    : [];

  return documents
    .map((doc: any) => {
      const fields = doc.fields ?? {};
      const name =
        typeof fields.name?.stringValue === "string"
          ? fields.name.stringValue
          : "";
      const imageUrl =
        typeof fields.imageUrl?.stringValue === "string"
          ? fields.imageUrl.stringValue
          : "";
      return {
        id: doc.name?.split("/").pop() ?? "",
        name,
        imageUrl,
      } as ClientLogo;
    })
    .filter((logo) => logo.imageUrl.trim().length > 0);
}

export interface ClientLogo {
  id: string;
  name: string;
  imageUrl: string;
}

const sampleLogos: ClientLogo[] = [
  { id: '1', name: 'Logo 1', imageUrl: '/placeholder.jpg' },
  { id: '2', name: 'Logo 2', imageUrl: '/placeholder.jpg' },
  { id: '3', name: 'Logo 3', imageUrl: '/placeholder.jpg' },
  { id: '4', name: 'Logo 4', imageUrl: '/placeholder.jpg' },
];

export async function getClientLogos(): Promise<ClientLogo[]> {
  if (typeof window === "undefined") {
    try {
      const logos = await fetchServerClientLogos();
      if (logos.length > 0) {
        return logos;
      }
    } catch (error) {
      console.warn("Failed to load client logos from server", error);
    }
  }

  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDocs(fs.collection(db, "clientLogos"));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  } catch (error) {
    console.warn("Falling back to sample client logos", error);
    return sampleLogos;
  }
}
