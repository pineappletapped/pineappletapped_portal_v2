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
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import "react-quill/dist/quill.snow.css";
import { db, storage } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  emptyPostForm,
  ensureStringArray,
  formatDateTimeLocal,
  formatDisplayDate,
  slugify,
  stripHtml,
  timestampToDate,
  type BlogCategory,
  type BlogPostForm,
  type BlogPostRecord,
  type ProductOption,
} from "@/components/admin/blog/blogUtils";

function getPostStatus(post: BlogPostRecord): "draft" | "scheduled" | "published" {
  const now = new Date();
  if (post.publishAt && post.publishAt.getTime() > now.getTime()) {
    return "scheduled";
  }
  return post.isVisible ? "published" : "draft";
}
export default function AdminBlogPage() {
  const router = useRouter();
  const { allowed, loading: guardLoading } = useRoleGate(["marketing", "admin"]);
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<BlogPostRecord[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [form, setForm] = useState<BlogPostForm>(emptyPostForm);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [savingPost, setSavingPost] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [scheduleSaving, setScheduleSaving] = useState<string | null>(null);
  const [editorUploading, setEditorUploading] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [categorySlugTouched, setCategorySlugTouched] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryDeleting, setCategoryDeleting] = useState<string | null>(null);

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

  const loadPosts = useCallback(async () => {
    try {
      const refCollection = collection(db, "blogPosts");
      let snapshot;
      try {
        snapshot = await getDocs(query(refCollection, orderBy("createdAt", "desc")));
      } catch (error) {
        console.debug("Falling back to unordered blogPosts fetch", error);
        snapshot = await getDocs(refCollection);
      }
      const items: BlogPostRecord[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        const publishAt = timestampToDate(data.publishAt);
        const createdAt = timestampToDate(data.createdAt);
        const updatedAt = timestampToDate(data.updatedAt);
        const seo = data.seo || {};
        const derivedVisible =
          typeof data.isVisible === "boolean"
            ? data.isVisible
            : data.hidden === undefined
            ? false
            : !data.hidden;
        return {
          id: docSnap.id,
          title: data.title || "",
          slug: data.slug || docSnap.id,
          excerpt: data.excerpt || "",
          content: data.content || "",
          heroImageUrl: data.heroImageUrl || data.imageUrl || undefined,
          videoUrl: data.videoUrl || data.videoEmbedUrl || "",
          categories: Array.isArray(data.categories)
            ? data.categories.filter((catId: any) => typeof catId === "string")
            : [],
          tags: ensureStringArray(data.tags),
          seoTitle: seo.title || data.seoTitle || "",
          seoDescription: seo.description || data.seoDescription || "",
          seoKeywords: ensureStringArray(seo.keywords || data.seoKeywords),
          relatedProductIds: Array.isArray(data.relatedProductIds)
            ? data.relatedProductIds.filter((id: any) => typeof id === "string")
            : [],
          relatedPostId:
            typeof data.relatedPostId === "string"
              ? data.relatedPostId
              : data.relatedPostId || null,
          isVisible: derivedVisible,
          publishAt,
          createdAt,
          updatedAt,
        };
      });
      items.sort((a, b) => {
        const aTime = a.publishAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
        const bTime = b.publishAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
        return bTime - aTime;
      });
      setPosts(items);
      const scheduleDefaults: Record<string, string> = {};
      for (const item of items) {
        const formatted = formatDateTimeLocal(item.publishAt);
        if (formatted) {
          scheduleDefaults[item.id] = formatted;
        }
      }
      setScheduleDrafts(scheduleDefaults);
      return items;
    } catch (error) {
      console.error("Failed to load blog posts", error);
      throw error;
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
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
    } catch (error) {
      console.error("Failed to load blog categories", error);
      throw error;
    }
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
      console.error("Failed to load products", error);
      // Products are optional for linking so the UI can continue without them.
    }
  }, []);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        await Promise.all([loadPosts(), loadCategories(), loadProducts()]);
      } catch (error) {
        // Individual loaders already log failures.
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading, loadPosts, loadCategories, loadProducts]);

  const filteredPosts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return posts.filter((post) => {
      const matchesSearch =
        term.length === 0 ||
        post.title.toLowerCase().includes(term) ||
        post.slug.toLowerCase().includes(term) ||
        post.tags.some((tag) => tag.toLowerCase().includes(term));
      const matchesCategory =
        categoryFilter === "all" || post.categories.includes(categoryFilter);
      const matchesStatus =
        statusFilter === "all" || getPostStatus(post) === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [posts, search, categoryFilter, statusFilter]);

  const mapPostToForm = useCallback(
    (post: BlogPostRecord): BlogPostForm => ({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      heroImageUrl: post.heroImageUrl,
      videoUrl: post.videoUrl ?? "",
      categories: post.categories,
      tags: post.tags,
      seoTitle: post.seoTitle ?? "",
      seoDescription: post.seoDescription ?? "",
      seoKeywords: post.seoKeywords ?? [],
      relatedProductIds: post.relatedProductIds,
      relatedPostId: post.relatedPostId ?? "",
      isVisible: post.isVisible,
      publishAt: formatDateTimeLocal(post.publishAt),
    }),
    []
  );

  const clearEditor = () => {
    setSelectedPostId(null);
    setForm(emptyPostForm);
    setSlugTouched(false);
    setCoverFile(null);
  };

  const startEditPost = (post: BlogPostRecord) => {
    setSelectedPostId(post.id);
    setForm(mapPostToForm(post));
    setSlugTouched(true);
    setCoverFile(null);
  };

  const togglePostVisibility = async (post: BlogPostRecord) => {
    try {
      await updateDoc(doc(db, "blogPosts", post.id), {
        isVisible: !post.isVisible,
        hidden: post.isVisible,
        updatedAt: serverTimestamp(),
      });
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id ? { ...item, isVisible: !post.isVisible } : item
        )
      );
      if (form.id === post.id) {
        setForm((prev) => ({ ...prev, isVisible: !post.isVisible }));
      }
    } catch (error) {
      console.error("Failed to update visibility", error);
      alert("Failed to update visibility. Please try again.");
    }
  };

  const handleScheduleChange = (postId: string, value: string) => {
    setScheduleDrafts((prev) => ({ ...prev, [postId]: value }));
  };

  const saveSchedule = async (post: BlogPostRecord) => {
    const value = scheduleDrafts[post.id] ?? formatDateTimeLocal(post.publishAt);
    const scheduleDate = value ? new Date(value) : null;
    if (scheduleDate && Number.isNaN(scheduleDate.getTime())) {
      alert("Please provide a valid schedule date");
      return;
    }
    try {
      setScheduleSaving(post.id);
      const payload: Record<string, any> = { updatedAt: serverTimestamp() };
      if (scheduleDate) {
        payload.publishAt = Timestamp.fromDate(scheduleDate);
      } else {
        payload.publishAt = deleteField();
      }
      await updateDoc(doc(db, "blogPosts", post.id), payload);
      setPosts((prev) =>
        prev.map((item) =>
          item.id === post.id ? { ...item, publishAt: scheduleDate } : item
        )
      );
      if (form.id === post.id) {
        setForm((prev) => ({ ...prev, publishAt: formatDateTimeLocal(scheduleDate) }));
      }
      if (scheduleDate) {
        setScheduleDrafts((prev) => ({
          ...prev,
          [post.id]: formatDateTimeLocal(scheduleDate),
        }));
      } else {
        setScheduleDrafts((prev) => {
          const next = { ...prev };
          delete next[post.id];
          return next;
        });
      }
    } catch (error) {
      console.error("Failed to update schedule", error);
      alert("Failed to update schedule. Please try again.");
    } finally {
      setScheduleSaving(null);
    }
  };

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

  const resetCategoryForm = () => {
    setCategoryName("");
    setCategorySlug("");
    setCategorySlugTouched(false);
    setEditingCategoryId(null);
  };

  const handleCategorySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = categoryName.trim();
    const slug = (categorySlug.trim() || slugify(name)).trim();
    if (!name) {
      alert("Category name is required");
      return;
    }
    if (!slug) {
      alert("Category slug is required");
      return;
    }
    try {
      setCategorySaving(true);
      if (editingCategoryId) {
        await updateDoc(doc(db, "blogCategories", editingCategoryId), {
          name,
          slug,
        });
      } else {
        await addDoc(collection(db, "blogCategories"), { name, slug });
      }
      await loadCategories();
      resetCategoryForm();
    } catch (error) {
      console.error("Failed to save category", error);
      alert("Failed to save category. Please try again.");
    } finally {
      setCategorySaving(false);
    }
  };

  const startEditCategory = (category: BlogCategory) => {
    setEditingCategoryId(category.id);
    setCategoryName(category.name);
    setCategorySlug(category.slug);
    setCategorySlugTouched(true);
  };

  const removeCategory = async (category: BlogCategory) => {
    if (
      !confirm(
        `Delete the "${category.name}" category? Posts will keep their reference but the category will be removed.`
      )
    ) {
      return;
    }
    try {
      setCategoryDeleting(category.id);
      await deleteDoc(doc(db, "blogCategories", category.id));
      setCategories((prev) => prev.filter((item) => item.id !== category.id));
      setForm((prev) => ({
        ...prev,
        categories: prev.categories.filter((id) => id !== category.id),
      }));
    } catch (error) {
      console.error("Failed to delete category", error);
      alert("Failed to delete category. Please try again.");
    } finally {
      setCategoryDeleting(null);
    }
  };

  useEffect(() => {
    if (categorySlugTouched) return;
    setCategorySlug(slugify(categoryName));
  }, [categoryName, categorySlugTouched]);

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
    const strippedContent = stripHtml(form.content || "");
    if (!strippedContent) {
      alert("Post content cannot be empty");
      return;
    }
    const scheduleDate = form.publishAt ? new Date(form.publishAt) : null;
    if (scheduleDate && Number.isNaN(scheduleDate.getTime())) {
      alert("Publish schedule must be a valid date and time");
      return;
    }
    try {
      setSavingPost(true);
      let heroUrl = form.heroImageUrl || "";
      if (coverFile) {
        const path = `blog/covers/${Date.now()}-${coverFile.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, coverFile, { contentType: coverFile.type });
        heroUrl = await getDownloadURL(storageRef);
      }
      const payloadBase: Record<string, any> = {
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
        updatedAt: serverTimestamp(),
      };
      if (scheduleDate) {
        payloadBase.publishAt = Timestamp.fromDate(scheduleDate);
      }
      if (form.id) {
        const payload = { ...payloadBase };
        if (!scheduleDate) {
          payload.publishAt = deleteField();
        }
        await updateDoc(doc(db, "blogPosts", form.id), payload);
        setSelectedPostId(form.id);
        const updated = await loadPosts();
        const match = updated.find((item) => item.id === form.id);
        if (match) {
          setForm(mapPostToForm(match));
        }
      } else {
        const payload = {
          ...payloadBase,
          createdAt: serverTimestamp(),
        };
        const docRef = await addDoc(collection(db, "blogPosts"), payload);
        setSelectedPostId(docRef.id);
        const updated = await loadPosts();
        const match = updated.find((item) => item.id === docRef.id);
        if (match) {
          setForm(mapPostToForm(match));
        } else {
          setForm((prev) => ({ ...prev, id: docRef.id }));
        }
      }
      setCoverFile(null);
      setSlugTouched(true);
    } catch (error) {
      console.error("Failed to save blog post", error);
      alert("Failed to save the post. Please try again.");
    } finally {
      setSavingPost(false);
    }
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage the blog.</p>;

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Blog Management</h1>
      <p className="text-sm text-gray-600">
        Publish new articles, schedule releases, and curate supporting content for the portal blog.
      </p>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Posts</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => {
                    void loadPosts();
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    router.push("/admin/blog/new");
                  }}
                >
                  Create Post
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <input
                className="input min-w-[200px] flex-1"
                placeholder="Search posts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                className="input min-w-[180px]"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <select
                className="input min-w-[160px]"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
              </select>
            </div>
            <div className="mt-4 overflow-x-auto">
              {filteredPosts.length === 0 ? (
                <p className="text-sm text-gray-600">No posts match the current filters.</p>
              ) : (
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Post</th>
                      <th className="px-3 py-2">Categories</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Schedule</th>
                      <th className="px-3 py-2">Visibility</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPosts.map((post) => {
                      const status = getPostStatus(post);
                      const statusLabel =
                        status === "scheduled"
                          ? "Scheduled"
                          : status === "published"
                          ? "Published"
                          : "Draft";
                      const badgeClass =
                        status === "scheduled"
                          ? "bg-amber-100 text-amber-800"
                          : status === "published"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-700";
                      const scheduleValue =
                        scheduleDrafts[post.id] ?? formatDateTimeLocal(post.publishAt);
                      return (
                        <tr
                          key={post.id}
                          className={`border-b last:border-0 ${
                            selectedPostId === post.id ? "bg-orange-50" : ""
                          }`}
                        >
                          <td className="px-3 py-3 align-top">
                            <button
                              type="button"
                              onClick={() => startEditPost(post)}
                              className="text-left font-medium text-orange hover:underline"
                            >
                              {post.title || "Untitled post"}
                            </button>
                            <div className="text-xs text-gray-500">{post.slug}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            {post.categories.length === 0 ? (
                              <span className="text-xs text-gray-500">Uncategorised</span>
                            ) : (
                              <ul className="space-y-1">
                                {post.categories.map((categoryId) => {
                                  const category = categories.find((item) => item.id === categoryId);
                                  return (
                                    <li key={categoryId} className="text-xs text-gray-700">
                                      {category ? category.name : categoryId}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}
                            >
                              {statusLabel}
                            </span>
                            <div className="mt-1 text-[11px] text-gray-500">
                              {formatDisplayDate(post.publishAt)}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex flex-col gap-2">
                              <input
                                type="datetime-local"
                                className="input"
                                value={scheduleValue || ""}
                                onChange={(event) => handleScheduleChange(post.id, event.target.value)}
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="btn btn-xs"
                                  onClick={() => saveSchedule(post)}
                                  disabled={scheduleSaving === post.id}
                                >
                                  {scheduleSaving === post.id ? "Saving…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-ghost"
                                  onClick={() => handleScheduleChange(post.id, "")}
                                  disabled={scheduleSaving === post.id}
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <button
                              type="button"
                              className="btn btn-xs"
                              onClick={() => togglePostVisibility(post)}
                            >
                              {post.isVisible ? "Hide" : "Show"}
                            </button>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                className="btn btn-xs btn-outline"
                                onClick={() => startEditPost(post)}
                              >
                                Edit
                              </button>
                              <Link
                                href={`/blog/${post.slug || post.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-xs btn-ghost"
                              >
                                View
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {selectedPostId ? (
              <>
                <h2 className="text-lg font-semibold">Edit Post</h2>
                <form onSubmit={savePost} className="mt-4 grid gap-4">
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
                <p className="text-xs text-gray-500">
                  Used for the public URL (e.g. /blog/{form.slug || "your-slug"}).
                </p>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor="post-excerpt">
                  Summary
                </label>
                <textarea
                  id="post-excerpt"
                  className="textarea textarea-bordered"
                  rows={3}
                  value={form.excerpt}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, excerpt: event.target.value }))
                  }
                  placeholder="Short preview for cards and social posts"
                />
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
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, videoUrl: event.target.value }))
                  }
                />
                <p className="text-xs text-gray-500">
                  Displayed above the article when provided. Supports YouTube or Vimeo links.
                </p>
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
                  <p className="text-xs text-gray-500">
                    Leave blank to publish immediately when the post is visible.
                  </p>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={form.isVisible}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, isVisible: event.target.checked }))
                      }
                    />
                    Visible on site
                  </label>
                </div>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Categories</span>
                {categories.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No categories yet. Add one in the panel to the right.
                  </p>
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
                <p className="text-xs text-gray-500">
                  Comma separated keywords used for search and filtering.
                </p>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Content</label>
                <ReactQuill
                  value={form.content}
                  onChange={(value) => setForm((prev) => ({ ...prev, content: value }))}
                  modules={quillModules}
                  className="bg-white"
                />
                {editorUploading && (
                  <p className="text-xs text-gray-500">Uploading image…</p>
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
                  {coverFile && (
                    <p className="text-xs text-gray-500">Selected: {coverFile.name}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    Upload a landscape image to appear at the top of the post.
                  </p>
                </div>
                {(form.heroImageUrl || coverFile) && (
                  <div className="mt-2 flex flex-col items-start gap-2">
                    {form.heroImageUrl && !coverFile && (
                      <Image
                        src={form.heroImageUrl}
                        alt="Current hero image"
                        width={320}
                        height={180}
                        className="h-32 w-56 rounded object-cover"
                      />
                    )}
                    {coverFile && (
                      <p className="text-xs text-gray-500">
                        New image will replace the current one after saving.
                      </p>
                    )}
                    {form.heroImageUrl && (
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => setForm((prev) => ({ ...prev, heroImageUrl: undefined }))}
                      >
                        Remove current image
                      </button>
                    )}
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
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, seoTitle: event.target.value }))
                  }
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
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, seoDescription: event.target.value }))
                  }
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
                <label className="text-sm font-medium" htmlFor="post-related-products">
                  Related products
                </label>
                <select
                  id="post-related-products"
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
                <p className="text-xs text-gray-500">
                  Selected products will be promoted beneath the article.
                </p>
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor="post-related-article">
                  Related article
                </label>
                <select
                  id="post-related-article"
                  className="input"
                  value={form.relatedPostId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, relatedPostId: event.target.value }))
                  }
                >
                  <option value="">None</option>
                  {posts
                    .filter((post) => post.id !== form.id)
                    .map((post) => (
                      <option key={post.id} value={post.id}>
                        {post.title || post.slug}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500">
                  Feature another story for readers to continue exploring.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn" disabled={savingPost}>
                  {savingPost ? "Saving…" : "Update Post"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={clearEditor}
                  disabled={savingPost}
                >
                  Close editor
                </button>
              </div>
            </form>
              </>
            ) : (
              <div className="grid gap-3 py-6 text-sm">
                <h2 className="text-lg font-semibold">Open the editor</h2>
                <p className="max-w-xl text-gray-600">
                  Select a post from the table to edit it here, or draft something new in the
                  dedicated create view for a larger workspace.
                </p>
                <button
                  type="button"
                  className="btn w-fit"
                  onClick={() => router.push("/admin/blog/new")}
                >
                  Create a new post
                </button>
              </div>
            )}
          </section>
        </div>

        <div className="grid gap-6">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Categories</h2>
            <p className="mt-1 text-sm text-gray-600">
              Group posts and control the navigation filters.
            </p>
            <form onSubmit={handleCategorySubmit} className="mt-4 grid gap-3">
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor="category-name">
                  Name
                </label>
                <input
                  id="category-name"
                  className="input"
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor="category-slug">
                  Slug
                </label>
                <input
                  id="category-slug"
                  className="input"
                  value={categorySlug}
                  onChange={(event) => {
                    setCategorySlugTouched(true);
                    setCategorySlug(event.target.value);
                  }}
                  required
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn btn-sm" disabled={categorySaving}>
                  {categorySaving
                    ? "Saving…"
                    : editingCategoryId
                    ? "Update category"
                    : "Create category"}
                </button>
                {editingCategoryId && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={resetCategoryForm}
                    disabled={categorySaving}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
            <ul className="mt-4 grid gap-2">
              {categories.length === 0 ? (
                <li className="text-sm text-gray-500">No categories yet.</li>
              ) : (
                categories.map((category) => (
                  <li
                    key={category.id}
                    className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{category.name}</p>
                      <p className="text-xs text-gray-500">/{category.slug}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => startEditCategory(category)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => removeCategory(category)}
                        disabled={categoryDeleting === category.id}
                      >
                        {categoryDeleting === category.id ? "Removing…" : "Delete"}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Publishing checklist</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
              <li>Set a publish schedule if you want the article to go live in the future.</li>
              <li>Mark the post as visible when you are ready for it to appear on the site.</li>
              <li>
                Use tags, categories, and related products to keep the blog connected to services.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
