"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { auth, db, storage } from "@/lib/firebase";
import { collection, addDoc, getDocs, getDoc, doc, deleteDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import type { ClientLogo } from "@/lib/clientLogos";

export default function AdminClientLogosPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [logos, setLogos] = useState<ClientLogo[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
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
    const snap = await getDocs(collection(db, "clientLogos"));
    setLogos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClientLogo[]);
  };

  const upload = async (id: string, f: File) => {
    const r = ref(storage, `clientLogos/${id}`);
    await uploadBytes(r, f);
    return await getDownloadURL(r);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const docRef = await addDoc(collection(db, "clientLogos"), {
      name,
      imageUrl: null,
    });
    if (file) {
      const url = await upload(docRef.id, file);
      await updateDoc(docRef, { imageUrl: url });
    }
    setName("");
    setFile(null);
    setPreview(null);
    await refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this logo?")) return;
    await deleteDoc(doc(db, "clientLogos", id));
    try {
      await deleteObject(ref(storage, `clientLogos/${id}`));
    } catch {
      // ignore missing files
    }
    await refresh();
  };

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to manage client logos.</p>;

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Client Logos</h1>

      <form onSubmit={create} className="grid gap-2 max-w-sm">
        <input
          className="input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
          required
        />
        {preview && (
          <Image
            src={preview}
            alt={`Preview of ${name}`}
            width={128}
            height={64}
            className="h-16 w-auto object-contain"
          />
        )}
        <button className="btn" disabled={!file}>
          Add Logo
        </button>
      </form>

      <ul className="grid gap-4 md:grid-cols-3">
        {logos.map((l) => (
          <li key={l.id} className="border rounded p-4 flex flex-col items-center gap-2">
            {l.imageUrl && (
              <Image
                src={l.imageUrl}
                alt={l.name}
                width={128}
                height={64}
                className="h-16 w-auto object-contain"
              />
            )}
            <p className="text-sm">{l.name}</p>
            <button
              onClick={() => remove(l.id)}
              className="text-xs text-red-600 hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
