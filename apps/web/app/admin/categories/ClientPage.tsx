"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { db, storage } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";
import type { Category } from "@/lib/categories";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useRoleGate } from "@/hooks/useRoleGate";
import PortalContainer from "@/components/PortalContainer";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function AdminCategoriesPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["marketing"]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [howWeWork, setHowWeWork] = useState("");
  const [parentId, setParentId] = useState("");
  const [headerImageFile, setHeaderImageFile] = useState<File | null>(null);
  const [headerImagePreview, setHeaderImagePreview] = useState<string | null>(null);
  const [layout, setLayout] = useState("grid");
  const [order, setOrder] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [parentFilter, setParentFilter] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editSlugTouched, setEditSlugTouched] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editHowWeWork, setEditHowWeWork] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editHeaderImage, setEditHeaderImage] = useState("");
  const [editHeaderImageFile, setEditHeaderImageFile] = useState<File | null>(null);
  const [editHeaderImagePreview, setEditHeaderImagePreview] = useState<string | null>(null);
  const [editLayout, setEditLayout] = useState("grid");
  const [editOrder, setEditOrder] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      await refresh();
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  const refresh = async () => {
    const catSnap = await getDocs(collection(db, "categories"));
    const cats = catSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });
    const prodSnap = await getDocs(collection(db, "products"));
    const map: Record<string, number> = {};
    prodSnap.docs.forEach((p) => {
      const cat = (p.data() as any).category;
      if (cat) map[cat] = (map[cat] || 0) + 1;
    });
    setCategories(cats);
    setCounts(map);
  };

  const upload = async (path: string, file: File) => {
    const r = ref(storage, path);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedSlug = slugify(slug);
    if (!normalizedSlug) {
      setCreateError("Provide a slug using letters and numbers.");
      return;
    }
    const duplicate = categories.some(
      (category) => (category.slug ?? "").toLowerCase() === normalizedSlug
    );
    if (duplicate) {
      setCreateError("Another category already uses this slug. Try a different one.");
      return;
    }
    setCreateError(null);
    const docRef = await addDoc(collection(db, "categories"), {
      name,
      slug: normalizedSlug,
      description: description || null,
      howWeWork: howWeWork || null,
      parentId: parentId || null,
      headerImage: null,
      layout,
      order,
    });
    if (headerImageFile) {
      const url = await upload(`categories/${docRef.id}/header`, headerImageFile);
      await updateDoc(docRef, { headerImage: url });
    }
    await refresh();
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setHowWeWork("");
    setParentId("");
    setHeaderImageFile(null);
    setHeaderImagePreview(null);
    setLayout("grid");
    setOrder((value) => value + 1);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    await deleteDoc(doc(db, "categories", id));
    await refresh();
  };

  const startEdit = (c: Category) => {
    setEditing(c.id);
    setEditName(c.name);
    setEditSlug(c.slug);
    setEditSlugTouched(false);
    setEditDescription(c.description || "");
    setEditHowWeWork(c.howWeWork || "");
    setEditParentId(c.parentId || "");
    setEditHeaderImage(c.headerImage || "");
    setEditHeaderImageFile(null);
    setEditHeaderImagePreview(null);
    setEditLayout(c.layout || "grid");
    setEditOrder(c.order ?? 0);
    setEditError(null);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const normalizedSlug = slugify(editSlug);
    if (!normalizedSlug) {
      setEditError("Provide a slug using letters and numbers.");
      return;
    }
    const duplicate = categories.some(
      (category) =>
        category.id !== editing && (category.slug ?? "").toLowerCase() === normalizedSlug
    );
    if (duplicate) {
      setEditError("Another category already uses this slug. Try a different one.");
      return;
    }
    setEditError(null);
    const docRef = doc(db, "categories", editing);
    await updateDoc(docRef, {
      name: editName,
      slug: normalizedSlug,
      description: editDescription || null,
      howWeWork: editHowWeWork || null,
      parentId: editParentId || null,
      headerImage: editHeaderImage || null,
      layout: editLayout,
      order: editOrder,
    });
    if (editHeaderImageFile) {
      const url = await upload(`categories/${editing}/header`, editHeaderImageFile);
      await updateDoc(docRef, { headerImage: url });
    }
    setEditing(null);
    setEditError(null);
    await refresh();
  };

  const totalProducts = useMemo(
    () => Object.values(counts).reduce((total, value) => total + value, 0),
    [counts]
  );
  const topLevelCount = useMemo(
    () => categories.filter((category) => !category.parentId).length,
    [categories]
  );

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((category) => {
      map.set(category.id, category);
    });
    return map;
  }, [categories]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Category[]>();
    categories.forEach((category) => {
      const key = category.parentId ?? null;
      const group = map.get(key) ?? [];
      group.push(category);
      map.set(key, group);
    });
    map.forEach((group, key) => {
      group.sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });
      map.set(key, group);
    });
    return map;
  }, [categories]);

  const { topLevelCategories, visibleCategoryIds, hasActiveFilters } = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase();

    const isWithinParentBranch = (category: Category) => {
      if (!parentFilter) return true;
      if (category.id === parentFilter) return true;

      let currentParentId = category.parentId ?? null;
      while (currentParentId) {
        if (currentParentId === parentFilter) return true;
        currentParentId = categoryMap.get(currentParentId)?.parentId ?? null;
      }
      return false;
    };

    const matchesSearch = (category: Category) => {
      if (!normalizedTerm) return true;
      const haystack = `${category.name} ${(category.slug ?? "")}`.toLowerCase();
      return haystack.includes(normalizedTerm);
    };

    const memo = new Map<string, boolean>();
    const computeVisible = (category: Category): boolean => {
      const cached = memo.get(category.id);
      if (cached !== undefined) return cached;

      if (!isWithinParentBranch(category)) {
        memo.set(category.id, false);
        return false;
      }

      const directMatch = matchesSearch(category);
      if (directMatch) {
        memo.set(category.id, true);
        return true;
      }

      const children = childrenByParent.get(category.id) ?? [];
      const matchesDescendant = children.some((child) => computeVisible(child));
      memo.set(category.id, matchesDescendant);
      return matchesDescendant;
    };

    const visibleSet = new Set<string>();
    categories.forEach((category) => {
      if (computeVisible(category)) {
        visibleSet.add(category.id);
      }
    });

    const roots = childrenByParent.get(null) ?? [];
    const filteredRoots = roots.filter((category) => visibleSet.has(category.id));

    return {
      topLevelCategories: filteredRoots,
      visibleCategoryIds: visibleSet,
      hasActiveFilters: Boolean(normalizedTerm) || Boolean(parentFilter),
    };
  }, [
    categories,
    categoryMap,
    childrenByParent,
    parentFilter,
    searchTerm,
  ]);

  const parentOptions = useMemo(() => {
    const roots = childrenByParent.get(null) ?? [];
    return [...roots].sort((a, b) => a.name.localeCompare(b.name));
  }, [childrenByParent]);

  const nextOrder = useMemo(() => {
    if (categories.length === 0) return 0;
    return (
      categories.reduce((max, category) => {
        const value = category.order ?? 0;
        return value > max ? value : max;
      }, 0) + 1
    );
  }, [categories]);

  const toggleCreate = () => {
    setShowCreate((value) => {
      const next = !value;
      if (next) {
        setOrder(nextOrder);
        setSlugTouched(false);
        setCreateError(null);
        if (name) {
          setSlug(slugify(name));
        }
      }
      return next;
    });
  };

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading categories…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">
          You do not have permission to manage categories.
        </p>
      </PortalContainer>
    );
  }
  const CategoryRow = ({
    category,
    depth = 0,
  }: {
    category: Category;
    depth?: number;
  }) => {
    const children = (childrenByParent.get(category.id) ?? []).filter((child) =>
      visibleCategoryIds.has(child.id)
    );
    const isEditing = editing === category.id;
    const paddingLeft = depth * 20;

    return (
      <>
        {isEditing ? (
          <tr className="bg-gray-50/80">
            <td colSpan={4} className="px-0 py-0">
              <form onSubmit={saveEdit} className="grid gap-4 px-6 py-5 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Name
                  <input
                    className="input mt-1"
                    value={editName}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      setEditName(nextName);
                      setEditError(null);
                      if (!editSlugTouched) {
                        setEditSlug(slugify(nextName));
                      }
                    }}
                    required
                    placeholder="Name"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Slug
                  <input
                    className="input mt-1"
                    value={editSlug}
                    onChange={(event) => {
                      setEditSlugTouched(true);
                      setEditSlug(event.target.value);
                      setEditError(null);
                    }}
                    required
                    placeholder="Slug"
                  />
                  {editError && (
                    <span className="mt-1 block text-[11px] font-medium text-rose-600">{editError}</span>
                  )}
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 sm:col-span-2">
                  Description
                  <textarea
                    className="input mt-1 h-24 resize-none"
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    placeholder="Description"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 sm:col-span-2">
                  How we work
                  <textarea
                    className="input mt-1 h-24 resize-none"
                    value={editHowWeWork}
                    onChange={(event) => setEditHowWeWork(event.target.value)}
                    placeholder="How we work"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Layout
                  <select
                    className="input mt-1"
                    value={editLayout}
                    onChange={(event) => setEditLayout(event.target.value)}
                  >
                    <option value="grid">Grid</option>
                    <option value="list">List</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Order
                  <input
                    type="number"
                    min={0}
                    className="input mt-1"
                    value={editOrder}
                    onChange={(event) => setEditOrder(Number(event.target.value))}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Parent
                  <select
                    className="input mt-1"
                    value={editParentId}
                    onChange={(event) => setEditParentId(event.target.value)}
                  >
                    <option value="">No parent</option>
                    {categories
                      .filter((candidate) => candidate.id !== category.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 sm:col-span-2">
                  Header image
                  <input
                    type="file"
                    accept="image/*"
                    className="mt-1"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setEditHeaderImageFile(file);
                      setEditHeaderImagePreview(file ? URL.createObjectURL(file) : null);
                    }}
                  />
                  {(editHeaderImagePreview || editHeaderImage) && (
                    <Image
                      src={editHeaderImagePreview || editHeaderImage}
                      alt="Header preview"
                      width={768}
                      height={384}
                      className="mt-3 h-auto max-h-48 w-full rounded-2xl object-cover"
                    />
                  )}
                </label>
                <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-3">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-sm">
                    Save changes
                  </button>
                </div>
              </form>
            </td>
          </tr>
        ) : (
          <tr className="hover:bg-gray-50/60">
            <td className="px-6 py-3">
              <div style={{ paddingLeft }} className="flex flex-col gap-1">
                <span className="text-sm font-medium text-gray-900">{category.name}</span>
                {category.description ? (
                  <span className="text-xs text-gray-500">{category.description}</span>
                ) : null}
              </div>
            </td>
            <td className="px-6 py-3 text-sm text-gray-600">{category.order ?? "—"}</td>
            <td className="px-6 py-3 text-sm text-gray-600">{counts[category.id] || 0}</td>
            <td className="px-6 py-3">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => startEdit(category)} className="btn btn-xs">
                  Edit
                </button>
                <button
                  onClick={() => remove(category.id)}
                  className="btn btn-xs bg-rose-600 text-white hover:bg-rose-500"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        )}
        {children.map((child) => (
          <CategoryRow key={child.id} category={child} depth={depth + 1} />
        ))}
      </>
    );
  };

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Catalog</p>
            <h1 className="text-2xl font-semibold text-gray-900">Manage categories</h1>
            <p className="max-w-2xl text-sm text-gray-600">
              Organise the taxonomy that powers product detail pages, control nested groupings, and keep hero imagery aligned with the latest brand look.
            </p>
            <div className="flex flex-wrap gap-3 text-xs font-medium uppercase tracking-wide text-gray-500">
              <span>Total categories · {categories.length}</span>
              <span>Top level · {topLevelCount}</span>
              <span>Products mapped · {totalProducts}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <button className="btn" onClick={toggleCreate}>
              {showCreate ? "Close form" : "Add category"}
            </button>
          </div>
        </header>

        {showCreate && (
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-1 border-b border-gray-100 pb-4">
              <h2 className="text-lg font-semibold text-gray-900">Create a new category</h2>
              <p className="text-sm text-gray-600">
                Define the label, optional parent grouping, and upload an optional hero header that appears on the customer-facing detail page.
              </p>
            </div>
            <form onSubmit={create} className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Name
                  <input
                    className="input mt-1"
                    placeholder="e.g. Brand Activations"
                    value={name}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      setName(nextName);
                      setCreateError(null);
                      if (!slugTouched) {
                        setSlug(slugify(nextName));
                      }
                    }}
                    required
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Slug
                  <input
                    className="input mt-1"
                    placeholder="brand-activations"
                    value={slug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      setSlug(event.target.value);
                      setCreateError(null);
                    }}
                    required
                  />
                  {createError && (
                    <span className="mt-1 block text-[11px] font-medium text-rose-600">{createError}</span>
                  )}
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Parent category
                  <select
                    className="input mt-1"
                    value={parentId}
                    onChange={(event) => setParentId(event.target.value)}
                  >
                    <option value="">No parent</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Layout preference
                  <select
                    className="input mt-1"
                    value={layout}
                    onChange={(event) => setLayout(event.target.value)}
                  >
                    <option value="grid">Grid</option>
                    <option value="list">List</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Order
                  <input
                    type="number"
                    min={0}
                    className="input mt-1"
                    value={order}
                    onChange={(event) => setOrder(Number(event.target.value))}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Description
                  <textarea
                    className="input mt-1 h-24 resize-none"
                    placeholder="Optional summary for marketing and SEO"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  How we work blurb
                  <textarea
                    className="input mt-1 h-24 resize-none"
                    placeholder="Explain the process or delivery notes"
                    value={howWeWork}
                    onChange={(event) => setHowWeWork(event.target.value)}
                  />
                </label>
              </div>
              <div className="lg:col-span-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Header image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setHeaderImageFile(file);
                      setHeaderImagePreview(file ? URL.createObjectURL(file) : null);
                    }}
                  />
                  {headerImagePreview && (
                    <Image
                      src={headerImagePreview}
                      alt="Header preview"
                      width={768}
                      height={384}
                      className="h-auto max-h-48 w-full rounded-2xl object-cover"
                    />
                  )}
                </label>
              </div>
              <div className="lg:col-span-2 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setShowCreate(false);
                    setOrder(nextOrder);
                    setCreateError(null);
                    setSlugTouched(false);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn">
                  Create category
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Existing categories</h2>
                <p className="text-sm text-gray-600">
                  Edit nested groupings, review product counts, and remove categories that are no longer in use.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-64">
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search by name or slug…"
                    className="input w-full pr-10"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m21 21-3.8-3.8M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z"
                      />
                    </svg>
                  </span>
                </div>
                <select
                  className="input w-full sm:w-52"
                  value={parentFilter}
                  onChange={(event) => setParentFilter(event.target.value)}
                >
                  <option value="">All parent groups</option>
                  {parentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {categories.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-500">No categories found yet. Create one to get started.</p>
          ) : topLevelCategories.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-500">
              {hasActiveFilters
                ? "No categories match the current filters. Try updating your search or parent selection."
                : "No categories available."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left font-semibold">Name</th>
                    <th scope="col" className="px-6 py-3 text-left font-semibold">Order</th>
                    <th scope="col" className="px-6 py-3 text-left font-semibold">Products</th>
                    <th scope="col" className="px-6 py-3 text-left font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {topLevelCategories.map((category) => (
                    <CategoryRow key={category.id} category={category} depth={0} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PortalContainer>
  );
}


