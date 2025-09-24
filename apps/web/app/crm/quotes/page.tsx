'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { ensureFirebase } from '@/lib/firebase';

export default function QuoteRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firebase database is unavailable.');
        }

        const snap = await getDocs(collection(db, 'quoteRequests'));
        const list = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data() as any;
            let user: any = null;
            if (data.userId) {
              const uSnap = await getDoc(doc(db, 'users', data.userId));
              if (uSnap.exists()) {
                user = uSnap.data();
              }
            }
            return { id: d.id, ...data, user };
          })
        );

        if (!cancelled) {
          setRequests(list);
        }
      } catch (err) {
        console.error('Failed to load quote requests', err);
        if (!cancelled) {
          setError('Failed to load quote requests. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p>Loading…</p>;

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Quote Requests</h1>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {requests.length === 0 ? (
        <p>No quote requests.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>ID</th>
              <th>Project</th>
              <th>Client</th>
              <th>Submitted</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-t">
                <td>{r.id.substring(0, 6)}</td>
                <td>{r.projectName || '-'}</td>
                <td>{r.user?.fullName || r.user?.email || r.userId}</td>
                <td>
                  {r.createdAt?.toDate
                    ? r.createdAt.toDate().toLocaleDateString()
                    : ''}
                </td>
                <td>{r.status}</td>
                <td>
                  <Link
                    href={`/crm/quotes/${r.id}`}
                    className="text-orange"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
