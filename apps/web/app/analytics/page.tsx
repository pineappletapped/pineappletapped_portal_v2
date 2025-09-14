"use client";
import { useEffect, useState } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

/**
 * Analytics dashboard showing basic metrics like number of orders, projects, leads and
 * average approval rounds. This provides a quick overview of business performance.
 */
export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const orgIds = memSnap.docs.map((d) => (d.data() as any).orgId);
      if (orgIds.length > 0) {
        const ordersSnap = await getDocs(query(collection(db, 'orders'), where('orgId', 'in', orgIds)));
        const projectsSnap = await getDocs(query(collection(db, 'projects'), where('orgId', 'in', orgIds)));
        const assetsSnap = await getDocs(query(collection(db, 'assets'), where('orgId', 'in', orgIds)));
        const leadsSnap = await getDocs(query(collection(db, 'leads'), where('orgId', 'in', orgIds)));
        const commentsSnap = await getDocs(query(collection(db, 'comments')));
        // Compute average approval rounds: total comments per asset
        let totalRounds = 0;
        commentsSnap.docs.forEach((d) => {
          const c = d.data() as any;
          if (c.assetId) totalRounds += 1;
        });
        const totalAssets = assetsSnap.size || 1;
        // Compute total order value
        let orderValue = 0;
        ordersSnap.docs.forEach((doc) => {
          const o = doc.data() as any;
          orderValue += o.price || 0;
        });
        // Compute average cycle time (in days) between project creation and last status update
        let cycleSum = 0;
        let cycleCount = 0;
        projectsSnap.docs.forEach((doc) => {
          const p = doc.data() as any;
          if (p.createdAt && p.statusUpdatedAt) {
            const start = p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
            const end = p.statusUpdatedAt.toDate ? p.statusUpdatedAt.toDate() : new Date(p.statusUpdatedAt);
            const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
            if (diff >= 0) {
              cycleSum += diff;
              cycleCount += 1;
            }
          }
        });
        const avgCycle = cycleCount > 0 ? (cycleSum / cycleCount) : 0;
        // Compute storage usage (sum of asset sizes in MB) if size field exists
        let totalStorage = 0;
        assetsSnap.docs.forEach((doc) => {
          const a = doc.data() as any;
          if (a.size) totalStorage += a.size;
        });
        const totalStorageMb = totalStorage / (1024 * 1024);
        setMetrics({
          orders: ordersSnap.size,
          projects: projectsSnap.size,
          assets: assetsSnap.size,
          leads: leadsSnap.size,
          avgRounds: (totalRounds / totalAssets).toFixed(2),
          orderValue: orderValue.toFixed(2),
          avgCycle: avgCycle.toFixed(1),
          storageMb: totalStorageMb.toFixed(2),
        });
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">{metrics.orders}</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Orders</div>
        </div>
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">{metrics.projects}</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Projects</div>
        </div>
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">{metrics.assets}</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Assets</div>
        </div>
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">{metrics.leads}</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Leads</div>
        </div>
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">£{metrics.orderValue}</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Total Order Value</div>
        </div>
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">{metrics.avgCycle}d</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Avg Project Cycle</div>
        </div>
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">{metrics.storageMb} MB</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Storage Used</div>
        </div>
        <div className="card p-4 text-center bg-white shadow-sm rounded-lg">
          <div className="text-3xl font-bold text-orange">{metrics.avgRounds}</div>
          <div className="text-xs uppercase tracking-wide text-gray-600 mt-1">Avg Revision Rounds</div>
        </div>
      </div>
    </div>
  );
}