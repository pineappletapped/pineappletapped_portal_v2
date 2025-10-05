"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PDFDownloadLink } from "@react-pdf/renderer";

import PortalContainer from "@/components/PortalContainer";
import InvoicePDF from "@/components/InvoicePDF";
import { useRoleGate } from "@/hooks/useRoleGate";

interface InvoiceLineItemRecord {
  description?: string;
  amount?: number;
  productId?: string | null;
}

interface InvoiceSplitPaymentRecord {
  amount?: number;
  dueDate?: string | null;
}

interface InvoiceRecord extends Record<string, unknown> {
  id: string;
  organisationName?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  paymentTerms?: string | null;
  termsUrl?: string | null;
  allowStripePayment?: boolean;
  dueDate?: string | null;
  items?: InvoiceLineItemRecord[];
  splitPayments?: InvoiceSplitPaymentRecord[];
  total?: number;
  outstandingBalance?: number;
  notes?: string | null;
  portalPublished?: boolean;
  status?: string;
  stripePaymentUrl?: string | null;
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
  history?: Array<{ event?: string; at?: string; notes?: string }>;
}

interface EditableLineItem {
  description: string;
  amount: string;
  productId: string;
}

interface EditableSplitPayment {
  amount: string;
  dueDate: string;
}

interface InvoiceFormState {
  organisationName: string;
  clientName: string;
  clientEmail: string;
  paymentTerms: string;
  termsUrl: string;
  allowStripePayment: boolean;
  dueDate: string;
  items: EditableLineItem[];
  splitPaymentsEnabled: boolean;
  splitPayments: EditableSplitPayment[];
  notes: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  unpaid: "bg-amber-100 text-amber-700",
  overdue: "bg-rose-100 text-rose-700",
  paid: "bg-emerald-100 text-emerald-700",
  void: "bg-gray-200 text-gray-600",
};

const formatCurrency = (value: number | string | null | undefined) => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(
    Number.isFinite(numeric) ? numeric : 0
  );
};

const toDateInput = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().split("T")[0];
};

const normaliseDateInput = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const iso = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

function ensureLineItems(items: EditableLineItem[]): EditableLineItem[] {
  if (items.length > 0) {
    return items;
  }
  return [{ description: "", amount: "", productId: "" }];
}

interface InvoiceDetailProps {
  invoiceId: string;
}

