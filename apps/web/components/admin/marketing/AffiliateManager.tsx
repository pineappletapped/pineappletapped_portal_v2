"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  increment,
} from "firebase/firestore";

import { ensureFirebase } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  AFFILIATE_DEFAULT_COMMISSION_RATE,
  AFFILIATE_MIN_WITHDRAWAL_NET,
  AffiliateApplicationRecord,
  AffiliateRecord,
  AffiliateStatus,
  AffiliatePayoutRecord,
  buildAffiliateShareLink,
  describeCommissionRate,
  formatCurrencyGBP,
  parseAffiliateApplicationDoc,
  parseAffiliateDoc,
  parseAffiliatePayoutDoc,
} from "@/lib/affiliates";

interface AffiliateFormState {
  name: string;
  email: string;
  company: string;
  phone: string;
  status: AffiliateStatus;
  commissionRate: number;
  refCode: string;
  notes: string;
  bankName: string;
  accountName: string;
  sortCode: string;
  accountNumber: string;
  payoutNotes: string;
}

interface PayoutFormState {
  amountNet: string;
  amountVat: string;
  amountGross: string;
  periodStart: string;
  periodEnd: string;
  notes: string;
}

const STATUS_OPTIONS: { value: AffiliateStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "inactive", label: "Inactive" },
];

function generateAffiliateCode(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  const random = Math.random().toString(36).slice(2, 6);
  return `${base || "partner"}-${random}`;
}

