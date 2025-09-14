"use client";
import { useEffect, useState } from 'react';
import { db, auth, functions } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

/**
 * Lists proposals in the CRM pipeline. Staff can accept a proposal to
 * automatically create an order awaiting deposit. Once deposit is paid the
 * existing payment workflow will create the project and any tasks.
 */
export default function ProposalsPage() {
  const [proposals, setProposals] = useState<any[]>([]);
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
      if (orgIds.length) {
        const snap = await getDocs(query(collection(db, 'proposals'), where('orgId', 'in', orgIds)));
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setProposals(list);
      }
      setLoading(false);
    })();
  }, []);

  const accept = async (id: string) => {
    if (!confirm('Accepting will create an order and may trigger task creation after payment. Continue?')) return;
    const fn = httpsCallable(functions, 'admin_acceptProposal');
    await fn({ proposalId: id });
    setProposals((ps) => ps.map((p) => (p.id === id ? { ...p, status: 'accepted' } : p)));
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Proposals</h1>
      {proposals.length === 0 ? (
        <p>No proposals.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th>ID</th>
              <th>Client</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => (
              <tr key={p.id} className="border-t">
                <td>{p.id.substring(0, 6)}</td>
                <td>{p.clientEmail}</td>
                <td>{p.status}</td>
                <td>
                  {p.status === 'sent' && (
                    <button className="link" onClick={() => accept(p.id)}>
                      Accept
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
