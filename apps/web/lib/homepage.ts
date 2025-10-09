import { db } from "./firebase";

interface HomeCard {
  id: string;
  title: string;
  text: string;
  link?: string;
}

export interface ProcessStage {
  id: string;
  title: string;
  description: string;
}

export interface HomepageContent {
  heroTitle: string;
  heroSubtitle: string;
  heroVideoUrl: string;
  heroPosterUrl: string;
  heroPosterAlt: string;
  aboutTitle: string;
  aboutText: string;
  ctaTitle: string;
  ctaText: string;
  ctaButtonText: string;
  ctaButtonLink: string;
  cards: HomeCard[];
  processTitle: string;
  processDescription: string;
  processVideoUrl: string;
  processPosterUrl: string;
  processStages: ProcessStage[];
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
  heroVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
  heroPosterUrl: "https://dummyimage.com/1920x1080/101828/ffffff&text=Pineapple+Tapped",
  heroPosterAlt: "Pineapple Tapped hero background",
  aboutTitle: "About Us",
  aboutText:
    "We craft compelling video and livestream experiences that help organisations tell their story. From strategy and production to delivery, our team handles every step.",
  ctaTitle: "Want to Launch a Corporate Podcast?",
  ctaText:
    "From concept to distribution, our team can create a show that resonates with your audience.",
  ctaButtonText: "Explore Podcast Services",
  ctaButtonLink: "/categories/video-production",
  cards: [],
  processTitle: "See the Pineapple Tapped workflow in action",
  processDescription:
    "Collaborate with our producers inside the client portal, review live updates, and keep every milestone on track from kickoff to delivery.",
  processVideoUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
  processPosterUrl:
    "https://dummyimage.com/1280x720/ff7f27/ffffff&text=Client+Portal+Preview",
  processStages: [
    {
      id: "discover",
      title: "Discover",
      description:
        "Share your brief and goals so we can scope the creative, technical, and delivery milestones together.",
    },
    {
      id: "collaborate",
      title: "Collaborate",
      description:
        "Review treatments, timelines, and live production notes inside the portal with instant notifications.",
    },
    {
      id: "deliver",
      title: "Deliver",
      description:
        "Approve final assets, track revisions, and download everything from a single, secure destination.",
    },
  ],
};

export async function getHomepage(): Promise<HomepageContent> {
  try {
    const fs = await loadFirestore();
    if (!fs) throw new Error("unavailable");
    const snap = await fs.getDoc(fs.doc(db, "settings", "homepage"));
    if (!snap.exists()) return sampleHomepage;
    const data = snap.data() as any;
    const rawStages = Array.isArray(data.processStages) ? data.processStages : null;
    return {
      heroTitle: data.heroTitle || sampleHomepage.heroTitle,
      heroSubtitle: data.heroSubtitle || sampleHomepage.heroSubtitle,
      heroVideoUrl: data.heroVideoUrl || sampleHomepage.heroVideoUrl,
      heroPosterUrl: data.heroPosterUrl || sampleHomepage.heroPosterUrl,
      heroPosterAlt: data.heroPosterAlt || sampleHomepage.heroPosterAlt,
      aboutTitle: data.aboutTitle || sampleHomepage.aboutTitle,
      aboutText: data.aboutText || sampleHomepage.aboutText,
      ctaTitle: data.ctaTitle || sampleHomepage.ctaTitle,
      ctaText: data.ctaText || sampleHomepage.ctaText,
      ctaButtonText: data.ctaButtonText || sampleHomepage.ctaButtonText,
      ctaButtonLink: data.ctaButtonLink || sampleHomepage.ctaButtonLink,
      cards: data.cards || [],
      processTitle: data.processTitle || sampleHomepage.processTitle,
      processDescription: data.processDescription || sampleHomepage.processDescription,
      processVideoUrl: data.processVideoUrl || sampleHomepage.processVideoUrl,
      processPosterUrl: data.processPosterUrl || sampleHomepage.processPosterUrl,
      processStages: rawStages
        ? rawStages
            .map((stage: any, index: number) => {
              const title =
                typeof stage?.title === "string" ? stage.title.trim() : "";
              const description =
                typeof stage?.description === "string"
                  ? stage.description.trim()
                  : "";
              const idCandidate =
                typeof stage?.id === "string" ? stage.id.trim() : "";
              return {
                id: idCandidate || `stage-${index}`,
                title,
                description,
              };
            })
            .filter((stage: ProcessStage) => stage.title && stage.description)
        : sampleHomepage.processStages,
    };
  } catch {
    return sampleHomepage;
  }
}

export type { HomeCard };
