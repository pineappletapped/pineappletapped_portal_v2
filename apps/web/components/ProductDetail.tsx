"use client";

import {
  Product,
  DeliverableType,
  getProductEventRangeLabel,
  formatProductOnsiteDuration,
} from "@/lib/products";
import type { Venue } from "@/lib/venues";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ProductFeatureCard from "./ProductFeatureCard";
import type { IconType } from "react-icons";
import clsx from "clsx";
import {
  FiClipboard,
  FiClock,
  FiGift,
  FiCheck,
  FiFilm,
  FiSmartphone,
  FiCamera,
  FiGrid,
  FiImage,
  FiMusic,
  FiFileText,
  FiPlay,
  FiExternalLink,
} from "react-icons/fi";
import { getListingPriceLabel } from "./productListingUtils";
import ListingPriceNote from "./ListingPriceNote";

const deliverableIcons: Record<DeliverableType, IconType> = {
  "long-form-video": FiFilm,
  "short-form-vertical": FiSmartphone,
  photo: FiCamera,
  "photo-set": FiGrid,
  thumbnail: FiImage,
  "audio-licence": FiMusic,
  document: FiFileText,
};

type VideoPlayback =
  | { kind: "iframe"; src: string }
  | { kind: "file"; src: string }
  | { kind: "external"; src: string };

interface NormalizedVideo {
  url: string;
  title: string;
  playback: VideoPlayback;
}

type GalleryItem =
  | { id: string; type: "video"; label: string; video: NormalizedVideo }
  | { id: string; type: "image"; label: string; src: string }
  | { id: string; type: "placeholder"; label: string };

function extractPoints(value?: string | null): string[] {
  if (!value || typeof value !== "string") {
    return [];
  }
  return value
    .split(/\r?\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveVideoPlayback(input: string): VideoPlayback | null {
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "");

    const ytIdFromSearch = () => url.searchParams.get("v") || "";
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      if (id) {
        return {
          kind: "iframe",
          src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
        };
      }
    }
    if (host.endsWith("youtube.com")) {
      let id = "";
      if (ytIdFromSearch()) {
        id = ytIdFromSearch();
      } else if (url.pathname.startsWith("/shorts/")) {
        id = url.pathname.replace("/shorts/", "").split("/")[0] || "";
      } else if (url.pathname.startsWith("/embed/")) {
        id = url.pathname.replace("/embed/", "").split("/")[0] || "";
      }
      if (id) {
        return {
          kind: "iframe",
          src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
        };
      }
    }

    if (host.endsWith("vimeo.com")) {
      let id = "";
      const parts = url.pathname.split("/").filter(Boolean);
      if (host === "player.vimeo.com") {
        const videoIndex = parts.findIndex((segment) => segment === "video");
        if (videoIndex !== -1 && parts[videoIndex + 1]) {
          id = parts[videoIndex + 1];
        }
      } else if (parts[0] && /^\d+$/.test(parts[0])) {
        id = parts[0];
      }
      if (id) {
        return { kind: "iframe", src: `https://player.vimeo.com/video/${id}` };
      }
    }

    const pathname = url.pathname.toLowerCase();
    if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(pathname)) {
      return { kind: "file", src: input };
    }

    return { kind: "external", src: input };
  } catch {
    return null;
  }
}

