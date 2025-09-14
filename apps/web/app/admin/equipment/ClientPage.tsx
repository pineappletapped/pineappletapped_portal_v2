"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs, doc, getDoc, query, where } from "firebase/firestore";
import type { Equipment } from "@/lib/equipment";

export default function AdminEquipmentPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [items, setItems] = useState<Equipment[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [carnetMode, setCarnetMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setAllowed(false); setLoading(false); return; }
      const snap = await getDoc(doc(db, "users", user.uid));
      const me = snap.data() as any;
      const ok = me?.isStaff || me?.contractor;
      setAllowed(!!ok);
      if (ok) {
        const uSnap = await getDocs(collection(db, "users"));
        const list = uSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(u => u.isStaff || u.contractor);
        setUsers(list);
        let eqSnap;
        if (me?.isStaff) {
          eqSnap = await getDocs(collection(db, "equipment"));
        } else {
          eqSnap = await getDocs(query(collection(db, "equipment"), where("ownerId", "==", user.uid)));
        }
        setItems(eqSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Equipment[]);
      }
      setLoading(false);
    })();
  }, []);

  const filtered = items.filter((i) => {
    const matchSearch = !search ||
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.serialNumber.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !categoryFilter || i.category === categoryFilter;
    const matchOwner = !ownerFilter || i.ownerId === ownerFilter || (ownerFilter === "company" && i.ownerId === "company");
    return matchSearch && matchCategory && matchOwner;
  });

  const totalItems = filtered.length;
  const totalNew = filtered.reduce((sum, i) => sum + (i.newValue || 0), 0);
  const totalCurrent = filtered.reduce((sum, i) => sum + (i.currentValue || 0), 0);

  const exportCsv = () => {
    const headers = ["id","name","serialNumber","category","ownerId","newValue","currentValue","rentalPrice","length","available"];
    const rows = filtered.map(i => headers.map(h => (i as any)[h] ?? "").join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "equipment.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportCarnet = () => {
    const headers = ["name","description","weightKg","serialNumber","currentValue"];
    const rows = filtered
      .filter(i => selected.has(i.id!))
      .map(i => headers.map(h => (i as any)[h] ?? "").join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "carnet.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view equipment.</p>;

  const categories = Array.from(new Set(items.map((i) => i.category))).sort();

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Equipment Register</h1>

      <div className="flex gap-4 flex-wrap">
        <div>Total Items: {totalItems}</div>
        <div>Total New Value: £{totalNew.toFixed(2)}</div>
        <div>Total Current Value: £{totalCurrent.toFixed(2)}</div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <input
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input input-bordered"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="select select-bordered"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="select select-bordered"
        >
          <option value="">All Owners</option>
          <option value="company">Pineapple Tapped</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
          ))}
        </select>
        {carnetMode ? (
          <>
            <span>{selected.size} selected</span>
            <button onClick={exportCarnet} className="btn btn-outline">Download Carnet CSV</button>
            <button onClick={()=>{setCarnetMode(false); setSelected(new Set());}} className="btn btn-outline">Cancel</button>
          </>
        ) : (
          <>
            <button onClick={exportCsv} className="btn btn-outline">Export CSV</button>
            <button onClick={()=>setCarnetMode(true)} className="btn btn-outline">Build Carnet</button>
            <Link href="/admin/equipment/new" className="btn">Add Item</Link>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <p>No equipment found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                {carnetMode && <th className="p-2"></th>}
                <th className="p-2">Name</th>
                <th className="p-2">Serial</th>
                <th className="p-2">Category</th>
                <th className="p-2">Owner</th>
                <th className="p-2">Current Value</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t">
                  {carnetMode && (
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id!)}
                        onChange={() => toggleSelect(item.id!)}
                      />
                    </td>
                  )}
                  <td className="p-2">{item.name}</td>
                  <td className="p-2">{item.serialNumber}</td>
                  <td className="p-2">{item.category}</td>
                  <td className="p-2">
                    {item.ownerId === 'company'
                      ? 'Pineapple Tapped'
                      : users.find(u => u.id === item.ownerId)?.fullName || item.ownerId}
                  </td>
                  <td className="p-2">£{(item.currentValue || 0).toFixed(2)}</td>
                  <td className="p-2">
                    <Link href={`/admin/equipment/${item.id}`} className="text-orange">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
