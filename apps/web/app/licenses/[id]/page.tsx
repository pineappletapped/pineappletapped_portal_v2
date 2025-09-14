"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

/**
 * Displays a single license document. Licenses are associated with an asset
 * and contain a name, storage path and downloadable URL. Only a simple view
 * is provided here. In a full implementation you may wish to show metadata
 * or support editing/removal.
 */
export default function LicenseDetailPage() {
  const params = useParams<{ id: string }>();
  const [license, setLicense] = useState<any>(null);
  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    (async () => {
      const snap = await getDoc(doc(db, 'licenses', id));
      if (snap.exists()) setLicense({ id: snap.id, ...snap.data() });
    })();
  }, [params]);
  if (!license) return <p>Loading…</p>;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">License: {license.name}</h1>
      <p>Asset ID: {license.assetId}</p>
      <p>Uploaded: {license.uploadedAt?.toDate?.().toLocaleString()}</p>
      <a href={license.url} target="_blank" rel="noopener noreferrer" className="btn">
        Download
      </a>
      {/*
        In a more complete implementation you could link back to the
        associated project or asset. Since license documents only reference
        an assetId here, the caller should provide appropriate navigation.
      */}
    </div>
  );
}