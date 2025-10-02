"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";

import PortalContainer from "@/components/PortalContainer";
import { ensureFirebase } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  AFFILIATE_MIN_WITHDRAWAL_NET,
  AffiliateRecord,
  AffiliatePayoutRecord,
  AffiliateCommissionRecord,
  AffiliateCommissionStatus,
  AffiliateResourceRecord,
  buildAffiliateShareLink,
  formatCurrencyGBP,
  parseAffiliateDoc,
  parseAffiliatePayoutDoc,
  parseAffiliateCommissionDoc,
  buildAffiliateCommissionCsv,
  parseAffiliateResourceDoc,
} from "@/lib/affiliates";

interface OrderSummary {
  id: string;
  label: string;
  status: string | null;
  total: number;
  commissionNet: number;
  commissionGross: number;
  createdAt: Timestamp | null;
}

interface ClientSummary {
  id: string;
  name: string;
  email: string | null;
  lastOrderAt: Timestamp | null;
}

type PortalTabKey = "overview" | "account" | "payout" | "remittances" | "resources";

const PORTAL_TABS: Array<{ key: PortalTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "account", label: "Account" },
  { key: "payout", label: "Payout details" },
  { key: "remittances", label: "Remittances" },
  { key: "resources", label: "Resources" },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const digitsOnly = (value: string) => value.replace(/\D+/g, "");

const formatSortCode = (value: string) => {
  const digits = digitsOnly(value).slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
};

const formatAccountNumber = (value: string) => digitsOnly(value).slice(0, 8);

const MAX_ORDERS = 20;
const MAX_CLIENTS = 12;

