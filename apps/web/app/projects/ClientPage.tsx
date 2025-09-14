'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';

export default function ProjectsPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [quoteRequests, setQuoteRequests] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const ordersQ = query(
          collection(db, 'orders'),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc')
        );
        const quotesQ = query(
          collection(db, 'quoteRequests'),
          where('userId', '==', user.uid)
        );
        const [ordersSnap, quotesSnap] = await Promise.all([
          getDocs(ordersQ),
          getDocs(quotesQ),
        ]);
        setOrders(ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setQuoteRequests(quotesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
      }
    })();
  }, []);

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Projects</h1>
          <Link href="/projects/new" className="btn">
            New Project
          </Link>
        </div>
        {quoteRequests.filter((r) => r.status === 'pending').length > 0 && (
          <div className="grid gap-3">
            <h2 className="text-lg font-semibold">Pending Quote Requests</h2>
            {quoteRequests
              .filter((r) => r.status === 'pending')
              .map((r) => (
                <div key={r.id} className="card p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">
                        {r.projectName || `Request #${r.id.substring(0, 6)}`}
                      </p>
                      <p className="text-sm text-gray-600">
                        Submitted:{' '}
                        {r.createdAt?.toDate
                          ? r.createdAt.toDate().toLocaleDateString()
                          : ''}
                      </p>
                      <p className="text-sm text-gray-600">Status: {r.status}</p>
                    </div>
                    <Link href={`/projects/requests/${r.id}`} className="btn">
                      View
                    </Link>
                  </div>
                </div>
              ))}
          </div>
        )}
        {orders.length === 0 ? (
          <p>No projects yet.</p>
        ) : (
          <div className="grid gap-3">
            {orders.map((o) => (
              <div key={o.id} className="card p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">
                      {o.projectName || `Order #${o.id.substring(0, 6)}`}
                    </p>
                    <p className="text-sm text-gray-600">Status: {o.status}</p>
                  </div>
                  <Link href={`/orders/${o.id}`} className="btn">
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PortalContainer>
  );
}
