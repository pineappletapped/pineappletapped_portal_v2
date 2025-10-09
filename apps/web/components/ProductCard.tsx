"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Product,
  getProductEventRangeLabel,
  formatProductOnsiteDuration,
} from "@/lib/products";
import { DIGITAL_STATUS_META, getDigitalStatusMeta } from "@/lib/digital-delivery";
import {
  FiCalendar,
  FiMapPin,
  FiClock,
  FiCheckCircle,
  FiFilm,
  FiDownload,
} from "react-icons/fi";
import {
  deliverableIconMap,
  getDeliverableSummary,
  getListingPriceLabel,
} from "./productListingUtils";
import AddToCartWizard from "./AddToCartWizard";
import ProductQuoteRequestDialog from "./ProductQuoteRequestDialog";
import ListingPriceNote from "./ListingPriceNote";
import {
  normaliseOrganiserId,
  normaliseOrganiserProgram,
  type OrganiserAccessContext,
} from "@/lib/organisers";

const DIGITAL_TONE_CLASSES: Record<string, string> = {
  released: "bg-emerald-100 text-emerald-800",
  processing: "bg-sky-100 text-sky-800",
  archived: "bg-slate-200 text-slate-700",
  partial: "bg-amber-100 text-amber-800",
  pending: "bg-amber-100 text-amber-800",
};

const resolveDigitalToneClass = (tone?: string | null): string => {
  if (!tone) {
    return "bg-sky-100 text-sky-800";
  }
  return DIGITAL_TONE_CLASSES[tone] ?? "bg-sky-100 text-sky-800";
};

