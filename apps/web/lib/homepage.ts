import { db } from "./firebase";

interface HomeCard {
  id: string;
  title: string;
  text: string;
  link?: string;
}

export interface HomepageContent {
  heroTitle: string;
  heroSubtitle: string;
  aboutTitle: string;
  aboutText: string;
  ctaTitle: string;
  ctaText: string;
  ctaButtonText: string;
  ctaButtonLink: string;
  cards: HomeCard[];
}

async function loadFirestore() {
  if (typeof window === "undefined") return null;
  try {
    const { getDb } = await import("./firebase");
    const database = await getDb();
    if (!database) return null;
    return await import("firebase/firestore");
  } catch {
    return null;
  }
}

const sampleHomepage: HomepageContent = {
  heroTitle: "Pineapple Tapped",
  heroSubtitle: "Production, streaming and creative services for modern brands.",
  aboutTitle: "About Us",
  aboutText:
    "We craft compelling video and livestream experiences that help organisations tell their story. From strategy and production to delivery, our team handles every step.",
  ctaTitle: "Want to Launch a Corporate Podcast?",
  ctaText:
    "From concept to distribution, our team can create a show that resonates with your audience.",
  ctaButtonText: "Explore Podcast Services",
  ctaButtonLink: "/categories/video-production",
  cards: [],
};

export async function getHomepage(): Promise<HomepageContent> {
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDoc(fs.doc(db, "settings", "homepage"));
    if (!snap.exists()) return sampleHomepage;
    const data = snap.data() as any;
    return {
      heroTitle: data.heroTitle || sampleHomepage.heroTitle,
      heroSubtitle: data.heroSubtitle || sampleHomepage.heroSubtitle,
      aboutTitle: data.aboutTitle || sampleHomepage.aboutTitle,
      aboutText: data.aboutText || sampleHomepage.aboutText,
      ctaTitle: data.ctaTitle || sampleHomepage.ctaTitle,
      ctaText: data.ctaText || sampleHomepage.ctaText,
      ctaButtonText: data.ctaButtonText || sampleHomepage.ctaButtonText,
      ctaButtonLink: data.ctaButtonLink || sampleHomepage.ctaButtonLink,
      cards: data.cards || [],
    };
  } catch {
    return sampleHomepage;
  }
}

export type { HomeCard };
