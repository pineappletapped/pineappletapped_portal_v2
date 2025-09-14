import Link from 'next/link';
import { getCategories } from '@/lib/categories';

export const metadata = {
  title: 'Categories',
  description: 'Browse all service categories',
};

export default async function CategoriesPage() {
  const categories = await getCategories();
  return (
    <div className="mx-auto max-w-6xl p-4 grid gap-6">
      <h1 className="text-3xl font-semibold">Categories</h1>
      <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
        {categories.map((cat) => (
          <Link
            key={cat.id}
            href={`/categories/${cat.slug}`}
            className="border rounded-md overflow-hidden bg-white hover:shadow-md transition-shadow"
          >
            {cat.headerImage && (
              <img
                src={cat.headerImage}
                alt={cat.name}
                className="w-full h-40 object-cover"
              />
            )}
            <div className="p-4">
              <h2 className="text-lg font-medium">{cat.name}</h2>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