function VideoPlayer({
  video,
  label,
  showExternalLink,
}: {
  video: NormalizedVideo;
  label: string;
  showExternalLink?: boolean;
}) {
  if (video.playback.kind === "iframe") {
    return (
      <iframe
        src={video.playback.src}
        title={label}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        className="h-full w-full border-0"
        referrerPolicy="no-referrer-when-downgrade"
      />
    );
  }

  if (video.playback.kind === "file") {
    return (
      <video
        className="h-full w-full"
        controls
        controlsList="nodownload"
        preload="metadata"
        playsInline
      >
        <source src={video.playback.src} />
        Your browser does not support embedded videos.
        <a href={video.url} className="ml-1">Watch the video in a new tab.</a>
      </video>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-900 via-gray-800 to-slate-700 p-6 text-center text-sm text-white/90">
      <FiPlay className="h-8 w-8" />
      <p>Preview not available. Open the link below to watch.</p>
      {showExternalLink && (
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded bg-white/10 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/20"
        >
          <FiExternalLink className="h-3 w-3" aria-hidden />
          Watch in new tab
        </a>
      )}
    </div>
  );
}
import AddToCartWizard from "./AddToCartWizard";
import ProductModifierSummary from "./ProductModifierSummary";
import ProductQuoteRequestDialog from "./ProductQuoteRequestDialog";
import VenueMap from "./VenueMap";

export default function ProductDetail({
  product,
  venue,
}: {
  product: Product;
  venue?: Venue | null;
}) {
  const isQuoteOnly = (product.salesMode ?? "ecommerce") === "quote";
  const CUSTOM_VARIATION_ID = "__custom";
  const [basePrice, setBasePrice] = useState(product.price);
  const [variation, setVariation] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const listingPriceDetails = useMemo(
    () =>
      getListingPriceLabel(product, {
        overrideMin:
          typeof basePrice === "number" && basePrice > 0
            ? basePrice
            : undefined,
      }),
    [product, basePrice]
  );
  const eventRangeLabel = useMemo(
    () => getProductEventRangeLabel(product),
    [product]
  );
  const onsiteSummary = useMemo(
    () => formatProductOnsiteDuration(product),
    [product]
  );

  const variationEntries = useMemo(
    () => (Array.isArray(product.variations) ? product.variations : []),
    [product.variations]
  );

  const availableVariationIds = useMemo(
    () =>
      variationEntries
        .map((entry) => entry?.id)
        .filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        ),
    [variationEntries]
  );

  const exampleVideos = useMemo<NormalizedVideo[]>(() => {
    const rawVideos = Array.isArray(product.exampleVideos)
      ? product.exampleVideos
      : [];
    const entries: NormalizedVideo[] = [];

    rawVideos.forEach((video: any) => {
      let url = "";
      let title = "";
      if (typeof video === "string") {
        url = video.trim();
      } else if (video && typeof video.url === "string") {
        url = video.url.trim();
        title = typeof video.title === "string" ? video.title.trim() : "";
      }
      if (!url) return;
      const playback = resolveVideoPlayback(url);
      if (!playback) return;
      entries.push({ url, title, playback });
    });

    if (entries.length === 0) {
      const fallback =
        typeof product.exampleWorkUrl === "string"
          ? product.exampleWorkUrl.trim()
          : "";
      if (fallback) {
        const playback = resolveVideoPlayback(fallback);
        if (playback) {
          entries.push({ url: fallback, title: "", playback });
        }
      }
    }

    return entries;
  }, [product.exampleVideos, product.exampleWorkUrl]);

  const galleryMedia = useMemo<GalleryItem[]>(() => {
    const items: GalleryItem[] = [];

    exampleVideos.forEach((video, index) => {
      const label = video.title || `Example video ${index + 1}`;
      items.push({
        id: `video-${index}-${video.url}`,
        type: "video",
        label,
        video,
      });
    });

    const gallerySources = Array.isArray(product.imageUrls)
      ? product.imageUrls
          .map((url) => (typeof url === "string" ? url.trim() : ""))
          .filter((url) => url.length > 0)
      : [];
    const fallbackCover =
      typeof product.imageUrl === "string" ? product.imageUrl.trim() : "";
    const coverImage = gallerySources[0] || fallbackCover;
    const usedImageUrls = new Set<string>();
    if (coverImage) {
      items.push({
        id: `image-cover-${coverImage}`,
        type: "image",
        label: product.name ? `${product.name} cover` : "Product image",
        src: coverImage,
      });
      usedImageUrls.add(coverImage);
    }

    const additionalGallery = coverImage
      ? gallerySources.slice(1)
      : gallerySources;
    additionalGallery.forEach((imageUrl, index) => {
      if (usedImageUrls.has(imageUrl)) return;
      usedImageUrls.add(imageUrl);
      items.push({
        id: `gallery-${index}-${imageUrl}`,
        type: "image",
        label: `Gallery image ${index + 1}`,
        src: imageUrl,
      });
    });

    if (Array.isArray(product.storyboardImages)) {
      product.storyboardImages.forEach((imageUrl, index) => {
        if (typeof imageUrl !== "string") return;
        const trimmed = imageUrl.trim();
        if (!trimmed || usedImageUrls.has(trimmed)) return;
        usedImageUrls.add(trimmed);
        items.push({
          id: `storyboard-${index}-${trimmed}`,
          type: "image",
          label: `Storyboard ${index + 1}`,
          src: trimmed,
        });
      });
    }

    if (items.length === 0) {
      items.push({
        id: "placeholder",
        type: "placeholder",
        label: product.name || "Product preview",
      });
    }

    return items;
  }, [
    exampleVideos,
    product.imageUrl,
    product.imageUrls,
    product.storyboardImages,
    product.name,
  ]);

  const [activeMediaId, setActiveMediaId] = useState<string | null>(
    galleryMedia[0]?.id ?? null
  );

  useEffect(() => {
    setActiveMediaId(galleryMedia[0]?.id ?? null);
  }, [galleryMedia]);

  const activeMedia = useMemo(() => {
    return galleryMedia.find((item) => item.id === activeMediaId) ?? galleryMedia[0];
  }, [galleryMedia, activeMediaId]);

  const selectableMedia = useMemo(
    () => galleryMedia.filter((item) => item.type !== "placeholder"),
    [galleryMedia]
  );

  const handleVariation = (id: string) => {
    if (id === CUSTOM_VARIATION_ID) {
      setVariation(CUSTOM_VARIATION_ID);
      setBasePrice(product.price);
      return;
    }
    const v = variationEntries.find((va) => va.id === id);
    setVariation(id);
    setBasePrice(v?.price ?? product.price);
  };

  const price = basePrice;

  const handleAdd = () => {
    const variationRequired = variationEntries.length > 0;
    if (variationRequired && !variation) return;
    if (isQuoteOnly || variation === CUSTOM_VARIATION_ID) {
      setQuoteOpen(true);
      return;
    }
    setWizardOpen(true);
  };

  const venueName = venue?.name || product.venue || "";

  const variationNameById = useMemo(() => {
    if (variationEntries.length === 0) {
      return new Map<string, string>();
    }
    return new Map(
      variationEntries.map((entry, index) => [
        entry.id,
        entry.name?.trim() || `Package ${index + 1}`,
      ])
    );
  }, [variationEntries]);

  const activeVariation = useMemo(() => {
    if (!variation) {
      return null;
    }
    return variationEntries.find((entry) => entry?.id === variation) ?? null;
  }, [variationEntries, variation]);

  const selectedVariationSummary = useMemo(() => {
    if (!variation) return null;
    if (variation === CUSTOM_VARIATION_ID) {
      return { label: "Custom request" };
    }
    const label = variationNameById.get(variation) || "";
    return { id: variation, label };
  }, [variation, variationNameById]);

  const deliverableDisplay = useMemo(() => {
    const entries = Array.isArray(product.deliverables)
      ? product.deliverables.filter(
          (item): item is NonNullable<Product["deliverables"]>[number] =>
            !!item && typeof item === "object"
        )
      : [];

    const selectedId =
      variation && availableVariationIds.includes(variation) ? variation : null;

    let hasRestricted = false;

    const visible = entries.filter((deliverable) => {
      const scopedIds = Array.isArray(deliverable.variationIds)
        ? deliverable.variationIds.filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0
          )
        : [];
      if (scopedIds.length > 0) {
        hasRestricted = true;
        if (!selectedId) {
          return false;
        }
        return scopedIds.includes(selectedId);
      }
      return true;
    });

    return {
      visible,
      hasRestricted,
      selectedId,
      total: entries.length,
    } as const;
  }, [product.deliverables, availableVariationIds, variation]);

  const deliverableSummaries = useMemo(() => {
    const items: {
      key: string;
      title: string;
      description: string;
      thumb?: string;
      Icon: IconType;
      scopeLabels: string[];
    }[] = [];

    deliverableDisplay.visible.forEach((deliverable, index) => {
      const title =
        typeof deliverable.title === "string"
          ? deliverable.title.trim()
          : "";
      const description =
        typeof deliverable.description === "string"
          ? deliverable.description.trim()
          : "";
      const thumb =
        typeof deliverable.thumbnailUrl === "string"
          ? deliverable.thumbnailUrl.trim()
          : "";
      if (!title && !description && !thumb) {
        return;
      }
      const Icon =
        (deliverable.type && deliverableIcons[deliverable.type]) || FiCheck;
      const scopeLabels = Array.isArray(deliverable.variationIds)
        ? deliverable.variationIds
            .filter(
              (id): id is string =>
                typeof id === "string" && id.trim().length > 0
            )
            .map((id) => variationNameById.get(id) || id)
        : [];

      items.push({
        key: `${index}-${title || "deliverable"}`,
        title,
        description,
        thumb: thumb || undefined,
        Icon,
        scopeLabels,
      });
    });

    return items;
  }, [deliverableDisplay.visible, variationNameById]);

  const deliverablesByVariation = useMemo(() => {
    if (!Array.isArray(product.deliverables) || product.deliverables.length === 0) {
      return null;
    }
    const byId = new Map<string, number>();
    product.deliverables.forEach((entry) => {
      if (!entry) return;
      const scoped = Array.isArray(entry.variationIds)
        ? entry.variationIds
            .map((id) => id?.trim())
            .filter(
              (id): id is string =>
                typeof id === "string" && availableVariationIds.includes(id)
            )
        : [];
      const targetIds = scoped.length > 0 ? scoped : availableVariationIds;
      if (targetIds.length === 0) {
        return;
      }
      targetIds.forEach((id) => {
        byId.set(id, (byId.get(id) || 0) + 1);
      });
    });
    return {
      byId,
      fallback: product.deliverables.length,
    } as const;
  }, [product.deliverables, availableVariationIds]);

  const deliverableHighlights = useMemo(() => {
    if (!Array.isArray(product.deliverables)) return [] as string[];
    return product.deliverables
      .map((entry) =>
        typeof entry?.title === "string" ? entry.title.trim() : ""
      )
      .filter((title) => title.length > 0)
      .slice(0, 3);
  }, [product.deliverables]);

  const heroBadges = useMemo(() => {
    const badges = [...deliverableHighlights];
    if (badges.length < 3 && onsiteSummary) {
      badges.push(onsiteSummary);
    }
    if (badges.length < 3 && product.deliveryTime) {
      badges.push(product.deliveryTime);
    }
    if (badges.length < 3 && eventRangeLabel) {
      badges.push(`Event window ${eventRangeLabel}`);
    }
    return badges.slice(0, 3);
  }, [deliverableHighlights, onsiteSummary, product.deliveryTime, eventRangeLabel]);

  const heroFacts = useMemo(() => {
    const facts: { label: string; value: string }[] = [];
    if (onsiteSummary) {
      facts.push({ label: "On-site", value: onsiteSummary });
    }
    if (product.deliveryTime) {
      facts.push({ label: "Delivery", value: product.deliveryTime });
    }
    if (eventRangeLabel) {
      facts.push({ label: "Schedule", value: eventRangeLabel });
    }
    if (deliverablesByVariation?.fallback) {
      facts.push({
        label: "Deliverables",
        value: `${deliverablesByVariation.fallback} included`,
      });
    } else if (variationEntries.length > 0) {
      facts.push({
        label: "Packages",
        value: `${variationEntries.length} options`,
      });
    }
    return facts.slice(0, 4);
  }, [
    onsiteSummary,
    product.deliveryTime,
    eventRangeLabel,
    deliverablesByVariation,
    variationEntries,
  ]);

  const variationComparison = useMemo(() => {
    if (variationEntries.length < 2) {
      return null;
    }
    const rows: { label: string; values: string[] }[] = [];
    rows.push({
      label: "Price",
      values: variationEntries.map((variationEntry) =>
        variationEntry.price > 0
          ? `£${variationEntry.price.toFixed(2)}`
          : "Custom quote"
      ),
    });
    const featureValues = variationEntries.map((variationEntry) =>
      Array.isArray(variationEntry.features) && variationEntry.features.length > 0
        ? variationEntry.features.slice(0, 3).join(", ")
        : ""
    );
    if (featureValues.some((value) => value.length > 0)) {
      rows.push({
        label: "Highlights",
        values: featureValues.map((value) => value || "—"),
      });
    }
    if (deliverablesByVariation) {
      rows.push({
        label: "Deliverables",
        values: variationEntries.map((variationEntry) => {
          const count =
            deliverablesByVariation.byId.get(variationEntry.id) ??
            deliverablesByVariation.fallback;
          return count > 0
            ? `${count} included`
            : "Confirmed during scoping";
        }),
      });
    }
    if (product.deliveryTime) {
      rows.push({
        label: "Turnaround",
        values: variationEntries.map(() => product.deliveryTime!),
      });
    }
    return rows;
  }, [variationEntries, deliverablesByVariation, product.deliveryTime]);

  const hasVariations = availableVariationIds.length > 0;

  return (
    <div className="space-y-16">
      <section className="overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-black/5">
        <div className="grid gap-10 p-6 md:p-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-900 md:text-5xl">
                {product.name}
              </h1>
              {product.tagline && (
                <p className="mt-3 text-lg text-slate-600 md:text-xl">
                  {product.tagline}
                </p>
              )}
            </div>
            {heroBadges.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {heroBadges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex items-center rounded-full border border-orange/30 bg-orange/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-700"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-3xl font-semibold text-slate-900">
                  {isQuoteOnly
                    ? "Bespoke quote required"
                    : typeof price === "number" && price > 0
                      ? `£${price.toFixed(2)}`
                      : "Pricing confirmed during booking"}
                </p>
                {listingPriceDetails && !isQuoteOnly && (
                  <p className="text-sm font-medium text-slate-700">
                    {listingPriceDetails.headline}
                  </p>
                )}
                <ListingPriceNote
                  className="text-sm text-slate-600"
                  note={listingPriceDetails?.note}
                  rangeNote={listingPriceDetails?.rangeNote}
                />
              </div>
              {heroFacts.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {heroFacts.map((fact) => (
                    <div
                      key={`${fact.label}-${fact.value}`}
                      className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {fact.label}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {fact.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {hasVariations ? (
                <Link href="#variation-options" className="btn btn-primary">
                  Explore packages
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAdd}
                >
                  {isQuoteOnly ? "Request bespoke quote" : "Add to cart"}
                </button>
              )}
              <Link href="/contact" className="btn btn-ghost">
                Talk to the team
              </Link>
            </div>
          </div>
          <div className="space-y-4">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950 shadow-lg">
              {activeMedia?.type === "image" && (
                <Image
                  src={activeMedia.src}
                  alt={activeMedia.label || product.name || "Product image"}
                  fill
                  priority
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  className="object-cover"
                />
              )}
              {activeMedia?.type === "video" && (
                <div className="absolute inset-0">
                  <VideoPlayer
                    video={activeMedia.video}
                    label={activeMedia.label}
                    showExternalLink
                  />
                </div>
              )}
              {activeMedia?.type === "placeholder" && (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 text-sm text-slate-200">
                  <FiPlay className="h-8 w-8" aria-hidden />
                  <p>No preview available</p>
                </div>
              )}
              {activeMedia?.type === "video" && (
                <span className="absolute bottom-3 left-3 inline-flex items-center rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                  Showcase preview
                </span>
              )}
            </div>
            {selectableMedia.length > 1 && (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {selectableMedia.map((item) => {
                  const isActive = activeMedia?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveMediaId(item.id)}
                      aria-pressed={isActive}
                      aria-label={`Show ${item.label}`}
                      className={clsx(
                        "relative h-20 overflow-hidden rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                        isActive
                          ? "border-orange ring-2 ring-orange"
                          : "border-slate-200 bg-white hover:border-orange/70"
                      )}
                    >
                      {item.type === "image" ? (
                        <div className="relative h-full w-full">
                          <Image
                            src={item.src}
                            alt={item.label}
                            fill
                            sizes="120px"
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-900/80 text-white">
                          <FiPlay className="h-6 w-6" aria-hidden />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {hasVariations && (
        <section
          id="variation-options"
          className="space-y-6 rounded-3xl bg-slate-50 p-6 shadow-inner ring-1 ring-slate-100 md:p-10"
        >
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-slate-900">
              Choose a variation
            </h2>
            <p className="text-sm text-slate-600">
              Select the configuration that fits your shoot. We can tailor a custom package on request.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <label className="grid gap-2 text-sm font-medium text-slate-900">
                Package selection
                <select
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/30"
                  value={variation}
                  onChange={(event) => handleVariation(event.target.value)}
                >
                  <option value="">Select a package</option>
                  {variationEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.price > 0 ? ` — £${entry.price.toFixed(2)}` : ""}
                    </option>
                  ))}
                  <option value={CUSTOM_VARIATION_ID}>Request a custom package</option>
                </select>
              </label>
              {activeVariation?.features && activeVariation.features.length > 0 && (
                <div className="rounded-2xl border border-orange/20 bg-white px-4 py-4 text-sm text-slate-700 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                    Highlights
                  </p>
                  <ul className="mt-2 space-y-1">
                    {activeVariation.features.map((feature, index) => (
                      <li key={`${activeVariation.id}-feature-${index}`} className="flex items-start gap-2">
                        <FiCheck className="mt-0.5 h-4 w-4 text-orange" aria-hidden />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={handleAdd}
                disabled={variation === ""}
              >
                {variation === CUSTOM_VARIATION_ID || isQuoteOnly
                  ? "Request bespoke quote"
                  : "Add to cart"}
              </button>
            </div>
            {variationComparison && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Compare variations
                  </h3>
                  <span className="rounded-full bg-orange/10 px-3 py-1 text-xs font-semibold text-orange-700">
                    {availableVariationIds.length} options
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold text-slate-700">
                          Feature
                        </th>
                        {variationEntries.map((entry) => (
                          <th key={`heading-${entry.id}`} scope="col" className="px-4 py-3 font-semibold text-slate-700">
                            {entry.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {variationComparison.map((row) => (
                        <tr key={row.label}>
                          <th scope="row" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {row.label}
                          </th>
                          {row.values.map((value, index) => (
                            <td key={`${row.label}-${index}`} className="px-4 py-3 text-sm text-slate-700">
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {(product.productSpec?.overview || product.productSpec?.filming ||
        product.productSpec?.editing || product.productSpec?.delivery) && (
        <section className="space-y-8 rounded-3xl bg-white p-6 shadow-lg ring-1 ring-gray-100 md:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-slate-900">
                The package at a glance
              </h2>
              {product.productSpec?.overview && (
                <p className="text-base text-slate-600">
                  {product.productSpec.overview}
                </p>
              )}
            </div>
            {heroFacts.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {heroFacts.map((fact) => (
                  <div
                    key={`summary-${fact.label}-${fact.value}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {fact.label}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {fact.value}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {product.productSpec?.filming && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Filming</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {extractPoints(product.productSpec.filming).map((point, index) => (
                    <li key={`filming-${index}`} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-orange" aria-hidden />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {product.productSpec?.editing && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Editing</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {extractPoints(product.productSpec.editing).map((point, index) => (
                    <li key={`editing-${index}`} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-orange" aria-hidden />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {product.productSpec?.delivery && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">Delivery</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {extractPoints(product.productSpec.delivery).map((point, index) => (
                    <li key={`delivery-${index}`} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-orange" aria-hidden />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {product.deliverables && product.deliverables.length > 0 && (
        <section className="space-y-4 rounded-3xl bg-slate-50 p-6 shadow-inner ring-1 ring-slate-100 md:p-10">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold text-slate-900">
              What you’ll receive
            </h2>
            <p className="text-sm text-slate-600">
              Every package comes with polished, ready-to-use assets. Choose a package above to see any variation-specific deliverables.
            </p>
          </div>
          {deliverableDisplay.hasRestricted &&
            !deliverableDisplay.selectedId &&
            deliverableSummaries.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-600">
                Select a package to reveal the deliverables for that option.
              </p>
            ) : deliverableSummaries.length > 0 ? (
              <ul className="grid gap-4 md:grid-cols-2">
                {deliverableSummaries.map(({ key, title, description, thumb, Icon, scopeLabels }, index) => (
                  <li
                    key={key}
                    className="flex gap-4 rounded-2xl border border-white/60 bg-white px-4 py-4 shadow-sm ring-1 ring-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange/10 text-orange">
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0 space-y-2">
                      {title && (
                        <p className="text-base font-semibold text-slate-900">
                          {title}
                        </p>
                      )}
                      {description && (
                        <p className="text-sm text-slate-700">{description}</p>
                      )}
                      {thumb && (
                        <Image
                          src={thumb}
                          alt={title || `Deliverable ${index + 1}`}
                          width={128}
                          height={72}
                          className="h-24 w-full rounded-xl object-cover"
                        />
                      )}
                      {scopeLabels.length > 0 && (
                        <p className="text-xs text-slate-500">
                          Included with: {scopeLabels.join(', ')}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-600">
                {deliverableDisplay.selectedId
                  ? "No deliverables are assigned to this package yet."
                  : "Deliverables will be confirmed during scoping."}
              </p>
            )}
        </section>
      )}

      {(product.requirements || product.operationsInfo || product.deliveryTime || product.productSpec?.notes) && (
        <section className="grid gap-4 rounded-3xl bg-white p-6 shadow-lg ring-1 ring-gray-100 md:grid-cols-3 md:p-10">
          {product.requirements && (
            <ProductFeatureCard title="Client requirements" icon={FiClipboard}>
              <p className="whitespace-pre-line">{product.requirements}</p>
            </ProductFeatureCard>
          )}
          {(product.deliveryTime || product.operationsInfo) && (
            <ProductFeatureCard title="Timeline" icon={FiClock}>
              {product.deliveryTime && <p>{product.deliveryTime}</p>}
              {product.operationsInfo && (
                <div className={`grid gap-1${product.deliveryTime ? ' mt-3' : ''}`}>
                  <p className="font-semibold text-slate-900">Operations detail</p>
                  <p className="whitespace-pre-line">{product.operationsInfo}</p>
                </div>
              )}
            </ProductFeatureCard>
          )}
          {product.productSpec?.notes && (
            <ProductFeatureCard title="Production notes" icon={FiGift}>
              <p className="whitespace-pre-line">{product.productSpec.notes}</p>
            </ProductFeatureCard>
          )}
        </section>
      )}

      {product.description && (
        <section className="rounded-3xl bg-white p-6 shadow-lg ring-1 ring-gray-100 md:p-10">
          <h2 className="text-2xl font-semibold text-slate-900">Full description</h2>
          <div
            className="prose mt-4 max-w-none"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        </section>
      )}

      {venue && (
        <section className="rounded-3xl bg-slate-50 p-6 shadow-inner ring-1 ring-slate-100 md:p-10">
          <h2 className="text-2xl font-semibold text-slate-900">Venue information</h2>
          <div className="mt-4 grid gap-2 text-sm text-slate-700">
            {venue.address && (
              <p>
                <span className="font-semibold text-slate-900">Address:</span> {venue.address}
              </p>
            )}
            <VenueMap venue={venue} className="mt-4" />
          </div>
        </section>
      )}

      <ProductModifierSummary product={product} />

      <section className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-10 text-white shadow-xl">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold">Ready to capture your story?</h2>
            <p className="text-sm text-slate-200">
              Book a production slot or chat through a bespoke configuration. Our team will guide you from prep to delivery.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAdd}
              disabled={hasVariations && variation === ""}
            >
              {isQuoteOnly || variation === CUSTOM_VARIATION_ID
                ? "Request bespoke quote"
                : "Add to cart"}
            </button>
            <Link href="/contact" className="btn btn-ghost text-white">
              Talk with a producer
            </Link>
          </div>
        </div>
      </section>

      {wizardOpen && !isQuoteOnly && (
        <AddToCartWizard
          product={product}
          variationId={
            variation && variation !== CUSTOM_VARIATION_ID
              ? variation
              : undefined
          }
          basePrice={basePrice}
          onClose={() => setWizardOpen(false)}
        />
      )}
      {quoteOpen && (
        <ProductQuoteRequestDialog
          product={product}
          open={quoteOpen}
          onClose={() => setQuoteOpen(false)}
          variation={selectedVariationSummary}
        />
      )}
    </div>
  );
}
