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
  writeBatch,
} from "firebase/firestore";

import { ensureFirebase } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  AFFILIATE_DEFAULT_COMMISSION_RATE,
  AFFILIATE_MIN_WITHDRAWAL_NET,
  AffiliateApplicationRecord,
  AffiliateApplicationDecisionAction,
  AffiliateApplicationReviewEntry,
  AffiliateRecord,
  AffiliateStatus,
  AffiliatePayoutRecord,
  AffiliateCommissionRecord,
  AffiliateCommissionStatus,
  buildAffiliateCommissionCsv,
  buildAffiliateShareLink,
  describeCommissionRate,
  formatCurrencyGBP,
  parseAffiliateApplicationDoc,
  parseAffiliateDoc,
  parseAffiliatePayoutDoc,
  parseAffiliateCommissionDoc,
} from "@/lib/affiliates";

type ApplicationFilterKey = "all" | "pending" | "approved" | "rejected" | "info";

interface ApplicationStatusDescriptor {
  category: Exclude<ApplicationFilterKey, "all">;
  label: string;
  badgeClass: string;
}

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
  selectedCommissionIds: string[];
  status: AffiliateCommissionStatus;
}

interface PayoutModalOptions {
  statuses?: AffiliateCommissionStatus[];
  preselectIds?: string[];
  initialStatus?: AffiliateCommissionStatus;
  payoutId?: string;
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

function sumCommissionTotals(entries: AffiliateCommissionRecord[]): {
  net: number;
  vat: number;
  gross: number;
} {
  return entries.reduce(
    (acc, entry) => {
      acc.net += roundCurrency(entry.commissionNet);
      acc.vat += roundCurrency(entry.commissionVat);
      acc.gross += roundCurrency(entry.commissionGross);
      return acc;
    },
    { net: 0, vat: 0, gross: 0 }
  );
}

export default function AffiliateManager() {
  const { allowed, loading: guardLoading } = useRoleGate(["marketing", "sales", "admin"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [affiliates, setAffiliates] = useState<AffiliateRecord[]>([]);
  const [applications, setApplications] = useState<AffiliateApplicationRecord[]>([]);
  const [payouts, setPayouts] = useState<AffiliatePayoutRecord[]>([]);
  const [commissions, setCommissions] = useState<AffiliateCommissionRecord[]>([]);
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
  const [payoutCandidateStatuses, setPayoutCandidateStatuses] = useState<
    AffiliateCommissionStatus[]
  >(["pending"]);
  const [payoutCandidatePayoutId, setPayoutCandidatePayoutId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<AffiliateApplicationRecord | null>(null);
  const [reviewAction, setReviewAction] = useState<AffiliateApplicationDecisionAction>("approve");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [applicationFilter, setApplicationFilter] = useState<ApplicationFilterKey>("pending");
  const [commissionFilter, setCommissionFilter] = useState<
    "all" | AffiliateCommissionStatus
  >("pending");
  const [exportingLedger, setExportingLedger] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const applicationFilterOptions: Array<{ key: ApplicationFilterKey; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "info", label: "Needs info" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  useEffect(() => {
    if (!reviewFeedback) {
      return;
    }
    const timeout = window.setTimeout(() => setReviewFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [reviewFeedback]);

  useEffect(() => {
    if (!reviewTarget) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setReviewTarget(null);
        setReviewNotes("");
        setReviewError(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    let originalOverflow: string | undefined;
    if (typeof document !== "undefined") {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (typeof document !== "undefined") {
        document.body.style.overflow = originalOverflow ?? "";
      }
    };
  }, [reviewTarget]);

  useEffect(() => {
    if (guardLoading || !allowed) {
      return;
    }

    let unsubscribeAffiliates: (() => void) | undefined;
    let unsubscribeApplications: (() => void) | undefined;
    let unsubscribePayouts: (() => void) | undefined;
    let unsubscribeCommissions: (() => void) | undefined;

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

        unsubscribeCommissions = onSnapshot(
          query(collection(db, "affiliateCommissions"), orderBy("createdAt", "desc"), limit(200)),
          (snapshot) => {
            const list = snapshot.docs.map((docSnap) => parseAffiliateCommissionDoc(docSnap));
            setCommissions(list);
          },
          (err) => {
            console.error("Failed to load affiliate commission ledger", err);
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
      unsubscribeCommissions?.();
    };
  }, [allowed, guardLoading]);

  const resolveApplicationStatus = (
    application: AffiliateApplicationRecord
  ): ApplicationStatusDescriptor => {
    const statusRaw = application.status?.toLowerCase?.() ?? "";
    const stageRaw = application.stage?.toLowerCase?.() ?? "";
    if (statusRaw === "approved") {
      return {
        category: "approved" as const,
        label: "Approved",
        badgeClass: "bg-emerald-100 text-emerald-700",
      };
    }
    if (statusRaw === "rejected") {
      return {
        category: "rejected" as const,
        label: "Rejected",
        badgeClass: "bg-rose-100 text-rose-700",
      };
    }
    if (statusRaw === "info_requested" || stageRaw === "info_requested" || stageRaw === "needs_info") {
      return {
        category: "info" as const,
        label: "Info requested",
        badgeClass: "bg-amber-100 text-amber-700",
      };
    }
    if (stageRaw === "under_review") {
      return {
        category: "pending" as const,
        label: "Under review",
        badgeClass: "bg-sky-100 text-sky-700",
      };
    }
    return {
      category: "pending",
      label: "Pending review",
      badgeClass: "bg-sky-100 text-sky-700",
    };
  };

  const sortedAffiliates = useMemo(
    () =>
      affiliates.slice().sort((a, b) => {
        const aTime = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      }),
    [affiliates]
  );

  const pendingCommissionTotals = useMemo(() => {
    const map = new Map<string, { net: number; vat: number; gross: number }>();
    commissions.forEach((entry) => {
      if (entry.status !== "pending") {
        return;
      }
      const existing = map.get(entry.affiliateId) ?? { net: 0, vat: 0, gross: 0 };
      existing.net += roundCurrency(entry.commissionNet);
      existing.vat += roundCurrency(entry.commissionVat);
      existing.gross += roundCurrency(entry.commissionGross);
      map.set(entry.affiliateId, existing);
    });
    return map;
  }, [commissions]);

  const scheduledCommissionTotals = useMemo(() => {
    const map = new Map<string, { net: number; vat: number; gross: number }>();
    commissions.forEach((entry) => {
      if (entry.status !== "scheduled") {
        return;
      }
      const existing = map.get(entry.affiliateId) ?? { net: 0, vat: 0, gross: 0 };
      existing.net += roundCurrency(entry.commissionNet);
      existing.vat += roundCurrency(entry.commissionVat);
      existing.gross += roundCurrency(entry.commissionGross);
      map.set(entry.affiliateId, existing);
    });
    return map;
  }, [commissions]);

  const commissionFilterOptions: Array<{ key: "all" | AffiliateCommissionStatus; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "scheduled", label: "Scheduled" },
    { key: "paid", label: "Paid" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const filteredCommissions = useMemo(() => {
    if (commissionFilter === "all") {
      return commissions;
    }
    return commissions.filter((entry) => entry.status === commissionFilter);
  }, [commissions, commissionFilter]);

  const commissionCounts = useMemo(() => {
    const counts: Record<"all" | AffiliateCommissionStatus, number> = {
      all: commissions.length,
      pending: 0,
      scheduled: 0,
      paid: 0,
      cancelled: 0,
    };
    commissions.forEach((entry) => {
      counts[entry.status] += 1;
    });
    return counts;
  }, [commissions]);

  const payoutSelectionEntries = useMemo(() => {
    if (!payoutForm) {
      return [] as AffiliateCommissionRecord[];
    }
    return payoutForm.selectedCommissionIds
      .map((id) => commissions.find((entry) => entry.id === id) || null)
      .filter((entry): entry is AffiliateCommissionRecord => Boolean(entry));
  }, [commissions, payoutForm]);

  const payoutCandidateEntries = useMemo(() => {
    if (!payoutTarget) {
      return [] as AffiliateCommissionRecord[];
    }
    return commissions.filter(
      (entry) =>
        entry.affiliateId === payoutTarget.id &&
        payoutCandidateStatuses.includes(entry.status as AffiliateCommissionStatus)
        && (!payoutCandidatePayoutId || entry.payoutId === payoutCandidatePayoutId)
    );
  }, [
    commissions,
    payoutCandidatePayoutId,
    payoutCandidateStatuses,
    payoutTarget,
  ]);

  const payoutCandidateStatusLabel = useMemo(() => {
    if (payoutCandidateStatuses.length === 0) {
      return "selected";
    }
    const labels = payoutCandidateStatuses.map(
      (status) => status.charAt(0).toUpperCase() + status.slice(1)
    );
    if (labels.length === 1) {
      return labels[0];
    }
    if (labels.length === 2) {
      return `${labels[0]} or ${labels[1]}`;
    }
    return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
  }, [payoutCandidateStatuses]);

  const payoutCandidateStatusSummary = useMemo(() => {
    if (payoutCandidateStatusLabel === "selected") {
      if (payoutCandidatePayoutId) {
        return `Showing commissions from payout ${payoutCandidatePayoutId.slice(0, 8)}`;
      }
      return null;
    }
    const base = `Showing ${payoutCandidateStatusLabel.toLowerCase()} commissions`;
    if (payoutCandidatePayoutId) {
      return `${base} from payout ${payoutCandidatePayoutId.slice(0, 8)}`;
    }
    return base;
  }, [payoutCandidatePayoutId, payoutCandidateStatusLabel]);

  const payoutCandidateEmptyMessage = useMemo(() => {
    const payoutContext = payoutCandidatePayoutId
      ? ` from payout ${payoutCandidatePayoutId.slice(0, 8)}`
      : "";
    if (payoutCandidateStatusLabel === "selected") {
      return `No commission entries${payoutContext} are ready for payout yet.`;
    }
    return `No ${payoutCandidateStatusLabel.toLowerCase()} commission entries${payoutContext} are ready for payout yet.`;
  }, [payoutCandidatePayoutId, payoutCandidateStatusLabel]);

  const applicationCounts = useMemo<Record<ApplicationFilterKey, number>>(() => {
    const counts: Record<ApplicationFilterKey, number> = {
      all: applications.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      info: 0,
    };
    applications.forEach((application) => {
      const descriptor = resolveApplicationStatus(application);
      counts[descriptor.category] += 1;
    });
    return counts;
  }, [applications]);

  const filteredApplications = useMemo(() => {
    if (applicationFilter === "all") {
      return applications;
    }
    return applications.filter((application) => {
      const descriptor = resolveApplicationStatus(application);
      if (applicationFilter === "pending") {
        return descriptor.category === "pending";
      }
      return descriptor.category === applicationFilter;
    });
  }, [applicationFilter, applications]);

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
          scheduledCommissionNet: 0,
          scheduledCommissionVat: 0,
          scheduledCommissionGross: 0,
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

  const openPayoutModal = (record: AffiliateRecord, options?: PayoutModalOptions) => {
    const statuses = options?.statuses?.length
      ? (Array.from(new Set(options.statuses)) as AffiliateCommissionStatus[])
      : (["pending"] as AffiliateCommissionStatus[]);
    const existingPayoutRecord = options?.payoutId
      ? payouts.find((payout) => payout.id === options.payoutId) ?? null
      : null;
    const eligibleEntries = commissions.filter(
      (entry) =>
        entry.affiliateId === record.id &&
        statuses.includes(entry.status as AffiliateCommissionStatus) &&
        (!options?.payoutId || entry.payoutId === options.payoutId)
    );
    const defaultSelectedIds = options?.preselectIds?.length
      ? eligibleEntries
          .filter((entry) => options.preselectIds?.includes(entry.id))
          .map((entry) => entry.id)
      : eligibleEntries.map((entry) => entry.id);
    const selectedEntries = eligibleEntries.filter((entry) =>
      defaultSelectedIds.includes(entry.id)
    );
    const totals = sumCommissionTotals(selectedEntries);
    setPayoutCandidateStatuses(statuses);
    setPayoutCandidatePayoutId(options?.payoutId ?? null);
    setPayoutTarget(record);
    setPayoutForm({
      amountNet: totals.net ? totals.net.toFixed(2) : "",
      amountVat: totals.vat ? totals.vat.toFixed(2) : "",
      amountGross: totals.gross ? totals.gross.toFixed(2) : "",
      periodStart: existingPayoutRecord?.periodStart
        ? toDateInput(existingPayoutRecord.periodStart)
        : "",
      periodEnd: existingPayoutRecord?.periodEnd
        ? toDateInput(existingPayoutRecord.periodEnd)
        : "",
      notes: existingPayoutRecord?.notes ?? "",
      selectedCommissionIds: defaultSelectedIds,
      status:
        options?.initialStatus ??
        (statuses.length === 1 && statuses[0] === "scheduled" ? "paid" : "paid"),
    });
    setActionError(null);
  };

  const resetPayoutModalState = () => {
    setPayoutTarget(null);
    setPayoutForm(null);
    setPayoutCandidateStatuses(["pending"]);
    setPayoutCandidatePayoutId(null);
    setActionError(null);
  };

  const submitPayout = async (event: FormEvent) => {
    event.preventDefault();
    if (!payoutTarget || !payoutForm) return;
    setActionError(null);

    try {
      const { db } = await ensureFirebase();
      if (!db) throw new Error("Firestore is unavailable.");

      const selectedEntries = payoutForm.selectedCommissionIds
        .map((id) => commissions.find((entry) => entry.id === id) || null)
        .filter((entry): entry is AffiliateCommissionRecord => Boolean(entry));
      if (selectedEntries.length === 0) {
        throw new Error("Select at least one commission ledger entry.");
      }

      const overallTotals = sumCommissionTotals(selectedEntries);
      if (overallTotals.net <= 0) {
        throw new Error("Selected commission total must be greater than zero.");
      }

      const pendingTotalsSelection = sumCommissionTotals(
        selectedEntries.filter((entry) => entry.status === "pending")
      );
      const scheduledTotalsSelection = sumCommissionTotals(
        selectedEntries.filter((entry) => entry.status === "scheduled")
      );

      const roundTotals = (totals: { net: number; vat: number; gross: number }) => ({
        net: roundCurrency(totals.net),
        vat: roundCurrency(totals.vat),
        gross: roundCurrency(totals.gross),
      });

      const roundedOverall = roundTotals(overallTotals);
      const roundedPendingSelection = roundTotals(pendingTotalsSelection);
      const roundedScheduledSelection = roundTotals(scheduledTotalsSelection);

      const statusToApply: AffiliateCommissionStatus =
        payoutForm.status === "scheduled" ? "scheduled" : "paid";

      const computeDelta = (total: number, snapshot?: number) => {
        const safeTotal = roundCurrency(total);
        if (safeTotal <= 0) {
          return 0;
        }
        const safeSnapshot =
          typeof snapshot === "number" && Number.isFinite(snapshot)
            ? Math.max(0, roundCurrency(snapshot))
            : safeTotal;
        return Math.max(0, Math.min(safeTotal, safeSnapshot));
      };

      const candidatePayoutIds = new Set(
        selectedEntries
          .map((entry) => entry.payoutId)
          .filter((id): id is string => Boolean(id))
      );
      const existingPayoutId =
        statusToApply === "paid" &&
        candidatePayoutIds.size === 1 &&
        selectedEntries.every((entry) => Boolean(entry.payoutId))
          ? Array.from(candidatePayoutIds)[0]
          : null;
      const reuseExistingPayout = Boolean(existingPayoutId);
      const payoutRef = reuseExistingPayout
        ? doc(db, "affiliatePayouts", existingPayoutId as string)
        : doc(collection(db, "affiliatePayouts"));
      const existingPayoutRecord = reuseExistingPayout
        ? payouts.find((payout) => payout.id === existingPayoutId) ?? null
        : null;

      const parseDate = (value: string): Timestamp | null => {
        if (!value) return null;
        const safe = new Date(value);
        return Number.isNaN(safe.getTime()) ? null : Timestamp.fromDate(safe);
      };

      const resolvedPeriodStart =
        !reuseExistingPayout || payoutForm.periodStart
          ? parseDate(payoutForm.periodStart)
          : undefined;
      const resolvedPeriodEnd =
        !reuseExistingPayout || payoutForm.periodEnd
          ? parseDate(payoutForm.periodEnd)
          : undefined;
      const trimmedNotes = payoutForm.notes.trim();
      const resolvedNotes =
        !reuseExistingPayout || trimmedNotes.length > 0
          ? trimmedNotes || null
          : undefined;

      const buildLineItem = (entry: AffiliateCommissionRecord) => ({
        commissionId: entry.id,
        orderId: entry.orderId,
        orderLabel: entry.orderLabel,
        clientName: entry.clientName,
        commissionNet: roundCurrency(entry.commissionNet),
        commissionVat: roundCurrency(entry.commissionVat),
        commissionGross: roundCurrency(entry.commissionGross),
        currency: entry.currency,
        deliverables: entry.deliverables,
        orderTotalGross: entry.orderTotalGross,
        orderTotalNet: entry.orderTotalNet,
        statusApplied: statusToApply,
      });

      const payoutLineItems = (() => {
        if (reuseExistingPayout && existingPayoutRecord) {
          const map = new Map(
            existingPayoutRecord.lineItems.map((item) => [item.commissionId, item])
          );
          selectedEntries.forEach((entry) => {
            map.set(entry.id, buildLineItem(entry));
          });
          return Array.from(map.values());
        }
        return selectedEntries.map((entry) => buildLineItem(entry));
      })();

      const payoutDocTotals = payoutLineItems.reduce(
        (acc, item) => {
          acc.net += roundCurrency(item.commissionNet);
          acc.vat += roundCurrency(item.commissionVat);
          acc.gross += roundCurrency(item.commissionGross);
          return acc;
        },
        { net: 0, vat: 0, gross: 0 }
      );
      const roundedPayoutDocTotals = roundTotals(payoutDocTotals);

      const batch = writeBatch(db);

      const payoutDocData: Record<string, any> = {
        affiliateId: payoutTarget.id,
        affiliateName: payoutTarget.name,
        affiliateRefCode: payoutTarget.refCode,
        amountNet: roundedPayoutDocTotals.net,
        amountVat: roundedPayoutDocTotals.vat,
        amountGross: roundedPayoutDocTotals.gross,
        currency: "GBP",
        lineItems: payoutLineItems,
        updatedAt: serverTimestamp(),
      };

      if (!reuseExistingPayout) {
        payoutDocData.createdAt = serverTimestamp();
        payoutDocData.periodStart = resolvedPeriodStart ?? null;
        payoutDocData.periodEnd = resolvedPeriodEnd ?? null;
        payoutDocData.notes = resolvedNotes ?? null;
      } else {
        if (typeof resolvedPeriodStart !== "undefined") {
          payoutDocData.periodStart = resolvedPeriodStart;
        }
        if (typeof resolvedPeriodEnd !== "undefined") {
          payoutDocData.periodEnd = resolvedPeriodEnd;
        }
        if (typeof resolvedNotes !== "undefined") {
          payoutDocData.notes = resolvedNotes;
        }
        if (statusToApply === "paid") {
          payoutDocData.finalisedAt = serverTimestamp();
        }
      }

      batch.set(payoutRef, payoutDocData, { merge: reuseExistingPayout });

      const pendingSnapshot = pendingCommissionTotals.get(payoutTarget.id);
      const scheduledSnapshot = scheduledCommissionTotals.get(payoutTarget.id);

      const pendingDelta = {
        net: computeDelta(roundedPendingSelection.net, pendingSnapshot?.net),
        vat: computeDelta(roundedPendingSelection.vat, pendingSnapshot?.vat),
        gross: computeDelta(roundedPendingSelection.gross, pendingSnapshot?.gross),
      };

      const scheduledDelta = {
        net: computeDelta(roundedScheduledSelection.net, scheduledSnapshot?.net),
        vat: computeDelta(roundedScheduledSelection.vat, scheduledSnapshot?.vat),
        gross: computeDelta(roundedScheduledSelection.gross, scheduledSnapshot?.gross),
      };
      const metricsUpdate: Record<string, any> = {
        pendingCommissionNet: increment(-pendingDelta.net),
        pendingCommissionVat: increment(-pendingDelta.vat),
        pendingCommissionGross: increment(-pendingDelta.gross),
      };

      if (statusToApply === "scheduled") {
        metricsUpdate.scheduledCommissionNet = increment(roundedOverall.net);
        metricsUpdate.scheduledCommissionVat = increment(roundedOverall.vat);
        metricsUpdate.scheduledCommissionGross = increment(roundedOverall.gross);
      } else {
        metricsUpdate.paidCommissionNet = increment(roundedOverall.net);
        metricsUpdate.paidCommissionVat = increment(roundedOverall.vat);
        metricsUpdate.paidCommissionGross = increment(roundedOverall.gross);

        if (scheduledDelta.net > 0 || scheduledDelta.vat > 0 || scheduledDelta.gross > 0) {
          metricsUpdate.scheduledCommissionNet = increment(-scheduledDelta.net);
          metricsUpdate.scheduledCommissionVat = increment(-scheduledDelta.vat);
          metricsUpdate.scheduledCommissionGross = increment(-scheduledDelta.gross);
        }
      }

      const affiliateUpdate: Record<string, any> = {
        metrics: metricsUpdate,
        updatedAt: serverTimestamp(),
      };

      if (statusToApply === "paid") {
        affiliateUpdate.lastPayoutAt = serverTimestamp();
      }

      batch.set(doc(db, "affiliates", payoutTarget.id), affiliateUpdate, { merge: true });

      selectedEntries.forEach((entry) => {
        const entryRef = doc(db, "affiliateCommissions", entry.id);
        const updates: Record<string, any> = {
          status: statusToApply,
          payoutId: payoutRef.id,
          updatedAt: serverTimestamp(),
        };
        if (statusToApply === "scheduled") {
          updates.scheduledAt = serverTimestamp();
          updates.paidAt = null;
        } else {
          updates.scheduledAt = entry.scheduledAt ?? serverTimestamp();
          updates.paidAt = serverTimestamp();
        }
        batch.set(entryRef, updates, { merge: true });
      });

      await batch.commit();

      resetPayoutModalState();
    } catch (err: any) {
      console.error("Failed to record payout", err);
      setActionError(err?.message || "Unable to record payout");
    }
  };

  const toggleCommissionSelection = (commissionId: string) => {
    setPayoutForm((prev) => {
      if (!prev) {
        return prev;
      }
      const current = new Set(prev.selectedCommissionIds);
      if (current.has(commissionId)) {
        current.delete(commissionId);
      } else {
        current.add(commissionId);
      }
      const nextIds = Array.from(current);
      const nextEntries = nextIds
        .map((id) => commissions.find((entry) => entry.id === id) || null)
        .filter((entry): entry is AffiliateCommissionRecord => Boolean(entry));
      const totals = sumCommissionTotals(nextEntries);
      return {
        ...prev,
        selectedCommissionIds: nextIds,
        amountNet: totals.net ? totals.net.toFixed(2) : "",
        amountVat: totals.vat ? totals.vat.toFixed(2) : "",
        amountGross: totals.gross ? totals.gross.toFixed(2) : "",
      };
    });
  };

  const handleExportLedger = () => {
    if (typeof window === "undefined") {
      return;
    }
    if (filteredCommissions.length === 0) {
      setLedgerError("There are no ledger entries to export.");
      return;
    }
    setLedgerError(null);
    setExportingLedger(true);
    try {
      const csv = buildAffiliateCommissionCsv(filteredCommissions);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `affiliate-commission-ledger-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export commission ledger", err);
      setLedgerError("Unable to export ledger CSV. Please try again.");
    } finally {
      setExportingLedger(false);
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

  const openReviewModal = (
    application: AffiliateApplicationRecord,
    action: AffiliateApplicationDecisionAction
  ) => {
    setReviewTarget(application);
    setReviewAction(action);
    setReviewNotes("");
    setReviewError(null);
  };

  const handleReviewSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewTarget) {
      return;
    }
    const trimmedNotes = reviewNotes.trim();
    if (reviewAction === "request_info" && !trimmedNotes) {
      setReviewError("Please include guidance when requesting more information.");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const response = await fetch("/api/affiliates/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: reviewTarget.id,
          action: reviewAction,
          notes: trimmedNotes || null,
        }),
      });
      if (!response.ok) {
        let errorMessage = "Unable to update application.";
        try {
          const data = (await response.json()) as { error?: string };
          if (data?.error) {
            errorMessage = data.error;
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw new Error(errorMessage);
      }
      const successMessage =
        reviewAction === "approve"
          ? `Approved ${reviewTarget.fullName}`
          : reviewAction === "reject"
            ? `Rejected ${reviewTarget.fullName}`
            : `Requested more info from ${reviewTarget.fullName}`;
      setReviewFeedback(successMessage);
      setReviewTarget(null);
      setReviewNotes("");
    } catch (err: any) {
      console.error("Failed to review affiliate application", err);
      setReviewError(err?.message || "Unable to update application.");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const renderReviewHistory = (history: AffiliateApplicationReviewEntry[]) => {
    if (!history.length) {
      return null;
    }
    return (
      <ol className="space-y-1 text-xs text-gray-600">
        {history.map((entry, index) => {
          const decidedAt = entry.decidedAt?.toDate?.();
          const key = `${entry.action}-${decidedAt?.getTime?.() ?? index}-${index}`;
          return (
            <li key={key} className="flex flex-wrap gap-1">
              <span className="font-medium text-gray-700">{entry.action === "approve"
                ? "Approved"
                : entry.action === "reject"
                  ? "Rejected"
                  : "Info requested"}</span>
              {decidedAt ? <span>· {decidedAt.toLocaleString()}</span> : null}
              {entry.reviewerName ? <span>· {entry.reviewerName}</span> : null}
              {entry.notes ? <span className="text-gray-500">— {entry.notes}</span> : null}
            </li>
          );
        })}
      </ol>
    );
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
                const ledgerPending = pendingCommissionTotals.get(affiliate.id);
                const ledgerScheduled = scheduledCommissionTotals.get(affiliate.id);
                const pendingNet = roundCurrency(
                  ledgerPending?.net ?? affiliate.metrics.pendingCommissionNet
                );
                const pendingGross = roundCurrency(
                  ledgerPending?.gross ?? affiliate.metrics.pendingCommissionGross
                );
                const scheduledGross = roundCurrency(
                  ledgerScheduled?.gross ?? affiliate.metrics.scheduledCommissionGross
                );
                const hasPendingLedgerLines = (ledgerPending?.net ?? 0) > 0;
                const eligibleForPayout =
                  hasPendingLedgerLines && pendingNet >= AFFILIATE_MIN_WITHDRAWAL_NET;
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
                        <dd>{formatCurrencyGBP(pendingGross)}</dd>
                      </div>
                      {scheduledGross > 0 ? (
                        <div className="flex items-center justify-between text-amber-700">
                          <dt className="font-medium">Scheduled</dt>
                          <dd>{formatCurrencyGBP(scheduledGross)}</dd>
                        </div>
                      ) : null}
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
                        {eligibleForPayout
                          ? 'Record payout'
                          : hasPendingLedgerLines
                            ? `Need £${AFFILIATE_MIN_WITHDRAWAL_NET.toFixed(0)}+ net`
                            : 'Awaiting delivered orders'}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold text-gray-900">Affiliate applications</h2>
            <span className="text-xs text-gray-500">{applications.length} recent submissions</span>
            {reviewFeedback ? <span className="text-xs text-emerald-600">{reviewFeedback}</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {applicationFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn btn-xs ${applicationFilter === option.key ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setApplicationFilter(option.key)}
              >
                {option.label}
                <span className="ml-2 rounded-full bg-gray-200 px-2 text-[10px] font-medium text-gray-700">
                  {applicationCounts[option.key]}
                </span>
              </button>
            ))}
          </div>
        </div>
        {filteredApplications.length === 0 ? (
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
                {filteredApplications.map((application) => {
                  const submitted = application.createdAt?.toDate?.();
                  const descriptor = resolveApplicationStatus(application);
                  const decision = application.review;
                  const decidedAt = decision?.decidedAt?.toDate?.();
                  return (
                    <>
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
                            <div className="mt-1 whitespace-pre-line text-xs text-gray-500">{application.notes}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top text-sm text-gray-600">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${descriptor.badgeClass}`}>
                              {descriptor.label}
                            </span>
                            {decision?.notes ? (
                              <span className="text-xs text-gray-500">“{decision.notes}”</span>
                            ) : null}
                            {decision?.reviewerName || decidedAt ? (
                              <span className="text-[11px] text-gray-400">
                                {decision?.reviewerName ? `by ${decision.reviewerName}` : null}
                                {decision?.reviewerName && decidedAt ? ' · ' : ''}
                                {decidedAt ? decidedAt.toLocaleString() : null}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-sm text-gray-600">
                          {submitted ? submitted.toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2 align-top text-sm">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-xs"
                              disabled={descriptor.category === 'approved'}
                              onClick={() => openReviewModal(application, "approve")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-warning"
                              disabled={descriptor.category === 'info'}
                              onClick={() => openReviewModal(application, "request_info")}
                            >
                              Request info
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-error"
                              disabled={descriptor.category === 'rejected'}
                              onClick={() => openReviewModal(application, "reject")}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
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
                          </div>
                        </td>
                      </tr>
                      {application.reviewHistory.length > 0 ? (
                        <tr className="bg-gray-50">
                          <td colSpan={5} className="px-3 py-2">
                            <div className="grid gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Review history
                              </span>
                              {renderReviewHistory(application.reviewHistory)}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reviewTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <button
            type="button"
            aria-label="Close review dialog"
            className="absolute inset-0"
            onClick={() => {
              setReviewTarget(null);
              setReviewNotes("");
              setReviewError(null);
            }}
          />
          <div className="relative w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Review affiliate application</h3>
                <p className="text-sm text-gray-600">
                  {reviewTarget.fullName} · {reviewTarget.email}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setReviewTarget(null);
                  setReviewNotes("");
                  setReviewError(null);
                }}
              >
                Close
              </button>
            </div>
            <form className="mt-4 grid gap-4" onSubmit={handleReviewSubmit}>
              <div className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Decision</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`btn btn-sm ${reviewAction === 'approve' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setReviewAction("approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${reviewAction === 'request_info' ? 'btn-warning' : 'btn-ghost'}`}
                    onClick={() => setReviewAction("request_info")}
                  >
                    Request info
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${reviewAction === 'reject' ? 'btn-error' : 'btn-ghost'}`}
                    onClick={() => setReviewAction("reject")}
                  >
                    Reject
                  </button>
                </div>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Reviewer notes</span>
                <textarea
                  className="input min-h-[100px]"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  placeholder={
                    reviewAction === 'request_info'
                      ? 'Share what we need before approving…'
                      : 'Add optional context for the applicant and audit trail'
                  }
                />
                {reviewAction === 'request_info' ? (
                  <span className="text-xs text-gray-500">Applicants will see these instructions in their follow-up email.</span>
                ) : null}
              </label>
              <div className="grid gap-1 text-xs text-gray-500">
                <span className="font-semibold uppercase tracking-wide text-gray-500">Application snapshot</span>
                <dl className="grid gap-1 sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-gray-700">Focus</dt>
                    <dd>{reviewTarget.focus || '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-gray-700">Experience</dt>
                    <dd>{reviewTarget.experience || '—'}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-gray-700">Notes</dt>
                    <dd className="whitespace-pre-line">{reviewTarget.notes || '—'}</dd>
                  </div>
                </dl>
              </div>
              {reviewError ? <p className="text-sm text-red-600">{reviewError}</p> : null}
              <div className="flex items-center justify-between gap-3">
                <button type="submit" className="btn" disabled={reviewSubmitting}>
                  {reviewSubmitting ? 'Saving…' : 'Save decision'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setReviewTarget(null);
                    setReviewNotes("");
                    setReviewError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Commission ledger</h2>
            <p className="text-xs text-gray-500">{commissionCounts.all} tracked entries</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {commissionFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`btn btn-xs ${commissionFilter === option.key ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setCommissionFilter(option.key)}
              >
                {option.label}
                <span className="ml-2 rounded-full bg-gray-200 px-2 text-[10px] font-medium text-gray-700">
                  {commissionCounts[option.key]}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleExportLedger}
              disabled={exportingLedger || filteredCommissions.length === 0}
            >
              {exportingLedger ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
        {ledgerError ? <p className="text-sm text-red-600">{ledgerError}</p> : null}
        {filteredCommissions.length === 0 ? (
          <p className="text-sm text-gray-600">No commission entries recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Affiliate</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Order</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Net</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">VAT</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Gross</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Delivered</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredCommissions.map((entry) => {
                  const delivered = entry.deliveredAt?.toDate?.();
                  const scheduled = entry.scheduledAt?.toDate?.();
                  const paid = entry.paidAt?.toDate?.();
                  const affiliateRecord = affiliates.find((item) => item.id === entry.affiliateId) || null;
                  return (
                    <tr key={entry.id} className="hover:bg-emerald-50/40">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{entry.affiliateName ?? entry.affiliateId}</div>
                        <div className="text-xs text-gray-500">Code: {entry.affiliateRefCode ?? "—"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{entry.orderLabel ?? entry.orderId}</div>
                        <div className="text-xs text-gray-500">
                          {entry.clientName ? `${entry.clientName} · ` : ""}
                          Ref: {entry.orderId}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        {formatCurrencyGBP(entry.commissionNet)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {formatCurrencyGBP(entry.commissionVat)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {formatCurrencyGBP(entry.commissionGross)}
                      </td>
                      <td className="px-3 py-2 text-sm capitalize text-gray-700">
                        {entry.status}
                        <div className="text-xs text-gray-500">
                          {scheduled ? `Scheduled ${scheduled.toLocaleDateString()}` : ""}
                          {paid ? ` · Paid ${paid.toLocaleDateString()}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {delivered ? delivered.toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        <div className="flex flex-col items-start gap-1">
                          <span>{entry.payoutId ? entry.payoutId.slice(0, 8) : "—"}</span>
                          {entry.status === "scheduled" && affiliateRecord ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-emerald-700 hover:text-emerald-900"
                              onClick={() =>
                                openPayoutModal(affiliateRecord, {
                                  statuses: ["scheduled"],
                                  preselectIds: [entry.id],
                                  initialStatus: "paid",
                                  payoutId: entry.payoutId ?? undefined,
                                })
                              }
                            >
                              Mark as paid
                            </button>
                          ) : null}
                        </div>
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
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Line items</th>
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
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {payout.lineItems.length === 0 ? (
                          <span className="text-xs text-gray-500">No ledger lines attached</span>
                        ) : (
                          <div className="space-y-1">
                            {payout.lineItems.map((item) => (
                              <div key={item.commissionId} className="rounded bg-gray-50 px-2 py-1">
                                <div className="text-xs font-medium text-gray-800">{item.orderLabel ?? item.orderId}</div>
                                <div className="text-[11px] text-gray-500">
                                  Net {formatCurrencyGBP(item.commissionNet)} · VAT {formatCurrencyGBP(item.commissionVat)} · Gross {formatCurrencyGBP(item.commissionGross)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
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
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">Commission ledger lines</h4>
                  <div className="flex flex-col items-start text-xs text-gray-500 sm:items-end">
                    <span>
                      {payoutSelectionEntries.length} selected of {payoutCandidateEntries.length}
                    </span>
                    {payoutCandidateStatusSummary ? (
                      <span>{payoutCandidateStatusSummary}</span>
                    ) : null}
                  </div>
                </div>
                {payoutCandidateEntries.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-600">{payoutCandidateEmptyMessage}</p>
                ) : (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Include</th>
                          <th className="px-3 py-2 text-left">Order</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-right">Net</th>
                          <th className="px-3 py-2 text-right">VAT</th>
                          <th className="px-3 py-2 text-right">Gross</th>
                          <th className="px-3 py-2 text-right">Delivered</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {payoutCandidateEntries.map((entry) => {
                          const delivered = entry.deliveredAt?.toDate?.();
                          const checked = payoutForm.selectedCommissionIds.includes(entry.id);
                          return (
                            <tr key={entry.id} className={checked ? "bg-emerald-50/40" : undefined}>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                  checked={checked}
                                  onChange={() => toggleCommissionSelection(entry.id)}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-gray-900">
                                  {entry.orderLabel ?? entry.orderId}
                                </div>
                                <div className="text-xs text-gray-500">
                                  Ref: {entry.orderId}
                                  {entry.clientName ? ` · ${entry.clientName}` : ""}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-left text-xs font-medium capitalize text-gray-700">
                                {entry.status}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-gray-900">
                                {formatCurrencyGBP(entry.commissionNet)}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-700">
                                {formatCurrencyGBP(entry.commissionVat)}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-900">
                                {formatCurrencyGBP(entry.commissionGross)}
                              </td>
                              <td className="px-3 py-2 text-right text-xs text-gray-500">
                                {delivered ? delivered.toLocaleDateString() : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-gray-700">Net amount</span>
                  <input className="input" type="number" step="0.01" value={payoutForm.amountNet} readOnly />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-gray-700">VAT</span>
                  <input className="input" type="number" step="0.01" value={payoutForm.amountVat} readOnly />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-gray-700">Gross</span>
                  <input className="input" type="number" step="0.01" value={payoutForm.amountGross} readOnly />
                </label>
              </div>
            </div>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Mark selected lines as</span>
              <select
                className="input"
                value={payoutForm.status}
                onChange={(event) =>
                  setPayoutForm((prev) =>
                    prev ? { ...prev, status: event.target.value as AffiliateCommissionStatus } : prev
                  )
                }
              >
                <option value="paid">Paid</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </label>
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
              <button
                type="submit"
                className="btn"
                disabled={payoutSelectionEntries.length === 0}
              >
                Record payout
              </button>
              <button type="button" className="btn btn-outline" onClick={resetPayoutModalState}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
