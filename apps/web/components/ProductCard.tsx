"use client";

import Link from "next/link";
import Image from "next/image";
import { Product } from "@/lib/products";
import {
  FiCalendar,
  FiMapPin,
  FiClock,
  FiCheckCircle,
} from "react-icons/fi";
import {
  deliverableIconMap,
  getDeliverableSummary,
  getPriceRangeLabel,
} from "./productListingUtils";

export default function ProductCard({ product }: { product: Product }) {
  const priceLabel = getPriceRangeLabel(product) ?? "Pricing on request";
  const img =
    product.imageUrl || "https://placehold.co/600x400?text=No+Image";
  const { visibleDeliverables, remainingDeliverableCount } =
    getDeliverableSummary(product);
  const showSummary = Boolean(product.deliveryTime || visibleDeliverables.length > 0);

  return (
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
          {product.eventDate && (
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <FiCalendar className="w-3 h-3" />
              {new Date(product.eventDate).toLocaleDateString()}
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
      <p className="font-bold text-sm">{priceLabel}</p>
      <Link href={`/products/${product.id}`} className="btn btn-sm mt-auto">
        Learn More
      </Link>
    </div>
  );
}
