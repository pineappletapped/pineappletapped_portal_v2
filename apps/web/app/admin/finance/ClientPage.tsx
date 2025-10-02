"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalContainer from "@/components/PortalContainer";
import { ensureFirebase } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { useRoleGate } from "@/hooks/useRoleGate";

type FirestoreRecord = Record<string, any>;

function coerceDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const candidate: any = value;
  if (candidate && typeof candidate.toDate === "function") {
    try {
      return candidate.toDate();
    } catch (error) {
      console.warn("Failed to convert Firestore timestamp", error);
      return null;
    }
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    Number.isFinite(value) ? value : 0
  );

type FranchiseOption = { id: string; name: string };

function extractFranchiseId(record: FirestoreRecord | null | undefined): string {
  if (!record || typeof record !== "object") {
    return "";
  }
  const direct = typeof record.franchiseId === "string" ? record.franchiseId.trim() : "";
  if (direct) {
    return direct;
  }
  const nested = record.franchise;
  if (nested && typeof nested === "object") {
    const nestedId = typeof (nested as Record<string, unknown>).id === "string"
      ? ((nested as Record<string, unknown>).id as string).trim()
      : "";
    if (nestedId) {
      return nestedId;
    }
    const nestedFranchiseId = typeof (nested as Record<string, unknown>).franchiseId === "string"
      ? ((nested as Record<string, unknown>).franchiseId as string).trim()
      : "";
    if (nestedFranchiseId) {
      return nestedFranchiseId;
    }
  }
  const assignment = record.franchiseAssignment;
  if (assignment && typeof assignment === "object") {
    const assignmentId = typeof (assignment as Record<string, unknown>).franchiseId === "string"
      ? ((assignment as Record<string, unknown>).franchiseId as string).trim()
      : "";
    if (assignmentId) {
      return assignmentId;
    }
  }
  return "";
}

