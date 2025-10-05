"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import PortalContainer from "@/components/PortalContainer";
import { useRoleGate } from "@/hooks/useRoleGate";

interface InvoiceRecord extends Record<string, unknown> {
  id: string;
  organisationName?: string;
  clientName?: string;
  clientEmail?: string | null;
  status?: string;
  total?: number;
  dueDate?: string | null;
  stripePaymentUrl?: string | null;
  portalPublished?: boolean;
  updatedAt?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  outstandingBalance?: number;
  stripePaymentIntentId?: string | null;
  lastStripePayment?: {
    intentId?: string | null;
    paymentLinkId?: string | null;
    amount?: number | null;
    currency?: string | null;
    method?: string | null;
    chargeId?: string | null;
    receiptUrl?: string | null;
    recordedAt?: string | null;
    source?: string | null;
  } | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  unpaid: "bg-amber-100 text-amber-700",
  overdue: "bg-rose-100 text-rose-700",
  paid: "bg-emerald-100 text-emerald-700",
  void: "bg-gray-200 text-gray-600",
};

const formatCurrency = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value) || 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(numeric);
};

const formatDate = (value: unknown) => {
  if (!value) {
    return "—";
  }
  const raw = typeof value === "string" ? value : String(value);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return parsed.toLocaleDateString();
};

export default function InvoiceManagementPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "finance"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [busyInvoices, setBusyInvoices] = useState<Record<string, boolean>>({});

  const loadInvoices = useCallback(async () => {
    if (!allowed) {
      setInvoices([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/invoices", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload?.error === "string" ? payload.error : "Failed to load invoices.";
        throw new Error(message);
      }
      const data = await response.json();
      const records: InvoiceRecord[] = Array.isArray(data?.invoices)
        ? data.invoices.map((entry: Record<string, unknown>) => ({
            ...(entry as InvoiceRecord),
            id: typeof entry?.id === "string" ? (entry.id as string) : "",
          }))
        : [];
      setInvoices(records.filter((record) => record.id));
    } catch (err) {
      console.error("Failed to load invoices", err);
      setError(err instanceof Error ? err.message : "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    if (guardLoading) {
      return;
    }
    if (!allowed) {
      setLoading(false);
      return;
    }
    loadInvoices();
  }, [allowed, guardLoading, loadInvoices]);

  const markInvoiceBusy = useCallback((id: string, busy: boolean) => {
    setBusyInvoices((prev) => ({ ...prev, [id]: busy }));
  }, []);

  const applyInvoiceUpdate = useCallback((invoice: InvoiceRecord) => {
    setInvoices((prev) => {
      const exists = prev.some((entry) => entry.id === invoice.id);
      if (!exists) {
        return [invoice, ...prev];
      }
      return prev.map((entry) => (entry.id === invoice.id ? invoice : entry));
    });
  }, []);

  const updateInvoice = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      markInvoiceBusy(id, true);
      try {
        const response = await fetch(`/api/admin/invoices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = typeof data?.error === "string" ? data.error : "Failed to update invoice.";
          throw new Error(message);
        }
        const result = await response.json();
        if (result?.invoice) {
          applyInvoiceUpdate(result.invoice as InvoiceRecord);
        }
      } catch (err) {
        console.error("Invoice update failed", err);
        alert(err instanceof Error ? err.message : "Failed to update invoice.");
      } finally {
        markInvoiceBusy(id, false);
      }
    },
    [applyInvoiceUpdate, markInvoiceBusy]
  );

  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => {
      const left = typeof a.updatedAt === "string" ? Date.parse(a.updatedAt) : 0;
      const right = typeof b.updatedAt === "string" ? Date.parse(b.updatedAt) : 0;
      return right - left;
    });
  }, [invoices]);

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading invoices…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">You do not have access to invoice management.</p>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Invoices</p>
            <h1 className="text-2xl font-semibold text-gray-900">Client invoicing</h1>
            <p className="text-sm text-gray-600">
              Track invoices raised for clients, share payment links, and keep records up to date.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button type="button" className="btn-outline btn-sm" onClick={loadInvoices}>
              Refresh
            </button>
            <Link href="/admin/finance/invoices/new" className="btn btn-sm">
              Create invoice
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {sortedInvoices.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No invoices have been created yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Invoice</th>
                  <th className="px-6 py-3 text-left font-medium">Client</th>
                  <th className="px-6 py-3 text-left font-medium">Due</th>
                  <th className="px-6 py-3 text-right font-medium">Total</th>
                  <th className="px-6 py-3 text-left font-medium">Status</th>
                  <th className="px-6 py-3 text-left font-medium">Portal</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {sortedInvoices.map((invoice) => {
                  const statusKey = typeof invoice.status === "string" ? invoice.status.toLowerCase() : "";
                  const badgeClass = STATUS_STYLES[statusKey] || "bg-gray-100 text-gray-700";
                  const busy = Boolean(busyInvoices[invoice.id]);
                  return (
                    <tr key={invoice.id} className={busy ? "opacity-70" : undefined}>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <Link
                            href={`/admin/finance/invoices/${invoice.id}`}
                            className="text-sm font-semibold text-gray-900 hover:underline"
                          >
                            {invoice.organisationName || invoice.clientName || `Invoice ${invoice.id}`}
                          </Link>
                          {invoice.clientEmail ? (
                            <span className="text-xs text-gray-500">{invoice.clientEmail}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col text-sm text-gray-700">
                          <span>{invoice.clientName || invoice.organisationName || '—'}</span>
                          {invoice.sentAt ? (
                            <span className="text-xs text-gray-500">Sent {formatDate(invoice.sentAt)}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatDate(invoice.dueDate)}</td>
                      <td className="px-6 py-4 text-right text-sm font-semibold text-gray-900">
                        {formatCurrency(invoice.total)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
                          {statusKey ? statusKey.replace(/_/g, " ") : "Draft"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {invoice.portalPublished ? (
                          <span className="text-emerald-600">Published</span>
                        ) : (
                          <span className="text-gray-400">Hidden</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                          {invoice.stripePaymentUrl ? (
                            <button
                              type="button"
                              className="btn-outline btn-xs"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  invoice.stripePaymentUrl &&
                                  typeof navigator !== "undefined" &&
                                  navigator.clipboard?.writeText
                                ) {
                                  navigator.clipboard
                                    .writeText(invoice.stripePaymentUrl)
                                    .then(() => {
                                      alert("Payment link copied to clipboard.");
                                    })
                                    .catch(() => {
                                      alert("Unable to copy the payment link.");
                                    });
                                }
                              }}
                            >
                              Copy link
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn-outline btn-xs"
                            disabled={busy}
                            onClick={() => updateInvoice(invoice.id, { markSent: true })}
                          >
                            Mark sent
                          </button>
                          <button
                            type="button"
                            className="btn-outline btn-xs"
                            disabled={busy}
                            onClick={() => updateInvoice(invoice.id, { markPaid: true })}
                          >
                            Mark paid
                          </button>
                          <button
                            type="button"
                            className="btn-outline btn-xs"
                            disabled={busy}
                            onClick={() =>
                              updateInvoice(invoice.id, {
                                portalPublished: !invoice.portalPublished,
                              })
                            }
                          >
                            {invoice.portalPublished ? "Unpublish" : "Publish"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PortalContainer>
  );
}
