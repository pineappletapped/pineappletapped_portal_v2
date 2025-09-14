"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, setDoc, doc } from 'firebase/firestore';

/**
 * Allows creation of a new organisation. Upon creation, the current user will
 * automatically be assigned the role of `client_admin` for the new org via a
 * membership document. After creation, the user is redirected to the new
 * organisation's detail page.
 */
export default function NewOrgPage() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return alert('You must be signed in to create an organisation.');
    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'orgs'), { name, createdAt: serverTimestamp() });
      const orgId = docRef.id;
      await setDoc(doc(db, 'memberships', `${orgId}_${user.uid}`), {
        orgId,
        userId: user.uid,
        role: 'client_admin',
        createdAt: serverTimestamp()
      });
      router.push(`/orgs/${orgId}`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating organisation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto card grid gap-3">
      <h1 className="text-xl font-semibold">New Organisation</h1>
      <form onSubmit={createOrg} className="grid gap-3">
        <input className="input" placeholder="Organisation name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" className="btn" disabled={loading}>{loading ? 'Creating…' : 'Create'}</button>
      </form>
    </div>
  );
}