export default function AffiliatePortal() {
  const { allowed, loading: guardLoading } = useRoleGate("affiliate");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [affiliate, setAffiliate] = useState<AffiliateRecord | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [payouts, setPayouts] = useState<AffiliatePayoutRecord[]>([]);
  const [commissions, setCommissions] = useState<AffiliateCommissionRecord[]>([]);
  const [commissionFilter, setCommissionFilter] = useState<
    "all" | AffiliateCommissionStatus
  >("pending");
  const [exportingLedger, setExportingLedger] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "account" | "payout" | "remittances" | "resources"
  >("overview");
  const [accountForm, setAccountForm] = useState({
    name: "",
    email: "",
    company: "",
    phone: "",
  });
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountFeedback, setAccountFeedback] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [payoutForm, setPayoutForm] = useState({
    accountName: "",
    bankName: "",
    sortCode: "",
    accountNumber: "",
    notes: "",
  });
  const [payoutErrors, setPayoutErrors] = useState<Record<string, string>>({});
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [payoutFeedback, setPayoutFeedback] = useState<string | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [remittanceUrls, setRemittanceUrls] = useState<Record<string, string | null>>({});
  const [remittanceErrors, setRemittanceErrors] = useState<Record<string, string | null>>({});
  const [resources, setResources] = useState<AffiliateResourceRecord[]>([]);
  const [resourceError, setResourceError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeOrders: (() => void) | undefined;
    let unsubscribePayouts: (() => void) | undefined;
    let unsubscribeCommissions: (() => void) | undefined;
    let unsubscribeAffiliate: (() => void) | undefined;
    let resolved = false;

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (!auth || !db) {
          throw new Error("Portal is unavailable without Firebase.");
        }

        await new Promise<void>((resolve) => {
          const finish = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };

          const unsub = auth.onAuthStateChanged(async (user: User | null) => {
            unsub();
            if (!user) {
              setError("Please sign in to view your affiliate dashboard.");
              setLoading(false);
              finish();
              return;
            }

            try {
              const findAffiliate = async () => {
                const directQuery = await getDocs(
                  query(collection(db, "affiliates"), where("ownerUid", "==", user.uid), limit(1))
                );
                if (!directQuery.empty) {
                  return directQuery.docs[0];
                }
                if (!user.email) {
                  return null;
                }
                const emailQuery = await getDocs(
                  query(
                    collection(db, "affiliates"),
                    where("email", "==", user.email.toLowerCase()),
                    limit(1)
                  )
                );
                if (!emailQuery.empty) {
                  return emailQuery.docs[0];
                }
                return null;
              };

              const docSnap = await findAffiliate();
              if (!docSnap) {
                setError(
                  "We couldn't find an affiliate record linked to your account yet. Please contact Pineapple Tapped HQ."
                );
                setLoading(false);
                finish();
                return;
              }

              const record = parseAffiliateDoc(docSnap);
              setAffiliate(record);
              setLoading(false);
              finish();

              if (!record.ownerUid) {
                try {
                  await updateDoc(doc(db, "affiliates", docSnap.id), {
                    ownerUid: user.uid,
                    updatedAt: serverTimestamp(),
                  });
                  await updateDoc(doc(db, "users", user.uid), {
                    "roles.affiliate": true,
                  });
                } catch (linkErr) {
                  console.error("Failed to attach affiliate to user", linkErr);
                }
              }

              unsubscribeAffiliate = onSnapshot(
                doc(db, "affiliates", docSnap.id),
                (snapshot) => {
                  if (!snapshot.exists()) {
                    setError("Your affiliate profile is no longer available.");
                    setAffiliate(null);
                    return;
                  }
                  const liveRecord = parseAffiliateDoc(snapshot as any);
                  setAffiliate(liveRecord);
                },
                (err) => console.error("Failed to refresh affiliate profile", err)
              );

              unsubscribeOrders = onSnapshot(
                query(
                  collection(db, "orders"),
                  where("affiliate.id", "==", docSnap.id),
                  orderBy("createdAt", "desc"),
                  limit(MAX_ORDERS)
                ),
                (snapshot) => {
                  const list: OrderSummary[] = snapshot.docs.map((orderSnap) => {
                    const data = orderSnap.data() as Record<string, any>;
                    const affiliateInfo = (data.affiliate ?? {}) as Record<string, any>;
                    return {
                      id: orderSnap.id,
                      label:
                        (typeof data.projectName === "string" && data.projectName) ||
                        (typeof data.customerName === "string" && data.customerName) ||
                        `Order ${orderSnap.id.slice(0, 6)}`,
                      status: typeof data.status === "string" ? data.status : null,
                      total: typeof data.price === "number" ? data.price : data.netTotal || 0,
                      commissionNet: Number(affiliateInfo.commissionNet) || 0,
                      commissionGross: Number(affiliateInfo.commissionGross) || 0,
                      createdAt: data.createdAt ?? null,
                    };
                  });
                  setOrders(list);
                },
                (err) => console.error("Failed to load affiliate orders", err)
              );

              unsubscribePayouts = onSnapshot(
                query(
                  collection(db, "affiliatePayouts"),
                  where("affiliateId", "==", docSnap.id),
                  orderBy("createdAt", "desc"),
                  limit(10)
                ),
                (snapshot) => {
                  const list = snapshot.docs.map((payoutDoc) => parseAffiliatePayoutDoc(payoutDoc));
                  setPayouts(list);
                },
                (err) => console.error("Failed to load affiliate payout history", err)
              );

              unsubscribeCommissions = onSnapshot(
                query(
                  collection(db, "affiliateCommissions"),
                  where("affiliateId", "==", docSnap.id),
                  orderBy("createdAt", "desc"),
                  limit(100)
                ),
                (snapshot) => {
                  const list = snapshot.docs.map((commissionDoc) => parseAffiliateCommissionDoc(commissionDoc));
                  setCommissions(list);
                },
                (err) => console.error("Failed to load affiliate commission ledger", err)
              );

              const clientQuery = await getDocs(
                query(
                  collection(db, "clients"),
                  where("affiliate.id", "==", docSnap.id),
                  orderBy("updatedAt", "desc"),
                  limit(MAX_CLIENTS)
                )
              );
              const clientList: ClientSummary[] = clientQuery.docs.map((clientSnap) => {
                const data = clientSnap.data() as Record<string, any>;
                return {
                  id: clientSnap.id,
                  name:
                    (typeof data.companyName === "string" && data.companyName) ||
                    (typeof data.customerName === "string" && data.customerName) ||
                    "Client",
                  email: typeof data.primaryEmail === "string" ? data.primaryEmail : null,
                  lastOrderAt: data.updatedAt ?? data.lastOrderAt ?? null,
                };
              });
              setClients(clientList);
            } catch (err) {
              console.error("Failed to load affiliate portal", err);
              setError("Unable to load your affiliate information.");
              setLoading(false);
              finish();
            }
          });
        });
      } catch (err) {
        console.error("Affiliate portal initialisation failed", err);
        setError("Unable to initialise the affiliate portal.");
        setLoading(false);
      }
    })();

    return () => {
      unsubscribeOrders?.();
      unsubscribePayouts?.();
      unsubscribeCommissions?.();
      unsubscribeAffiliate?.();
    };
  }, []);

  useEffect(() => {
    if (!affiliate) {
      setAccountForm({ name: "", email: "", company: "", phone: "" });
      return;
    }
    setAccountForm({
      name: affiliate.name ?? "",
      email: affiliate.email ?? "",
      company: affiliate.company ?? "",
      phone: affiliate.phone ?? "",
    });
    setAccountErrors({});
    setAccountError(null);
  }, [affiliate]);

  useEffect(() => {
    if (!affiliate) {
      setPayoutForm({ accountName: "", bankName: "", sortCode: "", accountNumber: "", notes: "" });
      return;
    }
    const payout = affiliate.payout ?? {
      accountName: null,
      bankName: null,
      sortCode: null,
      accountNumber: null,
      notes: null,
    };
    setPayoutForm({
      accountName: payout.accountName ?? "",
      bankName: payout.bankName ?? "",
      sortCode: payout.sortCode ? formatSortCode(payout.sortCode) : "",
      accountNumber: payout.accountNumber ? formatAccountNumber(payout.accountNumber) : "",
      notes: payout.notes ?? "",
    });
    setPayoutErrors({});
    setPayoutError(null);
  }, [affiliate]);

  useEffect(() => {
    let unsubscribeResources: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error("Firestore is unavailable");
        }
        unsubscribeResources = onSnapshot(
          query(collection(db, "affiliateResources"), orderBy("publishedAt", "desc"), limit(20)),
          (snapshot) => {
            if (cancelled) {
              return;
            }
            const list = snapshot.docs.map((docSnap) => parseAffiliateResourceDoc(docSnap));
            setResources(list);
            setResourceError(null);
          },
          (err) => {
            console.error("Failed to load affiliate resources", err);
            if (!cancelled) {
              setResourceError("Unable to load the latest resources right now.");
            }
          }
        );
      } catch (err) {
        console.error("Affiliate resources initialisation failed", err);
        if (!cancelled) {
          setResourceError("Unable to load the latest resources right now.");
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeResources?.();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setRemittanceUrls((prev) => {
      const next: Record<string, string | null> = {};
      payouts.forEach((payout) => {
        if (prev[payout.id] !== undefined) {
          next[payout.id] = prev[payout.id];
        }
      });
      return next;
    });
    setRemittanceErrors((prev) => {
      const next: Record<string, string | null> = {};
      payouts.forEach((payout) => {
        if (prev[payout.id]) {
          next[payout.id] = prev[payout.id];
        }
      });
      return next;
    });

    let cancelled = false;

    (async () => {
      try {
        const { storage } = await ensureFirebase();
        if (!storage) {
          throw new Error("Storage is unavailable");
        }

        await Promise.all(
          payouts.map(async (payout) => {
            if (cancelled) {
              return;
            }

            if (payout.remittanceDownloadUrl) {
              setRemittanceUrls((prev) => {
                if (prev[payout.id] === payout.remittanceDownloadUrl) {
                  return prev;
                }
                return { ...prev, [payout.id]: payout.remittanceDownloadUrl };
              });
              setRemittanceErrors((prev) => {
                if (!prev[payout.id]) {
                  return prev;
                }
                const next = { ...prev };
                delete next[payout.id];
                return next;
              });
              return;
            }

            if (!payout.remittanceStoragePath) {
              setRemittanceUrls((prev) => {
                if (prev[payout.id] === null) {
                  return prev;
                }
                return { ...prev, [payout.id]: null };
              });
              return;
            }

            try {
              const url = await getDownloadURL(ref(storage, payout.remittanceStoragePath));
              if (!cancelled) {
                setRemittanceUrls((prev) => ({ ...prev, [payout.id]: url }));
                setRemittanceErrors((prev) => {
                  if (!prev[payout.id]) {
                    return prev;
                  }
                  const next = { ...prev };
                  delete next[payout.id];
                  return next;
                });
              }
            } catch (err) {
              console.error(`Failed to load remittance file for payout ${payout.id}`, err);
              if (!cancelled) {
                setRemittanceUrls((prev) => ({ ...prev, [payout.id]: null }));
                setRemittanceErrors((prev) => ({ ...prev, [payout.id]: "Download unavailable" }));
              }
            }
          })
        );
      } catch (err) {
        console.error("Failed to initialise remittance downloads", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payouts]);

  const pendingNet = useMemo(
    () => (affiliate ? Math.max(0, affiliate.metrics.pendingCommissionNet) : 0),
    [affiliate]
  );
  const pendingGross = useMemo(
    () => (affiliate ? Math.max(0, affiliate.metrics.pendingCommissionGross) : 0),
    [affiliate]
  );
  const eligibleForWithdrawal = pendingNet >= AFFILIATE_MIN_WITHDRAWAL_NET;

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

  const orderedResources = useMemo(() => {
    if (resources.length === 0) {
      return resources;
    }
    const pinned = resources.filter((resource) => resource.pinned);
    const nonPinned = resources.filter((resource) => !resource.pinned);
    return [...pinned, ...nonPinned];
  }, [resources]);

  const overviewResources = useMemo(() => orderedResources.slice(0, 2), [orderedResources]);

  const handleAccountFieldChange = (field: "name" | "email" | "company" | "phone") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setAccountForm((prev) => ({ ...prev, [field]: value }));
      setAccountErrors((prev) => {
        if (!prev[field]) {
          return prev;
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setAccountError(null);
    };

  const handlePayoutFieldChange = (
    field: "accountName" | "bankName" | "sortCode" | "accountNumber" | "notes"
  ) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      let { value } = event.target;
      if (field === "sortCode") {
        value = formatSortCode(value);
      } else if (field === "accountNumber") {
        value = formatAccountNumber(value);
      }
      setPayoutForm((prev) => ({ ...prev, [field]: value }));
      setPayoutErrors((prev) => {
        if (!prev[field]) {
          return prev;
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setPayoutError(null);
    };

  const validateAccountForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!accountForm.name.trim()) {
      nextErrors.name = "Name is required";
    }
    const email = accountForm.email.trim();
    if (email && !EMAIL_REGEX.test(email)) {
      nextErrors.email = "Enter a valid email address";
    }
    const phoneDigits = digitsOnly(accountForm.phone);
    if (phoneDigits && phoneDigits.length < 7) {
      nextErrors.phone = "Phone number looks too short";
    }
    setAccountErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validatePayoutForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!payoutForm.accountName.trim()) {
      nextErrors.accountName = "Account name is required";
    }
    if (!payoutForm.bankName.trim()) {
      nextErrors.bankName = "Bank name is required";
    }
    const sortDigits = digitsOnly(payoutForm.sortCode).slice(0, 6);
    if (!sortDigits) {
      nextErrors.sortCode = "Sort code is required";
    } else if (sortDigits.length !== 6) {
      nextErrors.sortCode = "Sort code must be 6 digits";
    }
    const accountDigits = digitsOnly(payoutForm.accountNumber).slice(0, 8);
    if (!accountDigits) {
      nextErrors.accountNumber = "Account number is required";
    } else if (accountDigits.length < 6 || accountDigits.length > 8) {
      nextErrors.accountNumber = "Account number should be 6–8 digits";
    }
    setPayoutErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleAccountSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!affiliate) {
      return;
    }
    setAccountError(null);
    if (!validateAccountForm()) {
      return;
    }
    setAccountSaving(true);
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firestore is unavailable");
      }
      await updateDoc(doc(db, "affiliates", affiliate.id), {
        name: accountForm.name.trim(),
        email: accountForm.email.trim() ? accountForm.email.trim().toLowerCase() : null,
        company: accountForm.company.trim() || null,
        phone: accountForm.phone.trim() || null,
        updatedAt: serverTimestamp(),
      });
      setAccountFeedback("Your profile has been updated.");
    } catch (err) {
      console.error("Failed to update affiliate account details", err);
      setAccountError("Unable to save these details right now. Please try again.");
    } finally {
      setAccountSaving(false);
    }
  };

  const handlePayoutSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!affiliate) {
      return;
    }
    setPayoutError(null);
    if (!validatePayoutForm()) {
      return;
    }
    setPayoutSaving(true);
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firestore is unavailable");
      }
      const sortDigits = digitsOnly(payoutForm.sortCode).slice(0, 6);
      const accountDigits = digitsOnly(payoutForm.accountNumber).slice(0, 8);
      await updateDoc(doc(db, "affiliates", affiliate.id), {
        "payout.accountName": payoutForm.accountName.trim(),
        "payout.bankName": payoutForm.bankName.trim(),
        "payout.sortCode": sortDigits,
        "payout.accountNumber": accountDigits,
        "payout.notes": payoutForm.notes.trim() || null,
        updatedAt: serverTimestamp(),
      });
      setPayoutFeedback("Payout details saved.");
    } catch (err) {
      console.error("Failed to update affiliate payout details", err);
      setPayoutError("Unable to save payout details right now. Please try again.");
    } finally {
      setPayoutSaving(false);
    }
  };

  useEffect(() => {
    if (!accountFeedback) {
      return;
    }
    const timer = window.setTimeout(() => setAccountFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [accountFeedback]);

  useEffect(() => {
    if (!payoutFeedback) {
      return;
    }
    const timer = window.setTimeout(() => setPayoutFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [payoutFeedback]);

  const handleExportLedger = () => {
    if (typeof window === "undefined") {
      return;
    }
    if (filteredCommissions.length === 0) {
      setLedgerError("No ledger entries to export yet.");
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
      link.download = `affiliate-ledger-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export affiliate ledger", err);
      setLedgerError("Unable to export ledger CSV. Please try again.");
    } finally {
      setExportingLedger(false);
    }
  };

  const handleCopyLink = () => {
    if (!affiliate) return;
    const link = buildAffiliateShareLink(affiliate.refCode);
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopyMessage("Share link copied to clipboard");
        setTimeout(() => setCopyMessage(null), 2500);
      })
      .catch(() => {
        setCopyMessage("Unable to copy link");
        setTimeout(() => setCopyMessage(null), 2500);
      });
  };

  if (guardLoading || loading) {
    return (
      <PortalContainer>
        <p className="text-sm text-gray-600">Loading affiliate dashboard…</p>
      </PortalContainer>
    );
  }

  if (!allowed) {
    return (
      <PortalContainer>
        <p className="text-sm text-gray-600">
          Your account does not have access to the affiliate dashboard yet. Please contact support.
        </p>
      </PortalContainer>
    );
  }

  if (error) {
    return (
      <PortalContainer>
        <p className="text-sm text-red-600">{error}</p>
      </PortalContainer>
    );
  }

  if (!affiliate) {
    return (
      <PortalContainer>
        <p className="text-sm text-gray-600">No affiliate record is linked to this account yet.</p>
      </PortalContainer>
    );
  }

  const shareLink = buildAffiliateShareLink(affiliate.refCode);

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Affiliate earnings dashboard</h1>
            <p className="text-sm text-gray-600">
              Track the customers and orders you’ve referred and monitor your commission payouts.
            </p>
          </div>
          {copyMessage ? <span className="text-xs text-emerald-600">{copyMessage}</span> : null}
        </header>

        <nav className='flex flex-wrap gap-2 border-b border-gray-200 pb-2'>
          {PORTAL_TABS.map((tab) => (
            <button
              key={tab.key}
              type='button'
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                activeTab === tab.key ? 'bg-gray-900 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
              }`}
              aria-current={activeTab === tab.key ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === 'overview' ? (
          <div className='grid gap-6'>
            <section className='grid gap-4 md:grid-cols-3'>
              <div className='rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'>
                <p className='text-xs font-medium uppercase text-gray-500'>Total earned</p>
                <p className='text-xl font-semibold text-gray-900'>
                  {formatCurrencyGBP(affiliate.metrics.totalCommissionGross)}
                </p>
                <p className='text-xs text-gray-500'>Including VAT</p>
              </div>
              <div className='rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'>
                <p className='text-xs font-medium uppercase text-gray-500'>Available to withdraw</p>
                <p className='text-xl font-semibold text-gray-900'>{formatCurrencyGBP(pendingGross)}</p>
                <p className={`text-xs ${eligibleForWithdrawal ? 'text-emerald-600' : 'text-gray-500'}`}>
                  {eligibleForWithdrawal
                    ? 'Great! You’ve met the £50 minimum.'
                    : `You’ll be able to withdraw once you reach £${AFFILIATE_MIN_WITHDRAWAL_NET.toFixed(0)} net.`}
                </p>
              </div>
              <div className='rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'>
                <p className='text-xs font-medium uppercase text-gray-500'>Orders influenced</p>
                <p className='text-xl font-semibold text-gray-900'>{affiliate.metrics.totalOrders}</p>
                <p className='text-xs text-gray-500'>All-time orders linked to your referrals</p>
              </div>
            </section>

            <section className='grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div>
                  <h2 className='text-lg font-semibold text-gray-900'>Your referral link</h2>
                  <p className='text-sm text-gray-600'>
                    Share this link with prospects so we can automatically attribute new enquiries to you.
                  </p>
                </div>
                <button type='button' className='btn' onClick={handleCopyLink}>
                  Copy link
                </button>
              </div>
              <div className='break-all rounded-lg bg-gray-50 p-4 text-sm text-gray-700'>{shareLink}</div>
            </section>

            <section className='grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
              <h2 className='text-lg font-semibold text-gray-900'>Recent referred orders</h2>
              {orders.length === 0 ? (
                <p className='text-sm text-gray-600'>You haven’t referred any orders yet.</p>
              ) : (
                <div className='overflow-x-auto'>
                  <table className='min-w-full divide-y divide-gray-200 text-sm'>
                    <thead className='bg-gray-50'>
                      <tr>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Order</th>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Status</th>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Commission (net)</th>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Commission (gross)</th>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Created</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-200'>
                      {orders.map((order) => {
                        const created = order.createdAt?.toDate?.();
                        return (
                          <tr key={order.id}>
                            <td className='px-3 py-2'>
                              <div className='font-medium text-gray-900'>{order.label}</div>
                            </td>
                            <td className='px-3 py-2 text-sm text-gray-600'>{order.status ?? '—'}</td>
                            <td className='px-3 py-2'>{formatCurrencyGBP(order.commissionNet)}</td>
                            <td className='px-3 py-2'>{formatCurrencyGBP(order.commissionGross)}</td>
                            <td className='px-3 py-2 text-xs text-gray-500'>
                              {created ? created.toLocaleDateString() : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className='grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
              <h2 className='text-lg font-semibold text-gray-900'>Clients you’ve introduced</h2>
              {clients.length === 0 ? (
                <p className='text-sm text-gray-600'>We’ll list customers you refer here once they start working with us.</p>
              ) : (
                <div className='grid gap-2 md:grid-cols-2'>
                  {clients.map((client) => {
                    const last = client.lastOrderAt?.toDate?.();
                    return (
                      <div key={client.id} className='rounded-xl border border-gray-200 p-3 text-sm text-gray-700'>
                        <p className='font-medium text-gray-900'>{client.name}</p>
                        {client.email ? <p className='text-xs text-gray-500'>{client.email}</p> : null}
                        <p className='text-xs text-gray-500'>
                          Last order: {last ? last.toLocaleDateString() : 'not yet'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className='grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                  <h2 className='text-lg font-semibold text-gray-900'>Commission ledger</h2>
                  <p className='text-xs text-gray-500'>{commissionCounts.all} entries</p>
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  {commissionFilterOptions.map((option) => (
                    <button
                      key={option.key}
                      type='button'
                      className={`btn btn-xs ${commissionFilter === option.key ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setCommissionFilter(option.key)}
                    >
                      {option.label}
                      <span className='ml-2 rounded-full bg-gray-200 px-2 text-[10px] font-medium text-gray-700'>
                        {commissionCounts[option.key]}
                      </span>
                    </button>
                  ))}
                  <button
                    type='button'
                    className='btn btn-outline btn-sm'
                    onClick={handleExportLedger}
                    disabled={exportingLedger || filteredCommissions.length === 0}
                  >
                    {exportingLedger ? 'Exporting…' : 'Export CSV'}
                  </button>
                </div>
              </div>
              {ledgerError ? <p className='text-sm text-red-600'>{ledgerError}</p> : null}
              {filteredCommissions.length === 0 ? (
                <p className='text-sm text-gray-600'>We’ll log commission entries here once orders you refer are delivered.</p>
              ) : (
                <div className='overflow-x-auto'>
                  <table className='min-w-full divide-y divide-gray-200 text-sm'>
                    <thead className='bg-gray-50'>
                      <tr>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Order</th>
                        <th className='px-3 py-2 text-right font-medium text-gray-500'>Net</th>
                        <th className='px-3 py-2 text-right font-medium text-gray-500'>VAT</th>
                        <th className='px-3 py-2 text-right font-medium text-gray-500'>Gross</th>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Status</th>
                        <th className='px-3 py-2 text-left font-medium text-gray-500'>Delivered</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-gray-200'>
                      {filteredCommissions.map((entry) => {
                        const delivered = entry.deliveredAt?.toDate?.();
                        const paid = entry.paidAt?.toDate?.();
                        return (
                          <tr key={entry.id}>
                            <td className='px-3 py-2'>
                              <div className='font-medium text-gray-900'>{entry.orderLabel ?? entry.orderId}</div>
                              <div className='text-xs text-gray-500'>Ref: {entry.orderId}</div>
                            </td>
                            <td className='px-3 py-2 text-right font-medium text-gray-900'>
                              {formatCurrencyGBP(entry.commissionNet)}
                            </td>
                            <td className='px-3 py-2 text-right text-gray-700'>
                              {formatCurrencyGBP(entry.commissionVat)}
                            </td>
                            <td className='px-3 py-2 text-right text-gray-900'>
                              {formatCurrencyGBP(entry.commissionGross)}
                            </td>
                            <td className='px-3 py-2 text-sm capitalize text-gray-700'>
                              {entry.status}
                              {paid ? (
                                <span className='ml-1 text-xs text-gray-500'>· Paid {paid.toLocaleDateString()}</span>
                              ) : null}
                            </td>
                            <td className='px-3 py-2 text-sm text-gray-700'>
                              {delivered ? delivered.toLocaleDateString() : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {overviewResources.length > 0 ? (
              <section className='grid gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div>
                    <h2 className='text-lg font-semibold text-gray-900'>Latest resources</h2>
                    <p className='text-sm text-gray-600'>Toolkit updates and templates curated for affiliates.</p>
                  </div>
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm'
                    onClick={() => setActiveTab('resources')}
                  >
                    View all
                  </button>
                </div>
                <div className='grid gap-3 md:grid-cols-2'>
                  {overviewResources.map((resource) => {
                    const published = resource.publishedAt?.toDate?.();
                    return (
                      <article
                        key={resource.id}
                        className='flex h-full flex-col justify-between rounded-2xl border border-gray-200 p-4'
                      >
                        <div className='space-y-2'>
                          <div className='flex items-center justify-between gap-2'>
                            <h3 className='text-base font-semibold text-gray-900'>{resource.title}</h3>
                            {resource.pinned ? (
                              <span className='rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700'>
                                Pinned
                              </span>
                            ) : null}
                          </div>
                          {resource.category ? (
                            <span className='text-xs uppercase tracking-wide text-gray-500'>{resource.category}</span>
                          ) : null}
                          {resource.description ? (
                            <p className='text-sm text-gray-600'>{resource.description}</p>
                          ) : null}
                        </div>
                        <div className='mt-3 flex items-center justify-between text-[11px] text-gray-500'>
                          {resource.createdByName ? <span>Shared by {resource.createdByName}</span> : <span />}
                          {published ? <span>{published.toLocaleDateString()}</span> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'account' ? (
          <section className='grid gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
            <div className='space-y-1'>
              <h2 className='text-lg font-semibold text-gray-900'>Profile details</h2>
              <p className='text-sm text-gray-600'>
                Keep your contact information current so we know where to send updates about leads and payouts.
              </p>
            </div>
            {accountFeedback ? <p className='text-sm text-emerald-600'>{accountFeedback}</p> : null}
            {accountError ? <p className='text-sm text-red-600'>{accountError}</p> : null}
            <form className='grid gap-4' onSubmit={handleAccountSubmit}>
              <div className='grid gap-4 md:grid-cols-2'>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Full name</span>
                  <input
                    type='text'
                    value={accountForm.name}
                    onChange={handleAccountFieldChange('name')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    autoComplete='name'
                    aria-invalid={accountErrors.name ? 'true' : 'false'}
                  />
                  {accountErrors.name ? (
                    <span className='text-xs text-red-600'>{accountErrors.name}</span>
                  ) : null}
                </label>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Email</span>
                  <input
                    type='email'
                    value={accountForm.email}
                    onChange={handleAccountFieldChange('email')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    autoComplete='email'
                    aria-invalid={accountErrors.email ? 'true' : 'false'}
                  />
                  {accountErrors.email ? (
                    <span className='text-xs text-red-600'>{accountErrors.email}</span>
                  ) : (
                    <span className='text-xs text-gray-500'>We’ll send notifications to this address.</span>
                  )}
                </label>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Company (optional)</span>
                  <input
                    type='text'
                    value={accountForm.company}
                    onChange={handleAccountFieldChange('company')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    autoComplete='organization'
                  />
                </label>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Phone</span>
                  <input
                    type='tel'
                    value={accountForm.phone}
                    onChange={handleAccountFieldChange('phone')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    autoComplete='tel'
                    aria-invalid={accountErrors.phone ? 'true' : 'false'}
                  />
                  {accountErrors.phone ? (
                    <span className='text-xs text-red-600'>{accountErrors.phone}</span>
                  ) : (
                    <span className='text-xs text-gray-500'>Used for urgent campaign questions only.</span>
                  )}
                </label>
              </div>
              <div className='flex flex-wrap items-center gap-3'>
                <button type='submit' className='btn btn-primary' disabled={accountSaving}>
                  {accountSaving ? 'Saving…' : 'Save profile'}
                </button>
                <p className='text-xs text-gray-500'>Updates apply immediately to your affiliate record.</p>
              </div>
            </form>
          </section>
        ) : null}

        {activeTab === 'payout' ? (
          <section className='grid gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
            <div className='space-y-1'>
              <h2 className='text-lg font-semibold text-gray-900'>Payout details</h2>
              <p className='text-sm text-gray-600'>
                We process affiliate payouts on the first working day each month for balances over £50 net once orders are
                delivered. Enter the bank account you’d like us to use.
              </p>
            </div>
            {payoutFeedback ? <p className='text-sm text-emerald-600'>{payoutFeedback}</p> : null}
            {payoutError ? <p className='text-sm text-red-600'>{payoutError}</p> : null}
            <form className='grid gap-4' onSubmit={handlePayoutSubmit}>
              <div className='grid gap-4 md:grid-cols-2'>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Account name</span>
                  <input
                    type='text'
                    value={payoutForm.accountName}
                    onChange={handlePayoutFieldChange('accountName')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    autoComplete='name'
                    aria-invalid={payoutErrors.accountName ? 'true' : 'false'}
                  />
                  {payoutErrors.accountName ? (
                    <span className='text-xs text-red-600'>{payoutErrors.accountName}</span>
                  ) : null}
                </label>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Bank name</span>
                  <input
                    type='text'
                    value={payoutForm.bankName}
                    onChange={handlePayoutFieldChange('bankName')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    autoComplete='organization'
                    aria-invalid={payoutErrors.bankName ? 'true' : 'false'}
                  />
                  {payoutErrors.bankName ? (
                    <span className='text-xs text-red-600'>{payoutErrors.bankName}</span>
                  ) : null}
                </label>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Sort code</span>
                  <input
                    type='text'
                    value={payoutForm.sortCode}
                    onChange={handlePayoutFieldChange('sortCode')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    inputMode='numeric'
                    placeholder='12-34-56'
                    aria-invalid={payoutErrors.sortCode ? 'true' : 'false'}
                  />
                  {payoutErrors.sortCode ? (
                    <span className='text-xs text-red-600'>{payoutErrors.sortCode}</span>
                  ) : (
                    <span className='text-xs text-gray-500'>UK bank sort code (6 digits).</span>
                  )}
                </label>
                <label className='grid gap-1 text-sm text-gray-700'>
                  <span className='font-medium'>Account number</span>
                  <input
                    type='text'
                    value={payoutForm.accountNumber}
                    onChange={handlePayoutFieldChange('accountNumber')}
                    className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                    inputMode='numeric'
                    placeholder='12345678'
                    aria-invalid={payoutErrors.accountNumber ? 'true' : 'false'}
                  />
                  {payoutErrors.accountNumber ? (
                    <span className='text-xs text-red-600'>{payoutErrors.accountNumber}</span>
                  ) : (
                    <span className='text-xs text-gray-500'>We support 6–8 digit UK account numbers.</span>
                  )}
                </label>
              </div>
              <label className='grid gap-1 text-sm text-gray-700'>
                <span className='font-medium'>Notes for finance (optional)</span>
                <textarea
                  value={payoutForm.notes}
                  onChange={handlePayoutFieldChange('notes')}
                  className='w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200'
                  rows={3}
                />
                <span className='text-xs text-gray-500'>Add any special instructions for remittance references.</span>
              </label>
              <div className='flex flex-wrap items-center gap-3'>
                <button type='submit' className='btn btn-primary' disabled={payoutSaving}>
                  {payoutSaving ? 'Saving…' : 'Save payout details'}
                </button>
                <p className='text-xs text-gray-500'>We encrypt your bank details before storing them.</p>
              </div>
            </form>
          </section>
        ) : null}

        {activeTab === 'remittances' ? (
          <section className='grid gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
            <div className='space-y-1'>
              <h2 className='text-lg font-semibold text-gray-900'>Remittance history</h2>
              <p className='text-sm text-gray-600'>
                Download remittance PDFs for every payout once finance finalises the run. Each file lists the VAT
                breakdown applied to your commission.
              </p>
            </div>
            {payouts.length === 0 ? (
              <p className='text-sm text-gray-600'>
                Once HQ records your first payout the remittance will appear here for download.
              </p>
            ) : (
              <div className='overflow-x-auto'>
                <table className='min-w-full divide-y divide-gray-200 text-sm'>
                  <thead className='bg-gray-50'>
                    <tr>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>Recorded</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>Period</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>Net</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>VAT</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>Gross</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>Line items</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>Remittance</th>
                      <th className='px-3 py-2 text-left font-medium text-gray-500'>Notes</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-gray-200'>
                    {payouts.map((payout) => {
                      const created = payout.createdAt?.toDate?.();
                      const periodStart = payout.periodStart?.toDate?.();
                      const periodEnd = payout.periodEnd?.toDate?.();
                      const remittanceUrl = remittanceUrls[payout.id] ?? payout.remittanceDownloadUrl ?? null;
                      const remittanceError = remittanceErrors[payout.id];
                      const generatedAt = payout.remittanceGeneratedAt?.toDate?.();
                      return (
                        <tr key={payout.id}>
                          <td className='px-3 py-2 text-xs text-gray-500'>
                            {created ? created.toLocaleString() : '—'}
                          </td>
                          <td className='px-3 py-2 text-xs text-gray-600'>
                            {periodStart ? periodStart.toLocaleDateString() : '—'}
                            <span className='px-1'>–</span>
                            {periodEnd ? periodEnd.toLocaleDateString() : '—'}
                          </td>
                          <td className='px-3 py-2'>{formatCurrencyGBP(payout.amountNet)}</td>
                          <td className='px-3 py-2'>{formatCurrencyGBP(payout.amountVat)}</td>
                          <td className='px-3 py-2'>{formatCurrencyGBP(payout.amountGross)}</td>
                          <td className='px-3 py-2 text-sm text-gray-700'>
                            {payout.lineItems.length === 0 ? (
                              <span className='text-xs text-gray-500'>Awaiting ledger breakdown</span>
                            ) : (
                              <div className='space-y-1'>
                                {payout.lineItems.map((item) => (
                                  <div key={item.commissionId} className='rounded bg-gray-50 px-2 py-1'>
                                    <div className='text-xs font-medium text-gray-800'>{item.orderLabel ?? item.orderId}</div>
                                    <div className='text-[11px] text-gray-500'>
                                      Net {formatCurrencyGBP(item.commissionNet)} · VAT {formatCurrencyGBP(item.commissionVat)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className='px-3 py-2 text-sm text-gray-700'>
                            {remittanceError ? (
                              <span className='text-xs text-red-600'>{remittanceError}</span>
                            ) : remittanceUrl ? (
                              <a
                                href={remittanceUrl}
                                target='_blank'
                                rel='noopener noreferrer'
                                className='btn btn-link btn-xs px-0'
                              >
                                Download {payout.remittanceFileName ?? 'PDF'}
                              </a>
                            ) : payout.remittanceStoragePath ? (
                              <span className='text-xs text-gray-500'>Preparing file…</span>
                            ) : (
                              <span className='text-xs text-gray-500'>Not provided yet</span>
                            )}
                            {generatedAt ? (
                              <div className='text-[11px] text-gray-500'>
                                Updated {generatedAt.toLocaleDateString()}
                              </div>
                            ) : null}
                          </td>
                          <td className='px-3 py-2 text-xs text-gray-500'>{payout.notes ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {activeTab === 'resources' ? (
          <section className='grid gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
            <div className='space-y-1'>
              <h2 className='text-lg font-semibold text-gray-900'>Affiliate resources</h2>
              <p className='text-sm text-gray-600'>
                Guides, swipe files, and announcements from HQ to help you generate and nurture leads.
              </p>
            </div>
            {resourceError ? <p className='text-sm text-red-600'>{resourceError}</p> : null}
            {orderedResources.length === 0 ? (
              <p className='text-sm text-gray-600'>No resources have been published yet. Check back soon.</p>
            ) : (
              <ul className='grid gap-3 md:grid-cols-2'>
                {orderedResources.map((resource) => {
                  const published = resource.publishedAt?.toDate?.();
                  return (
                    <li key={resource.id} className='flex h-full flex-col justify-between rounded-2xl border border-gray-200 p-4'>
                      <div className='space-y-2'>
                        <div className='flex items-center justify-between gap-2'>
                          <h3 className='text-base font-semibold text-gray-900'>{resource.title}</h3>
                          {resource.pinned ? (
                            <span className='rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700'>
                              Pinned
                            </span>
                          ) : null}
                        </div>
                        {resource.category ? (
                          <span className='text-xs uppercase tracking-wide text-gray-500'>{resource.category}</span>
                        ) : null}
                        {resource.description ? (
                          <p className='text-sm text-gray-600'>{resource.description}</p>
                        ) : null}
                      </div>
                      <div className='mt-4 flex items-center justify-between text-[11px] text-gray-500'>
                        {resource.createdByName ? <span>Shared by {resource.createdByName}</span> : <span />}
                        {published ? <span>{published.toLocaleDateString()}</span> : null}
                      </div>
                      {resource.linkUrl ? (
                        <a
                          href={resource.linkUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='btn btn-outline btn-sm mt-3 self-start'
                        >
                          Open resource
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>

    </PortalContainer>
  );
}
