"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "react-quill/dist/quill.snow.css";

import {
  emptyPostForm,
  ensureStringArray,
  slugify,
  stripHtml,
  type BlogCategory,
  type BlogPostForm,
  type BlogPostRecord,
  type ProductOption,
} from "@/components/admin/blog/blogUtils";
import { db, storage } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";

function normalisePostSnapshot(docSnap: any): BlogPostRecord {
  const data = docSnap.data() ?? {};
  const publishAt = data.publishAt instanceof Timestamp ? data.publishAt.toDate() : null;
  const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null;
  const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null;
  return {
    id: docSnap.id,
    title: typeof data.title === "string" ? data.title : "",
    slug: typeof data.slug === "string" ? data.slug : docSnap.id,
    excerpt: typeof data.excerpt === "string" ? data.excerpt : "",
    content: typeof data.content === "string" ? data.content : "",
    heroImageUrl:
      typeof data.heroImageUrl === "string"
        ? data.heroImageUrl
        : typeof data.imageUrl === "string"
          ? data.imageUrl
          : undefined,
    videoUrl: typeof data.videoUrl === "string" ? data.videoUrl : "",
    categories: Array.isArray(data.categories)
      ? data.categories.filter((entry: any) => typeof entry === "string")
      : [],
    tags: ensureStringArray(data.tags),
    seoTitle: typeof data.seo?.title === "string" ? data.seo.title : typeof data.seoTitle === "string" ? data.seoTitle : "",
    seoDescription:
      typeof data.seo?.description === "string"
        ? data.seo.description
        : typeof data.seoDescription === "string"
          ? data.seoDescription
          : "",
    seoKeywords: ensureStringArray(data.seo?.keywords ?? data.seoKeywords),
    relatedProductIds: Array.isArray(data.relatedProductIds)
      ? data.relatedProductIds.filter((entry: any) => typeof entry === "string")
      : [],
    relatedPostId:
      typeof data.relatedPostId === "string"
        ? data.relatedPostId
        : data.relatedPostId || null,
    isVisible: typeof data.isVisible === "boolean" ? data.isVisible : !data.hidden,
    publishAt,
    createdAt,
    updatedAt,
  };
}

