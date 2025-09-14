"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, storage } from "@/lib/firebase";
import { collection, addDoc, getDocs, getDoc, doc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function NewEquipmentPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    serialNumber: "",
    category: "",
    ownerId: "company",
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
      if (ok) {
        const uSnap = await getDocs(collection(db, "users"));
        const list = uSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(u => u.isStaff || u.contractor);
        setUsers(list);
      if (!me?.isStaff) {
          setForm(f => ({ ...f, ownerId: user.uid }));
        }
      }
    })();
  }, []);

  const submit = async () => {
    setLoading(true);
    try {
      let photoUrl = "";
      if (photoFile) {
        const r = ref(storage, `equipment/${Date.now()}-${photoFile.name}`);
        await uploadBytes(r, photoFile);
        photoUrl = await getDownloadURL(r);
      }
      const data: any = {
        ...form,
        newValue: parseFloat(form.newValue) || 0,
        currentValue: parseFloat(form.currentValue) || 0,
        rentalPrice: parseFloat(form.rentalPrice) || 0,
        weightKg: parseFloat(form.weightKg) || 0,
        photo: photoUrl,
        createdAt: new Date(),
        available: form.available,
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
      <input className="input input-bordered" placeholder="Category" value={form.category} onChange={e=>setForm({...form,category:e.target.value})} />
      {users.length > 0 && (
        <select className="select select-bordered" value={form.ownerId} onChange={e=>setForm({...form,ownerId:e.target.value})} disabled={!users.some(u=>u.id===form.ownerId) && form.ownerId!=="company"}>
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
