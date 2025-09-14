'use client';

import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export default function AnalyticsClientPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [rows, setRows] = useState<{ path: string; views: number; uniques: number }[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { setIsStaff(false); setLoading(false); return; }
      const { doc, getDoc, collection, getDocs } = await import('firebase/firestore');
      const me = await getDoc(doc(db, 'users', user.uid));
      const data = me.data() as any;
      const staff = data?.isStaff === true;
      setIsStaff(staff);
      if (staff) {
        const snap = await getDocs(collection(db, 'analyticsEvents'));
        const map: Record<string, { views: number; visitors: Set<string> }> = {};
        const logArr: any[] = [];
        snap.forEach((d) => {
          const ev = d.data() as any;
          if (!ev.path) return;
          if (!map[ev.path]) map[ev.path] = { views: 0, visitors: new Set() };
          map[ev.path].views += 1;
          if (ev.visitorId) map[ev.path].visitors.add(ev.visitorId);
          logArr.push({ id: d.id, ...ev });
        });
        const arr = Object.keys(map).map((p) => ({
          path: p,
          views: map[p].views,
          uniques: map[p].visitors.size,
        }));
        setRows(arr);
        logArr.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setLogs(logArr.slice(0, 50));
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to view analytics.</p>;

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-4">Analytics Dashboard</h1>
      <table className="w-full text-left border mb-8">
        <thead>
          <tr className="border-b bg-slate-50">
            <th className="p-2">Page</th>
            <th className="p-2">Views</th>
            <th className="p-2">Unique Visitors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path} className="border-b">
              <td className="p-2">{r.path}</td>
              <td className="p-2">{r.views}</td>
              <td className="p-2">{r.uniques}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="text-xl font-semibold mb-2">Recent Visits</h2>
      <table className="w-full text-left border">
        <thead>
          <tr className="border-b bg-slate-50">
            <th className="p-2">User</th>
            <th className="p-2">Page</th>
            <th className="p-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="p-2">{l.userName || l.uid || l.visitorId || 'Anonymous'}</td>
              <td className="p-2">{l.path}</td>
              <td className="p-2">{l.createdAt?.toDate?.().toLocaleString?.() || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
