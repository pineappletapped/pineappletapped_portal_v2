import type { Metadata } from "next";
import { getCategoryBySlug } from "@/lib/categories";
import { getProductsByCategory } from "@/lib/products";
import ProductCard from "@/components/ProductCard";
import ExhibitionProductList from "@/components/ExhibitionProductList";
import Breadcrumbs from "@/components/Breadcrumbs";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const category = await getCategoryBySlug(params.slug);
  if (!category)
    return {
      title: "Category not found",
    };
  const seo = (category as any).seo || {};
  const title = seo.title || category.name;
  const description =
    seo.description || (category as any).tagline || category.description;
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

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const category = await getCategoryBySlug(params.slug);
  if (!category) return <div>Category not found</div>;
  const products = await getProductsByCategory(category.id);
  const validProducts = products.filter((p) => !p.hidden);

  return (
    <div className="mx-auto max-w-4xl p-4 grid gap-6">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          {
            href: `/categories/${category.slug}`,
            label: category.name,
          },
        ]}
      />
      <header className="grid gap-2">
        {category.headerImage && (
          <img
            src={category.headerImage}
            alt={category.name}
            className="w-full h-48 object-cover rounded"
          />
        )}
        <h1 className="text-3xl font-semibold">{category.name}</h1>
        {category.description && <p>{category.description}</p>}
      </header>
      {category.howWeWork && (
        <section className="grid gap-2">
          <h2 className="text-xl font-semibold">How We Work</h2>
          <p className="text-sm text-gray-700 whitespace-pre-line">
            {category.howWeWork}
          </p>
        </section>
      )}
      {validProducts.length > 0 && (
        <section className="grid gap-4">
          <h2 className="text-xl font-semibold">
            {category.slug === "exhibition-videography" ? "Events" : "Products"}
          </h2>
          {category.slug === "exhibition-videography" ? (
            <ExhibitionProductList products={validProducts} />
          ) : (
            <div
              className={
                category.layout === "list"
                  ? "grid gap-4"
                  : "grid sm:grid-cols-2 md:grid-cols-3 gap-4"
              }
            >
              {validProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
