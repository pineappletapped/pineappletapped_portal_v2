import type { Metadata } from "next";
import { getProduct } from "@/lib/products";
import { getCategory } from "@/lib/categories";
import ProductDetail from "@/components/ProductDetail";
import Breadcrumbs from "@/components/Breadcrumbs";
import { getVenue } from "@/lib/venues";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const product = await getProduct(params.id);
  if (!product)
    return {
      title: "Product not found",
    };
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

export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id);
  if (!product) return <div>Product not found</div>;
  const category = product.category
    ? await getCategory(product.category)
    : null;
  const venue = product.venueId ? await getVenue(product.venueId) : null;
  return (
    <div className="max-w-6xl mx-auto p-4 grid gap-4">
      {category && (
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            {
              href: `/categories/${category.slug}`,
              label: category.name,
            },
            { href: `/products/${product.id}`, label: product.name },
          ]}
        />
      )}
      <ProductDetail product={product} venue={venue} />
    </div>
  );
}