export default function ProductCard({ product }: { product: Product }) {
  const [selectedVariation, setSelectedVariation] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [organiserQuery, setOrganiserQuery] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const token = params.get("organiser") ?? params.get("organiserId");
    setOrganiserQuery(token);
  }, []);
  const organiserProgram = useMemo(
    () => normaliseOrganiserProgram(product.organiserProgram ?? null),
    [product.organiserProgram]
  );
  const organiserQueryValue = useMemo(
    () => normaliseOrganiserId(organiserQuery),
    [organiserQuery]
  );
  const organiserContext = useMemo<OrganiserAccessContext | null>(() => {
    if (!organiserProgram) {
      return null;
    }
    const active = Boolean(
      organiserQueryValue && organiserQueryValue === organiserProgram.organiserId
    );
    return {
      program: organiserProgram,
      active,
      source: "query",
      token: organiserQueryValue ?? null,
    } satisfies OrganiserAccessContext;
  }, [organiserProgram, organiserQueryValue]);
  const organiserActive = organiserContext?.active ?? false;
  const variations = useMemo(
    () => (Array.isArray(product.variations) ? product.variations : []),
    [product.variations]
  );
  const requiresVariation = variations.length > 0;
  const isQuoteOnly = (product.salesMode ?? "ecommerce") === "quote";
  const computePriceForSelection = useCallback(
    (variationId: string | null) => {
      const baseProductPrice =
        typeof product.price === "number" && Number.isFinite(product.price)
          ? product.price
          : 0;
      const selectedVariation = variationId
        ? variations.find((variation) => variation?.id === variationId) ?? null
        : null;
      const variationPrice =
        typeof selectedVariation?.price === "number" &&
        Number.isFinite(selectedVariation.price)
          ? selectedVariation.price
          : null;
      if (organiserActive && organiserContext) {
        const exhibitorBase =
          typeof organiserContext.program.exhibitorPrice === "number" &&
          Number.isFinite(organiserContext.program.exhibitorPrice)
            ? organiserContext.program.exhibitorPrice
            : baseProductPrice;
        const delta = (variationPrice ?? baseProductPrice) - baseProductPrice;
        const adjusted = exhibitorBase + delta;
        return Math.max(0, Number.isFinite(adjusted) ? adjusted : exhibitorBase);
      }
      if (variationPrice != null) {
        return variationPrice;
      }
      return baseProductPrice;
    },
    [organiserActive, organiserContext, product.price, variations]
  );
  const activeVariation = requiresVariation
    ? variations.find((variation) => variation.id === selectedVariation)
    : null;
  const activePrice = activeVariation
    ? computePriceForSelection(activeVariation.id ?? null)
    : organiserActive
      ? computePriceForSelection(null)
      : undefined;
  const priceDetails = useMemo(
    () =>
      getListingPriceLabel(product, {
        overrideMin:
          typeof activePrice === "number" && activePrice > 0
            ? activePrice
            : undefined,
      }),
    [activePrice, product]
  );
  const eventRangeLabel = useMemo(
    () => getProductEventRangeLabel(product),
    [product]
  );
  const onsiteSummary = useMemo(
    () => formatProductOnsiteDuration(product),
    [product]
  );
  const priceHeadline = priceDetails?.headline ?? "Pricing on request";
  const basePrice = computePriceForSelection(
    activeVariation ? activeVariation.id ?? null : null
  );
  const coverImage =
    product.imageUrls?.find(
      (url) => typeof url === "string" && url.trim().length > 0
    )?.trim() ||
    (typeof product.imageUrl === "string" ? product.imageUrl.trim() : "");
  const img =
    coverImage || "https://placehold.co/1280x720?text=No+Image&font=source-sans-pro";
  const { visibleDeliverables, remainingDeliverableCount } =
    getDeliverableSummary(product);
  const digitalConfig = product.digitalDelivery ?? null;
  const digitalEnabled = Boolean(digitalConfig && digitalConfig.enabled !== false);
  const digitalStatusKey = digitalEnabled && digitalConfig
    ? (typeof digitalConfig.status === "string" && digitalConfig.status.trim().length > 0
        ? digitalConfig.status.trim()
        : typeof digitalConfig.release?.status === "string" && digitalConfig.release.status.trim().length > 0
          ? digitalConfig.release.status.trim()
          : digitalConfig.release
            ? "released"
            : "pending")
    : null;
  const digitalStatusMeta = digitalEnabled
    ? getDigitalStatusMeta(digitalStatusKey) ?? DIGITAL_STATUS_META.pending
    : null;
  const digitalBadgeToneClass = resolveDigitalToneClass(digitalStatusMeta?.tone);
  const digitalBadgeLabel = digitalStatusMeta
    ? digitalStatusMeta.key === "released"
      ? digitalConfig?.label || "Digital download ready"
      : digitalStatusMeta.key === "processing"
        ? "Digital download processing"
        : digitalStatusMeta.key === "archived"
          ? "Digital download archived"
          : digitalStatusMeta.key === "partial"
            ? "Digital download updating"
            : digitalConfig?.label || "Digital download included"
    : null;
  const showSummary = Boolean(
    product.deliveryTime ||
    visibleDeliverables.length > 0 ||
    onsiteSummary ||
    (product.storyboardEnabled ?? false) ||
    digitalEnabled
  );
  const storyboardEnabled = Boolean(product.storyboardEnabled);
  const variationSelectId = `product-${product.id}-variation`;

  const handleQuickAdd = () => {
    if (requiresVariation && !selectedVariation) return;
    if (isQuoteOnly) {
      setQuoteOpen(true);
      return;
    }
    setWizardOpen(true);
  };

  const variationSummary = selectedVariation
    ? {
        id: selectedVariation,
        label:
          activeVariation?.name?.trim() ||
          variations.find((v) => v.id === selectedVariation)?.name ||
          "Selected package",
      }
    : null;

  return (
    <>
      <div className="card p-4 flex flex-col gap-2 text-sm">
        <div className="relative aspect-video w-full overflow-hidden rounded bg-slate-100">
          <Image
            src={img}
            alt={product.name}
            fill
            sizes="(min-width: 1280px) 22rem, (min-width: 1024px) 20rem, 100vw"
            className="object-cover"
            priority={false}
          />
        </div>
        <h3 className="font-medium text-sm">{product.name}</h3>
        {product.tagline && (
          <p className="text-xs text-gray-600">{product.tagline}</p>
        )}
        {showSummary && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-700">
            {product.deliveryTime && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium">
                <FiClock className="h-3 w-3" aria-hidden />
                {product.deliveryTime}
              </span>
            )}
            {onsiteSummary && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium">
                <FiCalendar className="h-3 w-3" aria-hidden />
                {onsiteSummary}
              </span>
            )}
            {visibleDeliverables.map((deliverable) => {
              const Icon =
                (deliverable.type && deliverableIconMap[deliverable.type]) || FiCheckCircle;
              return (
                <span
                  key={deliverable.key}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-medium"
                >
                  <Icon className="h-3 w-3" aria-hidden />
                  {deliverable.label}
                </span>
              );
            })}
            {remainingDeliverableCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 font-medium text-gray-600">
                +{remainingDeliverableCount} more
              </span>
            )}
            {storyboardEnabled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                <FiFilm className="h-3 w-3" aria-hidden />
                Storyboard
              </span>
            )}
            {digitalEnabled && digitalBadgeLabel && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${digitalBadgeToneClass}`}
              >
                <FiDownload className="h-3 w-3" aria-hidden />
                {digitalBadgeLabel}
              </span>
            )}
          </div>
        )}
        {product.category === "exhibition-videography" && (
          <>
            {eventRangeLabel && (
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <FiCalendar className="w-3 h-3" />
                {eventRangeLabel}
              </div>
            )}
            {product.venue && (
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <FiMapPin className="w-3 h-3" />
                {product.venue}
              </div>
            )}
          </>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-gray-900">
            {priceHeadline}
          </p>
          <ListingPriceNote
            className="text-gray-500"
            note={priceDetails?.note}
            rangeNote={priceDetails?.rangeNote}
          />
        </div>
        <div className="mt-auto flex flex-col gap-2">
          {requiresVariation && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor={variationSelectId}
                className="text-xs font-medium text-gray-700"
              >
                Package
              </label>
              <select
                id={variationSelectId}
                className="select select-bordered select-sm w-full"
                value={selectedVariation}
                onChange={(event) => setSelectedVariation(event.target.value)}
              >
                <option value="">Select a package</option>
                {variations.map((variation) => (
                  <option key={variation.id} value={variation.id}>
                    {variation.name}
                    {!isQuoteOnly && variation.price > 0
                      ? ` – £${variation.price.toFixed(2)}`
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="btn btn-sm btn-primary w-full sm:flex-1"
              onClick={handleQuickAdd}
              disabled={requiresVariation && !selectedVariation}
              title={
                requiresVariation && !selectedVariation
                  ? isQuoteOnly
                    ? "Select a package to request a quote"
                    : "Select a package to add to cart"
                  : undefined
              }
            >
              {isQuoteOnly ? "Request Quote" : "Add to Cart"}
            </button>
            <Link
              href={`/products/${product.id}`}
              className="btn btn-sm btn-outline w-full sm:flex-1"
            >
              Learn More
            </Link>
          </div>
        </div>
      </div>
      {wizardOpen && !isQuoteOnly && (
        <AddToCartWizard
          product={product}
          variationId={selectedVariation || undefined}
          basePrice={basePrice}
          organiserContext={organiserContext ?? undefined}
          onClose={() => setWizardOpen(false)}
        />
      )}
      {quoteOpen && (
        <ProductQuoteRequestDialog
          product={product}
          open={quoteOpen}
          onClose={() => setQuoteOpen(false)}
          variation={variationSummary}
        />
      )}
    </>
  );
}
