import Image from 'next/image';
import Link from 'next/link';
import { getBlogCategories, getPost } from '@/lib/blog';

function formatPublishedDate(post: Awaited<ReturnType<typeof getPost>>): string | null {
  if (!post) return null;
  const source = post.publishAt || post.createdAt;
  if (!source) return null;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function BlogPostPage({ params }: { params: { id: string } }) {
  const [post, categories] = await Promise.all([
    getPost(params.id),
    getBlogCategories(),
  ]);

  if (!post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Post not found</h1>
        <p className="mt-3 text-sm text-gray-600">
          We couldn&apos;t find the story you were looking for. It may have been unpublished or removed.
        </p>
        <div className="mt-6">
          <Link href="/blog" className="text-sm font-medium text-orange hover:underline">
            Back to the blog
          </Link>
        </div>
      </div>
    );
  }

  const publishedLabel = formatPublishedDate(post);
  const heroImage = post.heroImageUrl || post.imageUrl;
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const visibleCategories = post.categories
    .map((id) => categoryMap.get(id) || id)
    .filter((name) => name && name.length > 0);

  return (
    <article className="prose prose-orange mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 space-y-3">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          {publishedLabel && <span>Published {publishedLabel}</span>}
        </div>
        <h1 className="mb-2 text-3xl font-semibold text-gray-900">{post.title}</h1>
        {post.excerpt && (
          <p className="text-base text-gray-600">{post.excerpt}</p>
        )}
        {visibleCategories.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs font-medium text-orange">
            {visibleCategories.map((category) => (
              <span key={category} className="rounded-full bg-orange/10 px-3 py-1">
                {category}
              </span>
            ))}
          </div>
        )}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-gray-100 px-3 py-1">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {heroImage && (
        <div className="mb-8 overflow-hidden rounded-lg">
          <Image
            src={heroImage}
            alt={post.title}
            width={1280}
            height={720}
            className="h-auto w-full object-cover"
          />
        </div>
      )}
      <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: post.content }} />
      <div className="mt-10 border-t border-gray-200 pt-6">
        <Link href="/blog" className="text-sm font-medium text-orange hover:underline">
          ← View all posts
        </Link>
      </div>
    </article>
  );
}
