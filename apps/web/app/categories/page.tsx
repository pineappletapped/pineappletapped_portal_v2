import Image from 'next/image';
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
              <div className="relative h-40 w-full">
                <Image
                  src={cat.headerImage}
                  alt={cat.name}
                  fill
                  sizes="(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              </div>
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
