'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ensureFirebase } from '@/lib/firebase';

export default function QuoteRequestDetail({ params }: { params: { id: string } }) {
  const [request, setRequest] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dbRef = useRef<any>(null);

  const resolveDb = async () => {
    if (dbRef.current) {
      return dbRef.current;
    }
    const { db } = await ensureFirebase();
    if (!db) {
      throw new Error('Firebase database is unavailable.');
    }
    dbRef.current = db;
    return db;
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const db = await resolveDb();
        if (cancelled) {
          return;
        }

        const snap = await getDoc(doc(db, 'quoteRequests', params.id));
        if (snap.exists()) {
          const data = snap.data() as any;
          const itemsWithNames = await Promise.all(
            (data.items || []).map(async (it: any) => {
              const prodSnap = await getDoc(doc(db, 'products', it.productId));
              return { ...it, name: prodSnap.data()?.name || '' };
            })
          );
          if (!cancelled) {
            setRequest({ id: snap.id, ...data, items: itemsWithNames });
            setStatus(data.status || '');
            setNotes(data.internalNotes || '');
          }
        }
      } catch (err) {
        console.error('Failed to load quote request', err);
        if (!cancelled) {
          setError('Failed to load quote request. Please try again.');
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
  }, [params.id]);

  const save = async () => {
    setSaving(true);
    setError(null);

    try {
      const db = await resolveDb();
      await updateDoc(doc(db, 'quoteRequests', params.id), {
        status,
        internalNotes: notes || null,
      });
      setRequest((prev: any) => ({ ...prev, status, internalNotes: notes }));
    } catch (err: any) {
      console.error('Failed to save quote request', err);
      setError(err?.message || 'Error saving quote request.');
    } finally {
      setSaving(false);
    }
  };

  const createProposal = async () => {
    if (!request?.userId) {
      alert('Missing user');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { db, functions } = await ensureFirebase();
      if (!db || !functions) {
        throw new Error('Proposal service is unavailable.');
      }
      dbRef.current = db;

      const userSnap = await getDoc(doc(db, 'users', request.userId));
      const user = userSnap.data() as any;
      if (!user?.orgId || !user?.email) {
        alert('User missing org or email');
        setSaving(false);
        return;
      }
      const items = await Promise.all(
        (request.items || []).map(async (it: any) => {
          const pSnap = await getDoc(doc(db, 'products', it.productId));
          const prod = pSnap.data() as any;
          return {
            type: 'product',
            productId: it.productId,
            name: prod?.name || '',
            price: prod?.price || 0,
            notes: it.note || '',
          };
        })
      );
      if (request.customRequest) {
        items.push({ type: 'custom', name: request.customRequest, price: 0 });
      }
      const callable = httpsCallable(functions, 'admin_createProposal');
      const res: any = await callable({
        orgId: user.orgId,
        clientEmail: user.email,
        items,
      });
      await updateDoc(doc(db, 'quoteRequests', params.id), {
        status: 'proposal',
        proposalId: res.data?.id || null,
      });
      setRequest((prev: any) => ({
        ...prev,
        status: 'proposal',
        proposalId: res.data?.id || null,
      }));
    } catch (err: any) {
      console.error('Failed to create proposal', err);
      alert(err?.message || 'Error creating proposal');
    }
    setSaving(false);
  };

  if (loading) return <p>Loading…</p>;
  if (!request) return <p>Request not found.</p>;

  return (
    <div className="grid gap-4 max-w-2xl mx-auto">
      <Link href="/crm/quotes" className="text-sm text-orange">&larr; Back</Link>
      <h1 className="text-xl font-semibold">
        {request.projectName || `Request #${request.id.substring(0, 6)}`}
      </h1>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="grid gap-2 bg-white p-4 rounded">
        <div><span className="font-medium">Name:</span> {request.name || '—'}</div>
        <div><span className="font-medium">Email:</span> {request.email || '—'}</div>
        {request.productionPeriod && (
          <div><span className="font-medium">Production:</span> {request.productionPeriod}</div>
        )}
        {request.items?.length > 0 && (
          <div className="grid gap-1 mt-2">
            <div className="font-medium">Items</div>
            <ul className="list-disc pl-5 text-sm">
              {request.items.map((it: any, idx: number) => (
                <li key={idx}>
                  {it.name || it.productId}
                  {it.note && <span className="text-gray-600"> – {it.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {request.customRequest && (
          <div className="mt-2">
            <div className="font-medium">Custom Request</div>
            <p className="text-sm">{request.customRequest}</p>
          </div>
        )}
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium">Status</label>
        <select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {['pending', 'reviewing', 'proposal', 'closed'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium">Internal notes</label>
        <textarea
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={save} disabled={saving}>
          Save
        </button>
        <button className="btn-outline" onClick={createProposal} disabled={saving}>
          Create Proposal
        </button>
      </div>
    </div>
  );
}

