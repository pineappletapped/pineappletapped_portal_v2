import type {
  Product,
  DeliverableType,
  ProductDeliverable,
} from "@/lib/products";
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

export function getListingPriceLabel(product: Product): string | null {
  const range = getProductPriceExtents(product);
  if (!range) return null;
  const baseLabel = `From £${range.min.toFixed(2)} (listing price)`;
  if (range.max > range.min) {
    return `${baseLabel} · Packages up to £${range.max.toFixed(2)}`;
  }
  return baseLabel;
}

type DeliverableBadge = {
  label: string;
  type?: DeliverableType | null;
  key: string;
};

function normaliseDeliverables(
  rawDeliverables: unknown,
  options: { variationId?: string | null } = {}
): { title: string; type?: DeliverableType }[] {
  const variationFilter = options.variationId ?? null;
  if (!rawDeliverables) return [];

  const entries = Array.isArray(rawDeliverables)
    ? rawDeliverables
    : typeof rawDeliverables === "object"
      ? Object.values(rawDeliverables)
      : [];

  return entries.flatMap((entry) => {
    if (!entry) return [];

    if (Array.isArray(entry)) {
      return normaliseDeliverables(entry);
    }

    if (typeof entry === "string") {
      const label = entry.trim();
      return label ? [{ title: label }] : [];
    }

    if (typeof entry === "object") {
      const candidate = entry as Partial<ProductDeliverable> &
        Partial<{
          name?: unknown;
        }>;
      const rawTitle =
        typeof candidate.title === "string"
          ? candidate.title
          : typeof candidate.name === "string"
            ? candidate.name
            : "";
      const title = rawTitle.trim();
      if (!title) return [];
      const type =
        typeof candidate.type === "string"
          ? (candidate.type as DeliverableType)
          : undefined;
      const restrictedIds = Array.isArray(candidate.variationIds)
        ? candidate.variationIds.filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0
          )
        : [];
      if (restrictedIds.length > 0) {
        if (!variationFilter) {
          return [];
        }
        if (!restrictedIds.includes(variationFilter)) {
          return [];
        }
      }
      return [
        {
          title,
          type,
        },
      ];
    }

    return [];
  });
}

export function getDeliverableSummary(product: Product) {
  const deliverableEntries = normaliseDeliverables(product.deliverables);

  const deliverables: DeliverableBadge[] = deliverableEntries.map(
    (deliverable, index) => {
      const title = deliverable.title.trim();
      return {
        label: title,
        type: deliverable.type ?? null,
        key: `${title}-${deliverable.type ?? index}`,
      } as DeliverableBadge;
    }
  );

  const visibleDeliverables = deliverables.slice(0, 3);
  const remainingDeliverableCount =
    deliverables.length - visibleDeliverables.length;

  return { visibleDeliverables, remainingDeliverableCount } as const;
}
