"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ensureFirebase } from '@/lib/firebase';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { useRoleGate } from '@/hooks/useRoleGate';

/**
 * Admin Finance Dashboard
 *
 * Shows high level financial summaries and links to invoice/expense forms.
 * Staff can also review contractor invoices from here.
 */
export default function AdminFinancePage() {
  const [loading, setLoading] = useState(true);
  const [contractorInvoices, setContractorInvoices] = useState<any[]>([]);
  const [clientInvoices, setClientInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const { allowed, loading: guardLoading } = useRoleGate(['admin', 'finance']);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable');
        }
        const [contrSnap, clientSnap, expSnap, projSnap] = await Promise.all([
          getDocs(collection(db, 'invoices')),
          getDocs(collection(db, 'clientInvoices')),
          getDocs(collection(db, 'expenses')),
          getDocs(
            query(
              collection(db, 'projects'),
              orderBy('createdAt', 'desc'),
              limit(5)
            )
          ),
        ]);
        setContractorInvoices(
          contrSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
        setClientInvoices(clientSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const exps = expSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setExpenses(exps);
        setProjects(projSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load finance data', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  const updateInvoiceStatus = async (invoiceId: string, status: string) => {
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error('Firestore is unavailable');
      }
      await updateDoc(doc(db, 'invoices', invoiceId), { status });
      setContractorInvoices((prev) =>
        prev.map((inv) => (inv.id === invoiceId ? { ...inv, status } : inv))
      );
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating invoice');
    }
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have access to this page.</p>;

  const moneyIn = clientInvoices.reduce(
    (sum, inv) => sum + (inv.total || inv.amount || 0),
    0
  );
  const moneyOut = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const projectSummary = projects.map((p) => {
    const revenue = clientInvoices
      .filter((ci) => ci.projectId === p.id)
      .reduce((s, ci) => s + (ci.total || ci.amount || 0), 0);
    const cost = expenses
      .filter((e) => e.projectId === p.id)
      .reduce((s, e) => s + (e.amount || 0), 0);
    return { ...p, revenue, cost, profit: revenue - cost };
  });

  return (
    <div className="p-4 grid gap-6">
      <div className="flex gap-2">
        <Link href="/admin/finance/invoices/new" className="btn">
          Create Invoice
        </Link>
        <Link href="/admin/finance/expenses/new" className="btn">
          Log Expense
        </Link>
        <Link href="/admin/finance/stripe-connect" className="btn btn-outline">
          Stripe Connect Settings
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <h2 className="font-semibold">Money In</h2>
          <p>£{moneyIn.toFixed(2)}</p>
        </div>
        <div className="card p-4">
          <h2 className="font-semibold">Money Out</h2>
          <p>£{moneyOut.toFixed(2)}</p>
        </div>
        <div className="card p-4">
          <h2 className="font-semibold">Profit</h2>
          <p>£{(moneyIn - moneyOut).toFixed(2)}</p>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-2">Recent Projects P&L</h2>
        {projectSummary.length === 0 ? (
          <p>No projects.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-2">Project</th>
                  <th className="text-right p-2">Revenue</th>
                  <th className="text-right p-2">Expenses</th>
                  <th className="text-right p-2">Profit</th>
                </tr>
              </thead>
              <tbody>
                {projectSummary.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 text-right">£{p.revenue.toFixed(2)}</td>
                    <td className="p-2 text-right">£{p.cost.toFixed(2)}</td>
                    <td className="p-2 text-right">£{p.profit.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-2">Contractor Invoices</h2>
        {contractorInvoices.length === 0 ? (
          <p>No invoices.</p>
        ) : (
          <div className="grid gap-2">
            {contractorInvoices.map((inv) => (
              <div key={inv.id} className="border rounded p-3 grid gap-1">
                <p className="font-medium">Contractor: {inv.contractorId}</p>
                <p className="text-sm">Project: {inv.projectId}</p>
                <p className="text-sm">
                  Amount: £{inv.amount?.toFixed ? inv.amount.toFixed(2) : inv.amount}
                </p>
                <p className="text-sm">Status: {inv.status}</p>
                {inv.url && (
                  <a
                    className="text-blue-600 underline text-sm"
                    href={inv.url}
                    target="_blank"
                  >
                    View Document
                  </a>
                )}
                <div className="flex gap-2 mt-2">
                  {inv.status !== 'approved' && (
                    <button
                      className="btn-sm"
                      onClick={() => updateInvoiceStatus(inv.id, 'approved')}
                    >
                      Approve
                    </button>
                  )}
                  {inv.status !== 'paid' && (
                    <button
                      className="btn-sm"
                      onClick={() => updateInvoiceStatus(inv.id, 'paid')}
                    >
                      Mark Paid
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
