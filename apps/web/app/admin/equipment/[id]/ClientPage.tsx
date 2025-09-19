"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, db, storage } from "@/lib/firebase";
import { doc, getDoc, updateDoc, deleteDoc, collection, getDocs } from "firebase/firestore";
import Calendar from "react-calendar";
import type { EquipmentBooking } from "@/lib/equipment";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function EquipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { id } = params;
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<any[]>([]);
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
        const uSnap = await getDocs(collection(db, "users"));
        const list = uSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(u => u.isStaff || u.contractor);
        setUsers(list);
        const eqRef = doc(db, "equipment", id);
        const eqSnap = await getDoc(eqRef);
        if (eqSnap.exists()) {
          const data = { id: eqSnap.id, ...(eqSnap.data() as any) };
          if (!me?.isStaff && data.ownerId !== user.uid) {
            setAllowed(false);
          } else {
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
              config: data.config || { username: "", password: "", ip: "", firmware: "", lastServiced: "" },
              photo: data.photo || "",
              available: data.available !== false,
            });
            const bSnap = await getDocs(collection(eqRef, "bookings"));
            const bList = bSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            setBookings(bList);
          }
        } else {
          setForm(null);
        }
      }
    })();
  }, [id]);

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
      const data = {
        ...form,
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
      <input className="input input-bordered" placeholder="Category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})} />
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
