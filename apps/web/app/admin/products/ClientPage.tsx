"use client";

import Image from "next/image";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  setDoc,
} from "firebase/firestore";
import Papa from "papaparse";
import type { Product } from "@/lib/products";
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
  const [driveRootId, setDriveRootId] = useState("");
  const [driveBrandingName, setDriveBrandingName] = useState("Branding Assets");
  const [driveOrdersName, setDriveOrdersName] = useState("Projects");
  const [driveBrandingTemplateId, setDriveBrandingTemplateId] = useState("");
  const [driveHqEmails, setDriveHqEmails] = useState("");
  const [driveSaving, setDriveSaving] = useState(false);
  const [driveNotice, setDriveNotice] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);

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
      const driveSnap = await getDoc(doc(db, "settings", "clientDrive"));
      if (driveSnap.exists()) {
        const data = driveSnap.data() as any;
        setDriveRootId(
          typeof data.clientRootFolderId === "string" ? data.clientRootFolderId : ""
        );
        setDriveBrandingName(
          typeof data.brandingFolderName === "string" && data.brandingFolderName.trim().length > 0
            ? data.brandingFolderName
            : "Branding Assets"
        );
        setDriveOrdersName(
          typeof data.ordersFolderName === "string" && data.ordersFolderName.trim().length > 0
            ? data.ordersFolderName
            : "Projects"
        );
        setDriveBrandingTemplateId(
          typeof data.brandingTemplateFolderId === "string"
            ? data.brandingTemplateFolderId
            : ""
        );
        const emails = Array.isArray(data.hqEmails)
          ? data.hqEmails
              .map((value: unknown) =>
                typeof value === "string" ? value.trim() : ""
              )
              .filter((value: string) => value.length > 0)
          : [];
        setDriveHqEmails(emails.join(", "));
      } else {
        setDriveRootId("");
        setDriveBrandingTemplateId("");
        setDriveHqEmails("");
        setDriveBrandingName("Branding Assets");
        setDriveOrdersName("Projects");
      }
      setDriveNotice(null);
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  const saveDriveSettings = async () => {
    setDriveSaving(true);
    setDriveNotice(null);
    try {
      const emails = driveHqEmails
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
      await setDoc(
        doc(db, "settings", "clientDrive"),
        {
          clientRootFolderId:
            driveRootId.trim().length > 0 ? driveRootId.trim() : null,
          brandingFolderName:
            driveBrandingName.trim().length > 0 ? driveBrandingName.trim() : null,
          ordersFolderName:
            driveOrdersName.trim().length > 0 ? driveOrdersName.trim() : null,
          brandingTemplateFolderId:
            driveBrandingTemplateId.trim().length > 0
              ? driveBrandingTemplateId.trim()
              : null,
          hqEmails: emails,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      setDriveNotice({
        tone: "success",
        text: "Drive automation settings updated.",
      });
    } catch (error) {
      console.error("Failed to save drive settings", error);
      setDriveNotice({
        tone: "error",
        text: "Failed to save Drive automation settings. Please try again.",
      });
    } finally {
      setDriveSaving(false);
    }
  };

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

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage products.</p>;

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
      <section className="rounded border bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Client Drive automation</h2>
            <p className="text-xs text-gray-600">
              Configure the Google Drive folders that new client orders should use for
              automatic provisioning.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={saveDriveSettings}
            disabled={driveSaving}
          >
            {driveSaving ? "Saving…" : "Save settings"}
          </button>
        </div>
        <div className="mt-3 grid gap-3">
          <label className="text-xs font-medium text-gray-600">
            Client root folder ID
          </label>
          <input
            className="input"
            placeholder="Drive folder ID (required)"
            value={driveRootId}
            onChange={(event) => setDriveRootId(event.target.value)}
          />
          {driveRootId.trim().length > 0 && (
            <a
              className="text-xs text-blue-600 underline"
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(
                driveRootId.trim()
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Open root folder
            </a>
          )}
          <label className="text-xs font-medium text-gray-600">
            Branding folder name
          </label>
          <input
            className="input"
            placeholder="Branding Assets"
            value={driveBrandingName}
            onChange={(event) => setDriveBrandingName(event.target.value)}
          />
          <label className="text-xs font-medium text-gray-600">
            Orders/projects folder name
          </label>
          <input
            className="input"
            placeholder="Projects"
            value={driveOrdersName}
            onChange={(event) => setDriveOrdersName(event.target.value)}
          />
          <label className="text-xs font-medium text-gray-600">
            Branding template folder ID (optional)
          </label>
          <input
            className="input"
            placeholder="Folder ID for branding defaults"
            value={driveBrandingTemplateId}
            onChange={(event) => setDriveBrandingTemplateId(event.target.value)}
          />
          {driveBrandingTemplateId.trim().length > 0 && (
            <a
              className="text-xs text-blue-600 underline"
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(
                driveBrandingTemplateId.trim()
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              View branding template
            </a>
          )}
          <label className="text-xs font-medium text-gray-600">
            HQ emails with default access (comma separated)
          </label>
          <textarea
            className="input min-h-[4rem]"
            placeholder="hq@example.com, ops@example.com"
            value={driveHqEmails}
            onChange={(event) => setDriveHqEmails(event.target.value)}
          />
          {driveNotice && (
            <p
              className={`text-xs ${
                driveNotice.tone === "success" ? "text-green-600" : "text-red-600"
              }`}
            >
              {driveNotice.text}
            </p>
          )}
        </div>
      </section>
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
                  onClick={() => duplicate(p)}
                  className="btn btn-sm"
                >
                  Duplicate
                </button>
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
