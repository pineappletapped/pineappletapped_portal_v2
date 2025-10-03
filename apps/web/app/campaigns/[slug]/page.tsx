import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ProductDetail from "@/components/ProductDetail";
import CampaignSlotShowcase from "@/components/CampaignSlotShowcase";
import { getProductByCampaignSlug } from "@/lib/products";
import { getVenue } from "@/lib/venues";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const product = await getProductByCampaignSlug(params.slug);
  if (!product) {
    return {
      title: "Campaign not found",
    };
  }
  const seo = product.seo || {};
  const title = seo.title || product.name;
  const description = seo.description || product.tagline;
  return {
    title,
    description,
    ...(seo.keywords ? { keywords: seo.keywords } : {}),
    ...(seo.socialImageUrl
      ? {
          openGraph: {
            title,
            description,
            images: [seo.socialImageUrl],
          },
          twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [seo.socialImageUrl],
          },
        }
      : {}),
  };
}

export default async function CampaignPage({
  params,
}: {
  params: { slug: string };
}) {
  const product = await getProductByCampaignSlug(params.slug);
  if (!product) {
    notFound();
  }
  const venue = product.venueId ? await getVenue(product.venueId) : null;
  return (
    <div className="mx-auto max-w-6xl space-y-10 p-4">
      <CampaignSlotShowcase product={product} />
      <ProductDetail product={product} venue={venue} />
    </div>
  );
}
