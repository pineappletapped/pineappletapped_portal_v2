"use client";

import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/products";
import {
  getProductEventRangeLabel,
  formatProductOnsiteDuration,
} from "@/lib/products";
import {
  FiCalendar,
  FiClock,
  FiMapPin,
  FiCheckCircle,
} from "react-icons/fi";
import {
  deliverableIconMap,
  getDeliverableSummary,
  getListingPriceLabel,
} from "./productListingUtils";
import ListingPriceNote from "./ListingPriceNote";

export default function ProductListRow({ product }: { product: Product }) {
  const coverImage =
    product.imageUrls?.find(
      (url) => typeof url === "string" && url.trim().length > 0
    )?.trim() ||
    (typeof product.imageUrl === "string" ? product.imageUrl.trim() : "");
  const imageUrl = coverImage || "https://placehold.co/600x400?text=No+Image";
  const priceDetails = getListingPriceLabel(product);
  const priceHeadline = priceDetails?.headline ?? "Pricing on request";
  const { visibleDeliverables, remainingDeliverableCount } =
    getDeliverableSummary(product);
  const onsiteSummary = formatProductOnsiteDuration(product);
  const showSummary = Boolean(
    product.deliveryTime || visibleDeliverables.length > 0 || onsiteSummary
  );
  const eventLabel = getProductEventRangeLabel(product);

  return (
    <article className="card p-4 text-sm shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        <div className="relative aspect-video w-full overflow-hidden rounded-md sm:aspect-[3/4] sm:w-48 sm:flex-shrink-0">
          <Image
            src={imageUrl}
            alt={product.name}
            fill
            sizes="(min-width: 640px) 12rem, 100vw"
            className="object-cover"
          />
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-gray-900">{product.name}</h3>
            {product.tagline && (
              <p className="text-sm text-gray-600">{product.tagline}</p>
            )}
          </div>
          {showSummary && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
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
          {(eventLabel || product.venue) && (
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
              {eventLabel && (
                <span className="inline-flex items-center gap-1">
                  <FiCalendar className="h-3 w-3" aria-hidden />
                  {eventLabel}
                </span>
              )}
              {product.venue && (
                <span className="inline-flex items-center gap-1">
                  <FiMapPin className="h-3 w-3" aria-hidden />
                  {product.venue}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-44 sm:items-end sm:self-stretch">
          <div className="flex w-full flex-col items-start gap-1 sm:items-end">
            <p className="text-base font-semibold text-gray-900 sm:text-right">
              {priceHeadline}
            </p>
            <ListingPriceNote
              className="text-gray-500 sm:text-right"
              note={priceDetails?.note}
              rangeNote={priceDetails?.rangeNote}
            />
          </div>
          <Link
            href={`/products/${product.id}`}
            className="btn btn-sm btn-outline w-full sm:w-auto"
          >
            Learn More
          </Link>
        </div>
      </div>
    </article>
  );
}
