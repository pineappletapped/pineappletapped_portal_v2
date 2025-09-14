"use client";
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';

/**
 * Side-by-side comparison page for project assets. Allows the user to select two
 * versions of assets within a project and view them simultaneously for easier
 * comparison. Also supports batch approval of both assets.
 */
export default function ComparePage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  const [assets, setAssets] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (!projectId) return;
      const snap = await getDocs(query(collection(db, 'assets'), where('projectId', '==', projectId)));
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, [projectId]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return prev.length < 2 ? [...prev, id] : prev;
    });
  };
  const approveBoth = async () => {
    if (selectedIds.length < 2) return;
    await Promise.all(selectedIds.map((aid) => updateDoc(doc(db, 'assets', aid), { status: 'approved' })));
    alert('Both assets approved');
  };
  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Compare Versions</h1>
      <div className="grid md:grid-cols-2 gap-4">
        {assets.map((a) => (
          <div key={a.id} className={`card p-3 ${selectedIds.includes(a.id) ? 'border-blue-500' : ''}`}
            onClick={() => toggleSelect(a.id)}>
            <p className="font-medium mb-2">{a.name || 'Asset'} v{a.version}</p>
            {a.mime?.startsWith('video/') ? (
              <video src={a.url} controls className="w-full rounded" />
            ) : (
              <p className="text-sm text-gray-600">Non-video asset</p>
            )}
          </div>
        ))}
      </div>
      {selectedIds.length === 2 && (
        <button className="btn" onClick={approveBoth}>Approve Both</button>
      )}
    </div>
  );
}