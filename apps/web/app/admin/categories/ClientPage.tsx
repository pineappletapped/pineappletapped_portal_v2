"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
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

export default function AdminCategoriesPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["marketing"]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [howWeWork, setHowWeWork] = useState("");
  const [parentId, setParentId] = useState("");
  const [headerImageFile, setHeaderImageFile] = useState<File | null>(null);
  const [headerImagePreview, setHeaderImagePreview] = useState<string | null>(null);
  const [layout, setLayout] = useState("grid");
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editHowWeWork, setEditHowWeWork] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editHeaderImage, setEditHeaderImage] = useState("");
  const [editHeaderImageFile, setEditHeaderImageFile] = useState<File | null>(null);
  const [editHeaderImagePreview, setEditHeaderImagePreview] = useState<string | null>(null);
  const [editLayout, setEditLayout] = useState("grid");
  const [showCreate, setShowCreate] = useState(false);

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
    const cats = catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
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
    const docRef = await addDoc(collection(db, "categories"), {
      name,
      slug,
      description: description || null,
      howWeWork: howWeWork || null,
      parentId: parentId || null,
      headerImage: null,
      layout,
    });
    if (headerImageFile) {
      const url = await upload(`categories/${docRef.id}/header`, headerImageFile);
      await updateDoc(docRef, { headerImage: url });
    }
    await refresh();
    setName("");
    setSlug("");
    setDescription("");
    setHowWeWork("");
    setParentId("");
    setHeaderImageFile(null);
    setHeaderImagePreview(null);
    setLayout("grid");
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
    setEditDescription(c.description || "");
    setEditHowWeWork(c.howWeWork || "");
    setEditParentId(c.parentId || "");
    setEditHeaderImage(c.headerImage || "");
    setEditHeaderImageFile(null);
    setEditHeaderImagePreview(null);
    setEditLayout(c.layout || "grid");
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const docRef = doc(db, "categories", editing);
    await updateDoc(docRef, {
      name: editName,
      slug: editSlug,
      description: editDescription || null,
      howWeWork: editHowWeWork || null,
      parentId: editParentId || null,
      headerImage: editHeaderImage || null,
      layout: editLayout,
    });
    if (editHeaderImageFile) {
      const url = await upload(`categories/${editing}/header`, editHeaderImageFile);
      await updateDoc(docRef, { headerImage: url });
    }
    setEditing(null);
    await refresh();
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage categories.</p>;
  const CategoryRow = ({
    category,
    depth = 0,
  }: {
    category: Category;
    depth?: number;
  }) => {
    const children = categories.filter((c) => c.parentId === category.id);
    const isEditing = editing === category.id;
    return (
      <>
        {isEditing ? (
          <tr className="border-b">
            <td colSpan={3}>
              <form onSubmit={saveEdit} className="grid gap-2 p-4">
                <input
                  className="input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  placeholder="Name"
                />
                <input
                  className="input"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                  required
                  placeholder="Slug"
                />
                <textarea
                  className="input"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Description"
                />
                <textarea
                  className="input"
                  value={editHowWeWork}
                  onChange={(e) => setEditHowWeWork(e.target.value)}
                  placeholder="How we work"
                />
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setEditHeaderImageFile(file);
                    setEditHeaderImagePreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
                {(editHeaderImagePreview || editHeaderImage) && (
                  <Image
                    src={editHeaderImagePreview || editHeaderImage}
                    alt="Header preview"
                    width={512}
                    height={256}
                    className="h-auto max-h-32 w-full object-cover"
                  />
                )}
                <select
                  className="input"
                  value={editLayout}
                  onChange={(e) => setEditLayout(e.target.value)}
                >
                  <option value="grid">Grid</option>
                  <option value="list">List</option>
                </select>
                <select
                  className="input"
                  value={editParentId}
                  onChange={(e) => setEditParentId(e.target.value)}
                >
                  <option value="">No parent</option>
                  {categories
                    .filter((c) => c.id !== category.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <div className="flex gap-2 mt-2">
                  <button type="submit" className="btn btn-sm">
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="btn btn-sm btn-outline"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </td>
          </tr>
        ) : (
          <tr className="border-b">
            <td style={{ paddingLeft: depth * 16 }} className="py-2">
              {category.name}
            </td>
            <td className="py-2">{counts[category.id] || 0}</td>
            <td className="py-2 space-x-2">
              <button onClick={() => startEdit(category)} className="btn btn-sm">
                Edit
              </button>
              <button
                onClick={() => remove(category.id)}
                className="btn btn-sm bg-red-600 text-white"
              >
                Delete
              </button>
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
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Manage Categories</h1>
        <button
          className="btn"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Close" : "Add Category"}
        </button>
      </div>
      {showCreate && (
        <form onSubmit={create} className="card p-4 grid gap-2 max-w-md">
          <input
            className="input"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
          <textarea
            className="input"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <textarea
            className="input"
            placeholder="How we work"
            value={howWeWork}
            onChange={(e) => setHowWeWork(e.target.value)}
          />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setHeaderImageFile(file);
              setHeaderImagePreview(file ? URL.createObjectURL(file) : null);
            }}
          />
          {headerImagePreview && (
            <Image
              src={headerImagePreview}
              alt="Header preview"
              width={512}
              height={256}
              className="h-auto max-h-32 w-full object-cover"
            />
          )}
          <select
            className="input"
            value={layout}
            onChange={(e) => setLayout(e.target.value)}
          >
            <option value="grid">Grid</option>
            <option value="list">List</option>
          </select>
          <select
            className="input"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">No parent</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn w-fit">
            Create
          </button>
        </form>
      )}
      {categories.length === 0 ? (
        <p>No categories.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b">
              <th className="py-2">Name</th>
              <th className="py-2">Products</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories
              .filter((c) => !c.parentId)
              .map((c) => (
                <CategoryRow key={c.id} category={c} depth={0} />
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


