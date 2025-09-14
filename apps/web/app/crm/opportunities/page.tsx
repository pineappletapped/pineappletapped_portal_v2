"use client";
import { useEffect, useState } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';

/**
 * Opportunities page: lists leads marked as opportunities and orders in progress,
 * providing a quick view of the sales pipeline. Only staff and client admins
 * should see this page.
 */
export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const orgIds = memSnap.docs.map((m) => (m.data() as any).orgId);
      if (orgIds.length > 0) {
        // Fetch opportunities tracked separately in the opportunities collection
        const oppSnap = await getDocs(query(collection(db, 'opportunities'), where('orgId', 'in', orgIds)));
        const opps = oppSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: 'opportunity' }));
        // Also include leads marked as opportunities and orders still in pipeline
        const leadsSnap = await getDocs(query(collection(db, 'leads'), where('orgId', 'in', orgIds), where('status', '==', 'opportunity')));
        const leads = leadsSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: 'lead' }));
        const ordersSnap = await getDocs(
          query(
            collection(db, 'orders'),
            where('orgId', 'in', orgIds),
            where('status', 'in', ['deposit_paid', 'in_progress', 'balance_due']),
            orderBy('createdAt', 'desc')
          )
        );
        const orders = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: 'order' }));
        const combined: any[] = [...opps, ...leads, ...orders];
        combined.sort((a, b) => {
          const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
          const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        });
        setOpportunities(combined);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Opportunities</h1>
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