import ProductCard from "@/components/ProductCard";
import { getCategories } from "@/lib/categories";
import { getProducts } from "@/lib/products";

export default async function SearchPage({
  searchParams,
}: {
  searchParams?: { q?: string; category?: string };
}) {
  const q = (searchParams?.q || "").toLowerCase();
  const category = searchParams?.category || "";
  const [products, categories] = await Promise.all([
    getProducts(),
    getCategories(),
  ]);
  const matches = products.filter((p) => {
    const haystack = `${p.name} ${p.tagline ?? ""}`.toLowerCase();
    return (
      (!q || haystack.includes(q)) &&
      (!category || p.category === category)
    );
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-4">
        Search results{q ? ` for "${q}"` : ""}
      </h1>
      <form className="mb-6 flex gap-2">
        <input type="hidden" name="q" value={q} />
        <select
          name="category"
          defaultValue={category}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-sm">
          Filter
        </button>
      </form>
      {matches.length === 0 ? (
        <p>No matching products.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
          {matches.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}

