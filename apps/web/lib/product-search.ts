import { cache } from "react";

import type { Product } from "./products";
import { getProducts } from "./products";

interface SearchIndexEntry {
  product: Product;
  haystack: string;
  nameLower: string;
  taglineLower: string;
}

const buildSearchIndex = cache(async (): Promise<SearchIndexEntry[]> => {
  const products = await getProducts();
  return products
    .filter((product) => !product.hidden)
    .map((product) => {
      const haystackSources = [
        product.name,
        product.tagline ?? "",
        product.description ?? "",
        product.deliveryTime ?? "",
        product.seo?.keywords ?? "",
        ...(product.variations?.map((variation) => variation.name) ?? []),
      ]
        .join(" ")
        .toLowerCase();

      return {
        product,
        haystack: haystackSources.replace(/\s+/g, " ").trim(),
        nameLower: product.name.toLowerCase(),
        taglineLower: (product.tagline ?? "").toLowerCase(),
      };
    });
});

export interface ProductSearchHit {
  product: Product;
  exactName: boolean;
  exactTagline: boolean;
  matchIndex: number;
}

export async function searchProducts(
  term: string,
  options: { limit?: number; category?: string } = {}
): Promise<ProductSearchHit[]> {
  const q = term.trim().toLowerCase();
  if (!q) return [];

  const tokens = Array.from(new Set(q.split(/\s+/).filter(Boolean)));
  if (tokens.length === 0) return [];

  const { limit = 10, category } = options;
  const max = Math.min(Math.max(limit, 1), 50);
  const index = await buildSearchIndex();

  const hits = index
    .filter(({ product, haystack }) => {
      if (category && product.category !== category) return false;
      return tokens.every((token) => haystack.includes(token));
    })
    .map(({ product, haystack, nameLower, taglineLower }) => {
      const positions = tokens
        .map((token) => haystack.indexOf(token))
        .filter((pos) => pos >= 0);
      const matchIndex = positions.length
        ? Math.min(...positions)
        : Number.MAX_SAFE_INTEGER;
      const exactName = nameLower === q;
      const exactTagline = taglineLower === q;
      return {
        product,
        exactName,
        exactTagline,
        matchIndex,
      } satisfies ProductSearchHit;
    })
    .filter((hit) => hit.matchIndex !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => {
      if (a.exactName && !b.exactName) return -1;
      if (!a.exactName && b.exactName) return 1;
      if (a.exactTagline && !b.exactTagline) return -1;
      if (!a.exactTagline && b.exactTagline) return 1;
      return a.matchIndex - b.matchIndex;
    });

  return hits.slice(0, max);
}

export async function getSearchableProducts(): Promise<Product[]> {
  const index = await buildSearchIndex();
  return index.map((entry) => entry.product);
}

