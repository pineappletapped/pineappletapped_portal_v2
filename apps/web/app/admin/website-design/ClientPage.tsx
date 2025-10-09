"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import { useRoleGate } from "@/hooks/useRoleGate";
import type { Category } from "@/lib/categories";
import type { ProcessStage } from "@/lib/homepage";
import { db, ensureFirebase } from "@/lib/firebase";

interface PageDoc {
  id: string;
  title: string;
  slug: string;
}

interface HomeCard {
  id: string;
  title: string;
  text: string;
  link?: string;
}

type TabKey = "home" | "pages" | "menu" | "branding";

type FeedbackState = {
  type: "success" | "error";
  message: string;
} | null;

const getHomepageDoc = (database: Firestore) => doc(database, "settings", "homepage");
const getBrandingDoc = (database: Firestore) => doc(database, "settings", "branding");

async function requireDb(): Promise<Firestore> {
  await ensureFirebase();
  if (!db) {
    throw new Error("Firestore is unavailable");
  }
  return db as Firestore;
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeCards(cards: HomeCard[]): HomeCard[] {
  return cards.reduce<HomeCard[]>((acc, card, index) => {
    const title = card.title?.trim?.() ?? "";
    const text = card.text?.trim?.() ?? "";
    const link = card.link?.trim?.() ?? "";

    if (!title || !text) {
      return acc;
    }

    acc.push({
      id: card.id || createId(`card-${index}`),
      title,
      text,
      link: link || undefined,
    });

    return acc;
  }, []);
}

function sanitizeProcessStages(stages: ProcessStage[]): ProcessStage[] {
  return stages
    .map((stage, index) => {
      const title = stage.title?.trim?.() ?? "";
      const description = stage.description?.trim?.() ?? "";
      const id = stage.id?.trim?.() ?? createId(`stage-${index}`);

      if (!title || !description) {
        return null;
      }

      return {
        id,
        title,
        description,
      };
    })
    .filter((stage): stage is ProcessStage => Boolean(stage));
}

export default function WebsiteDesignPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["marketing"]);
  const [initialising, setInitialising] = useState(true);
  const [tab, setTab] = useState<TabKey>("home");
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const [pages, setPages] = useState<PageDoc[]>([]);
  const [pageTitle, setPageTitle] = useState("");
  const [pageSlug, setPageSlug] = useState("");

  const [menuCats, setMenuCats] = useState<Category[]>([]);

  const [homeTitle, setHomeTitle] = useState("");
  const [homeSubtitle, setHomeSubtitle] = useState("");
  const [heroVideoUrl, setHeroVideoUrl] = useState("");
  const [heroPosterUrl, setHeroPosterUrl] = useState("");
  const [heroPosterAlt, setHeroPosterAlt] = useState("");
  const [homeAboutTitle, setHomeAboutTitle] = useState("");
  const [homeAboutText, setHomeAboutText] = useState("");
  const [homeCtaTitle, setHomeCtaTitle] = useState("");
  const [homeCtaText, setHomeCtaText] = useState("");
  const [homeCtaBtnText, setHomeCtaBtnText] = useState("");
  const [homeCtaBtnLink, setHomeCtaBtnLink] = useState("");
  const [homeCards, setHomeCards] = useState<HomeCard[]>([]);
  const [cardTitle, setCardTitle] = useState("");
  const [cardText, setCardText] = useState("");
  const [cardLink, setCardLink] = useState("");

  const [processTitle, setProcessTitle] = useState("");
  const [processDescription, setProcessDescription] = useState("");
  const [processVideoUrl, setProcessVideoUrl] = useState("");
  const [processPosterUrl, setProcessPosterUrl] = useState("");
  const [processStages, setProcessStages] = useState<ProcessStage[]>([]);
  const [newStageTitle, setNewStageTitle] = useState("");
  const [newStageDescription, setNewStageDescription] = useState("");

  const [metaPixelId, setMetaPixelId] = useState("");
  const [linkedinPartnerId, setLinkedinPartnerId] = useState("");
  const [savingHomepageCopy, setSavingHomepageCopy] = useState(false);
  const [savingHeroMedia, setSavingHeroMedia] = useState(false);
  const [savingCards, setSavingCards] = useState(false);
  const [savingProcess, setSavingProcess] = useState(false);
  const [savingAnalytics, setSavingAnalytics] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);

  const tabOptions: { key: TabKey; label: string; description: string }[] = [
    {
      key: "home",
      label: "Homepage",
      description: "Hero copy, CTA, workflow media, and homepage cards.",
    },
    {
      key: "pages",
      label: "Landing pages",
      description: "Create additional marketing pages and routes.",
    },
    {
      key: "menu",
      label: "Navigation",
      description: "Reorder customer-facing service categories.",
    },
    {
      key: "branding",
      label: "Branding",
      description: "Tracking pixels and brand hub access.",
    },
  ];

  useEffect(() => {
    if (guardLoading) {
      return;
    }

    if (!allowed) {
      setInitialising(false);
      return;
    }

    let active = true;

    (async () => {
      try {
        const database = await requireDb();
        const [pageSnap, categorySnap, brandingSnap, homeSnap] = await Promise.all([
          getDocs(collection(database, "pages")),
          getDocs(collection(database, "categories")),
          getDoc(getBrandingDoc(database)),
          getDoc(getHomepageDoc(database)),
        ]);

        if (!active) {
          return;
        }

        setPages(
          pageSnap.docs
            .map((docSnap) => {
              const data = docSnap.data() as DocumentData;
              const title = typeof data.title === "string" ? data.title : "";
              const slug = typeof data.slug === "string" ? data.slug : "";

              if (!title || !slug) {
                return null;
              }

              return { id: docSnap.id, title, slug } satisfies PageDoc;
            })
            .filter((page): page is PageDoc => Boolean(page))
        );
        const sortedCategories = categorySnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as DocumentData;
            const name = typeof data.name === "string" ? data.name : "";
            const slug = typeof data.slug === "string" ? data.slug : "";
            if (!name || !slug) {
              return null;
            }
            const base: Category = {
              id: docSnap.id,
              name,
              slug,
            };
            if (typeof data.description === "string" && data.description.trim()) {
              base.description = data.description;
            }
            if (typeof data.howWeWork === "string" && data.howWeWork.trim()) {
              base.howWeWork = data.howWeWork;
            }
            if (typeof data.parentId === "string" && data.parentId.trim()) {
              base.parentId = data.parentId;
            }
            if (typeof data.headerImage === "string" && data.headerImage.trim()) {
              base.headerImage = data.headerImage;
            }
            if (typeof data.layout === "string" && data.layout.trim()) {
              base.layout = data.layout as Category["layout"];
            }
            if (typeof data.order === "number" && Number.isFinite(data.order)) {
              base.order = data.order;
            }
            return base;
          })
          .filter((category): category is Category => Boolean(category))
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        setMenuCats(sortedCategories);

        const brandingData = brandingSnap.data() as DocumentData | undefined;
        setMetaPixelId((brandingData?.metaPixelId as string) || "");
        setLinkedinPartnerId((brandingData?.linkedinPartnerId as string) || "");

        const homeData = homeSnap.data() as DocumentData | undefined;
        if (homeData) {
          setHomeTitle((homeData.heroTitle as string) || "");
          setHomeSubtitle((homeData.heroSubtitle as string) || "");
          setHeroVideoUrl((homeData.heroVideoUrl as string) || "");
          setHeroPosterUrl((homeData.heroPosterUrl as string) || "");
          setHeroPosterAlt((homeData.heroPosterAlt as string) || "");
          setHomeAboutTitle((homeData.aboutTitle as string) || "");
          setHomeAboutText((homeData.aboutText as string) || "");
          setHomeCtaTitle((homeData.ctaTitle as string) || "");
          setHomeCtaText((homeData.ctaText as string) || "");
          setHomeCtaBtnText((homeData.ctaButtonText as string) || "");
          setHomeCtaBtnLink((homeData.ctaButtonLink as string) || "");

          const rawCards = Array.isArray(homeData.cards) ? (homeData.cards as HomeCard[]) : [];
          setHomeCards(sanitizeCards(rawCards));

          setProcessTitle((homeData.processTitle as string) || "");
          setProcessDescription((homeData.processDescription as string) || "");
          setProcessVideoUrl((homeData.processVideoUrl as string) || "");
          setProcessPosterUrl((homeData.processPosterUrl as string) || "");

          const rawStages = Array.isArray(homeData.processStages)
            ? (homeData.processStages as ProcessStage[])
            : [];
          setProcessStages(sanitizeProcessStages(rawStages));
        }
      } catch (error) {
        console.error("Failed to load website configuration", error);
        setFeedback({ type: "error", message: "We couldn't load the website settings. Try refreshing the page." });
      } finally {
        if (active) {
          setInitialising(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading]);

  const heroMetrics = useMemo(
    () => [
      { label: "Pages", value: pages.length },
      { label: "Menu groups", value: menuCats.length },
      { label: "Homepage cards", value: homeCards.length },
      { label: "Workflow stages", value: processStages.length },
    ],
    [pages.length, menuCats.length, homeCards.length, processStages.length],
  );

  const mergeHomepage = async (payload: Record<string, unknown>) => {
    const database = await requireDb();
    await setDoc(getHomepageDoc(database), payload, { merge: true });
  };

  const handleAddPage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!pageTitle.trim() || !pageSlug.trim()) {
      return;
    }

    try {
      setCreatingPage(true);
      const database = await requireDb();
      const ref = await addDoc(collection(database, "pages"), {
        title: pageTitle.trim(),
        slug: pageSlug.trim(),
      });

      setPages((prev) => [...prev, { id: ref.id, title: pageTitle.trim(), slug: pageSlug.trim() }]);
      setPageTitle("");
      setPageSlug("");
      setFeedback({ type: "success", message: "Landing page added." });
    } catch (error: any) {
      console.error("Failed to add page", error);
      setFeedback({ type: "error", message: error?.message || "Couldn't create the page. Please try again." });
    } finally {
      setCreatingPage(false);
    }
  };

  const addHomeCard = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cardTitle.trim() || !cardText.trim()) {
      return;
    }

    const newCard: HomeCard = {
      id: createId("card"),
      title: cardTitle.trim(),
      text: cardText.trim(),
      link: cardLink.trim() ? cardLink.trim() : undefined,
    };
    setHomeCards((current) => [...current, newCard]);
    setCardTitle("");
    setCardText("");
    setCardLink("");
  };

  const saveHomepageCopy = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSavingHomepageCopy(true);
      await mergeHomepage({
        heroTitle: homeTitle.trim(),
        heroSubtitle: homeSubtitle.trim(),
        aboutTitle: homeAboutTitle.trim(),
        aboutText: homeAboutText.trim(),
        ctaTitle: homeCtaTitle.trim(),
        ctaText: homeCtaText.trim(),
        ctaButtonText: homeCtaBtnText.trim(),
        ctaButtonLink: homeCtaBtnLink.trim(),
      });
      setFeedback({ type: "success", message: "Homepage copy updated." });
    } catch (error: any) {
      console.error("Failed to save homepage copy", error);
      setFeedback({
        type: "error",
        message: error?.message || "Saving homepage copy failed. Please try again.",
      });
    } finally {
      setSavingHomepageCopy(false);
    }
  };

  const saveHeroMedia = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSavingHeroMedia(true);
      await mergeHomepage({
        heroVideoUrl: heroVideoUrl.trim(),
        heroPosterUrl: heroPosterUrl.trim(),
        heroPosterAlt: heroPosterAlt.trim(),
      });
      setFeedback({ type: "success", message: "Hero media saved." });
    } catch (error: any) {
      console.error("Failed to save hero media", error);
      setFeedback({ type: "error", message: error?.message || "Couldn't update the hero media." });
    } finally {
      setSavingHeroMedia(false);
    }
  };

  const saveCards = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSavingCards(true);
      const sanitized = sanitizeCards(homeCards);
      await mergeHomepage({ cards: sanitized });
      setHomeCards(sanitized);
      setFeedback({ type: "success", message: "Homepage cards updated." });
    } catch (error: any) {
      console.error("Failed to save homepage cards", error);
      setFeedback({ type: "error", message: error?.message || "Saving cards failed. Please retry." });
    } finally {
      setSavingCards(false);
    }
  };

  const updateCard = (id: string, field: keyof HomeCard, value: string) => {
    setHomeCards((cards) =>
      cards.map((card) => (card.id === id ? { ...card, [field]: field === "link" ? value : value } : card)),
    );
  };

  const removeCard = (id: string) => {
    setHomeCards((cards) => cards.filter((card) => card.id !== id));
  };

  const addProcessStage = () => {
    if (!newStageTitle.trim() || !newStageDescription.trim()) {
      return;
    }

    setProcessStages((current) => [
      ...current,
      {
        id: createId("stage"),
        title: newStageTitle.trim(),
        description: newStageDescription.trim(),
      },
    ]);
    setNewStageTitle("");
    setNewStageDescription("");
  };

  const updateProcessStage = (id: string, field: keyof ProcessStage, value: string) => {
    setProcessStages((stages) => stages.map((stage) => (stage.id === id ? { ...stage, [field]: value } : stage)));
  };

  const removeProcessStage = (id: string) => {
    setProcessStages((stages) => stages.filter((stage) => stage.id !== id));
  };

  const onProcessDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }

    setProcessStages((current) => {
      const reordered = [...current];
      const [moved] = reordered.splice(result.source.index, 1);
      reordered.splice(result.destination!.index, 0, moved);
      return reordered;
    });
  };

  const saveProcess = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSavingProcess(true);
      const sanitized = sanitizeProcessStages(processStages);
      await mergeHomepage({
        processTitle: processTitle.trim(),
        processDescription: processDescription.trim(),
        processVideoUrl: processVideoUrl.trim(),
        processPosterUrl: processPosterUrl.trim(),
        processStages: sanitized,
      });
      setProcessStages(sanitized);
      setFeedback({ type: "success", message: "Workflow content saved." });
    } catch (error: any) {
      console.error("Failed to save workflow", error);
      setFeedback({ type: "error", message: error?.message || "Couldn't update the workflow." });
    } finally {
      setSavingProcess(false);
    }
  };

  const onMenuDragEnd = async (result: DropResult) => {
    if (!result.destination) {
      return;
    }

    const ordered = [...menuCats].sort((a, b) => (a.order || 0) - (b.order || 0));
    const [moved] = ordered.splice(result.source.index, 1);
    ordered.splice(result.destination.index, 0, moved);
    const updated = ordered.map((category, index) => ({ ...category, order: index }));
    setMenuCats(updated);

    try {
      const database = await requireDb();
      const batch = writeBatch(database);
      updated.forEach((category) => {
        batch.update(doc(database, "categories", category.id), { order: category.order });
      });
      await batch.commit();
      setFeedback({ type: "success", message: "Navigation order updated." });
    } catch (error: any) {
      console.error("Failed to save navigation order", error);
      setFeedback({ type: "error", message: error?.message || "Couldn't save the navigation order." });
    }
  };

  const saveAnalytics = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      setSavingAnalytics(true);
      const database = await requireDb();
      await setDoc(
        getBrandingDoc(database),
        {
          metaPixelId: metaPixelId.trim() || null,
          linkedinPartnerId: linkedinPartnerId.trim() || null,
        },
        { merge: true },
      );
      setFeedback({ type: "success", message: "Tracking settings saved." });
    } catch (error: any) {
      console.error("Failed to save analytics", error);
      setFeedback({ type: "error", message: error?.message || "Saving tracking settings failed." });
    } finally {
      setSavingAnalytics(false);
    }
  };

  if (guardLoading || initialising) {
    return (
      <PortalContainer>
        <div className="py-16 text-center text-sm text-gray-500">Loading website settings…</div>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <div className="py-16 text-center text-sm text-gray-500">
          You do not have permission to manage the website design.
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <PortalHero
          eyebrow="Marketing"
          title="Website design controls"
          description="Keep the public site aligned with the latest campaigns, track pixels, and manage navigation without touching code."
          metrics={heroMetrics}
          quickActions={tabOptions.map((option) => ({
            label: option.label,
            description: option.description,
            onClick: () => setTab(option.key),
          }))}
        />

        {feedback && (
          <div
            className={clsx(
              "rounded-3xl border p-4 sm:p-5",
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm font-medium">{feedback.message}</p>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-xs font-semibold uppercase tracking-wide text-current/70 hover:text-current"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <nav className="rounded-3xl bg-slate-100 p-1">
          <div className="flex flex-wrap gap-2">
            {tabOptions.map((option) => {
              const isActive = tab === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTab(option.key)}
                  className={clsx(
                    "flex min-w-[180px] flex-1 flex-col rounded-2xl px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500",
                    isActive ? "bg-white text-slate-900 shadow" : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
                  )}
                >
                  <span className="text-sm font-semibold">{option.label}</span>
                  <span className="mt-1 text-xs text-slate-500">{option.description}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {tab === "home" && (
          <div className="grid gap-6">
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="space-y-1 border-b border-gray-100 pb-4">
                <h2 className="text-lg font-semibold text-gray-900">Hero and CTA copy</h2>
                <p className="text-sm text-gray-600">
                  Update the headlines, supporting copy, and call-to-action that appear across the homepage hero and CTA banner.
                </p>
              </div>
              <form onSubmit={saveHomepageCopy} className="mt-6 grid gap-4 lg:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Hero title
                  <input
                    className="input"
                    placeholder="Pineapple Tapped"
                    value={homeTitle}
                    onChange={(event) => setHomeTitle(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Hero subtitle
                  <input
                    className="input"
                    placeholder="Production, streaming and creative services for modern brands."
                    value={homeSubtitle}
                    onChange={(event) => setHomeSubtitle(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:col-span-2">
                  About title
                  <input
                    className="input"
                    placeholder="About Pineapple Tapped"
                    value={homeAboutTitle}
                    onChange={(event) => setHomeAboutTitle(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:col-span-2">
                  About copy
                  <textarea
                    className="textarea min-h-[120px]"
                    placeholder="Tell visitors what makes the team unique."
                    value={homeAboutText}
                    onChange={(event) => setHomeAboutText(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  CTA title
                  <input
                    className="input"
                    placeholder="Ready to launch?"
                    value={homeCtaTitle}
                    onChange={(event) => setHomeCtaTitle(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  CTA copy
                  <textarea
                    className="textarea min-h-[120px]"
                    placeholder="Describe the podcast or campaign invitation."
                    value={homeCtaText}
                    onChange={(event) => setHomeCtaText(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  CTA button label
                  <input
                    className="input"
                    placeholder="Explore services"
                    value={homeCtaBtnText}
                    onChange={(event) => setHomeCtaBtnText(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  CTA button link
                  <input
                    className="input"
                    placeholder="/categories/video-production"
                    value={homeCtaBtnLink}
                    onChange={(event) => setHomeCtaBtnLink(event.target.value)}
                  />
                </label>
                <div className="lg:col-span-2">
                  <button type="submit" className="btn btn-sm" disabled={savingHomepageCopy}>
                    {savingHomepageCopy ? "Saving…" : "Save copy"}
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="space-y-1 border-b border-gray-100 pb-4">
                <h2 className="text-lg font-semibold text-gray-900">Hero media</h2>
                <p className="text-sm text-gray-600">
                  Control the autoplay video or fallback image that sits behind the homepage hero message.
                </p>
              </div>
              <form onSubmit={saveHeroMedia} className="mt-6 grid gap-4 lg:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:col-span-2">
                  Video URL
                  <input
                    className="input"
                    placeholder="https://cdn.example.com/hero.mp4"
                    value={heroVideoUrl}
                    onChange={(event) => setHeroVideoUrl(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:col-span-2">
                  Poster image URL
                  <input
                    className="input"
                    placeholder="https://cdn.example.com/hero-poster.jpg"
                    value={heroPosterUrl}
                    onChange={(event) => setHeroPosterUrl(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Poster alt text
                  <input
                    className="input"
                    placeholder="Hero background description"
                    value={heroPosterAlt}
                    onChange={(event) => setHeroPosterAlt(event.target.value)}
                  />
                </label>
                <div className="lg:col-span-3">
                  <button type="submit" className="btn btn-sm" disabled={savingHeroMedia}>
                    {savingHeroMedia ? "Saving…" : "Save hero media"}
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="space-y-1 border-b border-gray-100 pb-4">
                <h2 className="text-lg font-semibold text-gray-900">Workflow walkthrough</h2>
                <p className="text-sm text-gray-600">
                  Curate the process section video and stage descriptions that showcase how the Pineapple Tapped team delivers projects.
                </p>
              </div>
              <form onSubmit={saveProcess} className="mt-6 grid gap-6">
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Section title
                    <input
                      className="input"
                      placeholder="See the Pineapple Tapped workflow in action"
                      value={processTitle}
                      onChange={(event) => setProcessTitle(event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Section description
                    <textarea
                      className="textarea min-h-[120px]"
                      placeholder="Explain how clients collaborate with the team."
                      value={processDescription}
                      onChange={(event) => setProcessDescription(event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Video URL
                    <input
                      className="input"
                      placeholder="https://cdn.example.com/process.mp4"
                      value={processVideoUrl}
                      onChange={(event) => setProcessVideoUrl(event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Poster image URL
                    <input
                      className="input"
                      placeholder="https://cdn.example.com/process-poster.jpg"
                      value={processPosterUrl}
                      onChange={(event) => setProcessPosterUrl(event.target.value)}
                    />
                  </label>
                </div>

                <div className="grid gap-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Workflow stages</h3>
                  <DragDropContext onDragEnd={onProcessDragEnd}>
                    <Droppable droppableId="process-stages">
                      {(provided) => (
                        <ul ref={provided.innerRef} {...provided.droppableProps} className="grid gap-3">
                          {processStages.map((stage, index) => (
                            <Draggable key={stage.id} draggableId={stage.id} index={index}>
                              {(dragProvided) => (
                                <li
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  className="grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                      Stage {index + 1}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        {...dragProvided.dragHandleProps}
                                        className="btn btn-ghost btn-xs text-gray-500 hover:text-gray-700"
                                        aria-label="Reorder stage"
                                      >
                                        Drag
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeProcessStage(stage.id)}
                                        className="btn btn-ghost btn-xs text-rose-600 hover:text-rose-700"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                  <div className="grid gap-3 lg:grid-cols-2">
                                    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                      Title
                                      <input
                                        className="input"
                                        value={stage.title}
                                        onChange={(event) =>
                                          updateProcessStage(stage.id, "title", event.target.value)
                                        }
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                      Description
                                      <textarea
                                        className="textarea min-h-[100px]"
                                        value={stage.description}
                                        onChange={(event) =>
                                          updateProcessStage(stage.id, "description", event.target.value)
                                        }
                                      />
                                    </label>
                                  </div>
                                </li>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </ul>
                      )}
                    </Droppable>
                  </DragDropContext>

                  <div className="grid gap-3 rounded-2xl border border-dashed border-gray-300 p-4">
                    <h4 className="text-sm font-semibold text-gray-700">Add workflow stage</h4>
                    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Stage title
                      <input
                        className="input"
                        placeholder="Discover"
                        value={newStageTitle}
                        onChange={(event) => setNewStageTitle(event.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Stage description
                      <textarea
                        className="textarea min-h-[100px]"
                        placeholder="Share your brief and goals so we can scope the milestones together."
                        value={newStageDescription}
                        onChange={(event) => setNewStageDescription(event.target.value)}
                      />
                    </label>
                    <div>
                      <button type="button" className="btn btn-xs" onClick={addProcessStage}>
                        Add stage
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <button type="submit" className="btn btn-sm" disabled={savingProcess}>
                    {savingProcess ? "Saving…" : "Save workflow"}
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="space-y-1 border-b border-gray-100 pb-4">
                <h2 className="text-lg font-semibold text-gray-900">Homepage cards</h2>
                <p className="text-sm text-gray-600">
                  Manage the trio of cards that highlight key services or value propositions beneath the hero section.
                </p>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                <form onSubmit={addHomeCard} className="grid gap-3 rounded-2xl border border-dashed border-gray-300 p-4">
                  <h3 className="text-sm font-semibold text-gray-700">Add card</h3>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Title
                    <input
                      className="input"
                      placeholder="On-site production"
                      value={cardTitle}
                      onChange={(event) => setCardTitle(event.target.value)}
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Description
                    <textarea
                      className="textarea min-h-[100px]"
                      placeholder="Summarise the value in one or two sentences."
                      value={cardText}
                      onChange={(event) => setCardText(event.target.value)}
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Link (optional)
                    <input
                      className="input"
                      placeholder="/products/filming"
                      value={cardLink}
                      onChange={(event) => setCardLink(event.target.value)}
                    />
                  </label>
                  <div>
                    <button type="submit" className="btn btn-xs">
                      Add card
                    </button>
                  </div>
                </form>

                <form onSubmit={saveCards} className="grid gap-4">
                  {homeCards.length === 0 ? (
                    <p className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
                      No cards configured yet. Use the form to create highlights for the homepage.
                    </p>
                  ) : (
                    <ul className="grid gap-3">
                      {homeCards.map((card, index) => (
                        <li key={card.id} className="grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Card {index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeCard(card.id)}
                              className="btn btn-ghost btn-xs text-rose-600 hover:text-rose-700"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Title
                              <input
                                className="input"
                                value={card.title}
                                onChange={(event) => updateCard(card.id, "title", event.target.value)}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Link
                              <input
                                className="input"
                                value={card.link || ""}
                                onChange={(event) => updateCard(card.id, "link", event.target.value)}
                                placeholder="/services"
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 lg:col-span-2">
                              Description
                              <textarea
                                className="textarea min-h-[100px]"
                                value={card.text}
                                onChange={(event) => updateCard(card.id, "text", event.target.value)}
                              />
                            </label>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div>
                    <button type="submit" className="btn btn-sm" disabled={savingCards}>
                      {savingCards ? "Saving…" : "Save cards"}
                    </button>
                  </div>
                </form>
              </div>
            </section>
          </div>
        )}

        {tab === "pages" && (
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-1 border-b border-gray-100 pb-4">
              <h2 className="text-lg font-semibold text-gray-900">Landing pages</h2>
              <p className="text-sm text-gray-600">
                Create lightweight CMS entries that surface in the marketing site routing. Content can then be managed via the respective page templates.
              </p>
            </div>
            <form onSubmit={handleAddPage} className="mt-6 grid gap-3 sm:max-w-md">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Title
                <input
                  className="input"
                  placeholder="Case studies"
                  value={pageTitle}
                  onChange={(event) => setPageTitle(event.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Slug
                <input
                  className="input"
                  placeholder="case-studies"
                  value={pageSlug}
                  onChange={(event) => setPageSlug(event.target.value)}
                  required
                />
              </label>
              <button type="submit" className="btn btn-sm w-fit" disabled={creatingPage}>
                {creatingPage ? "Adding…" : "Add page"}
              </button>
            </form>
            <ul className="mt-6 grid gap-2">
              {pages.length === 0 ? (
                <li className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  No landing pages yet. Add titles and slugs to scaffold new routes.
                </li>
              ) : (
                pages.map((page) => (
                  <li key={page.id} className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{page.title}</p>
                      <p className="text-xs text-gray-600">/{page.slug}</p>
                    </div>
                    <Link href={`/${page.slug}`} className="text-xs font-semibold text-orange-600 hover:text-orange-700">
                      View page
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </section>
        )}

        {tab === "menu" && (
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-1 border-b border-gray-100 pb-4">
              <h2 className="text-lg font-semibold text-gray-900">Navigation order</h2>
              <p className="text-sm text-gray-600">
                Drag and drop service categories to control the order they appear in the marketing site menu.
              </p>
            </div>
            <div className="mt-6">
              <DragDropContext onDragEnd={onMenuDragEnd}>
                <Droppable droppableId="menu-categories">
                  {(provided) => (
                    <ul ref={provided.innerRef} {...provided.droppableProps} className="grid gap-3">
                      {menuCats
                        .slice()
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map((category, index) => (
                          <Draggable key={category.id} draggableId={category.id} index={index}>
                            {(dragProvided) => (
                              <li
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800"
                              >
                                <span>{category.name}</span>
                                <span className="text-xs uppercase tracking-wide text-gray-500">Position {index + 1}</span>
                              </li>
                            )}
                          </Draggable>
                        ))}
                      {provided.placeholder}
                    </ul>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </section>
        )}

        {tab === "branding" && (
          <div className="grid gap-6">
            <section className="rounded-3xl border border-orange-200 bg-orange-50 p-6 shadow-sm text-orange-900">
              <h2 className="text-lg font-semibold">Manage brand assets</h2>
              <p className="mt-2 text-sm text-orange-800">
                Logos, typography, and colour palettes live in the brand guidelines workspace so everything stays in sync across proposals and marketing.
              </p>
              <Link href="/admin/brand-guidelines" className="btn btn-sm mt-4 bg-white text-orange-600 hover:text-orange-700">
                Open brand guidelines
              </Link>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="space-y-1 border-b border-gray-100 pb-4">
                <h2 className="text-lg font-semibold text-gray-900">Tracking pixels</h2>
                <p className="text-sm text-gray-600">
                  Store Facebook (Meta) and LinkedIn tracking IDs so they can be injected into the marketing site.
                </p>
              </div>
              <form onSubmit={saveAnalytics} className="mt-6 grid gap-3 sm:max-w-md">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Meta Pixel ID
                  <input
                    className="input"
                    placeholder="1234567890"
                    value={metaPixelId}
                    onChange={(event) => setMetaPixelId(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  LinkedIn Partner ID
                  <input
                    className="input"
                    placeholder="1234567"
                    value={linkedinPartnerId}
                    onChange={(event) => setLinkedinPartnerId(event.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn-sm w-fit" disabled={savingAnalytics}>
                  {savingAnalytics ? "Saving…" : "Save tracking"}
                </button>
              </form>
            </section>
          </div>
        )}
      </div>
    </PortalContainer>
  );
}
