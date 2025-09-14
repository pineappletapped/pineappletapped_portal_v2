"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

/**
 * Lists all organisations that the currently signed in user is a member of.
 * Users can navigate into an organisation or create a new one. Memberships are
 * stored in the `memberships` collection with an `orgId_userId` id pattern and
 * fields { orgId, userId, role }. This page fetches memberships for the
 * authenticated user and then loads the associated org documents.
 */
export default function OrgsPage() {
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<{ id: string; name: string; role?: string }[]>([]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user: any) => {
      if (!user) return;
      // Query memberships for this user
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const memberships = memSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
      // Fetch each organisation document
      const orgPromises = memberships.map((m) => getDoc(doc(db, 'orgs', m.orgId)));
      const orgDocs = await Promise.all(orgPromises);
      const list = orgDocs.map((docSnap) => {
        const orgId = docSnap.id;
        const m = memberships.find((mm) => mm.orgId === orgId);
        return { id: orgId, name: (docSnap.data() as any)?.name || 'Untitled', role: m?.role };
      });
      setOrgs(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Organisations</h1>
        <Link href="/orgs/new" className="btn">New Org</Link>
      </div>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="grid gap-2">
          {orgs.length === 0 ? (
            <p>You are not a member of any organisations.</p>
          ) : (
            orgs.map((o) => (
              <Link key={o.id} href={`/orgs/${o.id}`} className="card hover:bg-gray-50">
                <div className="font-medium">{o.name}</div>
                {o.role && <div className="text-sm text-gray-500">Role: {o.role}</div>}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}