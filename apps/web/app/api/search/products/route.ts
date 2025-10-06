import { NextResponse } from "next/server";

import { searchProducts } from "@/lib/product-search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const limitParam = searchParams.get("limit");
  const category = searchParams.get("category") ?? undefined;

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  if (!q.trim()) {
    return NextResponse.json({ results: [] });
  }

  const hits = await searchProducts(q, { limit, category });

  return NextResponse.json({
    results: hits.map((hit) => ({
      id: hit.product.id,
      name: hit.product.name,
      tagline: hit.product.tagline ?? null,
      category: hit.product.category ?? null,
      imageUrl: hit.product.imageUrl ?? null,
      imageUrls: Array.isArray(hit.product.imageUrls)
        ? hit.product.imageUrls
        : [],
      exact: hit.exactName || hit.exactTagline,
    })),
  });
}

