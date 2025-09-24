"use client";
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { fetchOrgDocs, fetchUserOrgIds } from '@/lib/crm';

/**
 * Lists proposals in the CRM pipeline. Staff can accept a proposal to
 * automatically create an order awaiting deposit. Once deposit is paid the
 * existing payment workflow will create the project and any tasks.
 */
export default function ProposalsPage() {
  const [proposals, setProposals] = useState<any[]>([]);
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
        setProposals([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const orgIds = await fetchUserOrgIds(db, user.uid);
        orgIdsRef.current = orgIds;
        if (orgIds.length === 0) {
          setProposals([]);
          return;
        }

        const list = await fetchOrgDocs(db, 'proposals', orgIds);
        setProposals(list);
      } catch (err) {
        console.error('Failed to load proposals', err);
        if (!cancelled) {
          setError('Failed to load proposals. Please try again.');
          setProposals([]);
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
        console.error('Failed to initialise CRM proposals view', err);
        if (!cancelled) {
          setError('Failed to initialise CRM. Please refresh the page.');
          setProposals([]);
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

  const accept = async (id: string) => {
    if (!confirm('Accepting will create an order and may trigger task creation after payment. Continue?')) return;

    try {
      const { functions } = await ensureFirebase();
      if (!functions) {
        throw new Error('Proposal service is unavailable.');
      }

      const fn = httpsCallable(functions, 'admin_acceptProposal');
      await fn({ proposalId: id });
      setProposals((ps) => ps.map((p) => (p.id === id ? { ...p, status: 'accepted' } : p)));
    } catch (err: any) {
      console.error('Failed to accept proposal', err);
      alert(err?.message || 'Error accepting proposal');
    }
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Proposals</h1>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
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
