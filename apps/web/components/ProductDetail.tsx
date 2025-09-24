"use client";

import { Product, DeliverableType } from "@/lib/products";
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
import VenueMap from "./VenueMap";

export default function ProductDetail({
  product,
  venue,
}: {
  product: Product;
  venue?: Venue | null;
}) {
  const [basePrice, setBasePrice] = useState(product.price);
  const [variation, setVariation] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);

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

    const coverImage =
      typeof product.imageUrl === "string" ? product.imageUrl.trim() : "";
    if (coverImage) {
      items.push({
        id: "image-cover",
        type: "image",
        label: product.name ? `${product.name} cover` : "Product image",
        src: coverImage,
      });
    }

    if (Array.isArray(product.storyboardImages)) {
      product.storyboardImages.forEach((imageUrl, index) => {
        if (typeof imageUrl !== "string") return;
        const trimmed = imageUrl.trim();
        if (!trimmed) return;
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
  }, [exampleVideos, product.imageUrl, product.storyboardImages, product.name]);

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
    const v = product.variations?.find((va) => va.id === id);
    setVariation(id);
    setBasePrice(v?.price ?? product.price);
  };

  const price = basePrice;

  const handleAdd = () => {
    const variationRequired = product.variations && product.variations.length > 0;
    if (variationRequired && !variation) return;
    setWizardOpen(true);
  };

  const venueName = venue?.name || product.venue || "";

  return (
    <div className="space-y-12">
      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-gray-200">
            {activeMedia?.type === "image" && (
              <Image
                src={activeMedia.src}
                alt={activeMedia.label || product.name || "Product image"}
                fill
                priority
                sizes="(min-width: 768px) 50vw, 100vw"
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
              <div className="flex h-full w-full items-center justify-center bg-gray-200 text-sm text-gray-500">
                No preview available
              </div>
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
                      "relative h-20 overflow-hidden rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 focus-visible:ring-offset-white",
                      isActive
                        ? "border-orange ring-2 ring-orange"
                        : "border-gray-200 hover:border-orange/70"
                    )}
                  >
                    {item.type === "image" ? (
                      <div className="relative h-full w-full">
                        <Image
                          src={item.src}
                          alt={item.label}
                          fill
                          sizes="100px"
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
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold">{product.name}</h1>
          {product.tagline && (
            <p className="text-gray-600">{product.tagline}</p>
          )}
          <p className="text-2xl font-bold">£{price.toFixed(2)}</p>
          {product.category === "exhibition-videography" && product.eventDate && (
            <p className="text-sm text-gray-700">
              Event Date: {new Date(product.eventDate).toLocaleDateString()}
            </p>
          )}
          {product.category === "exhibition-videography" && venueName && (
            <p className="text-sm text-gray-700">Venue: {venueName}</p>
          )}
          {product.variations && product.variations.length > 0 && (
            <div className="grid gap-2">
              <h2 className="font-semibold">Package</h2>
              <select
                className="input"
                value={variation}
                onChange={(e) => handleVariation(e.target.value)}
              >
                <option value="">Select a package</option>
                {product.variations.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} – £{v.price.toFixed(2)}
                  </option>
                ))}
              </select>
              {variation && product.variations.find((v) => v.id === variation)?.features && (
                <ul className="list-disc pl-5 text-sm">
                  {product.variations
                    .find((v) => v.id === variation)!
                    .features?.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                </ul>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn w-full md:w-auto"
            disabled={
              product.variations && product.variations.length > 0 && !variation
            }
            onClick={handleAdd}
          >
            Add to Cart
          </button>
          {wizardOpen && (
            <AddToCartWizard
              product={product}
              variationId={variation || undefined}
              basePrice={basePrice}
              onClose={() => setWizardOpen(false)}
            />
          )}
        </div>
      </div>

      {product.description && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Product Description</h2>
          <div
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        </section>
      )}

      {venue && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Venue Information</h2>
          <div className="grid gap-2 text-sm text-gray-700">
            {venue.address && (
              <p>
                <span className="font-medium">Address:</span> {venue.address}
              </p>
            )}
            <VenueMap venue={venue} className="mt-2" />
          </div>
        </section>
      )}

      {(product.requirements || product.deliveryTime || product.operationsInfo ||
        (product.deliverables && product.deliverables.length > 0)) && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Project Details</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {product.requirements && (
              <ProductFeatureCard title="Client Requirements" icon={FiClipboard}>
                <p className="whitespace-pre-line">{product.requirements}</p>
              </ProductFeatureCard>
            )}
            {(product.deliveryTime || product.operationsInfo) && (
              <ProductFeatureCard title="Delivery Time" icon={FiClock}>
                {product.deliveryTime && <p>{product.deliveryTime}</p>}
                {product.operationsInfo && (
                  <div className={`grid gap-1${product.deliveryTime ? " mt-3" : ""}`}>
                    <p className="font-semibold text-gray-900">Our Operations</p>
                    <p className="whitespace-pre-line">{product.operationsInfo}</p>
                  </div>
                )}
              </ProductFeatureCard>
            )}
            {product.deliverables && product.deliverables.length > 0 && (
              <ProductFeatureCard title="Deliverables" icon={FiGift}>
                <ul className="space-y-2">
                  {product.deliverables.map((d, i) => {
                    const title = d.title?.trim();
                    const description = d.description?.trim();
                    const thumb = d.thumbnailUrl?.trim();
                    if (!title && !description && !thumb) return null;
                    const Icon =
                      (d.type && deliverableIcons[d.type]) || FiCheck;
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <Icon className="mt-1 text-orange shrink-0" />
                        <div>
                          {title && <p className="font-medium">{title}</p>}
                          {description && (
                            <p className="text-gray-700 text-sm">{description}</p>
                          )}
                          {thumb && (
                            <Image
                              src={thumb}
                              alt={title || `Deliverable ${i + 1}`}
                              width={64}
                              height={64}
                              className="w-16 h-16 object-cover rounded mt-1"
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </ProductFeatureCard>
            )}
          </div>
        </section>
      )}

      {exampleVideos.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Example Videos</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {exampleVideos.map((video, index) => {
              const label = video.title || `Example video ${index + 1}`;
              return (
                <div
                  key={`${video.url}-${index}`}
                  className="space-y-3 rounded-lg border bg-white p-3 shadow-sm"
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
                    <VideoPlayer video={video} label={label} />
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-gray-900">{label}</p>
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-orange hover:text-orange/80"
                    >
                      <FiExternalLink className="h-4 w-4" aria-hidden />
                      Watch in new tab
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <ProductModifierSummary product={product} />

      <section className="text-center py-8">
        <p>
          Have questions or need something custom?{' '}
          <Link href="/contact" className="text-orange underline">
            Contact us
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
