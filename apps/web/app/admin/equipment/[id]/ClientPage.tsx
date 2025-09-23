"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, db, storage } from "@/lib/firebase";
import { doc, getDoc, updateDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import Calendar from "react-calendar";
import type { EquipmentBooking, EquipmentStandard } from "@/lib/equipment";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function EquipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [standards, setStandards] = useState<EquipmentStandard[]>([]);
  const [form, setForm] = useState<any | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [bookings, setBookings] = useState<EquipmentBooking[]>([]);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setAllowed(false); return; }
      const snap = await getDoc(doc(db, "users", user.uid));
      const me = snap.data() as any;
      const ok = me?.isStaff || me?.contractor;
      setAllowed(!!ok);
      if (ok) {
        try {
          const uSnap = await getDocs(collection(db, "users"));
          const list = uSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter((u) => u.isStaff || u.contractor);
          setUsers(list);
          const eqRef = doc(db, "equipment", id);
          const [eqSnap, bookingSnap, equipmentSnap, standardSnap] = await Promise.all([
            getDoc(eqRef),
            getDocs(collection(eqRef, "bookings")),
            getDocs(collection(db, "equipment")),
            getDocs(collection(db, "equipmentStandards")),
          ]);
          const categorySet = new Set<string>();
          equipmentSnap.docs.forEach((equipmentDoc) => {
            const rawCategory = (equipmentDoc.data() as any)?.category;
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
          if (!eqSnap.exists()) {
            setForm(null);
            setBookings([]);
            return;
          }
          const data = { id: eqSnap.id, ...(eqSnap.data() as any) };
          if (!me?.isStaff && data.ownerId !== user.uid) {
            setAllowed(false);
            setForm(null);
            setBookings([]);
            return;
          }
          setForm({
            name: data.name || "",
            serialNumber: data.serialNumber || "",
            category: data.category || "",
            ownerId: data.ownerId || "company",
            newValue: data.newValue || 0,
            currentValue: data.currentValue || 0,
            rentalPrice: data.rentalPrice || 0,
            description: data.description || "",
            weightKg: data.weightKg || 0,
            length: data.length || "",
            manualUrl: data.manualUrl || "",
            notes: data.notes || "",
            damage: data.damage || "",
            config:
              data.config || {
                username: "",
                password: "",
                ip: "",
                firmware: "",
                lastServiced: "",
              },
            photo: data.photo || "",
            available: data.available !== false,
            meetsStandards: Array.isArray(data.meetsStandards)
              ? Array.from(
                  new Set(
                    data.meetsStandards
                      .map((id: any) => (typeof id === "string" ? id.trim() : ""))
                      .filter((id: string) => id.length > 0)
                  )
                )
              : [],
          });
          setBookings(
            bookingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
          );
        } catch (error) {
          console.error("Failed to load equipment details", error);
          setForm(null);
          setBookings([]);
        }
      }
    })();
  }, [id]);

  const toggleStandard = (standardId: string) => {
    setForm((prev: any) => {
      if (!prev) return prev;
      const current = Array.isArray(prev.meetsStandards)
        ? prev.meetsStandards
        : [];
      const exists = current.includes(standardId);
      return {
        ...prev,
        meetsStandards: exists
          ? current.filter((id: string) => id !== standardId)
          : [...current, standardId],
      };
    });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      let photoUrl = form.photo || "";
      if (photoFile) {
        const r = ref(storage, `equipment/${Date.now()}-${photoFile.name}`);
        await uploadBytes(r, photoFile);
        photoUrl = await getDownloadURL(r);
      }
      const category = (form.category || "").trim();
      const meetsStandards = Array.isArray(form.meetsStandards)
        ? Array.from(
            new Set(
              form.meetsStandards
                .map((id: any) => (typeof id === "string" ? id.trim() : ""))
                .filter((id: string) => id.length > 0)
            )
          )
        : [];
      const data = {
        ...form,
        category,
        meetsStandards,
        newValue: parseFloat(form.newValue) || 0,
        currentValue: parseFloat(form.currentValue) || 0,
        rentalPrice: parseFloat(form.rentalPrice) || 0,
        weightKg: parseFloat(form.weightKg) || 0,
        photo: photoUrl,
        available: form.available,
        updatedAt: new Date(),
      };
      await updateDoc(doc(db, "equipment", id), data);
      router.push("/admin/equipment");
    } catch (err) {
      console.error("Failed to update equipment", err);
    }
    setSaving(false);
  };

  const remove = async () => {
    if (confirm("Delete this item?")) {
      await deleteDoc(doc(db, "equipment", id));
      router.push("/admin/equipment");
    }
  };

  if (allowed === null || form === null) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this item.</p>;

  return (
    <div className="grid gap-4 max-w-2xl">
      <h1 className="text-xl font-semibold">Edit Equipment</h1>
      <input className="input input-bordered" placeholder="Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />
      <input className="input input-bordered" placeholder="Serial Number" value={form.serialNumber} onChange={e=>setForm({...form,serialNumber:e.target.value})} />
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
      {users.length > 0 && (
        <select className="select select-bordered" value={form.ownerId} onChange={e=>setForm({...form,ownerId:e.target.value})}>
          <option value="company">Pineapple Tapped</option>
          {users.map(u=> (
            <option key={u.id} value={u.id}>{u.fullName || u.email}</option>
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
                const checked = Array.isArray(form.meetsStandards)
                  ? form.meetsStandards.includes(standard.id)
                  : false;
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
      <input className="input input-bordered" placeholder="Config Username" value={form.config?.username || ''} onChange={e=>setForm({...form,config:{...form.config,username:e.target.value}})} />
      <input className="input input-bordered" placeholder="Config Password" value={form.config?.password || ''} onChange={e=>setForm({...form,config:{...form.config,password:e.target.value}})} />
      <input className="input input-bordered" placeholder="IP Address" value={form.config?.ip || ''} onChange={e=>setForm({...form,config:{...form.config,ip:e.target.value}})} />
      <input className="input input-bordered" placeholder="Firmware Version" value={form.config?.firmware || ''} onChange={e=>setForm({...form,config:{...form.config,firmware:e.target.value}})} />
      <input className="input input-bordered" placeholder="Last Serviced" value={form.config?.lastServiced || ''} onChange={e=>setForm({...form,config:{...form.config,lastServiced:e.target.value}})} />
      {form.photo && (
        <Image
          src={form.photo}
          alt={form.name ? `${form.name} photo` : 'Equipment photo'}
          width={400}
          height={400}
          className="h-auto max-h-40 w-auto object-contain"
        />
      )}
      <input type="file" onChange={e=>setPhotoFile(e.target.files?.[0] || null)} />
      <div className="flex gap-2">
        <button onClick={save} className="btn" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        <button onClick={remove} className="btn btn-outline">Delete</button>
      </div>
      <div>
        <h2 className="text-lg font-semibold mt-6">Bookings</h2>
        <Calendar
          tileClassName={({ date }) =>
            bookings.some(b =>
              date >= (b.start?.toDate ? b.start.toDate() : b.start) &&
              date <= (b.end?.toDate ? b.end.toDate() : b.end)
            )
              ? 'bg-red-200'
              : undefined
          }
        />
      </div>
    </div>
  );
}
