'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { BlogCategory, BlogPost } from '@/lib/blog';

interface BlogExplorerProps {
  posts: BlogPost[];
  categories: BlogCategory[];
  tags: string[];
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getPrimaryImage(post: BlogPost): string | undefined {
  return post.heroImageUrl || post.imageUrl || undefined;
}

function normaliseText(value: string | null | undefined): string {
  return (value || '').toLowerCase();
}

export default function BlogExplorer({ posts, categories, tags }: BlogExplorerProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );

  const filteredPosts = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return posts.filter((post) => {
      const matchesSearch =
        searchTerm.length === 0 ||
        normaliseText(post.title).includes(searchTerm) ||
        normaliseText(post.excerpt).includes(searchTerm) ||
        post.tags.some((tag) => normaliseText(tag).includes(searchTerm));
      const matchesCategory =
        categoryFilter === 'all' || post.categories.includes(categoryFilter);
      const matchesTag = tagFilter === 'all' || post.tags.includes(tagFilter);
      return matchesSearch && matchesCategory && matchesTag;
    });
  }, [posts, search, categoryFilter, tagFilter]);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-[2fr,1fr,1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Search</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search posts by title, summary, or tag"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Category</span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Tag</span>
          <select
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20"
          >
            <option value="all">All tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filteredPosts.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-600">
          No posts match your filters yet. Try adjusting the search term or selecting a different
          category.
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-2">
          {filteredPosts.map((post) => {
            const image = getPrimaryImage(post);
            const publishedLabel = formatDate(post.publishAt || post.createdAt);
            const postCategories = post.categories
              .map((categoryId) => categoryMap.get(categoryId)?.name || categoryId)
              .filter((name) => Boolean(name));
            const slug = post.slug || post.id;

            return (
              <article key={post.id} className="overflow-hidden rounded-md border border-gray-200">
                {image && (
                  <div className="relative h-48 w-full">
                    <Image
                      src={image}
                      alt={post.title}
                      fill
                      sizes="(min-width: 768px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
                    {publishedLabel && <span>{publishedLabel}</span>}
                    {postCategories.map((name) => (
                      <span key={name} className="rounded-full bg-gray-100 px-2 py-1 text-[0.65rem] font-medium">
                        {name}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-xl font-semibold leading-snug text-gray-900">{post.title}</h2>
                  <p className="text-sm leading-relaxed text-gray-600">{post.excerpt}</p>
                  {post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {post.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-orange/10 px-2 py-1 text-xs font-medium text-orange">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div>
                    <Link href={`/blog/${slug}`} className="text-sm font-medium text-orange hover:underline">
                      Read more
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
