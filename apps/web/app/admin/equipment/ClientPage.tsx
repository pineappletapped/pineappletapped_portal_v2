"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import type { Equipment, KitBag, EquipmentStandard } from "@/lib/equipment";

export default function AdminEquipmentPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [items, setItems] = useState<Equipment[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [carnetMode, setCarnetMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kitBags, setKitBags] = useState<KitBag[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [kitBagSearch, setKitBagSearch] = useState("");
  const [kitBagForm, setKitBagForm] = useState({
    name: "",
    description: "",
    itemIds: [] as string[],
    productIds: [] as string[],
    availableFrom: "",
    availableTo: "",
    availabilityNotes: "",
  });
  const [editingBagId, setEditingBagId] = useState<string | null>(null);
  const [showBagForm, setShowBagForm] = useState(false);
  const [bagError, setBagError] = useState<string | null>(null);
  const [bagSaving, setBagSaving] = useState(false);
  const [standards, setStandards] = useState<EquipmentStandard[]>([]);
  const [standardForm, setStandardForm] = useState({
    title: "",
    category: "",
    minimumSpec: "",
    description: "",
    requiresApproval: false,
  });
  const [editingStandardId, setEditingStandardId] = useState<string | null>(null);
  const [standardSaving, setStandardSaving] = useState(false);
  const [standardError, setStandardError] = useState<string | null>(null);
  const [showStandardForm, setShowStandardForm] = useState(false);

  const formatDate = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setAllowed(false); setLoading(false); return; }
      const snap = await getDoc(doc(db, "users", user.uid));
      const me = snap.data() as any;
      const ok = me?.isStaff || me?.contractor;
      setAllowed(!!ok);
      setIsStaff(!!me?.isStaff);
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
        try {
          if (me?.isStaff) {
            const [bagSnap, standardSnap, productSnap] = await Promise.all([
              getDocs(collection(db, "kitBags")),
              getDocs(collection(db, "equipmentStandards")),
              getDocs(collection(db, "products")),
            ]);
            setKitBags(
              (bagSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as KitBag[]).sort(
                (a, b) => (a.name || "").localeCompare(b.name || "")
              )
            );
            setStandards(
              (standardSnap.docs.map((d) => ({
                id: d.id,
                ...(d.data() as any),
              })) as EquipmentStandard[]).sort((a, b) =>
                (a.title || "").localeCompare(b.title || "")
              )
            );
            setProducts(
              productSnap.docs
                .map((d) => {
                  const data = d.data() as any;
                  return { id: d.id, name: data.name || d.id };
                })
                .sort((a, b) => a.name.localeCompare(b.name))
            );
          } else {
            const standardSnap = await getDocs(collection(db, "equipmentStandards"));
            setStandards(
              standardSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as EquipmentStandard[]
            );
          }
        } catch (err) {
          console.error("Failed to load kit metadata", err);
        }
      }
      setLoading(false);
    })();
  }, []);

  const equipmentLookup = useMemo(() => {
    const map = new Map<string, Equipment>();
    items.forEach((item) => {
      if (item.id) {
        map.set(item.id, item);
      }
    });
    return map;
  }, [items]);

  const standardLookup = useMemo(() => {
    const map = new Map<string, EquipmentStandard>();
    standards.forEach((standard) => {
      if (standard.id) {
        map.set(standard.id, standard);
      }
    });
    return map;
  }, [standards]);

  const productLookup = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((product) => {
      map.set(product.id, product.name);
    });
    return map;
  }, [products]);

  const filteredBagEquipment = useMemo(() => {
    const term = kitBagSearch.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      const name = item.name?.toLowerCase() || "";
      const serial = item.serialNumber?.toLowerCase() || "";
      const category = item.category?.toLowerCase() || "";
      return (
        name.includes(term) ||
        serial.includes(term) ||
        category.includes(term)
      );
    });
  }, [items, kitBagSearch]);

  const refreshKitBags = async () => {
    try {
      const bagSnap = await getDocs(collection(db, "kitBags"));
      setKitBags(
        (bagSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as KitBag[]).sort(
          (a, b) => (a.name || "").localeCompare(b.name || "")
        )
      );
    } catch (err) {
      console.error("Failed to refresh kit bags", err);
    }
  };

  const refreshStandards = async () => {
    try {
      const standardSnap = await getDocs(collection(db, "equipmentStandards"));
      setStandards(
        (standardSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as EquipmentStandard[]).sort((a, b) =>
          (a.title || "").localeCompare(b.title || "")
        )
      );
    } catch (err) {
      console.error("Failed to refresh equipment standards", err);
    }
  };

  const resetKitBagForm = () => {
    setKitBagForm({
      name: "",
      description: "",
      itemIds: [],
      productIds: [],
      availableFrom: "",
      availableTo: "",
      availabilityNotes: "",
    });
    setEditingBagId(null);
    setBagError(null);
  };

  const startCreateBag = () => {
    resetKitBagForm();
    setKitBagSearch("");
    setShowBagForm(true);
  };

  const editKitBag = (bag: KitBag) => {
    setKitBagForm({
      name: bag.name || "",
      description: bag.description || "",
      itemIds: Array.isArray(bag.itemIds) ? [...bag.itemIds] : [],
      productIds: Array.isArray(bag.assignedProductIds)
        ? [...bag.assignedProductIds]
        : [],
      availableFrom:
        typeof bag.availableFrom === "string" && bag.availableFrom
          ? bag.availableFrom
          : "",
      availableTo:
        typeof bag.availableTo === "string" && bag.availableTo
          ? bag.availableTo
          : "",
      availabilityNotes: bag.availabilityNotes || "",
    });
    setEditingBagId(bag.id || null);
    setBagError(null);
    setKitBagSearch("");
    setShowBagForm(true);
  };

  const toggleBagItem = (id: string) => {
    setKitBagForm((prev) => {
      const exists = prev.itemIds.includes(id);
      return {
        ...prev,
        itemIds: exists
          ? prev.itemIds.filter((itemId) => itemId !== id)
          : [...prev.itemIds, id],
      };
    });
  };

  const toggleBagProduct = (id: string) => {
    setKitBagForm((prev) => {
      const exists = prev.productIds.includes(id);
      return {
        ...prev,
        productIds: exists
          ? prev.productIds.filter((productId) => productId !== id)
          : [...prev.productIds, id],
      };
    });
  };

  const syncKitBagAssignments = async (
    bagId: string,
    bagName: string,
    itemIds: string[],
    nextProductIds: string[],
    previousProductIds: string[]
  ) => {
    if (!bagId) return;
    const uniqueItems = Array.from(new Set(itemIds.filter(Boolean)));
    const bagGroupId = `kitBag:${bagId}`;
    const removalTargets = previousProductIds.filter(
      (id) => !nextProductIds.includes(id)
    );

    await Promise.all(
      nextProductIds.map(async (productId) => {
        try {
          const productRef = doc(db, "products", productId);
          const snap = await getDoc(productRef);
          if (!snap.exists()) return;
          const data = snap.data() as any;
          const requiredKit = Array.isArray(data.requiredKit)
            ? [...data.requiredKit]
            : [];
          const payload = {
            groupId: bagGroupId,
            items: uniqueItems,
            label: bagName,
            kitBagId: bagId,
          };
          const existingIndex = requiredKit.findIndex(
            (group: any) =>
              group?.kitBagId === bagId || group?.groupId === bagGroupId
          );
          if (existingIndex >= 0) {
            requiredKit[existingIndex] = {
              ...requiredKit[existingIndex],
              ...payload,
            };
          } else {
            requiredKit.push(payload);
          }
          await updateDoc(productRef, { requiredKit });
        } catch (err) {
          console.error(`Failed to update product ${productId} with kit bag`, err);
        }
      })
    );

    await Promise.all(
      removalTargets.map(async (productId) => {
        try {
          const productRef = doc(db, "products", productId);
          const snap = await getDoc(productRef);
          if (!snap.exists()) return;
          const data = snap.data() as any;
          const requiredKit = Array.isArray(data.requiredKit)
            ? [...data.requiredKit]
            : [];
          const filteredKit = requiredKit.filter(
            (group: any) =>
              !(
                group?.kitBagId === bagId || group?.groupId === bagGroupId
              )
          );
          if (filteredKit.length === requiredKit.length) return;
          await updateDoc(productRef, { requiredKit: filteredKit });
        } catch (err) {
          console.error(`Failed to remove kit bag from product ${productId}`, err);
        }
      })
    );
  };

  const saveKitBag = async (event: FormEvent) => {
    event.preventDefault();
    const name = kitBagForm.name.trim();
    const uniqueItems = Array.from(new Set(kitBagForm.itemIds.filter(Boolean)));
    const productIds = Array.from(new Set(kitBagForm.productIds.filter(Boolean)));
    const fromValue = kitBagForm.availableFrom.trim();
    const toValue = kitBagForm.availableTo.trim();
    const fromTime = fromValue ? Date.parse(fromValue) : NaN;
    const toTime = toValue ? Date.parse(toValue) : NaN;
    if (!name) {
      setBagError("Kit bags need a name.");
      return;
    }
    if (!uniqueItems.length) {
      setBagError("Select at least one piece of kit for this bag.");
      return;
    }
    if (fromValue && Number.isNaN(fromTime)) {
      setBagError("Enter a valid availability start date.");
      return;
    }
    if (toValue && Number.isNaN(toTime)) {
      setBagError("Enter a valid availability end date.");
      return;
    }
    if (!Number.isNaN(fromTime) && !Number.isNaN(toTime) && fromTime > toTime) {
      setBagError("The availability start date must be before the end date.");
      return;
    }
    setBagError(null);
    setBagSaving(true);
    try {
      const payload: any = {
        name,
        description: kitBagForm.description.trim() || null,
        itemIds: uniqueItems,
        assignedProductIds: productIds,
        availableFrom: fromValue || null,
        availableTo: toValue || null,
        availabilityNotes: kitBagForm.availabilityNotes.trim() || null,
        updatedAt: new Date(),
      };
      let bagId = editingBagId;
      if (!bagId) {
        const newDoc = doc(collection(db, "kitBags"));
        await setDoc(newDoc, { ...payload, createdAt: new Date() });
        bagId = newDoc.id;
      } else {
        await updateDoc(doc(db, "kitBags", bagId), payload);
      }
      await syncKitBagAssignments(
        bagId!,
        name,
        uniqueItems,
        productIds,
        editingBagId
          ? kitBags.find((bag) => bag.id === editingBagId)?.assignedProductIds || []
          : []
      );
      await refreshKitBags();
      resetKitBagForm();
      setShowBagForm(false);
    } catch (err) {
      console.error("Failed to save kit bag", err);
      setBagError("We couldn't save this kit bag. Please try again.");
    } finally {
      setBagSaving(false);
    }
  };

  const removeKitBag = async (bag: KitBag) => {
    if (!bag.id) return;
    if (!confirm("Delete this kit bag? Products assigned to it will lose the bag."))
      return;
    try {
      await syncKitBagAssignments(
        bag.id,
        bag.name,
        [],
        [],
        bag.assignedProductIds || []
      );
      await deleteDoc(doc(db, "kitBags", bag.id));
      await refreshKitBags();
      if (editingBagId === bag.id) {
        resetKitBagForm();
        setShowBagForm(false);
      }
    } catch (err) {
      console.error("Failed to delete kit bag", err);
      setBagError("Failed to delete kit bag. Please try again.");
    }
  };

  const resetStandardForm = () => {
    setStandardForm({
      title: "",
      category: "",
      minimumSpec: "",
      description: "",
      requiresApproval: false,
    });
    setEditingStandardId(null);
    setStandardError(null);
  };

  const startCreateStandard = () => {
    resetStandardForm();
    setShowStandardForm(true);
  };

  const editStandard = (standard: EquipmentStandard) => {
    setEditingStandardId(standard.id || null);
    setStandardForm({
      title: standard.title || "",
      category: standard.category || "",
      minimumSpec: standard.minimumSpec || "",
      description: standard.description || "",
      requiresApproval: !!standard.requiresApproval,
    });
    setShowStandardForm(true);
  };

  const cancelStandardForm = () => {
    resetStandardForm();
    setShowStandardForm(false);
  };

  const saveStandard = async (event: FormEvent) => {
    event.preventDefault();
    const title = standardForm.title.trim();
    if (!title) {
      setStandardError("Standards need a name.");
      return;
    }
    setStandardSaving(true);
    setStandardError(null);
    try {
      const payload: any = {
        title,
        category: standardForm.category.trim() || null,
        minimumSpec: standardForm.minimumSpec.trim() || null,
        description: standardForm.description.trim() || null,
        requiresApproval: !!standardForm.requiresApproval,
        updatedAt: new Date(),
      };
      let standardId = editingStandardId;
      if (!standardId) {
        const newDoc = doc(collection(db, "equipmentStandards"));
        await setDoc(newDoc, { ...payload, createdAt: new Date() });
        standardId = newDoc.id;
      } else {
        await updateDoc(doc(db, "equipmentStandards", standardId), payload);
      }
      await refreshStandards();
      resetStandardForm();
      setShowStandardForm(false);
    } catch (err) {
      console.error("Failed to save equipment standard", err);
      setStandardError("We couldn't save this standard. Please try again.");
    } finally {
      setStandardSaving(false);
    }
  };

  const removeStandard = async (standard: EquipmentStandard) => {
    if (!standard.id) return;
    if (!confirm("Delete this standard? Kit marked against it will lose the label."))
      return;
    try {
      await deleteDoc(doc(db, "equipmentStandards", standard.id));
      await refreshStandards();
      if (editingStandardId === standard.id) {
        cancelStandardForm();
      }
      setItems((prev) =>
        prev.map((item) => {
          if (!Array.isArray(item.meetsStandards)) return item;
          if (!item.meetsStandards.includes(standard.id!)) return item;
          return {
            ...item,
            meetsStandards: item.meetsStandards.filter(
              (value) => value !== standard.id
            ),
          } as Equipment;
        })
      );
    } catch (err) {
      console.error("Failed to delete equipment standard", err);
      setStandardError("Failed to delete this standard. Please try again.");
    }
  };

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
    const headers = [
      "id",
      "name",
      "serialNumber",
      "category",
      "ownerId",
      "newValue",
      "currentValue",
      "rentalPrice",
      "length",
      "available",
      "meetsStandards",
    ];
    const rows = filtered.map((item) =>
      headers
        .map((header) => {
          if (header === "meetsStandards") {
            return Array.isArray(item.meetsStandards)
              ? item.meetsStandards.join("|")
              : "";
          }
          const value = (item as any)[header];
          return value == null ? "" : value;
        })
        .join(",")
    );
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
          <table className="w-full min-w-[760px] text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                {carnetMode && <th className="p-2"></th>}
                <th className="p-2">Name</th>
                <th className="p-2">Serial</th>
                <th className="p-2">Category</th>
                <th className="p-2">Owner</th>
                <th className="p-2">Standards</th>
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
                  <td className="p-2">
                    {Array.isArray(item.meetsStandards) && item.meetsStandards.length ? (
                      <ul className="flex flex-wrap gap-1">
                        {item.meetsStandards.map((standardId) => (
                          <li key={`${item.id}-${standardId}`}>
                            <span className="inline-flex items-center rounded bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                              {standardLookup.get(standardId)?.title || standardId}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-gray-500">None</span>
                    )}
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

      {isStaff && (
        <section className="space-y-4 border-t pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Kit bags</h2>
              <p className="text-sm text-gray-600">
                Build reusable packs of equipment and attach them to multiple
                products without rebuilding every time.
              </p>
            </div>
            <button className="btn self-start" onClick={startCreateBag}>
              New kit bag
            </button>
          </div>
          {bagError && <p className="text-sm text-red-600">{bagError}</p>}
          {showBagForm && (
            <form
              onSubmit={saveKitBag}
              className="space-y-4 rounded border p-4"
            >
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="kit-bag-name">
                  Bag name
                </label>
                <input
                  id="kit-bag-name"
                  className="input input-bordered"
                  value={kitBagForm.name}
                  onChange={(e) =>
                    setKitBagForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. Interview essentials"
                  required
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="kit-bag-description">
                  Description (optional)
                </label>
                <textarea
                  id="kit-bag-description"
                  className="textarea textarea-bordered"
                  value={kitBagForm.description}
                  onChange={(e) =>
                    setKitBagForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  placeholder="Note any assumptions or accessories included"
                  rows={3}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="kit-bag-available-from">
                    Available from (optional)
                  </label>
                  <input
                    id="kit-bag-available-from"
                    type="date"
                    className="input input-bordered"
                    value={kitBagForm.availableFrom}
                    onChange={(e) =>
                      setKitBagForm((prev) => ({
                        ...prev,
                        availableFrom: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium" htmlFor="kit-bag-available-to">
                    Available until (optional)
                  </label>
                  <input
                    id="kit-bag-available-to"
                    type="date"
                    className="input input-bordered"
                    value={kitBagForm.availableTo}
                    onChange={(e) =>
                      setKitBagForm((prev) => ({
                        ...prev,
                        availableTo: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="kit-bag-availability-notes"
                >
                  Availability notes (optional)
                </label>
                <textarea
                  id="kit-bag-availability-notes"
                  className="textarea textarea-bordered"
                  value={kitBagForm.availabilityNotes}
                  onChange={(e) =>
                    setKitBagForm((prev) => ({
                      ...prev,
                      availabilityNotes: e.target.value,
                    }))
                  }
                  placeholder="Blackout periods, lead times, or other scheduling details"
                  rows={2}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Included equipment
                  </label>
                  <input
                    value={kitBagSearch}
                    onChange={(e) => setKitBagSearch(e.target.value)}
                    className="input input-bordered input-sm w-48"
                    placeholder="Search kit"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded border p-2">
                  {filteredBagEquipment.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No matching equipment available.
                    </p>
                  ) : (
                    <ul className="grid gap-1">
                      {filteredBagEquipment.map((item) => (
                        <li key={`bag-item-${item.id}`}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={kitBagForm.itemIds.includes(item.id!)}
                              onChange={() => toggleBagItem(item.id!)}
                            />
                            <span>
                              {item.name}
                              <span className="text-xs text-gray-500">
                                {item.category ? ` • ${item.category}` : ""}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  Selected items will sync to every product assigned to this
                  bag.
                </p>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Assign to products</span>
                <div className="max-h-48 overflow-y-auto rounded border p-2">
                  {products.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No products available yet.
                    </p>
                  ) : (
                    <ul className="grid gap-1">
                      {products.map((product) => (
                        <li key={`bag-product-${product.id}`}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={kitBagForm.productIds.includes(product.id)}
                              onChange={() => toggleBagProduct(product.id)}
                            />
                            <span>{product.name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  Assigned products automatically receive this bag as a kit
                  group.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn" type="submit" disabled={bagSaving}>
                  {bagSaving
                    ? "Saving bag..."
                    : editingBagId
                    ? "Update kit bag"
                    : "Save kit bag"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    resetKitBagForm();
                    setShowBagForm(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {kitBags.length === 0 ? (
              <p className="text-sm text-gray-600">
                No kit bags defined yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {kitBags.map((bag) => {
                  const itemNames = Array.isArray(bag.itemIds)
                    ? bag.itemIds.map(
                        (id) => equipmentLookup.get(id)?.name || id
                      )
                    : [];
                  const productNames = Array.isArray(bag.assignedProductIds)
                    ? bag.assignedProductIds
                        .map((id) => productLookup.get(id) || id)
                        .filter(Boolean)
                    : [];
                  const availableFromLabel = formatDate(
                    typeof bag.availableFrom === "string" ? bag.availableFrom : null
                  );
                  const availableToLabel = formatDate(
                    typeof bag.availableTo === "string" ? bag.availableTo : null
                  );
                  return (
                    <li key={bag.id} className="rounded border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div>
                            <h3 className="font-medium">{bag.name}</h3>
                            {bag.description && (
                              <p className="text-sm text-gray-600">
                                {bag.description}
                              </p>
                            )}
                            {(availableFromLabel || availableToLabel) && (
                              <p className="text-xs text-gray-500">
                                Availability: {availableFromLabel ? `from ${availableFromLabel}` : "Immediate"}
                                {availableToLabel ? ` until ${availableToLabel}` : ""}
                              </p>
                            )}
                            {bag.availabilityNotes && (
                              <p className="text-xs text-gray-500">
                                {bag.availabilityNotes}
                              </p>
                            )}
                          </div>
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">Items:</span>{" "}
                            {itemNames.length ? itemNames.join(", ") : "None"}
                          </div>
                          <div className="text-sm text-gray-600">
                            <span className="font-medium">Assigned to:</span>{" "}
                            {productNames.length
                              ? productNames.join(", ")
                              : "No products yet"}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => editKitBag(bag)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm text-red-600"
                            onClick={() => removeKitBag(bag)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}

      {isStaff && (
        <section className="space-y-4 border-t pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Equipment standards</h2>
              <p className="text-sm text-gray-600">
                Set minimum capability guidelines so contractors can self-certify
                their kit against the requirements.
              </p>
            </div>
            <button className="btn self-start" onClick={startCreateStandard}>
              New standard
            </button>
          </div>
          {standardError && (
            <p className="text-sm text-red-600">{standardError}</p>
          )}
          {showStandardForm && (
            <form
              onSubmit={saveStandard}
              className="space-y-4 rounded border p-4"
            >
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="standard-title">
                  Standard name
                </label>
                <input
                  id="standard-title"
                  className="input input-bordered"
                  value={standardForm.title}
                  onChange={(e) =>
                    setStandardForm((prev) => ({
                      ...prev,
                      title: e.target.value,
                    }))
                  }
                  placeholder="e.g. 4K-capable camera body"
                  required
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="standard-category"
                  >
                    Category
                  </label>
                  <input
                    id="standard-category"
                    className="input input-bordered"
                    value={standardForm.category}
                    onChange={(e) =>
                      setStandardForm((prev) => ({
                        ...prev,
                        category: e.target.value,
                      }))
                    }
                    placeholder="Camera, audio, lighting..."
                  />
                </div>
                <div className="grid gap-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="standard-minimum"
                  >
                    Minimum specification
                  </label>
                  <input
                    id="standard-minimum"
                    className="input input-bordered"
                    value={standardForm.minimumSpec}
                    onChange={(e) =>
                      setStandardForm((prev) => ({
                        ...prev,
                        minimumSpec: e.target.value,
                      }))
                    }
                    placeholder="e.g. Records 4K at 50fps"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="standard-description"
                >
                  Guidance (optional)
                </label>
                <textarea
                  id="standard-description"
                  className="textarea textarea-bordered"
                  value={standardForm.description}
                  onChange={(e) =>
                    setStandardForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  rows={3}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={standardForm.requiresApproval}
                  onChange={(e) =>
                    setStandardForm((prev) => ({
                      ...prev,
                      requiresApproval: e.target.checked,
                    }))
                  }
                />
                Requires staff approval after self-certification
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn"
                  type="submit"
                  disabled={standardSaving}
                >
                  {standardSaving
                    ? "Saving standard..."
                    : editingStandardId
                    ? "Update standard"
                    : "Save standard"}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={cancelStandardForm}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            {standards.length === 0 ? (
              <p className="text-sm text-gray-600">
                No standards defined yet.
              </p>
            ) : (
              <table className="w-full min-w-[720px] text-sm border">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-2">Name</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Minimum spec</th>
                    <th className="p-2">Approval</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {standards.map((standard) => (
                    <tr key={standard.id} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">{standard.title}</div>
                        {standard.description && (
                          <p className="text-xs text-gray-600">
                            {standard.description}
                          </p>
                        )}
                      </td>
                      <td className="p-2">{standard.category || "—"}</td>
                      <td className="p-2">{standard.minimumSpec || "—"}</td>
                      <td className="p-2">
                        {standard.requiresApproval ? "Requires approval" : "Self certify"}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => editStandard(standard)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm text-red-600"
                            onClick={() => removeStandard(standard)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
