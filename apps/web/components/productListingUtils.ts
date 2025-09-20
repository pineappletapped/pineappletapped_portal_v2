import type { Product, DeliverableType } from "@/lib/products";
import type { IconType } from "react-icons";
import {
  FiVideo,
  FiImage,
  FiCamera,
  FiFileText,
  FiMusic,
} from "react-icons/fi";

export const deliverableIconMap: Partial<Record<DeliverableType, IconType>> = {
  "long-form-video": FiVideo,
  "short-form-vertical": FiVideo,
  photo: FiCamera,
  "photo-set": FiCamera,
  thumbnail: FiImage,
  "audio-licence": FiMusic,
  document: FiFileText,
};

export function getProductPriceExtents(product: Product):
  | { min: number; max: number }
  | null {
  const prices: number[] = [];
  if (typeof product.price === "number" && Number.isFinite(product.price)) {
    prices.push(product.price);
  }
  if (Array.isArray(product.variations)) {
    for (const variation of product.variations) {
      const value = variation?.price;
      if (typeof value === "number" && Number.isFinite(value)) {
        prices.push(value);
      }
    }
  }
  if (prices.length === 0) return null;
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

export function getPriceRangeLabel(product: Product): string | null {
  const range = getProductPriceExtents(product);
  if (!range) return null;
  if (range.min === range.max) {
    return `£${range.min.toFixed(2)}`;
  }
  return `£${range.min.toFixed(2)} - £${range.max.toFixed(2)}`;
}

type DeliverableBadge = {
  label: string;
  type?: DeliverableType | null;
  key: string;
};

export function getDeliverableSummary(product: Product) {
  const deliverables: DeliverableBadge[] =
    product.deliverables?.flatMap((deliverable, index) => {
      const title =
        typeof deliverable?.title === "string"
          ? deliverable.title.trim()
          : "";
      if (!title) return [];
      return [
        {
          label: title,
          type: deliverable?.type ?? null,
          key: `${title}-${deliverable?.type ?? index}`,
        },
      ];
    }) ?? [];

  const visibleDeliverables = deliverables.slice(0, 3);
  const remainingDeliverableCount =
    deliverables.length - visibleDeliverables.length;

  return { visibleDeliverables, remainingDeliverableCount } as const;
}
