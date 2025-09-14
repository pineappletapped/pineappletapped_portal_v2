"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
} from "firebase/firestore";

interface Voucher {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  amount: number;
  productIds?: string[];
  categoryIds?: string[];
  locations?: string[];
}

export default function AdminVoucherCodesPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percentage" | "fixed">("percentage");
  const [amount, setAmount] = useState<number>(0);
  const [products, setProducts] = useState("");
  const [categories, setCategories] = useState("");
  const [locations, setLocations] = useState("");
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
      if (staff) await refresh();
      setLoading(false);
    })();
  }, []);

  const refresh = async () => {
    const snap = await getDocs(collection(db, "vouchers"));
    setVouchers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Voucher[]);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDoc(collection(db, "vouchers"), {
      code,
      type,
      amount,
      productIds: products
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      categoryIds: categories
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      locations: locations
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setCode("");
    setAmount(0);
    setProducts("");
    setCategories("");
    setLocations("");
    await refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this voucher?")) return;
    await deleteDoc(doc(db, "vouchers", id));
    await refresh();
  };

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to manage voucher codes.</p>;

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Voucher Codes</h1>

      <form onSubmit={create} className="grid gap-2 max-w-sm">
        <input
          className="input"
          placeholder="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <select
          className="input"
          value={type}
          onChange={(e) => setType(e.target.value as any)}
        >
          <option value="percentage">Percentage %</option>
          <option value="fixed">Fixed £</option>
        </select>
        <input
          className="input"
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          min={0}
          step={1}
          required
        />
        <input
          className="input"
          placeholder="Product IDs (comma separated)"
          value={products}
          onChange={(e) => setProducts(e.target.value)}
        />
        <input
          className="input"
          placeholder="Category IDs (comma separated)"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
        />
        <input
          className="input"
          placeholder="Locations (comma separated)"
          value={locations}
          onChange={(e) => setLocations(e.target.value)}
        />
        <button className="btn">Add Voucher</button>
      </form>

      <ul className="divide-y rounded border">
        {vouchers.map((v) => (
          <li key={v.id} className="p-2 text-sm">
            <div className="flex items-center justify-between">
              <span>
                {v.code} –
                {v.type === "percentage" ? ` ${v.amount}%` : ` £${v.amount}`}
              </span>
              <button
                onClick={() => remove(v.id)}
                className="text-xs text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
            <div className="text-xs text-gray-500">
              {(v.productIds && v.productIds.length > 0 && `Products: ${v.productIds.join(", ")}`) ||
                (v.categoryIds && v.categoryIds.length > 0 && `Categories: ${v.categoryIds.join(", ")}`) ||
                "All items"}
              {v.locations && v.locations.length > 0 && ` | Locations: ${v.locations.join(", ")}`}
            </div>
          </li>
        ))}
        {vouchers.length === 0 && (
          <li className="p-2 text-sm text-gray-500">No vouchers found.</li>
        )}
      </ul>
    </div>
  );
}

