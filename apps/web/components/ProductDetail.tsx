"use client";

import { Product, DeliverableType } from "@/lib/products";
import type { Venue } from "@/lib/venues";
import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ProductFeatureCard from "./ProductFeatureCard";
import type { IconType } from "react-icons";
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

  const exampleVideos = useMemo(() => {
    const rawVideos = Array.isArray(product.exampleVideos)
      ? product.exampleVideos
      : [];
    const normalised = rawVideos
      .map((video: any) => {
        if (typeof video === "string") {
          const url = video.trim();
          if (!url) return null;
          return { url, title: "" };
        }
        if (video && typeof video.url === "string") {
          const url = video.url.trim();
          if (!url) return null;
          const title =
            typeof video.title === "string" ? video.title.trim() : "";
          return { url, title };
        }
        return null;
      })
      .filter((entry): entry is { url: string; title: string } => !!entry);
    if (normalised.length === 0) {
      const fallback =
        typeof product.exampleWorkUrl === "string"
          ? product.exampleWorkUrl.trim()
          : "";
      if (fallback) {
        normalised.push({ url: fallback, title: "" });
      }
    }
    return normalised;
  }, [product.exampleVideos, product.exampleWorkUrl]);

  const resolveYouTubeEmbed = (input: string) => {
    try {
      const url = new URL(input);
      const host = url.hostname.replace(/^www\./, "");
      let id = "";
      if (host === "youtu.be") {
        id = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (host.endsWith("youtube.com")) {
        if (url.searchParams.get("v")) {
          id = url.searchParams.get("v") || "";
        } else if (url.pathname.startsWith("/shorts/")) {
          id = url.pathname.replace("/shorts/", "").split("/")[0] || "";
        } else if (url.pathname.startsWith("/embed/")) {
          id = url.pathname.replace("/embed/", "").split("/")[0] || "";
        }
      }
      if (!id) return null;
      return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    } catch {
      return null;
    }
  };

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
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              width={800}
              height={600}
              priority
              className="w-full h-80 object-cover rounded"
            />
          ) : (
            <div className="w-full h-80 bg-gray-200 rounded" />
          )}
          {product.storyboardImages && product.storyboardImages.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {product.storyboardImages.map((url, i) => (
                <Image
                  key={i}
                  src={url}
                  alt={`Storyboard ${i + 1}`}
                  width={300}
                  height={200}
                  className="w-full h-24 object-cover rounded"
                />
              ))}
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

      {(product.requirements || product.deliveryTime ||
        (product.deliverables && product.deliverables.length > 0)) && (
        <section>
          <h2 className="text-xl font-semibold mb-2">Project Details</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {product.requirements && (
              <ProductFeatureCard title="Client Requirements" icon={FiClipboard}>
                <p className="whitespace-pre-line">{product.requirements}</p>
              </ProductFeatureCard>
            )}
            {product.deliveryTime && (
              <ProductFeatureCard title="Delivery Time" icon={FiClock}>
                <p>{product.deliveryTime}</p>
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
              const embedUrl = resolveYouTubeEmbed(video.url);
              const label = video.title || `Example video ${index + 1}`;
              return (
                <div
                  key={`${video.url}-${index}`}
                  className="space-y-3 rounded-lg border bg-white p-3 shadow-sm"
                >
                  <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
                    {embedUrl ? (
                      <iframe
                        src={embedUrl}
                        title={label}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                        className="h-full w-full border-0"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-900 via-gray-800 to-slate-700 p-6 text-center text-sm text-white/90">
                        <FiPlay className="h-8 w-8" />
                        <p>Preview not available. Open the link below to watch.</p>
                      </div>
                    )}
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
