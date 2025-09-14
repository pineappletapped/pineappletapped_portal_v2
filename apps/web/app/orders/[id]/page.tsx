"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';
import PortalContainer from '@/components/PortalContainer';

/**
 * Order detail page.
 *
 * Shows a single order with pricing and deposit/balance information.
 * The page listens for real-time updates to the order document and reacts
 * to Stripe webhook–driven status changes. Once a project is created and
 * linked to the order the user is redirected automatically.
 */
export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [service, setService] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [redirected, setRedirected] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [modifierGroups, setModifierGroups] = useState<Record<string, any>>({});

  const saveName = async () => {
    if (!order) return;
    await updateDoc(doc(db, 'orders', order.id), { projectName: nameInput || null });
    setOrder({ ...order, projectName: nameInput || null });
    setEditingName(false);
  };

  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    const unsub = onSnapshot(doc(db, 'orders', id), async (snap) => {
      if (snap.exists()) {
        const od = { id: snap.id, ...snap.data() } as any;
        setOrder(od);
        setNameInput(od.projectName || '');
        setLoading(false);
        if (od.projectId && !redirected) {
          setRedirected(true);
          router.push(`/projects/${od.projectId}`);
        }
      } else {
        setOrder(null);
        setLoading(false);
      }
    });
    return () => unsub();
  }, [params, router, redirected]);

  useEffect(() => {
    const serviceId = order?.serviceId;
    if (!serviceId) return;
    let active = true;
    (async () => {
      try {
        const sSnap = await getDoc(doc(db, 'products', serviceId));
        if (sSnap.exists() && active) {
          setService({ id: sSnap.id, ...sSnap.data() });
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      active = false;
    };
  }, [order?.serviceId]);

  useEffect(() => {
    const ids = new Set<string>();
    (order?.items || []).forEach((item: any) => {
      (item.modifiers || []).forEach((m: any) => ids.add(m.groupId));
    });
    if (ids.size === 0) {
      setModifierGroups({});
      return;
    }
    let active = true;
    (async () => {
      try {
        const snaps = await Promise.all(
          Array.from(ids).map((id) => getDoc(doc(db, 'modifiers', id)))
        );
        if (!active) return;
        const map: Record<string, any> = {};
        snaps.forEach((s) => {
          if (s.exists()) map[s.id] = s.data();
        });
        setModifierGroups(map);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      active = false;
    };
  }, [order]);

  if (loading || !order) return <p>Loading…</p>;
  return (
    <PortalContainer>
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold">Order for {service?.name || 'Service'}</h1>
        <div className="card p-4">
          <p className="mb-2">Status: {order.status}</p>
          <p className="mb-2 flex items-center">
            <span>Project Name: </span>
            {editingName ? (
              <>
              <input
                className="input input-bordered ml-2"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
              <button className="btn btn-sm ml-2" onClick={saveName}>
                Save
              </button>
            </>
          ) : (
            <>
              <span className="ml-2">{order.projectName || '—'}</span>
              <button
                className="btn btn-sm ml-2"
                onClick={() => setEditingName(true)}
              >
                {order.projectName ? 'Edit' : 'Add'}
              </button>
            </>
          )}
        </p>
          <p className="mb-2">Subtotal: £{(order.netTotal ?? order.price - (order.vat || 0)).toFixed(2)}</p>
          {order.vat ? (
            <p className="mb-2">VAT: £{order.vat.toFixed(2)}</p>
          ) : null}
          <p className="mb-2">Total price: £{order.price?.toFixed(2)}</p>
          <p className="mb-2">Deposit: £{order.depositAmount?.toFixed(2)} ({(order.depositPercentage * 100).toFixed(0)}%)</p>
          <p className="mb-4">Balance: £{order.balanceAmount?.toFixed(2)}</p>
        </div>

        {order.items?.length ? (
          <div className="card p-4">
            <h2 className="font-semibold mb-2">Items</h2>
            <ul className="divide-y">
              {order.items.map((item: any) => (
                <li key={item.id} className="py-2 flex justify-between">
                  <div>
                    <Link
                      href={`/products/${item.id}`}
                      className="text-primary hover:underline"
                    >
                      {item.name}
                    </Link>
                    <span className="ml-2 text-sm text-gray-600">x{item.quantity}</span>
                    {item.modifiers?.length ? (
                      <ul className="ml-4 list-disc text-xs text-gray-600">
                        {item.modifiers.map((m: any, idx: number) => {
                          const group = modifierGroups[m.groupId];
                          const option = group?.options?.find((o: any) => o.id === m.optionId);
                          const label = option?.name || m.optionId;
                          return <li key={idx}>{label}</li>;
                        })}
                      </ul>
                    ) : null}
                  </div>
                  <div className="text-right text-sm">
                    <span>£{(item.price * item.quantity).toFixed(2)}</span>
                    {item.rentalTotal ? (
                      <div className="text-xs text-gray-600">
                        Rent £{(item.rentalTotal * item.quantity).toFixed(2)}
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {order.status === 'deposit_paid' && !order.projectId && (
          <div className="card p-4">
            <p className="mb-2">Deposit received. Setting up your project…</p>
            <Link href="/projects" className="btn">View Projects</Link>
          </div>
        )}
        {order.status === 'balance_paid' && (
          <div className="card p-4">
            <p className="text-green-600">Order fully paid.</p>
          </div>
        )}
      </div>
    </PortalContainer>
  );
}