export default function InvoiceDetailClient({ invoiceId }: InvoiceDetailProps) {
  const router = useRouter();
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "finance"]);
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [form, setForm] = useState<InvoiceFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildFormState = useCallback((data: InvoiceRecord): InvoiceFormState => {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const editableItems: EditableLineItem[] = rawItems.map((item) => ({
      description: typeof item.description === "string" ? item.description : "",
      amount:
        typeof item.amount === "number"
          ? item.amount.toFixed(2)
          : typeof item.amount === "string"
          ? item.amount
          : "",
      productId: typeof item.productId === "string" ? item.productId : "",
    }));
    const rawSchedule = Array.isArray(data.splitPayments) ? data.splitPayments : [];
    const editableSchedule: EditableSplitPayment[] = rawSchedule.map((entry) => ({
      amount:
        typeof entry.amount === "number"
          ? entry.amount.toFixed(2)
          : typeof entry.amount === "string"
          ? entry.amount
          : "",
      dueDate: toDateInput(entry.dueDate ?? null),
    }));
    return {
      organisationName: typeof data.organisationName === "string" ? data.organisationName : "",
      clientName: typeof data.clientName === "string" ? data.clientName : "",
      clientEmail: typeof data.clientEmail === "string" ? data.clientEmail : "",
      paymentTerms: typeof data.paymentTerms === "string" ? data.paymentTerms : "",
      termsUrl: typeof data.termsUrl === "string" ? data.termsUrl : "",
      allowStripePayment: data.allowStripePayment !== false,
      dueDate: toDateInput(data.dueDate ?? null),
      items: ensureLineItems(editableItems),
      splitPaymentsEnabled: editableSchedule.length > 0,
      splitPayments: editableSchedule.length > 0 ? editableSchedule : [{ amount: "", dueDate: "" }],
      notes: typeof data.notes === "string" ? data.notes : "",
    };
  }, []);

  const loadInvoice = useCallback(async () => {
    if (!invoiceId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = typeof payload?.error === "string" ? payload.error : "Failed to load invoice.";
        throw new Error(message);
      }
      const result = await response.json();
      const record = result?.invoice as InvoiceRecord | undefined;
      if (record && record.id) {
        setInvoice(record);
        setForm(buildFormState(record));
      } else {
        throw new Error("Invoice not found.");
      }
    } catch (err) {
      console.error("Failed to load invoice", err);
      setError(err instanceof Error ? err.message : "Failed to load invoice.");
    } finally {
      setLoading(false);
    }
  }, [invoiceId, buildFormState]);

  useEffect(() => {
    if (!guardLoading && allowed) {
      loadInvoice();
    }
    if (!allowed && !guardLoading) {
      setLoading(false);
    }
  }, [allowed, guardLoading, loadInvoice]);

  const handleFieldChange = (field: keyof InvoiceFormState, value: string | boolean) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, [field]: value };
    });
  };

  const handleItemChange = (index: number, key: keyof EditableLineItem, value: string) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      const items = [...prev.items];
      items[index] = { ...items[index], [key]: value };
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, items: [...prev.items, { description: "", amount: "", productId: "" }] };
    });
  };

  const removeItem = (index: number) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      const next = prev.items.filter((_, idx) => idx !== index);
      return { ...prev, items: ensureLineItems(next) };
    });
  };

  const handleSplitPaymentChange = (index: number, key: keyof EditableSplitPayment, value: string) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      const schedule = [...prev.splitPayments];
      schedule[index] = { ...schedule[index], [key]: value };
      return { ...prev, splitPayments: schedule };
    });
  };

  const addSplitPayment = () => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, splitPayments: [...prev.splitPayments, { amount: "", dueDate: "" }] };
    });
  };

  const removeSplitPayment = (index: number) => {
    setForm((prev) => {
      if (!prev) {
        return prev;
      }
      const next = prev.splitPayments.filter((_, idx) => idx !== index);
      return { ...prev, splitPayments: next.length > 0 ? next : [{ amount: "", dueDate: "" }] };
    });
  };

  const sanitiseLineItems = () => {
    if (!form) {
      return [] as { description: string; amount: number; productId: string | null }[];
    }
    return form.items
      .map((item) => {
        const amountValue = Number.parseFloat(item.amount || "0");
        const amount = Number.isFinite(amountValue) ? amountValue : 0;
        const description = item.description.trim();
        return {
          description,
          amount,
          productId: item.productId.trim() || null,
        };
      })
      .filter((item) => item.description || item.amount > 0);
  };

  const buildSplitSchedule = () => {
    if (!form || !form.splitPaymentsEnabled) {
      return [] as { amount: number; dueDate: string | null }[];
    }
    return form.splitPayments
      .map((entry) => {
        const amountValue = Number.parseFloat(entry.amount || "0");
        const amount = Number.isFinite(amountValue) ? amountValue : 0;
        return {
          amount,
          dueDate: normaliseDateInput(entry.dueDate),
        };
      })
      .filter((entry) => entry.amount > 0 && entry.dueDate);
  };

  const invoiceTotal = useMemo(() => {
    if (!form) {
      return 0;
    }
    return form.items.reduce((sum, item) => {
      const value = Number.parseFloat(item.amount || "0");
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }, [form]);

  const scheduleTotal = useMemo(() => {
    if (!form || !form.splitPaymentsEnabled) {
      return 0;
    }
    return form.splitPayments.reduce((sum, entry) => {
      const value = Number.parseFloat(entry.amount || "0");
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }, [form]);

  const handleSave = async () => {
    if (!form || !invoice) {
      return;
    }
    const lineItems = sanitiseLineItems();
    if (lineItems.length === 0) {
      alert("Add at least one line item with a description or amount.");
      return;
    }
    const schedule = buildSplitSchedule();
    if (form.splitPaymentsEnabled && schedule.length === 0) {
      alert("Add at least one split payment with an amount and due date.");
      return;
    }
    if (form.splitPaymentsEnabled) {
      const scheduleSum = schedule.reduce((sum, entry) => sum + entry.amount, 0);
      if (Math.abs(scheduleSum - invoiceTotal) > 0.5) {
        alert("Split payments must match the invoice total before saving.");
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        organisationName: form.organisationName.trim() || null,
        clientName: form.clientName.trim() || null,
        clientEmail: form.clientEmail.trim() || null,
        dueDate: normaliseDateInput(form.dueDate),
        paymentTerms: form.paymentTerms.trim() || null,
        termsUrl: form.termsUrl.trim() || null,
        allowStripePayment: form.allowStripePayment,
        items: lineItems,
        splitPayments: form.splitPaymentsEnabled ? schedule : [],
        notes: form.notes.trim() || null,
      };
      const response = await fetch(`/api/admin/invoices/${invoice.id}`, {
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
        setInvoice(result.invoice as InvoiceRecord);
        setForm(buildFormState(result.invoice as InvoiceRecord));
        alert("Invoice updated");
      }
    } catch (err) {
      console.error("Failed to update invoice", err);
      alert(err instanceof Error ? err.message : "Failed to update invoice.");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAction = async (payload: Record<string, unknown>) => {
    if (!invoice) {
      return;
    }
    try {
      const response = await fetch(`/api/admin/invoices/${invoice.id}`, {
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
        setInvoice(result.invoice as InvoiceRecord);
        setForm(buildFormState(result.invoice as InvoiceRecord));
      }
    } catch (err) {
      console.error("Invoice action failed", err);
      alert(err instanceof Error ? err.message : "Failed to update invoice.");
    }
  };

  if (guardLoading || loading || !form || !invoice) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">Loading invoice…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">You do not have access to this invoice.</p>
      </PortalContainer>
    );
  }

  const statusKey = typeof invoice.status === "string" ? invoice.status.toLowerCase() : "draft";
  const badgeClass = STATUS_STYLES[statusKey] || "bg-gray-100 text-gray-700";

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Invoice</p>
            <h1 className="text-2xl font-semibold text-gray-900">{form.organisationName || form.clientName || invoice.id}</h1>
            <p className="text-sm text-gray-600">Update billing details, resend payment links, and manage the client view.</p>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
              {statusKey.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Link href="/admin/finance/invoices" className="btn-outline btn-sm">
              Back to invoices
            </Link>
            <button type="button" className="btn btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Invoice details</h2>
              <p className="text-sm text-gray-600">Edit the billing recipient, line items, and optional notes.</p>
            </div>
            <div className="space-y-5 px-6 py-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Organisation name
                  <input
                    type="text"
                    className="input mt-1 w-full"
                    value={form.organisationName}
                    onChange={(event) => handleFieldChange("organisationName", event.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Client name
                  <input
                    type="text"
                    className="input mt-1 w-full"
                    value={form.clientName}
                    onChange={(event) => handleFieldChange("clientName", event.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Client email
                  <input
                    type="email"
                    className="input mt-1 w-full"
                    value={form.clientEmail}
                    onChange={(event) => handleFieldChange("clientEmail", event.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Payment due date
                  <input
                    type="date"
                    className="input mt-1 w-full"
                    value={form.dueDate}
                    onChange={(event) => handleFieldChange("dueDate", event.target.value)}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Line items</h3>
                  <button type="button" className="btn-outline btn-xs" onClick={addItem}>
                    Add line item
                  </button>
                </div>
                <div className="space-y-3">
                  {form.items.map((item, index) => (
                    <div key={index} className="rounded-2xl border border-gray-200 p-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Description
                          <input
                            type="text"
                            className="input mt-1 w-full"
                            value={item.description}
                            onChange={(event) => handleItemChange(index, "description", event.target.value)}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Amount
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="input mt-1 w-full"
                            value={item.amount}
                            onChange={(event) => handleItemChange(index, "amount", event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <input
                          type="text"
                          className="input w-full"
                          placeholder="Product reference (optional)"
                          value={item.productId}
                          onChange={(event) => handleItemChange(index, "productId", event.target.value)}
                        />
                        {form.items.length > 1 ? (
                          <button
                            type="button"
                            className="btn-outline btn-xs ml-3 text-red-600"
                            onClick={() => removeItem(index)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Notes (internal)
                <textarea
                  className="input mt-1 h-24 resize-none"
                  value={form.notes}
                  onChange={(event) => handleFieldChange("notes", event.target.value)}
                />
              </label>
            </div>
          </section>

          <aside className="grid gap-6">
            <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Payment &amp; schedule</h2>
                <p className="text-sm text-gray-600">Manage payment terms, the online checkout, and optional split payments.</p>
              </div>
              <div className="space-y-4 px-6 py-6">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Payment terms
                  <textarea
                    className="input mt-1 h-24 resize-none"
                    value={form.paymentTerms}
                    onChange={(event) => handleFieldChange("paymentTerms", event.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Terms &amp; conditions link
                  <input
                    type="url"
                    className="input mt-1 w-full"
                    value={form.termsUrl}
                    onChange={(event) => handleFieldChange("termsUrl", event.target.value)}
                  />
                </label>
                <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  <span>Allow Stripe payments</span>
                  <input
                    type="checkbox"
                    checked={form.allowStripePayment}
                    onChange={(event) => handleFieldChange("allowStripePayment", event.target.checked)}
                  />
                </label>
                <div className="space-y-3 rounded-2xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Payment schedule</p>
                      <p className="text-xs text-gray-600">Enable instalments to collect the balance over multiple dates.</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <input
                        type="checkbox"
                        checked={form.splitPaymentsEnabled}
                        onChange={(event) =>
                          setForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  splitPaymentsEnabled: event.target.checked,
                                }
                              : prev
                          )
                        }
                      />
                      Split payments
                    </label>
                  </div>
                  {!form.splitPaymentsEnabled ? (
                    <p className="text-xs text-gray-500">Use the payment due date above for a single instalment.</p>
                  ) : (
                    <div className="space-y-3">
                      {form.splitPayments.map((split, index) => (
                        <div key={index} className="rounded-2xl border border-dashed border-gray-300 p-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Amount
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="input mt-1 w-full"
                                value={split.amount}
                                onChange={(event) => handleSplitPaymentChange(index, "amount", event.target.value)}
                              />
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                              Due date
                              <input
                                type="date"
                                className="input mt-1 w-full"
                                value={split.dueDate}
                                onChange={(event) => handleSplitPaymentChange(index, "dueDate", event.target.value)}
                              />
                            </label>
                          </div>
                          {form.splitPayments.length > 1 ? (
                            <button
                              type="button"
                              className="btn-outline btn-xs mt-3 text-red-600"
                              onClick={() => removeSplitPayment(index)}
                            >
                              Remove payment
                            </button>
                          ) : null}
                        </div>
                      ))}
                      <button type="button" className="btn-outline btn-xs" onClick={addSplitPayment}>
                        Add payment
                      </button>
                      <div className="rounded-2xl bg-gray-50 p-3 text-xs text-gray-600">
                        <p>
                          Scheduled total: <span className="font-semibold text-gray-800">{formatCurrency(scheduleTotal)}</span>
                        </p>
                        <p>
                          {Math.abs(scheduleTotal - invoiceTotal) < 0.5
                            ? "The schedule matches the invoice total."
                            : scheduleTotal > invoiceTotal
                            ? `Reduce the schedule by ${formatCurrency(scheduleTotal - invoiceTotal)}.`
                            : `Add ${formatCurrency(invoiceTotal - scheduleTotal)} to match the invoice total.`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Summary &amp; actions</h2>
                <p className="text-sm text-gray-600">Keep the invoice status aligned with reality and share payment options.</p>
              </div>
              <div className="space-y-4 px-6 py-6 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <span>Total</span>
                  <span className="text-base font-semibold text-gray-900">{formatCurrency(invoiceTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Due</span>
                  <span className="font-semibold text-gray-900">{form.dueDate || "—"}</span>
                </div>
                {invoice.stripePaymentUrl ? (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Stripe payment link</p>
                    <p className="break-all text-xs text-gray-600">{invoice.stripePaymentUrl}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-outline btn-xs"
                        onClick={() => {
                          if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(invoice.stripePaymentUrl!);
                            alert("Payment link copied to clipboard.");
                          }
                        }}
                      >
                        Copy link
                      </button>
                      <button
                        type="button"
                        className="btn-outline btn-xs"
                        onClick={() =>
                          handleQuickAction({
                            regenerateStripeLink: true,
                            items: sanitiseLineItems(),
                            allowStripePayment: true,
                          })
                        }
                      >
                        Regenerate link
                      </button>
                    </div>
                  </div>
                ) : form.allowStripePayment ? (
                  <button
                    type="button"
                    className="btn-outline btn-xs"
                    onClick={() =>
                      handleQuickAction({
                        regenerateStripeLink: true,
                        items: sanitiseLineItems(),
                        allowStripePayment: true,
                      })
                    }
                  >
                    Create payment link
                  </button>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-outline btn-xs" onClick={() => handleQuickAction({ markSent: true })}>
                    Mark sent
                  </button>
                  <button type="button" className="btn-outline btn-xs" onClick={() => handleQuickAction({ markPaid: true })}>
                    Mark paid
                  </button>
                  <button
                    type="button"
                    className="btn-outline btn-xs"
                    onClick={() => handleQuickAction({ portalPublished: !invoice.portalPublished })}
                  >
                    {invoice.portalPublished ? "Unpublish" : "Publish to portal"}
                  </button>
                </div>

                <PDFDownloadLink
                  document={
                    <InvoicePDF
                      invoice={{
                        id: invoice.id,
                        organisationName: form.organisationName || form.clientName || invoice.id,
                        clientName: form.clientName,
                        clientEmail: form.clientEmail,
                        dueDate: form.dueDate,
                        items: sanitiseLineItems(),
                        total: invoiceTotal,
                        paymentTerms: form.paymentTerms,
                        notes: form.notes,
                      }}
                    />
                  }
                  fileName={`${invoice.id || "invoice"}.pdf`}
                  className="btn-outline btn-xs"
                >
                  Download PDF
                </PDFDownloadLink>

                <button type="button" className="btn-outline btn-xs" onClick={() => router.push("/admin/finance/invoices")}> 
                  Close
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </PortalContainer>
  );
}
