import { getBlogCategories, getPosts } from '@/lib/blog';
import BlogExplorer from '@/components/BlogExplorer';

export default async function BlogPage() {
  const [posts, categories] = await Promise.all([getPosts(), getBlogCategories()]);
  const tags = Array.from(
    new Set(
      posts
        .flatMap((post) => post.tags || [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold">Blog</h1>
        <p className="text-sm text-gray-600">
          Explore the latest stories, updates, and production insights from the Pineapple team.
        </p>
      </div>
      <BlogExplorer posts={posts} categories={categories} tags={tags} />
    </div>
  );
}