export default function CreateBlogPostPage() {
  const router = useRouter();
  const { allowed, loading: guardLoading } = useRoleGate(["marketing", "admin"]);

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<BlogPostForm>({ ...emptyPostForm, isVisible: false });
  const [slugTouched, setSlugTouched] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [posts, setPosts] = useState<BlogPostRecord[]>([]);
  const [editorUploading, setEditorUploading] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiOutline, setAiOutline] = useState<string[]>([]);

  const ReactQuill = dynamic(() => import("react-quill"), { ssr: false });

  const handleImageUpload = useCallback(function (this: any) {
    const quill = this?.quill;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        setEditorUploading(true);
        const path = `blog/content/${Date.now()}-${file.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file, { contentType: file.type });
        const url = await getDownloadURL(storageRef);
        if (quill) {
          const selection = quill.getSelection(true);
          const index = selection ? selection.index : quill.getLength();
          quill.insertEmbed(index, "image", url, "user");
          quill.setSelection(index + 1);
        }
      } catch (error) {
        console.error("Failed to upload image", error);
        alert("Image upload failed. Please try again.");
      } finally {
        setEditorUploading(false);
      }
    };
    input.click();
  }, []);

  const quillModules = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ align: [] }],
          ["link", "image", "video"],
          ["clean"],
        ],
        handlers: {
          image: handleImageUpload,
        },
      },
    }),
    [handleImageUpload]
  );

  const loadCategories = useCallback(async () => {
    const snapshot = await getDocs(collection(db, "blogCategories"));
    const items: BlogCategory[] = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as any;
      return {
        id: docSnap.id,
        name: data.name || docSnap.id,
        slug: data.slug || slugify(data.name || docSnap.id),
      };
    });
    items.sort((a, b) => a.name.localeCompare(b.name));
    setCategories(items);
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, "products"));
      const items: ProductOption[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          name: data.name || data.title || docSnap.id,
          hidden: data.hidden || false,
        };
      });
      items.sort((a, b) => a.name.localeCompare(b.name));
      setProducts(items);
    } catch (error) {
      console.warn("Failed to load products for blog linking", error);
    }
  }, []);

  const loadPosts = useCallback(async () => {
    const refCollection = collection(db, "blogPosts");
    let snapshot;
    try {
      snapshot = await getDocs(query(refCollection, orderBy("createdAt", "desc")));
    } catch (error) {
      console.debug("Falling back to unordered blog post fetch", error);
      snapshot = await getDocs(refCollection);
    }
    const items = snapshot.docs.map(normalisePostSnapshot);
    setPosts(items);
  }, []);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        await Promise.all([loadCategories(), loadProducts(), loadPosts()]);
      } catch (error) {
        console.error("Failed to load blog create dependencies", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading, loadCategories, loadProducts, loadPosts]);

  const handleTitleChange = (value: string) => {
    setForm((prev) => {
      const next = { ...prev, title: value };
      if (!slugTouched) {
        next.slug = slugify(value);
      }
      return next;
    });
  };

  const handleSlugChange = (value: string) => {
    setSlugTouched(true);
    setForm((prev) => ({ ...prev, slug: slugify(value) }));
  };

  const handleCategoryToggle = (categoryId: string) => {
    setForm((prev) => {
      const exists = prev.categories.includes(categoryId);
      return {
        ...prev,
        categories: exists
          ? prev.categories.filter((id) => id !== categoryId)
          : [...prev.categories, categoryId],
      };
    });
  };

  const handleProductsChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const values = Array.from(event.target.selectedOptions).map((option) => option.value);
    setForm((prev) => ({ ...prev, relatedProductIds: values }));
  };

  const handleTagsChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      tags: value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    }));
  };

  const handleSeoKeywordsChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      seoKeywords: value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    }));
  };

  const handlePublishAtChange = (value: string) => {
    setForm((prev) => ({ ...prev, publishAt: value }));
  };

  const selectedCategoryNames = useMemo(
    () =>
      categories
        .filter((category) => form.categories.includes(category.id))
        .map((category) => category.name),
    [categories, form.categories]
  );

  const selectedProducts = useMemo(
    () =>
      products
        .filter((product) => form.relatedProductIds.includes(product.id))
        .map((product) => ({ id: product.id, name: product.name })),
    [products, form.relatedProductIds]
  );

  const requestAiDraft = async () => {
    const summary = form.excerpt.trim();
    if (summary.length < 20) {
      setAiError("Add a longer summary before generating a draft.");
      return;
    }
    setAiGenerating(true);
    setAiError(null);
    setAiWarnings([]);
    setAiOutline([]);
    try {
      const response = await fetch("/api/admin/blog/generate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary,
          audience: form.seoDescription.trim() || undefined,
          tone: form.seoTitle.trim() || undefined,
          categories: selectedCategoryNames,
          tags: form.tags,
          keywords: form.seoKeywords,
          relatedProducts: selectedProducts,
          notes: form.videoUrl.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ error: "Failed to generate draft." }));
        throw new Error(errorPayload.error || "Failed to generate draft.");
      }
      const payload = await response.json();
      setForm((prev) => {
        const next = { ...prev };
        if (typeof payload.title === "string" && payload.title.trim()) {
          next.title = payload.title;
          if (!slugTouched) {
            next.slug = slugify(payload.title);
          }
        }
        if (typeof payload.summary === "string" && payload.summary.trim()) {
          next.excerpt = payload.summary;
        }
        if (typeof payload.contentHtml === "string" && payload.contentHtml.trim()) {
          next.content = payload.contentHtml;
        }
        if (typeof payload.seoTitle === "string") {
          next.seoTitle = payload.seoTitle;
        }
        if (typeof payload.seoDescription === "string") {
          next.seoDescription = payload.seoDescription;
        }
        if (Array.isArray(payload.seoKeywords)) {
          next.seoKeywords = payload.seoKeywords.filter((keyword: unknown) => typeof keyword === "string");
        }
        return next;
      });
      if (Array.isArray(payload.warnings)) {
        setAiWarnings(payload.warnings.filter((warning: unknown) => typeof warning === "string"));
      }
      if (Array.isArray(payload.outline)) {
        setAiOutline(payload.outline.filter((entry: unknown) => typeof entry === "string"));
      }
    } catch (error) {
      setAiError((error as Error).message || "Draft generation failed.");
    } finally {
      setAiGenerating(false);
    }
  };

  const savePost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) {
      alert("Title is required");
      return;
    }
    if (!form.slug.trim()) {
      alert("Slug is required");
      return;
    }
    if (!stripHtml(form.content || "").trim()) {
      alert("Post content cannot be empty");
      return;
    }
    const scheduleDate = form.publishAt ? new Date(form.publishAt) : null;
    if (scheduleDate && Number.isNaN(scheduleDate.getTime())) {
      alert("Publish schedule must be a valid date and time");
      return;
    }

    try {
      setSaving(true);
      let heroUrl = form.heroImageUrl || "";
      if (coverFile) {
        const path = `blog/covers/${Date.now()}-${coverFile.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, coverFile, { contentType: coverFile.type });
        heroUrl = await getDownloadURL(storageRef);
      }

      const payload: Record<string, any> = {
        title: form.title.trim(),
        slug: form.slug.trim(),
        excerpt: form.excerpt.trim(),
        content: form.content,
        heroImageUrl: heroUrl || null,
        imageUrl: heroUrl || null,
        videoUrl: form.videoUrl.trim() || null,
        categories: form.categories,
        tags: form.tags,
        seo: {
          title: form.seoTitle.trim() || null,
          description: form.seoDescription.trim() || null,
          keywords: form.seoKeywords,
        },
        relatedProductIds: form.relatedProductIds,
        relatedPostId: form.relatedPostId ? form.relatedPostId : null,
        isVisible: form.isVisible,
        hidden: !form.isVisible,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (scheduleDate) {
        payload.publishAt = Timestamp.fromDate(scheduleDate);
      }

      await addDoc(collection(db, "blogPosts"), payload);
      router.push("/admin/blog");
    } catch (error) {
      console.error("Failed to create blog post", error);
      alert("Failed to create the post. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (guardLoading || loading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to create blog posts.</p>;
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Create blog post</h1>
          <p className="text-sm text-gray-600">
            Craft a new article, generate a first draft with AI, and publish it to the Pineapple blog.
          </p>
        </div>
        <Link href="/admin/blog" className="btn btn-outline">
          Back to blog management
        </Link>
      </div>

      <form onSubmit={savePost} className="grid gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="post-title">
            Title
          </label>
          <input
            id="post-title"
            className="input"
            value={form.title}
            onChange={(event) => handleTitleChange(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="post-slug">
            Slug
          </label>
          <input
            id="post-slug"
            className="input"
            value={form.slug}
            onChange={(event) => handleSlugChange(event.target.value)}
            required
          />
          <p className="text-xs text-gray-500">Used for the public URL (e.g. /blog/{form.slug || "your-slug"}).</p>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium" htmlFor="post-excerpt">
              Summary
            </label>
            <button
              type="button"
              className="btn btn-sm"
              onClick={requestAiDraft}
              disabled={aiGenerating}
            >
              {aiGenerating ? "Generating…" : "AI generate draft"}
            </button>
          </div>
          <textarea
            id="post-excerpt"
            className="textarea textarea-bordered"
            rows={4}
            value={form.excerpt}
            onChange={(event) => setForm((prev) => ({ ...prev, excerpt: event.target.value }))}
            placeholder="Write a short overview of the article to guide the assistant and display on cards"
          />
          {aiError && <p className="text-sm text-red-600">{aiError}</p>}
          {aiWarnings.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Assistant notes</p>
              <ul className="mt-1 list-disc pl-5">
                {aiWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="post-video">
            Feature video URL
          </label>
          <input
            id="post-video"
            className="input"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={form.videoUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, videoUrl: event.target.value }))}
          />
          <p className="text-xs text-gray-500">Displayed above the article when provided. Supports YouTube or Vimeo links.</p>
        </div>

        <div className="grid gap-2 md:grid-cols-2 md:gap-4">
          <div className="grid gap-1">
            <label className="text-sm font-medium" htmlFor="post-publish-at">
              Publish schedule
            </label>
            <input
              id="post-publish-at"
              type="datetime-local"
              className="input"
              value={form.publishAt}
              onChange={(event) => handlePublishAtChange(event.target.value)}
            />
            <p className="text-xs text-gray-500">Leave blank to publish immediately when the post is visible.</p>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.isVisible}
                onChange={(event) => setForm((prev) => ({ ...prev, isVisible: event.target.checked }))}
              />
              Visible on site
            </label>
          </div>
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Categories</span>
          {categories.length === 0 ? (
            <p className="text-xs text-gray-500">No categories yet. Create one from the blog management screen.</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {categories.map((category) => (
                <label key={category.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.categories.includes(category.id)}
                    onChange={() => handleCategoryToggle(category.id)}
                  />
                  {category.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="post-tags">
            Post tags
          </label>
          <input
            id="post-tags"
            className="input"
            value={form.tags.join(", ")}
            onChange={(event) => handleTagsChange(event.target.value)}
            placeholder="production, livestream, behind the scenes"
          />
          <p className="text-xs text-gray-500">Comma separated keywords used for search and filtering.</p>
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium">Content</label>
          <ReactQuill
            value={form.content}
            onChange={(value) => setForm((prev) => ({ ...prev, content: value }))}
            modules={quillModules}
            className="bg-white"
          />
          {editorUploading && <p className="text-xs text-gray-500">Uploading image…</p>}
          {aiOutline.length > 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium">Suggested outline</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {aiOutline.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 sm:items-start sm:gap-4">
          <div className="grid gap-1">
            <label className="text-sm font-medium" htmlFor="post-hero">
              Hero image
            </label>
            <input
              id="post-hero"
              type="file"
              accept="image/*"
              onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)}
            />
            {coverFile && <p className="text-xs text-gray-500">Selected: {coverFile.name}</p>}
            <p className="text-xs text-gray-500">Upload a landscape image to appear at the top of the post.</p>
          </div>
          {form.heroImageUrl && !coverFile && (
            <div className="rounded border border-slate-200 p-3 text-sm text-gray-600">
              This post will reuse the existing hero image once saved.
            </div>
          )}
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="seo-title">
            SEO title
          </label>
          <input
            id="seo-title"
            className="input"
            value={form.seoTitle}
            onChange={(event) => setForm((prev) => ({ ...prev, seoTitle: event.target.value }))}
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="seo-description">
            SEO description
          </label>
          <textarea
            id="seo-description"
            className="textarea textarea-bordered"
            rows={2}
            value={form.seoDescription}
            onChange={(event) => setForm((prev) => ({ ...prev, seoDescription: event.target.value }))}
            placeholder="Short description for search engines"
          />
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="seo-keywords">
            SEO keywords
          </label>
          <input
            id="seo-keywords"
            className="input"
            value={form.seoKeywords.join(", ")}
            onChange={(event) => handleSeoKeywordsChange(event.target.value)}
            placeholder="client portal, production workflow"
          />
          <p className="text-xs text-gray-500">Comma separated keywords for meta tags.</p>
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="related-products">
            Related products
          </label>
          <select
            id="related-products"
            multiple
            className="input h-32"
            value={form.relatedProductIds}
            onChange={handleProductsChange}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
                {product.hidden ? " (hidden)" : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">Selected products will be promoted beneath the article.</p>
        </div>

        <div className="grid gap-1">
          <label className="text-sm font-medium" htmlFor="related-post">
            Related article
          </label>
          <select
            id="related-post"
            className="input"
            value={form.relatedPostId}
            onChange={(event) => setForm((prev) => ({ ...prev, relatedPostId: event.target.value }))}
          >
            <option value="">None</option>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.title || post.slug}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">Feature another story for readers to continue exploring.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : "Create post"}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setForm({ ...emptyPostForm, isVisible: false });
              setSlugTouched(false);
              setCoverFile(null);
              setAiWarnings([]);
              setAiOutline([]);
              setAiError(null);
            }}
            disabled={saving}
          >
            Reset form
          </button>
        </div>
      </form>
    </div>
  );
}
