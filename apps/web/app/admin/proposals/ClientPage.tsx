"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';

/**
 * Admin Quotes & Proposals Management
 *
 * Allows staff to review quote requests and proposals in one place. Items are
 * grouped into tabs for active proposals, active quotes, and archived records.
 * Status can be updated inline and quick links are provided for deeper review.
 */
export default function AdminQuotesProposalsPage() {
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'proposals' | 'quotes' | 'archived'>('proposals');
  const [proposals, setProposals] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setCanManage(false); setLoading(false); return; }
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      const me = uSnap.data() as any;
      const roles = extractUserRoles(me);
      const allowed = hasRole(roles, ['admin', 'sales']);
      setCanManage(allowed);
      if (allowed) {
        const [propSnap, quoteSnap, userSnap] = await Promise.all([
          getDocs(collection(db, 'proposals')),
          getDocs(collection(db, 'quoteRequests')),
          getDocs(collection(db, 'users')),
        ]);
        setProposals(propSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setQuotes(quoteSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setUsers(userSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
  }, []);

  const changeProposalStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, 'proposals', id), { status });
    setProposals((ps) => ps.map((p) => (p.id === id ? { ...p, status } : p)));
  };

  const changeQuoteStatus = async (id: string, status: string) => {
    await updateDoc(doc(db, 'quoteRequests', id), { status });
    setQuotes((qs) => qs.map((q) => (q.id === id ? { ...q, status } : q)));
  };

  if (loading) return <p>Loading…</p>;
  if (!canManage) return <p>You do not have permission to manage quotes or proposals.</p>;

  const activeProposals = proposals.filter((p) => p.status === 'sent');
  const archivedProposals = proposals.filter((p) => p.status !== 'sent');
  const activeQuotes = quotes.filter((q) => q.status !== 'closed');
  const archivedQuotes = quotes.filter((q) => q.status === 'closed');

  const renderProposalTable = (list: any[]) => {
    if (list.length === 0) return <p>No proposals.</p>;
    return (
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
          {list.map((p) => (
            <tr key={p.id} className="border-t">
              <td>{p.id.substring(0,6)}</td>
              <td>{p.clientEmail}</td>
              <td>
                <select
                  className="input p-1"
                  value={p.status}
                  onChange={(e) => changeProposalStatus(p.id, e.target.value)}
                >
                  {['sent','accepted','rejected'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td className="flex gap-2">
                <Link href="/crm/proposals" className="link">View</Link>
                <Link href={`/admin/proposals/new?id=${p.id}`} className="link">Edit</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderQuoteTable = (list: any[]) => {
    if (list.length === 0) return <p>No quotes.</p>;
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th>ID</th>
            <th>Project</th>
            <th>Client</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.map((q) => (
            <tr key={q.id} className="border-t">
              <td>{q.id.substring(0,6)}</td>
              <td>{q.projectName || '-'}</td>
              <td>{users.find((u) => u.id === q.userId)?.fullName || q.userId}</td>
              <td>
                <select
                  className="input p-1"
                  value={q.status}
                  onChange={(e) => changeQuoteStatus(q.id, e.target.value)}
                >
                  {['pending','reviewing','proposal','closed'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td className="flex gap-2">
                <Link href={`/crm/quotes/${q.id}`} className="link">View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Quotes &amp; Proposals</h1>
      <div className="flex items-center gap-4 border-b">
        {['proposals','quotes','archived'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            className={`px-3 py-1 -mb-px border-b-2 ${tab===t ? 'border-orange text-orange' : 'border-transparent text-gray-500'}`}
          >
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
        <div className="ml-auto flex gap-3">
          <Link href="/admin/proposals/new" className="btn">New Proposal</Link>
          <Link href="/admin/proposals/templates" className="btn-outline">Templates</Link>
        </div>
      </div>
      {tab === 'proposals' && renderProposalTable(activeProposals)}
      {tab === 'quotes' && renderQuoteTable(activeQuotes)}
      {tab === 'archived' && (
        <div className="grid gap-6">
          <div>
            <h2 className="font-semibold mb-2">Proposals</h2>
            {renderProposalTable(archivedProposals)}
          </div>
          <div>
            <h2 className="font-semibold mb-2">Quotes</h2>
            {renderQuoteTable(archivedQuotes)}
          </div>
        </div>
      )}
    </div>
  );
}
