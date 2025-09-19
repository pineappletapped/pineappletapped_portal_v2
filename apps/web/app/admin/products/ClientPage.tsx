"use client";

import Image from "next/image";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  setDoc,
} from "firebase/firestore";
import Papa from "papaparse";
import type { Product } from "@/lib/products";
import type { Category } from "@/lib/categories";

export default function AdminProductsPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [venueFilter, setVenueFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setIsStaff(false);
        setLoading(false);
        return;
      }
      const snap = await getDoc(doc(db, "users", user.uid));
      const me = snap.data() as any;
      const staff = me?.isStaff === true;
      setIsStaff(staff);
      if (staff) {
        const prodSnap = await getDocs(collection(db, "products"));
        setProducts(prodSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        const catSnap = await getDocs(collection(db, "categories"));
        setCats(catSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }
      setLoading(false);
    })();
  }, []);

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

  const downloadCSV = () => {
    const rows = products.map((p) => ({
      ...p,
      deliverables: JSON.stringify(p.deliverables || []),
      modifiers: JSON.stringify(p.modifiers || []),
      storyboardImages: JSON.stringify(p.storyboardImages || []),
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

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to manage products.</p>;

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Manage Products</h1>
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input"
          placeholder="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input"
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
          className="input"
          placeholder="Filter by venue"
          value={venueFilter}
          onChange={(e) => setVenueFilter(e.target.value)}
        />
        <Link href="/admin/products/new" className="btn">
          Create Product
        </Link>
        <button onClick={downloadCSV} className="btn">
          Download CSV
        </button>
        <label className="btn">
          Upload CSV
          <input
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
          />
        </label>
      </div>
      {filtered.length === 0 ? (
        <p>No products found.</p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="card p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
            >
              <div className="flex items-center gap-4">
                {p.imageUrl && (
                  <Image
                    src={p.imageUrl}
                    alt={p.name}
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded object-cover"
                  />
                )}
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-gray-700">
                    £{p.price?.toFixed(2)}
                  </p>
                  {p.venue && (
                    <p className="text-xs text-gray-600">{p.venue}</p>
                  )}
                  {p.eventDate && (
                    <p className="text-xs text-gray-600">
                      {new Date(p.eventDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleHidden(p.id, p.hidden)}
                  className="btn btn-sm"
                >
                  {p.hidden ? "Show" : "Hide"}
                </button>
                <Link href={`/admin/products/${p.id}`} className="btn btn-sm">
                  Edit
                </Link>
                <button
                  onClick={() => remove(p.id)}
                  className="btn btn-sm bg-red-600 text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
