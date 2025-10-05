"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Product,
  getProductEventRangeLabel,
  formatProductOnsiteDuration,
} from "@/lib/products";
import {
  FiCalendar,
  FiMapPin,
  FiClock,
  FiCheckCircle,
} from "react-icons/fi";
import {
  deliverableIconMap,
  getDeliverableSummary,
  getListingPriceLabel,
} from "./productListingUtils";
import AddToCartWizard from "./AddToCartWizard";
import ProductQuoteRequestDialog from "./ProductQuoteRequestDialog";
import ListingPriceNote from "./ListingPriceNote";

export default function ProductCard({ product }: { product: Product }) {
  const [selectedVariation, setSelectedVariation] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const variations = product.variations ?? [];
  const requiresVariation = variations.length > 0;
  const isQuoteOnly = (product.salesMode ?? "ecommerce") === "quote";
  const activeVariation = requiresVariation
    ? variations.find((variation) => variation.id === selectedVariation)
    : null;
  const activePrice = activeVariation?.price;
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
  const basePrice = activeVariation?.price ?? product.price;
  const coverImage =
    product.imageUrls?.find(
      (url) => typeof url === "string" && url.trim().length > 0
    )?.trim() ||
    (typeof product.imageUrl === "string" ? product.imageUrl.trim() : "");
  const img = coverImage || "https://placehold.co/600x400?text=No+Image";
  const { visibleDeliverables, remainingDeliverableCount } =
    getDeliverableSummary(product);
  const showSummary = Boolean(
    product.deliveryTime || visibleDeliverables.length > 0 || onsiteSummary
  );
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
        <Image
          src={img}
          alt={product.name}
          width={600}
          height={400}
          className="w-full h-40 object-cover rounded"
        />
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
