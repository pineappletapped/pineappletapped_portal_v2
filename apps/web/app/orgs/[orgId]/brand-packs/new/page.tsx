"use client";
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, storage } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Allows creation of a new Brand Pack for a given organisation. A brand pack
 * includes a name, a primary and optional secondary colour, and an optional
 * logo image. The logo is uploaded to Firebase Storage under the
 * `orgs/{orgId}/brand-packs/{packId}/` prefix.
 */
export default function NewBrandPackPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params?.orgId;
  const router = useRouter();
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState('#');
  const [secondary, setSecondary] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  if (!orgId) return <p>Organisation id missing.</p>;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'brandPacks'), {
        orgId,
        name,
        primaryColor: primary || null,
        secondaryColor: secondary || null,
        createdAt: serverTimestamp()
      });
      let logoUrl: string | null = null;
      if (file) {
        const key = `orgs/${orgId}/brand-packs/${docRef.id}/logo-${Date.now()}-${encodeURIComponent(file.name)}`;
        const r = ref(storage, key);
        await uploadBytes(r, file, { contentType: file.type });
        logoUrl = await getDownloadURL(r);
        await updateDoc(doc(db, 'brandPacks', docRef.id), { logoUrl });
      }
      router.push(`/orgs/${orgId}`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating brand pack');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto card grid gap-3">
      <h1 className="text-xl font-semibold">New Brand Pack</h1>
      <form onSubmit={create} className="grid gap-3">
        <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <input className="input" placeholder="Primary colour (#hex)" value={primary} onChange={(e) => setPrimary(e.target.value)} required />
          <input className="input" placeholder="Secondary colour (#hex optional)" value={secondary} onChange={(e) => setSecondary(e.target.value)} />
        </div>
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Creating…' : 'Create'}</button>
      </form>
    </div>
  );
}