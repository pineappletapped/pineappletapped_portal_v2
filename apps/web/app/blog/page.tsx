import Link from 'next/link';
import { getPosts } from '@/lib/blog';

export default async function BlogPage() {
  const posts = await getPosts();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-8">
      <h1 className="text-3xl font-semibold">Blog</h1>
      <div className="grid gap-8 md:grid-cols-2">
        {posts.map((p) => (
          <article key={p.id} className="border rounded-md overflow-hidden">
            {p.imageUrl && (
              <img src={p.imageUrl} alt="" className="h-48 w-full object-cover" />
            )}
            <div className="p-4">
              <h2 className="text-xl font-semibold mb-2">{p.title}</h2>
              <p className="text-sm text-gray-600 mb-4">{p.excerpt}</p>
              <Link href={`/blog/${p.id}`} className="text-orange hover:underline">
                Read more
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
