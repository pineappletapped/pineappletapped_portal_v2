
'use client';
import { useState, useEffect } from 'react';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { addDoc, collection, serverTimestamp, doc, getDoc, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { useParams, useRouter } from 'next/navigation';

export default function Upload() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id ?? null;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [pct, setPct] = useState(0);
  const [orgId, setOrgId] = useState<string | null>(null);

  // Fetch project to get orgId
  useEffect(() => {
    if (!projectId) {
      return;
    }
    (async () => {
      const projRef = doc(db, 'projects', projectId);
      const snap = await getDoc(projRef);
      const data = snap.data();
      let org = data?.orgId || null;
      if (!org && data?.orderId) {
        const orderSnap = await getDoc(doc(db, 'orders', data.orderId));
        const orderData = orderSnap.data();
        org = orderData?.orgId || null;
        if (org) {
          await updateDoc(projRef, { orgId: org });
        }
      }
      setOrgId(org);
    })();
  }, [projectId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (!projectId) {
      alert('Cannot determine project for this upload');
      return;
    }
    if (!orgId) {
      alert('Cannot determine organisation for this project');
      return;
    }
    const key = `orgs/${orgId}/projects/${projectId}/assets/${Date.now()}-${encodeURIComponent(file.name)}`;
    const r = ref(storage, key);
    const task = uploadBytesResumable(r, file, { contentType: file.type });
    task.on(
      'state_changed',
      (snap) => setPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => alert(err.message),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        // Determine version number based on existing assets with same name
        const assetName = name || file.name;
        const existingSnap = await getDocs(query(collection(db,'assets'), where('projectId','==', projectId), where('name','==', assetName)));
        const version = existingSnap.size + 1;
        await addDoc(collection(db, 'assets'), {
          orgId,
          projectId,
          name: assetName,
          storageKey: key,
          url,
          bytes: file.size,
          mime: file.type,
          status: 'ready',
          version,
          createdAt: serverTimestamp()
        });
        router.push(`/projects/${projectId}`);
      }
    );
  };

  if (!projectId) {
    return (
      <div className="max-w-lg mx-auto card grid gap-3">
        <h1 className="text-xl font-semibold">Upload Asset</h1>
        <p className="text-sm text-gray-600">We couldn&apos;t find that project. Please return to your dashboard and try again.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto card grid gap-3">
      <h1 className="text-xl font-semibold">Upload Asset</h1>
      <form onSubmit={submit} className="grid gap-3">
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
        <input className="input" placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn">Upload</button>
      </form>
      {pct > 0 && <div className="text-sm text-gray-600">Uploading… {pct}%</div>}
    </div>
  );
}
