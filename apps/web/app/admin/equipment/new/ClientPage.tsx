"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, storage } from "@/lib/firebase";
import { collection, addDoc, getDocs, getDoc, doc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import type { EquipmentStandard } from "@/lib/equipment";

export default function NewEquipmentPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [franchises, setFranchises] = useState<{ id: string; name: string }[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [standards, setStandards] = useState<EquipmentStandard[]>([]);
  const [form, setForm] = useState({
    name: "",
    serialNumber: "",
    assetTag: "",
    category: "",
    ownerId: "company",
    ownerType: "company" as "company" | "user" | "franchise",
    franchiseId: "",
    newValue: "",
    currentValue: "",
    rentalPrice: "",
    description: "",
    weightKg: "",
    length: "",
    manualUrl: "",
    notes: "",
    damage: "",
    config: { username: "", password: "", ip: "", firmware: "", lastServiced: "" },
    available: true,
    meetsStandards: [] as string[],
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setAllowed(false); return; }
      const snap = await getDoc(doc(db, "users", user.uid));
      const me = snap.data() as any;
      const ok = me?.isStaff || me?.contractor;
      setAllowed(!!ok);
      setIsStaff(!!me?.isStaff);
      if (ok) {
        const uSnap = await getDocs(collection(db, "users"));
        const list = uSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((u) => u.isStaff || u.contractor);
        setUsers(list);
        if (!me?.isStaff) {
          setForm((f) => ({ ...f, ownerId: user.uid, ownerType: "user" }));
        }
        try {
          const basePromises = [
            getDocs(collection(db, "equipment")),
            getDocs(collection(db, "equipmentStandards")),
          ] as const;
          const results = await Promise.all(
            me?.isStaff
              ? [...basePromises, getDocs(collection(db, "franchises"))]
              : basePromises
          );
          const equipmentSnap = results[0];
          const standardSnap = results[1];
          const franchiseSnap = me?.isStaff ? results[2] : undefined;
          const categorySet = new Set<string>();
          equipmentSnap.docs.forEach((docSnap) => {
            const rawCategory = (docSnap.data() as any)?.category;
            if (typeof rawCategory === "string") {
              const trimmed = rawCategory.trim();
              if (trimmed) categorySet.add(trimmed);
            }
          });
          setCategories(Array.from(categorySet).sort((a, b) => a.localeCompare(b)));
          setStandards(
            standardSnap.docs
              .map(
                (d) =>
                  ({
                    id: d.id,
                    ...(d.data() as any),
                  } as EquipmentStandard)
              )
              .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
          );
          if (franchiseSnap) {
            setFranchises(
              franchiseSnap.docs
                .map((docSnap) => {
                  const data = docSnap.data() as any;
                  const rawName = typeof data?.name === "string" ? data.name.trim() : "";
                  return { id: docSnap.id, name: rawName || docSnap.id };
                })
                .sort((a, b) => a.name.localeCompare(b.name))
            );
          }
        } catch (error) {
          console.error("Failed to load equipment metadata", error);
        }
      }
    })();
  }, []);

  const defaultFranchiseId = useMemo(() => franchises[0]?.id ?? "", [franchises]);

  const toggleStandard = (standardId: string) => {
    setForm((prev) => {
      const current = Array.isArray(prev.meetsStandards)
        ? prev.meetsStandards
        : [];
      const exists = current.includes(standardId);
      return {
        ...prev,
        meetsStandards: exists
          ? current.filter((id) => id !== standardId)
          : [...current, standardId],
      };
    });
  };

  const submit = async () => {
    setLoading(true);
    try {
      const ownerType = form.ownerType;
      let ownerId = "company";
      let franchiseId: string | null = null;
      if (ownerType === "company") {
        ownerId = "company";
      } else if (ownerType === "user") {
        if (!form.ownerId) {
          alert("Select the team member who owns this equipment.");
          setLoading(false);
          return;
        }
        ownerId = form.ownerId;
      } else {
        const selectedFranchiseId = form.franchiseId || defaultFranchiseId;
        if (!selectedFranchiseId) {
          alert("Select the franchise that owns this equipment.");
          setLoading(false);
          return;
        }
        franchiseId = selectedFranchiseId;
        ownerId = `franchise:${selectedFranchiseId}`;
      }

      let photoUrl = "";
      if (photoFile) {
        const r = ref(storage, `equipment/${Date.now()}-${photoFile.name}`);
        await uploadBytes(r, photoFile);
        photoUrl = await getDownloadURL(r);
      }
      const category = form.category.trim();
      const meetsStandards = Array.isArray(form.meetsStandards)
        ? Array.from(
            new Set(
              form.meetsStandards
                .map((id) => (typeof id === "string" ? id.trim() : ""))
                .filter((id) => id.length > 0)
            )
          )
        : [];
      const data: any = {
        ...form,
        category,
        meetsStandards,
        newValue: parseFloat(form.newValue) || 0,
        currentValue: parseFloat(form.currentValue) || 0,
        rentalPrice: parseFloat(form.rentalPrice) || 0,
        weightKg: parseFloat(form.weightKg) || 0,
        photo: photoUrl,
        createdAt: new Date(),
        available: form.available,
        ownerType,
        ownerId,
        franchiseId,
        assetTag: form.assetTag.trim() ? form.assetTag.trim() : null,
      };
      const docRef = await addDoc(collection(db, "equipment"), data);
      router.push(`/admin/equipment/${docRef.id}`);
    } catch (err) {
      console.error("Failed to create equipment", err);
    }
    setLoading(false);
  };

  if (allowed === null) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to add equipment.</p>;

  return (
    <div className="grid gap-4 max-w-2xl">
      <h1 className="text-xl font-semibold">Add Equipment</h1>
      <input className="input input-bordered" placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />
      <input className="input input-bordered" placeholder="Serial Number" value={form.serialNumber} onChange={e=>setForm({...form,serialNumber:e.target.value})} />
      <input className="input input-bordered" placeholder="Asset Tag" value={form.assetTag} onChange={e=>setForm({...form,assetTag:e.target.value})} />
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="equipment-category">
          Category
        </label>
        <input
          id="equipment-category"
          className="input input-bordered"
          list="equipment-category-options"
          placeholder="Select an existing category or enter a new one"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
        />
        <datalist id="equipment-category-options">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        {categories.length === 0 && (
          <p className="text-xs text-gray-500">
            No categories yet — start typing to create one.
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">Owner type</span>
        <select
          className="select select-bordered"
          value={form.ownerType}
          onChange={(event) => {
            const nextType = event.target.value as "company" | "user" | "franchise";
            setForm((prev) => {
              if (nextType === "company") {
                return { ...prev, ownerType: nextType, ownerId: "company", franchiseId: "" };
              }
              if (nextType === "user") {
                const defaultOwner = prev.ownerId && users.some((user) => user.id === prev.ownerId)
                  ? prev.ownerId
                  : users[0]?.id || "";
                return { ...prev, ownerType: nextType, ownerId: defaultOwner, franchiseId: "" };
              }
              const fallbackFranchise = prev.franchiseId || defaultFranchiseId;
              return {
                ...prev,
                ownerType: nextType,
                franchiseId: fallbackFranchise,
                ownerId: fallbackFranchise ? `franchise:${fallbackFranchise}` : "",
              };
            });
          }}
          disabled={!isStaff}
        >
          <option value="company">Pineapple Tapped</option>
          <option value="user">Team member</option>
          <option value="franchise">Franchise</option>
        </select>
        {!isStaff && (
          <span className="text-xs text-gray-500">Only HQ can reassign owner type.</span>
        )}
      </div>
      {form.ownerType === "user" && (
        <select
          className="select select-bordered"
          value={form.ownerId}
          onChange={(event) => setForm({ ...form, ownerId: event.target.value })}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
          ))}
        </select>
      )}
      {form.ownerType === "franchise" && (
        <select
          className="select select-bordered"
          value={form.franchiseId}
          onChange={(event) => {
            const value = event.target.value;
            setForm((prev) => ({
              ...prev,
              franchiseId: value,
              ownerId: value ? `franchise:${value}` : "",
            }));
          }}
        >
          <option value="">Select franchise…</option>
          {franchises.map((franchise) => (
            <option key={franchise.id} value={franchise.id}>{franchise.name}</option>
          ))}
        </select>
      )}
      <input className="input input-bordered" placeholder="New Value" type="number" value={form.newValue} onChange={e=>setForm({...form,newValue:e.target.value})} />
      <input className="input input-bordered" placeholder="Current Value" type="number" value={form.currentValue} onChange={e=>setForm({...form,currentValue:e.target.value})} />
      <input className="input input-bordered" placeholder="Rental Price per Day" type="number" value={form.rentalPrice} onChange={e=>setForm({...form,rentalPrice:e.target.value})} />
      <textarea className="textarea textarea-bordered" placeholder="Description" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} />
      <input className="input input-bordered" placeholder="Weight (kg)" type="number" value={form.weightKg} onChange={e=>setForm({...form,weightKg:e.target.value})} />
      <input className="input input-bordered" placeholder="Length (for cables)" value={form.length} onChange={e=>setForm({...form,length:e.target.value})} />
      <input className="input input-bordered" placeholder="Manual / Instructions URL" value={form.manualUrl} onChange={e=>setForm({...form,manualUrl:e.target.value})} />
      <textarea className="textarea textarea-bordered" placeholder="Notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
      <textarea className="textarea textarea-bordered" placeholder="Damage Notes" value={form.damage} onChange={e=>setForm({...form,damage:e.target.value})} />
      <div className="grid gap-2">
        <span className="text-sm font-medium">Equipment standards</span>
        {standards.length === 0 ? (
          <p className="text-xs text-gray-500">
            No standards defined yet. Create standards in the equipment register to make them available here.
          </p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded border p-3">
            <ul className="grid gap-2">
              {standards.map((standard) => {
                if (!standard.id) return null;
                const checked = form.meetsStandards.includes(standard.id);
                return (
                  <li key={standard.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStandard(standard.id!)}
                      />
                      <span>
                        <span className="font-medium">{standard.title || "Untitled standard"}</span>
                        {standard.minimumSpec && (
                          <span className="block text-xs text-gray-500">{standard.minimumSpec}</span>
                        )}
                        {standard.description && (
                          <span className="block text-xs text-gray-500">{standard.description}</span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.available} onChange={e=>setForm({...form,available:e.target.checked})} /> Available for rental</label>
      <input className="input input-bordered" placeholder="Config Username" value={form.config.username} onChange={e=>setForm({...form,config:{...form.config,username:e.target.value}})} />
      <input className="input input-bordered" placeholder="Config Password" value={form.config.password} onChange={e=>setForm({...form,config:{...form.config,password:e.target.value}})} />
      <input className="input input-bordered" placeholder="IP Address" value={form.config.ip} onChange={e=>setForm({...form,config:{...form.config,ip:e.target.value}})} />
      <input className="input input-bordered" placeholder="Firmware Version" value={form.config.firmware} onChange={e=>setForm({...form,config:{...form.config,firmware:e.target.value}})} />
      <input className="input input-bordered" placeholder="Last Serviced" value={form.config.lastServiced} onChange={e=>setForm({...form,config:{...form.config,lastServiced:e.target.value}})} />
      <input type="file" onChange={e=>setPhotoFile(e.target.files?.[0] || null)} />
      <button onClick={submit} className="btn" disabled={loading}>{loading ? 'Saving...' : 'Save'}</button>
    </div>
  );
}