const statusTone: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-800",
  approved: "bg-emerald-100 text-emerald-700",
  paid: "bg-gray-200 text-gray-700",
  rejected: "bg-rose-100 text-rose-700",
};

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
  const [franchises, setFranchises] = useState<FranchiseOption[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>("hq");
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
        const [contrSnap, clientSnap, expSnap, projSnap, franchiseSnap] = await Promise.all([
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
          getDocs(collection(db, 'franchises')),
        ]);
        setContractorInvoices(
          contrSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
        setClientInvoices(clientSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const exps = expSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setExpenses(exps);
        setProjects(projSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFranchises(
          franchiseSnap.docs
            .map((doc) => {
              const data = doc.data() as Record<string, unknown>;
              const rawName = typeof data.name === 'string' ? data.name.trim() : '';
              return {
                id: doc.id,
                name: rawName || doc.id,
              } satisfies FranchiseOption;
            })
            .sort((a, b) => a.name.localeCompare(b.name))
        );
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

  const matchesScope = useCallback(
    (record: FirestoreRecord) => {
      if (selectedScope === 'all') {
        return true;
      }
      const franchiseId = extractFranchiseId(record).toLowerCase();
      if (selectedScope === 'hq') {
        return !franchiseId || franchiseId === 'hq' || franchiseId === 'head office' || franchiseId === 'head-office';
      }
      return franchiseId === selectedScope.toLowerCase();
    },
    [selectedScope]
  );

  const filteredContractorInvoices = useMemo(
    () => contractorInvoices.filter((invoice) => matchesScope(invoice as FirestoreRecord)),
    [contractorInvoices, matchesScope]
  );

  const filteredClientInvoices = useMemo(
    () => clientInvoices.filter((invoice) => matchesScope(invoice as FirestoreRecord)),
    [clientInvoices, matchesScope]
  );

  const filteredExpenses = useMemo(
    () => expenses.filter((expense) => matchesScope(expense as FirestoreRecord)),
    [expenses, matchesScope]
  );

  const filteredProjects = useMemo(
    () => projects.filter((project) => matchesScope(project as FirestoreRecord)),
    [projects, matchesScope]
  );

  const moneyIn = filteredClientInvoices.reduce(
    (sum, inv) => sum + (inv.total || inv.amount || 0),
    0
  );
  const moneyOut = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalProfit = moneyIn - moneyOut;
  const projectSummary = filteredProjects.map((p) => {
    const revenue = filteredClientInvoices
      .filter((ci) => ci.projectId === p.id)
      .reduce((s, ci) => s + (ci.total || ci.amount || 0), 0);
    const cost = filteredExpenses
      .filter((e) => e.projectId === p.id)
      .reduce((s, e) => s + (e.amount || 0), 0);
    return { ...p, revenue, cost, profit: revenue - cost };
  });

  type InvoiceWithDue = FirestoreRecord & { _dueDate: Date | null };
  const outstandingClientInvoices = useMemo<InvoiceWithDue[]>(() => {
    return filteredClientInvoices
      .filter((invoice: FirestoreRecord) => {
        const status = `${invoice?.status || ""}`.toLowerCase();
        return status !== "paid";
      })
      .map((invoice: FirestoreRecord) => {
        const due = coerceDate(invoice?.dueDate || invoice?.createdAt);
        return { ...(invoice as FirestoreRecord), _dueDate: due };
      })
      .sort((a, b) => {
        const left = a?._dueDate?.getTime() ?? 0;
        const right = b?._dueDate?.getTime() ?? 0;
        return right - left;
      })
      .slice(0, 6);
  }, [filteredClientInvoices]);

  const outstandingClientTotal = outstandingClientInvoices.reduce((sum, inv: any) => {
    const value = Number(inv.total || inv.amount || 0);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  type ExpenseWithDate = FirestoreRecord & { _date: Date | null };
  const recentExpenses = useMemo<ExpenseWithDate[]>(() => {
    return filteredExpenses
      .map((expense: FirestoreRecord) => {
        const when = coerceDate(expense?.date || expense?.createdAt);
        return { ...(expense as FirestoreRecord), _date: when };
      })
      .sort((a, b) => {
        const left = a?._date?.getTime() ?? 0;
        const right = b?._date?.getTime() ?? 0;
        return right - left;
      })
      .slice(0, 8);
  }, [filteredExpenses]);

  const scopeLabel = useMemo(() => {
    if (selectedScope === 'all') {
      return 'All organisations';
    }
    if (selectedScope === 'hq') {
      return 'Head office (HQ)';
    }
    const match = franchises.find((franchise) => franchise.id.toLowerCase() === selectedScope.toLowerCase());
    return match?.name || selectedScope;
  }, [franchises, selectedScope]);

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading finance data…</p>
      </PortalContainer>
    );
  }
  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">
          You do not have access to this page.
        </p>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Finance overview
            </p>
            <h1 className="text-2xl font-semibold text-gray-900">Revenue &amp; expenses</h1>
            <p className="text-sm text-gray-600">
              Monitor cash flow, reconcile contractor invoices, and keep the latest project profitability in one view.
            </p>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Snapshot · {scopeLabel}</p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-gray-500">
              View snapshot for
              <select
                className="input mt-1 w-full min-w-[12rem] sm:w-56"
                value={selectedScope}
                onChange={(event) => setSelectedScope(event.target.value)}
              >
                <option value="hq">Head office (HQ)</option>
                <option value="all">All organisations</option>
                {franchises.map((franchise) => (
                  <option key={franchise.id} value={franchise.id}>
                    {franchise.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Link href="/admin/finance/invoices/new" className="btn btn-sm">
                Create invoice
              </Link>
              <Link href="/admin/finance/expenses/new" className="btn btn-sm">
                Log expense
              </Link>
              <Link href="/admin/finance/stripe-connect" className="btn btn-xs btn-outline">
                Stripe Connect
              </Link>
            </div>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="grid gap-6">
            <section className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Money in</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatCurrency(moneyIn)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {filteredClientInvoices.length > 0
                    ? `${filteredClientInvoices.length} client ${filteredClientInvoices.length === 1 ? "invoice" : "invoices"}`
                    : "No client invoices recorded"}
                </p>
              </div>
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Money out</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatCurrency(moneyOut)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {filteredExpenses.length > 0
                    ? `${filteredExpenses.length} expense ${filteredExpenses.length === 1 ? "entry" : "entries"}`
                    : "No expenses logged"}
                </p>
              </div>
              <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Profit</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatCurrency(totalProfit)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Includes both invoiced revenue and logged expenses.
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Recent project profitability</h2>
                <p className="text-sm text-gray-600">
                  A quick glance at the last few projects to compare revenue against associated spend.
                </p>
              </div>
              {projectSummary.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">No projects to report yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium">Project</th>
                        <th className="px-6 py-3 text-right font-medium">Revenue</th>
                        <th className="px-6 py-3 text-right font-medium">Expenses</th>
                        <th className="px-6 py-3 text-right font-medium">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {projectSummary.map((p) => (
                        <tr key={p.id} className="bg-white">
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">{p.name || p.id}</td>
                          <td className="px-6 py-4 text-right text-sm text-gray-700">{formatCurrency(p.revenue)}</td>
                          <td className="px-6 py-4 text-right text-sm text-gray-700">{formatCurrency(p.cost)}</td>
                          <td className="px-6 py-4 text-right text-sm font-semibold text-gray-900">
                            {formatCurrency(p.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Contractor invoices</h2>
                <p className="text-sm text-gray-600">
                  Approve or mark payouts once the deliverables have been checked and reconciled.
                </p>
              </div>
              {filteredContractorInvoices.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">No contractor invoices awaiting action.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {filteredContractorInvoices.map((invoice) => {
                    const amountValue = Number(invoice?.amount || 0);
                    const amountLabel = Number.isFinite(amountValue)
                      ? formatCurrency(amountValue)
                      : `${invoice?.amount ?? "—"}`;
                    const statusKey = `${invoice?.status || ""}`.toLowerCase();
                    const statusClass = statusTone[statusKey] || "bg-gray-100 text-gray-700";
                    return (
                      <li key={invoice.id} className="px-6 py-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-gray-900">
                                {invoice.contractorName || invoice.contractorId || "Contractor"}
                              </p>
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}>
                                {statusKey ? statusKey.replace(/_/g, " ") : "Pending"}
                              </span>
                            </div>
                            {invoice.projectId ? (
                              <p className="text-xs uppercase tracking-wide text-gray-500">
                                Project · {invoice.projectId}
                              </p>
                            ) : null}
                            <p className="text-sm text-gray-600">Amount {amountLabel}</p>
                            {invoice.notes ? (
                              <p className="text-xs text-gray-500">{invoice.notes}</p>
                            ) : null}
                            {invoice.url ? (
                              <a
                                href={invoice.url}
                                target="_blank"
                                className="text-xs font-medium text-orange underline"
                              >
                                View supporting document
                              </a>
                            ) : null}
                          </div>
                          <div className="flex flex-col gap-2 sm:items-end">
                            {statusKey !== "approved" && (
                              <button
                                type="button"
                                className="btn btn-xs"
                                onClick={() => updateInvoiceStatus(invoice.id, "approved")}
                              >
                                Approve invoice
                              </button>
                            )}
                            {statusKey !== "paid" && (
                              <button
                                type="button"
                                className="btn btn-xs btn-outline"
                                onClick={() => updateInvoiceStatus(invoice.id, "paid")}
                              >
                                Mark as paid
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <aside className="grid gap-6">
            <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">Outstanding client invoices</h2>
                    <p className="text-sm text-gray-600">Track balances waiting to clear.</p>
                  </div>
                  <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 sm:inline-flex">
                    {formatCurrency(outstandingClientTotal)}
                  </span>
                </div>
              </div>
              {outstandingClientInvoices.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">All client invoices are settled.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {outstandingClientInvoices.map((invoice) => {
                    const amountValue = Number(invoice?.total || invoice?.amount || 0);
                    const amountLabel = Number.isFinite(amountValue)
                      ? formatCurrency(amountValue)
                      : `${invoice?.total ?? invoice?.amount ?? "—"}`;
                    const dueDate = invoice._dueDate
                      ? invoice._dueDate.toLocaleDateString()
                      : "No due date";
                    return (
                      <li key={invoice.id} className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-semibold text-gray-900">
                            {invoice.clientName || invoice.clientId || `Invoice ${invoice.id}`}
                          </p>
                          <p className="text-xs uppercase tracking-wide text-gray-500">Due {dueDate}</p>
                          <p className="text-sm text-gray-700">{amountLabel}</p>
                          {invoice.projectId ? (
                            <p className="text-xs text-gray-500">Project · {invoice.projectId}</p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Latest expenses</h2>
                <p className="text-sm text-gray-600">Recent entries ready for reconciliation.</p>
              </div>
              {recentExpenses.length === 0 ? (
                <p className="px-6 py-8 text-sm text-gray-500">No expenses have been logged yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recentExpenses.map((expense) => {
                    const amountValue = Number(expense?.amount || 0);
                    const amountLabel = Number.isFinite(amountValue)
                      ? formatCurrency(amountValue)
                      : `${expense?.amount ?? "—"}`;
                    const dateLabel = expense?._date
                      ? expense._date.toLocaleDateString()
                      : "Unscheduled";
                    return (
                      <li key={expense.id} className="px-6 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {expense.description || "Expense"}
                            </p>
                            <p className="text-xs uppercase tracking-wide text-gray-500">{dateLabel}</p>
                            {expense.projectId ? (
                              <p className="text-xs text-gray-500">Project · {expense.projectId}</p>
                            ) : (
                              <p className="text-xs text-gray-500">General business expense</p>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-gray-900">{amountLabel}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </PortalContainer>
  );
}