function roundCurrency(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function toDateInput(timestamp: Timestamp | null): string {
  if (!timestamp) return "";
  try {
    const date = timestamp.toDate();
    return date.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

export default function AffiliateManager() {
  const { allowed, loading: guardLoading } = useRoleGate(["marketing", "sales", "admin"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [affiliates, setAffiliates] = useState<AffiliateRecord[]>([]);
  const [applications, setApplications] = useState<AffiliateApplicationRecord[]>([]);
  const [payouts, setPayouts] = useState<AffiliatePayoutRecord[]>([]);
  const [newAffiliate, setNewAffiliate] = useState<AffiliateFormState>(() => ({
    name: "",
    email: "",
    company: "",
    phone: "",
    status: "pending",
    commissionRate: AFFILIATE_DEFAULT_COMMISSION_RATE,
    refCode: generateAffiliateCode("affiliate"),
    notes: "",
    bankName: "",
    accountName: "",
    sortCode: "",
    accountNumber: "",
    payoutNotes: "",
  }));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AffiliateRecord | null>(null);
  const [editingForm, setEditingForm] = useState<AffiliateFormState | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<AffiliateRecord | null>(null);
  const [payoutForm, setPayoutForm] = useState<PayoutFormState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (guardLoading || !allowed) {
      return;
    }

    let unsubscribeAffiliates: (() => void) | undefined;
    let unsubscribeApplications: (() => void) | undefined;
    let unsubscribePayouts: (() => void) | undefined;

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error("Firestore is unavailable.");
        }

        unsubscribeAffiliates = onSnapshot(
          query(collection(db, "affiliates"), orderBy("createdAt", "desc")),
          (snapshot) => {
            const list = snapshot.docs.map((docSnap) => parseAffiliateDoc(docSnap));
            setAffiliates(list);
            setLoading(false);
          },
          (err) => {
            console.error("Failed to load affiliates", err);
            setError("Unable to load affiliates");
            setLoading(false);
          }
        );

        unsubscribeApplications = onSnapshot(
          query(collection(db, "affiliateApplications"), orderBy("createdAt", "desc"), limit(50)),
          (snapshot) => {
            const list = snapshot.docs.map((docSnap) => parseAffiliateApplicationDoc(docSnap));
            setApplications(list);
          },
          (err) => {
            console.error("Failed to load affiliate applications", err);
          }
        );

        unsubscribePayouts = onSnapshot(
          query(collection(db, "affiliatePayouts"), orderBy("createdAt", "desc"), limit(25)),
          (snapshot) => {
            const list = snapshot.docs.map((docSnap) => parseAffiliatePayoutDoc(docSnap));
            setPayouts(list);
          },
          (err) => {
            console.error("Failed to load affiliate payouts", err);
          }
        );
      } catch (err) {
        console.error("Failed to initialise affiliate manager", err);
        setError("Unable to connect to Firestore.");
        setLoading(false);
      }
    })();

    return () => {
      unsubscribeAffiliates?.();
      unsubscribeApplications?.();
      unsubscribePayouts?.();
    };
  }, [allowed, guardLoading]);

  const sortedAffiliates = useMemo(
    () =>
      affiliates.slice().sort((a, b) => {
        const aTime = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      }),
    [affiliates]
  );

  const resetNewAffiliateForm = (prefill?: Partial<AffiliateFormState>) => {
    setNewAffiliate({
      name: prefill?.name ?? "",
      email: prefill?.email ?? "",
      company: prefill?.company ?? "",
      phone: prefill?.phone ?? "",
      status: "pending",
      commissionRate: prefill?.commissionRate ?? AFFILIATE_DEFAULT_COMMISSION_RATE,
      refCode: generateAffiliateCode(prefill?.name || "affiliate"),
      notes: prefill?.notes ?? "",
      bankName: prefill?.bankName ?? "",
      accountName: prefill?.accountName ?? "",
      sortCode: prefill?.sortCode ?? "",
      accountNumber: prefill?.accountNumber ?? "",
      payoutNotes: prefill?.payoutNotes ?? "",
    });
  };

  const handleCreateAffiliate = async (event: FormEvent) => {
    event.preventDefault();
    setActionError(null);
    setCreating(true);
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firestore is unavailable.");
      }
      const payload = newAffiliate;
      if (!payload.name.trim()) {
        throw new Error("Affiliate name is required.");
      }
      if (!payload.refCode.trim()) {
        throw new Error("Share code is required.");
      }

      await addDoc(collection(db, "affiliates"), {
        name: payload.name.trim(),
        email: payload.email.trim() || null,
        company: payload.company.trim() || null,
        phone: payload.phone.trim() || null,
        status: payload.status,
        commissionRate: Number(payload.commissionRate) || AFFILIATE_DEFAULT_COMMISSION_RATE,
        refCode: payload.refCode.trim(),
        refCodeLower: payload.refCode.trim().toLowerCase(),
        notes: payload.notes.trim() || null,
        payout: {
          bankName: payload.bankName.trim() || null,
          accountName: payload.accountName.trim() || null,
          sortCode: payload.sortCode.trim() || null,
          accountNumber: payload.accountNumber.trim() || null,
          notes: payload.payoutNotes.trim() || null,
        },
        metrics: {
          totalOrders: 0,
          totalRevenueGross: 0,
          totalCommissionNet: 0,
          totalCommissionVat: 0,
          totalCommissionGross: 0,
          pendingCommissionNet: 0,
          pendingCommissionVat: 0,
          pendingCommissionGross: 0,
          paidCommissionNet: 0,
          paidCommissionVat: 0,
          paidCommissionGross: 0,
          totalLeads: 0,
          totalQuotes: 0,
          totalClicks: 0,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastReferralAt: null,
      });

      resetNewAffiliateForm();
    } catch (err: any) {
      console.error("Failed to create affiliate", err);
      setActionError(err?.message || "Unable to create affiliate");
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (record: AffiliateRecord) => {
    setEditing(record);
    setEditingForm({
      name: record.name,
      email: record.email ?? "",
      company: record.company ?? "",
      phone: record.phone ?? "",
      status: record.status,
      commissionRate: record.commissionRate || AFFILIATE_DEFAULT_COMMISSION_RATE,
      refCode: record.refCode,
      notes: record.notes ?? "",
      bankName: record.payout.bankName ?? "",
      accountName: record.payout.accountName ?? "",
      sortCode: record.payout.sortCode ?? "",
      accountNumber: record.payout.accountNumber ?? "",
      payoutNotes: record.payout.notes ?? "",
    });
    setActionError(null);
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || !editingForm) return;
    setActionError(null);
    try {
      const { db } = await ensureFirebase();
      if (!db) throw new Error("Firestore is unavailable.");

      const ref = doc(db, "affiliates", editing.id);
      await updateDoc(ref, {
        name: editingForm.name.trim() || editing.name,
        email: editingForm.email.trim() || null,
        company: editingForm.company.trim() || null,
        phone: editingForm.phone.trim() || null,
        status: editingForm.status,
        commissionRate: Number(editingForm.commissionRate) || AFFILIATE_DEFAULT_COMMISSION_RATE,
        refCode: editingForm.refCode.trim() || editing.refCode,
        refCodeLower: (editingForm.refCode.trim() || editing.refCode).toLowerCase(),
        notes: editingForm.notes.trim() || null,
        payout: {
          bankName: editingForm.bankName.trim() || null,
          accountName: editingForm.accountName.trim() || null,
          sortCode: editingForm.sortCode.trim() || null,
          accountNumber: editingForm.accountNumber.trim() || null,
          notes: editingForm.payoutNotes.trim() || null,
        },
        updatedAt: serverTimestamp(),
      });

      setEditing(null);
      setEditingForm(null);
    } catch (err: any) {
      console.error("Failed to update affiliate", err);
      setActionError(err?.message || "Unable to update affiliate");
    }
  };

  const openPayoutModal = (record: AffiliateRecord) => {
    const net = roundCurrency(record.metrics.pendingCommissionNet);
    const vat = roundCurrency(record.metrics.pendingCommissionVat);
    const gross = roundCurrency(record.metrics.pendingCommissionGross || net + vat);
    setPayoutTarget(record);
    setPayoutForm({
      amountNet: net ? net.toFixed(2) : "",
      amountVat: vat ? vat.toFixed(2) : "",
      amountGross: gross ? gross.toFixed(2) : "",
      periodStart: "",
      periodEnd: "",
      notes: "",
    });
    setActionError(null);
  };

  const submitPayout = async (event: FormEvent) => {
    event.preventDefault();
    if (!payoutTarget || !payoutForm) return;
    setActionError(null);

    try {
      const { db } = await ensureFirebase();
      if (!db) throw new Error("Firestore is unavailable.");

      const net = roundCurrency(Number(payoutForm.amountNet));
      const vat = roundCurrency(Number(payoutForm.amountVat));
      const grossInput = payoutForm.amountGross ? Number(payoutForm.amountGross) : net + vat;
      const gross = roundCurrency(grossInput);
      if (net <= 0) {
        throw new Error("Net payout must be greater than zero.");
      }

      const pendingNet = roundCurrency(payoutTarget.metrics.pendingCommissionNet);
      const pendingVat = roundCurrency(payoutTarget.metrics.pendingCommissionVat);
      const pendingGross = roundCurrency(payoutTarget.metrics.pendingCommissionGross);
      const netDelta = Math.min(net, pendingNet);
      const vatDelta = Math.min(vat, pendingVat);
      const grossDelta = Math.min(gross, pendingGross || net + vat);

      const parseDate = (value: string): Timestamp | null => {
        if (!value) return null;
        const safe = new Date(value);
        return Number.isNaN(safe.getTime()) ? null : Timestamp.fromDate(safe);
      };

      await addDoc(collection(db, "affiliatePayouts"), {
        affiliateId: payoutTarget.id,
        affiliateName: payoutTarget.name,
        affiliateRefCode: payoutTarget.refCode,
        amountNet: net,
        amountVat: vat,
        amountGross: gross,
        currency: "GBP",
        periodStart: parseDate(payoutForm.periodStart),
        periodEnd: parseDate(payoutForm.periodEnd),
        notes: payoutForm.notes.trim() || null,
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "affiliates", payoutTarget.id), {
        metrics: {
          pendingCommissionNet: increment(-netDelta),
          pendingCommissionVat: increment(-vatDelta),
          pendingCommissionGross: increment(-grossDelta),
          paidCommissionNet: increment(net),
          paidCommissionVat: increment(vat),
          paidCommissionGross: increment(gross),
        },
        updatedAt: serverTimestamp(),
        lastPayoutAt: serverTimestamp(),
      });

      setPayoutTarget(null);
      setPayoutForm(null);
    } catch (err: any) {
      console.error("Failed to record payout", err);
      setActionError(err?.message || "Unable to record payout");
    }
  };

  const handleCopyLink = (affiliate: AffiliateRecord) => {
    const link = buildAffiliateShareLink(affiliate.refCode);
    if (!link) return;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopyMessage(`Copied link for ${affiliate.name}`);
        setTimeout(() => setCopyMessage(null), 2500);
      })
      .catch(() => {
        setCopyMessage("Unable to copy link");
        setTimeout(() => setCopyMessage(null), 2500);
      });
  };

  if (guardLoading) {
    return <p className="text-sm text-gray-600">Checking permissions…</p>;
  }

  if (!allowed) {
    return <p className="text-sm text-gray-600">You do not have access to the affiliate workspace.</p>;
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Affiliate programme</h1>
            <p className="text-sm text-gray-600">
              Manage partner onboarding, referral tracking and commission payouts in one place.
            </p>
          </div>
          {copyMessage ? <span className="text-xs text-emerald-600">{copyMessage}</span> : null}
        </header>
        <form className="mt-6 grid gap-4" onSubmit={handleCreateAffiliate}>
          <h2 className="text-base font-semibold text-gray-900">Add a new affiliate partner</h2>
          {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Name *</span>
              <input
                className="input"
                value={newAffiliate.name}
                onChange={(event) => setNewAffiliate((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Email</span>
              <input
                className="input"
                type="email"
                value={newAffiliate.email}
                onChange={(event) => setNewAffiliate((prev) => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Company</span>
              <input
                className="input"
                value={newAffiliate.company}
                onChange={(event) => setNewAffiliate((prev) => ({ ...prev, company: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Phone</span>
              <input
                className="input"
                value={newAffiliate.phone}
                onChange={(event) => setNewAffiliate((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Commission rate</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1.5}
                step={0.01}
                value={newAffiliate.commissionRate}
                onChange={(event) =>
                  setNewAffiliate((prev) => ({ ...prev, commissionRate: Number(event.target.value) }))
                }
              />
              <span className="text-xs text-gray-500">
                {describeCommissionRate(Number(newAffiliate.commissionRate) || AFFILIATE_DEFAULT_COMMISSION_RATE)}
              </span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Share code</span>
              <input
                className="input"
                value={newAffiliate.refCode}
                onChange={(event) => setNewAffiliate((prev) => ({ ...prev, refCode: event.target.value }))}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">Notes</span>
            <textarea
              className="input min-h-[60px]"
              value={newAffiliate.notes}
              onChange={(event) => setNewAffiliate((prev) => ({ ...prev, notes: event.target.value }))}
            />
          </label>
          <details className="rounded-lg border border-dashed border-gray-300 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-gray-700">
              Payout details (optional)
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Bank name</span>
                <input
                  className="input"
                  value={newAffiliate.bankName}
                  onChange={(event) => setNewAffiliate((prev) => ({ ...prev, bankName: event.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Account name</span>
                <input
                  className="input"
                  value={newAffiliate.accountName}
                  onChange={(event) => setNewAffiliate((prev) => ({ ...prev, accountName: event.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Sort code</span>
                <input
                  className="input"
                  value={newAffiliate.sortCode}
                  onChange={(event) => setNewAffiliate((prev) => ({ ...prev, sortCode: event.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Account number</span>
                <input
                  className="input"
                  value={newAffiliate.accountNumber}
                  onChange={(event) => setNewAffiliate((prev) => ({ ...prev, accountNumber: event.target.value }))}
                />
              </label>
              <label className="md:col-span-2 grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Payout notes</span>
                <textarea
                  className="input min-h-[60px]"
                  value={newAffiliate.payoutNotes}
                  onChange={(event) => setNewAffiliate((prev) => ({ ...prev, payoutNotes: event.target.value }))}
                />
              </label>
            </div>
          </details>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn" disabled={creating}>
              {creating ? "Creating…" : "Add affiliate"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => resetNewAffiliateForm()}>
              Reset
            </button>
          </div>
        </form>
      </section>

      {loading ? (
        <p className="text-sm text-gray-600">Loading affiliates…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold text-gray-900">Active partners</h2>
          {sortedAffiliates.length === 0 ? (
            <p className="text-sm text-gray-600">No affiliates registered yet.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {sortedAffiliates.map((affiliate) => {
                const link = buildAffiliateShareLink(affiliate.refCode);
                const pendingNet = roundCurrency(affiliate.metrics.pendingCommissionNet);
                const eligibleForPayout = pendingNet >= AFFILIATE_MIN_WITHDRAWAL_NET;
                return (
                  <article
                    key={affiliate.id}
                    className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm"
                  >
                    <header className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">{affiliate.name}</h3>
                        <p className="text-xs text-gray-500">
                          {affiliate.email || 'No email provided'} · Status: {affiliate.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleCopyLink(affiliate)}
                      >
                        Copy link
                      </button>
                    </header>
                    <dl className="mt-4 grid gap-2 text-sm text-gray-700">
                      <div className="flex items-center justify-between">
                        <dt className="font-medium">Commission</dt>
                        <dd>{describeCommissionRate(affiliate.commissionRate)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="font-medium">Total earned</dt>
                        <dd>{formatCurrencyGBP(affiliate.metrics.totalCommissionGross)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="font-medium">Pending payout</dt>
                        <dd>{formatCurrencyGBP(affiliate.metrics.pendingCommissionGross)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="font-medium">Total orders</dt>
                        <dd>{affiliate.metrics.totalOrders}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openEditModal(affiliate)}>
                        Update details
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openPayoutModal(affiliate)}
                        disabled={!eligibleForPayout}
                      >
                        {eligibleForPayout ? 'Record payout' : `Need £${AFFILIATE_MIN_WITHDRAWAL_NET.toFixed(0)}+ net`}
                      </button>
                    </div>
                    <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                      <p className="font-medium text-gray-700">Share link</p>
                      <p className="break-all">{link}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Affiliate applications</h2>
          <span className="text-xs text-gray-500">{applications.length} recent submissions</span>
        </div>
        {applications.length === 0 ? (
          <p className="text-sm text-gray-600">No pending applications.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Applicant</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Focus</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Stage</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Submitted</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {applications.map((application) => {
                  const submitted = application.createdAt?.toDate?.();
                  return (
                    <tr key={application.id}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-gray-900">{application.fullName}</div>
                        <div className="text-xs text-gray-500">{application.email}</div>
                        {application.phone ? (
                          <div className="text-xs text-gray-500">{application.phone}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="text-sm text-gray-700">{application.focus || '—'}</div>
                        {application.notes ? (
                          <div className="mt-1 text-xs text-gray-500 whitespace-pre-line">{application.notes}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top text-sm text-gray-600">
                        {application.stage || application.status || 'New'}
                      </td>
                      <td className="px-3 py-2 align-top text-sm text-gray-600">
                        {submitted ? submitted.toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2 align-top text-sm">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() =>
                            resetNewAffiliateForm({
                              name: application.fullName,
                              email: application.email,
                              company: application.location ?? '',
                              phone: application.phone ?? '',
                              notes: application.notes ?? '',
                            })
                          }
                        >
                          Prefill new affiliate
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Recent payouts</h2>
        {payouts.length === 0 ? (
          <p className="text-sm text-gray-600">No payout records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Affiliate</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Net</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">VAT</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Gross</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Period</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {payouts.map((payout) => {
                  const created = payout.createdAt?.toDate?.();
                  return (
                    <tr key={payout.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{payout.affiliateName ?? payout.affiliateId}</div>
                        <div className="text-xs text-gray-500">Code: {payout.affiliateRefCode ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2">{formatCurrencyGBP(payout.amountNet)}</td>
                      <td className="px-3 py-2">{formatCurrencyGBP(payout.amountVat)}</td>
                      <td className="px-3 py-2">{formatCurrencyGBP(payout.amountGross)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {toDateInput(payout.periodStart) || '—'} — {toDateInput(payout.periodEnd) || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {created ? created.toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && editingForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <form className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onSubmit={submitEdit}>
            <h3 className="text-lg font-semibold text-gray-900">Update affiliate</h3>
            {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Name</span>
                <input
                  className="input"
                  value={editingForm.name}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, name: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Email</span>
                <input
                  className="input"
                  value={editingForm.email}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, email: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Company</span>
                <input
                  className="input"
                  value={editingForm.company}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, company: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Phone</span>
                <input
                  className="input"
                  value={editingForm.phone}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, phone: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Status</span>
                <select
                  className="input"
                  value={editingForm.status}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, status: event.target.value as AffiliateStatus })
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Commission rate</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={editingForm.commissionRate}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, commissionRate: Number(event.target.value) })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Share code</span>
                <input
                  className="input"
                  value={editingForm.refCode}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, refCode: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Notes</span>
              <textarea
                className="input min-h-[60px]"
                value={editingForm.notes}
                onChange={(event) =>
                  setEditingForm((prev) => prev && { ...prev, notes: event.target.value })
                }
              />
            </label>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Bank name</span>
                <input
                  className="input"
                  value={editingForm.bankName}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, bankName: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Account name</span>
                <input
                  className="input"
                  value={editingForm.accountName}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, accountName: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Sort code</span>
                <input
                  className="input"
                  value={editingForm.sortCode}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, sortCode: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Account number</span>
                <input
                  className="input"
                  value={editingForm.accountNumber}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, accountNumber: event.target.value })
                  }
                />
              </label>
              <label className="md:col-span-2 grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Payout notes</span>
                <textarea
                  className="input min-h-[60px]"
                  value={editingForm.payoutNotes}
                  onChange={(event) =>
                    setEditingForm((prev) => prev && { ...prev, payoutNotes: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="submit" className="btn">
                Save changes
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {payoutTarget && payoutForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <form className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl" onSubmit={submitPayout}>
            <h3 className="text-lg font-semibold text-gray-900">Record payout for {payoutTarget.name}</h3>
            {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Net amount</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={payoutForm.amountNet}
                  onChange={(event) =>
                    setPayoutForm((prev) => prev && { ...prev, amountNet: event.target.value })
                  }
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">VAT</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={payoutForm.amountVat}
                  onChange={(event) =>
                    setPayoutForm((prev) => prev && { ...prev, amountVat: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Gross</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={payoutForm.amountGross}
                  onChange={(event) =>
                    setPayoutForm((prev) => prev && { ...prev, amountGross: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Period start</span>
                <input
                  className="input"
                  type="date"
                  value={payoutForm.periodStart}
                  onChange={(event) =>
                    setPayoutForm((prev) => prev && { ...prev, periodStart: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Period end</span>
                <input
                  className="input"
                  type="date"
                  value={payoutForm.periodEnd}
                  onChange={(event) =>
                    setPayoutForm((prev) => prev && { ...prev, periodEnd: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Notes</span>
              <textarea
                className="input min-h-[60px]"
                value={payoutForm.notes}
                onChange={(event) => setPayoutForm((prev) => prev && { ...prev, notes: event.target.value })}
              />
            </label>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="submit" className="btn">
                Record payout
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setPayoutTarget(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
