"use client";
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { orderBy, where } from 'firebase/firestore';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { fetchOrgDocs, fetchUserOrgIds } from '@/lib/crm';

/**
 * Opportunities page: lists leads marked as opportunities and orders in progress,
 * providing a quick view of the sales pipeline. Only staff and client admins
 * should see this page.
 */
export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const orgIdsRef = useRef<string[]>([]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const handleUserChange = async (user: User | null, db: any) => {
      if (cancelled) {
        return;
      }

      if (!user) {
        orgIdsRef.current = [];
        setOpportunities([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const orgIds = await fetchUserOrgIds(db, user.uid);
        orgIdsRef.current = orgIds;
        if (orgIds.length === 0) {
          setOpportunities([]);
          return;
        }

        const [opps, leads, orders] = await Promise.all([
          fetchOrgDocs(db, 'opportunities', orgIds),
          fetchOrgDocs(db, 'leads', orgIds, [where('status', '==', 'opportunity')]),
          fetchOrgDocs(db, 'orders', orgIds, [
            where('status', 'in', ['deposit_paid', 'in_progress', 'balance_due']),
            orderBy('createdAt', 'desc'),
          ]),
        ]);

        const combined: any[] = [
          ...opps.map((item) => ({ ...item, type: 'opportunity' })),
          ...leads.map((item) => ({ ...item, type: 'lead' })),
          ...orders.map((item) => ({ ...item, type: 'order' })),
        ];

        combined.sort((a, b) => {
          const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
          const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        });

        setOpportunities(combined);
      } catch (err) {
        console.error('Failed to load opportunities', err);
        if (!cancelled) {
          setError('Failed to load opportunities. Please try again.');
          setOpportunities([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || !db) {
          throw new Error('Firebase auth or database is unavailable.');
        }

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== 'function') {
          throw new Error('Firebase auth listener helper is unavailable.');
        }

        unsubscribe = onAuthStateChanged(auth, (user: User | null) => handleUserChange(user, db));
      } catch (err) {
        console.error('Failed to initialise CRM opportunities view', err);
        if (!cancelled) {
          setError('Failed to initialise CRM. Please refresh the page.');
          setOpportunities([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Opportunities</h1>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {opportunities.length === 0 ? <p>No active opportunities.</p> : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>ID</th>
              <th>Name/Ref</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr key={o.id} className="border-t">
                <td>{o.id.substring(0, 6)}</td>
                <td>{o.type === 'lead' ? o.name : `Order #${o.id.substring(0, 6)}`}</td>
                <td>{o.type}</td>
                <td>{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}