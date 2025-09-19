"use client";
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

/**
 * Lists brand packs for a given organisation. Brand packs include colours and
 * optional logos and are used to apply consistent branding to projects and
 * assets. Users can create new brand packs from here.
 */
export default function BrandPacksListPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params?.orgId;
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const snap = await getDocs(query(collection(db, 'brandPacks'), where('orgId', '==', orgId)));
      setPacks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, [orgId]);
  if (!orgId) return <p>Organisation id missing.</p>;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Brand Packs</h1>
        <Link href={`/orgs/${orgId}/brand-packs/new`} className="btn">New Brand Pack</Link>
      </div>
      {loading ? <p>Loading…</p> : (
        <div className="grid gap-2">
          {packs.length === 0 ? <p>No brand packs yet.</p> : packs.map((b) => (
            <div key={b.id} className="card flex items-center gap-3">
              {b.logoUrl && (
                <Image
                  src={b.logoUrl}
                  alt={`${b.name} logo`}
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded object-contain"
                />
              )}
              <div className="font-medium flex-1">{b.name}</div>
              <div className="flex gap-2">
                {b.primaryColor && <span className="inline-block h-3 w-3 rounded-full" style={{ background: b.primaryColor }} />}
                {b.secondaryColor && <span className="inline-block h-3 w-3 rounded-full" style={{ background: b.secondaryColor }} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}