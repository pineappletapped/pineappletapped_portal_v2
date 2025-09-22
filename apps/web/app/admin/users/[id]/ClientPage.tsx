"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { useRoleGate } from '@/hooks/useRoleGate';

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;
  const { allowed, loading: guardLoading } = useRoleGate(['sales']);
  const [user, setUser] = useState<any | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      const uSnap = await getDoc(doc(db, 'users', id));
      setUser(uSnap.data() ? { id: uSnap.id, ...uSnap.data() } : null);
      const oQ = query(collection(db, 'orders'), where('userId', '==', id), orderBy('createdAt', 'desc'));
      const oSnap = await getDocs(oQ);
      setOrders(oSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      const eQ = query(collection(db, 'analyticsEvents'), where('uid', '==', id));
      const eSnap = await getDocs(eQ);
      const evs: any[] = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      evs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setEvents(evs);
      setLoading(false);
    })();
  }, [allowed, guardLoading, id]);

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this page.</p>;
  if (!user) return <p>User not found.</p>;

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">{user.fullName || user.email}</h1>
      <p>Email: {user.email}</p>
      <p>Status: {user.crmStatus || 'client'}</p>
      <p>Discount: {user.discount || 0}%</p>
      <h2 className="font-semibold mt-4">Orders</h2>
      {orders.length === 0 ? (
        <p>No orders found.</p>
      ) : (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2">Order ID</th>
              <th className="p-2">Service</th>
              <th className="p-2">Total</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} className="border-t">
                <td className="p-2">
                  <Link className="text-orange" href={`/orders/${o.id}`}>{o.id}</Link>
                </td>
                <td className="p-2">{o.items?.map((i: any) => i.name).join(', ')}</td>
                <td className="p-2">£{(o.price || 0).toFixed(2)}</td>
                <td className="p-2">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 className="font-semibold mt-4">Activity</h2>
      {events.length === 0 ? (
        <p>No activity recorded.</p>
      ) : (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2">Page</th>
              <th className="p-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id} className="border-t">
                <td className="p-2">{e.path}</td>
                <td className="p-2">{e.createdAt?.toDate?.().toLocaleString?.() || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link className="text-orange" href="/admin/users">← Back to users</Link>
    </div>
  );
}

