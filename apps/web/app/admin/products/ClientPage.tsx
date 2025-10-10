"use client";

import Image from "next/image";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import AdminWorkspaceLayout, { AdminSection } from "@/components/admin/AdminWorkspaceLayout";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  setDoc,
} from "firebase/firestore";
import Papa from "papaparse";
import type { Product } from "@/lib/products";
import { getProductEventRangeLabel, formatProductOnsiteDuration } from "@/lib/products";
import type { Category } from "@/lib/categories";

export default function AdminProductsPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [venueFilter, setVenueFilter] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      const prodSnap = await getDocs(collection(db, "products"));
      setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      const catSnap = await getDocs(collection(db, "categories"));
      setCats(catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  const toggleHidden = async (id: string, hidden: boolean | undefined) => {
    await updateDoc(doc(db, "products", id), { hidden: !hidden });
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, hidden: !hidden } : p))
    );
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    await deleteDoc(doc(db, "products", id));
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const duplicate = async (product: Product) => {
    const { id: _id, ...data } = product;
    const duplicatedName = `${product.name} (Copy)`;
    try {
      const ref = await addDoc(collection(db, "products"), {
        ...data,
        name: duplicatedName,
      });
      const newProduct: Product = {
        ...product,
        id: ref.id,
        name: duplicatedName,
      };
      setProducts((prev) => [newProduct, ...prev]);
      router.push(`/admin/products/${ref.id}`);
    } catch (error) {
      console.error("Failed to duplicate product", error);
      alert("Failed to duplicate product. Please try again.");
    }
  };

  const downloadCSV = () => {
    const rows = products.map((p) => ({
      ...p,
      deliverables: JSON.stringify(p.deliverables || []),
      modifiers: JSON.stringify(p.modifiers || []),
      storyboardImages: JSON.stringify(p.storyboardImages || []),
      imageUrls: JSON.stringify(p.imageUrls || []),
      defaultTasks: JSON.stringify(p.defaultTasks || []),
      seo: JSON.stringify(p.seo || {}),
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadCSV = async (file: File) => {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data as any[];
    for (const row of rows) {
      const id = row.id as string | undefined;
      const price = row.price ? Number(row.price) : undefined;
      const data: any = {
        ...row,
        price,
      };
      if (row.deliverables) data.deliverables = JSON.parse(row.deliverables);
      if (row.modifiers) data.modifiers = JSON.parse(row.modifiers);
      if (row.storyboardImages)
        data.storyboardImages = JSON.parse(row.storyboardImages);
      if (row.imageUrls) data.imageUrls = JSON.parse(row.imageUrls);
      if (row.defaultTasks) data.defaultTasks = JSON.parse(row.defaultTasks);
      if (row.seo) data.seo = JSON.parse(row.seo);
      if (row.hidden !== undefined)
        data.hidden = row.hidden === "true" || row.hidden === true;
      delete data.id;
      if (id) {
        await setDoc(doc(db, "products", id), data, { merge: true });
      } else {
        await addDoc(collection(db, "products"), data);
      }
    }
    const prodSnap = await getDocs(collection(db, "products"));
    setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadCSV(file);
    e.target.value = "";
  };

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch = p.name
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesCat = catFilter === "all" || p.category === catFilter;
      const matchesVenue = venueFilter
        ? (p.venue || "").toLowerCase().includes(venueFilter.toLowerCase())
        : true;
      return matchesSearch && matchesCat && matchesVenue;
    });
  }, [products, search, catFilter, venueFilter]);

  if (guardLoading || loading) {
    return (
      <AdminWorkspaceLayout
        title="Product library"
        description="Manage storefront services, pricing, and intake metadata."
      >
        <AdminSection>
          <p className="text-sm text-gray-600">Loading product catalogue…</p>
        </AdminSection>
      </AdminWorkspaceLayout>
    );
  }

  if (!allowed) {
    return (
      <AdminWorkspaceLayout
        title="Product library"
        description="Manage storefront services, pricing, and intake metadata."
      >
        <AdminSection tone="danger">
          <p className="text-sm font-medium text-rose-700">You do not have permission to manage products.</p>
        </AdminSection>
      </AdminWorkspaceLayout>
    );
  }

  return (
    <AdminWorkspaceLayout
      title="Product library"
      description="Update product visibility, route bespoke workflows, and keep pricing aligned with HQ guidance."
      actions={
        <Link href="/admin/products/new" className="btn">
          Create product
        </Link>
      }
    >
      <AdminSection title="Filters" description="Search by name, category, or venue to refine the list.">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            placeholder="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input max-w-xs"
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="input max-w-xs"
            placeholder="Filter by venue"
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={downloadCSV} className="btn btn-sm">
              Download CSV
            </button>
            <label className="btn btn-sm">
              Upload CSV
              <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
            </label>
          </div>
        </div>
      </AdminSection>
      <AdminSection
        title="Catalogue"
        description="Toggle visibility, duplicate templates, or jump into deep editing."
      >
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-600">No products match the selected filters.</p>
        ) : (
          <div className="grid gap-3">
            {filtered.map((p) => {
              const eventLabel = getProductEventRangeLabel(p);
              const onsiteLabel = formatProductOnsiteDuration(p);
              const coverImage =
                p.imageUrls?.find((url) => typeof url === "string" && url.trim().length > 0)?.trim() ||
                (typeof p.imageUrl === "string" ? p.imageUrl.trim() : "");
              return (
                <div
                  key={p.id}
                  className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex items-center gap-4">
                    {coverImage && (
                      <Image
                        src={coverImage}
                        alt={p.name}
                        width={64}
                        height={64}
                        className="h-16 w-16 rounded object-cover"
                      />
                    )}
                    <div>
                      <p className="font-medium text-gray-900">{p.name}</p>
                      <p className="text-sm text-gray-700">
                        {p.salesMode === "quote" ? "Quote-only workflow" : `£${(p.price ?? 0).toFixed(2)}`}
                      </p>
                      {p.salesMode === "quote" ? (
                        <p className="text-xs text-orange-600">Requests route to bespoke quote intake.</p>
                      ) : null}
                      {p.venue ? <p className="text-xs text-gray-600">{p.venue}</p> : null}
                      {eventLabel ? <p className="text-xs text-gray-600">{eventLabel}</p> : null}
                      {onsiteLabel ? <p className="text-xs text-gray-500">{onsiteLabel}</p> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => toggleHidden(p.id, p.hidden)} className="btn btn-sm">
                      {p.hidden ? "Show" : "Hide"}
                    </button>
                    <Link href={`/admin/products/${p.id}`} className="btn btn-sm">
                      Edit
                    </Link>
                    <button onClick={() => duplicate(p)} className="btn btn-sm">
                      Duplicate
                    </button>
                    <button onClick={() => remove(p.id)} className="btn btn-sm bg-rose-600 text-white">
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminSection>
    </AdminWorkspaceLayout>
  );
}
