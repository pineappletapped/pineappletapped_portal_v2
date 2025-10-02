"use client";

import { useEffect, useMemo, useState } from "react";
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

import PortalContainer from "@/components/PortalContainer";
import { ensureFirebase } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  AFFILIATE_MIN_WITHDRAWAL_NET,
  AffiliateRecord,
  AffiliatePayoutRecord,
  AffiliateCommissionRecord,
  AffiliateCommissionStatus,
  buildAffiliateShareLink,
  formatCurrencyGBP,
  parseAffiliateDoc,
  parseAffiliatePayoutDoc,
  parseAffiliateCommissionDoc,
  buildAffiliateCommissionCsv,
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

  useEffect(() => {
    let unsubscribeOrders: (() => void) | undefined;
    let unsubscribePayouts: (() => void) | undefined;
    let unsubscribeCommissions: (() => void) | undefined;

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (!auth || !db) {
          throw new Error("Portal is unavailable without Firebase.");
        }

        await new Promise<void>((resolve) => {
          const unsub = auth.onAuthStateChanged(async (user: User | null) => {
            unsub();
            if (!user) {
              setError("Please sign in to view your affiliate dashboard.");
              setLoading(false);
              resolve();
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
                resolve();
                return;
              }

              const record = parseAffiliateDoc(docSnap);
              setAffiliate(record);
              setLoading(false);
              resolve();

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
              resolve();
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
    };
  }, []);

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

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">Total earned</p>
            <p className="text-xl font-semibold text-gray-900">
              {formatCurrencyGBP(affiliate.metrics.totalCommissionGross)}
            </p>
            <p className="text-xs text-gray-500">Including VAT</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">Available to withdraw</p>
            <p className="text-xl font-semibold text-gray-900">{formatCurrencyGBP(pendingGross)}</p>
            <p className={`text-xs ${eligibleForWithdrawal ? "text-emerald-600" : "text-gray-500"}`}>
              {eligibleForWithdrawal
                ? "Great! You’ve met the £50 minimum."
                : `You’ll be able to withdraw once you reach £${AFFILIATE_MIN_WITHDRAWAL_NET.toFixed(0)} net.`}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase text-gray-500">Orders influenced</p>
            <p className="text-xl font-semibold text-gray-900">{affiliate.metrics.totalOrders}</p>
            <p className="text-xs text-gray-500">All-time orders linked to your referrals</p>
          </div>
        </section>

        <section className="grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Your referral link</h2>
              <p className="text-sm text-gray-600">
                Share this link with prospects so we can automatically attribute new enquiries to you.
              </p>
            </div>
            <button type="button" className="btn" onClick={handleCopyLink}>
              Copy link
            </button>
          </div>
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700 break-all">{shareLink}</div>
        </section>

        <section className="grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Recent referred orders</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-600">You haven’t referred any orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Order</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Commission (net)</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Commission (gross)</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {orders.map((order) => {
                    const created = order.createdAt?.toDate?.();
                    return (
                      <tr key={order.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{order.label}</div>
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600">{order.status ?? '—'}</td>
                        <td className="px-3 py-2">{formatCurrencyGBP(order.commissionNet)}</td>
                        <td className="px-3 py-2">{formatCurrencyGBP(order.commissionGross)}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">
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

        <section className="grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Clients you’ve introduced</h2>
          {clients.length === 0 ? (
            <p className="text-sm text-gray-600">We’ll list customers you refer here once they start working with us.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {clients.map((client) => {
                const last = client.lastOrderAt?.toDate?.();
                return (
                  <div key={client.id} className="rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
                    <p className="font-medium text-gray-900">{client.name}</p>
                    {client.email ? <p className="text-xs text-gray-500">{client.email}</p> : null}
                    <p className="text-xs text-gray-500">
                      Last order: {last ? last.toLocaleDateString() : 'not yet'}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Commission ledger</h2>
              <p className="text-xs text-gray-500">{commissionCounts.all} entries</p>
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
            <p className="text-sm text-gray-600">We’ll log commission entries here once orders you refer are delivered.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Order</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Net</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">VAT</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-500">Gross</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Delivered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredCommissions.map((entry) => {
                    const delivered = entry.deliveredAt?.toDate?.();
                    const paid = entry.paidAt?.toDate?.();
                    return (
                      <tr key={entry.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{entry.orderLabel ?? entry.orderId}</div>
                          <div className="text-xs text-gray-500">Ref: {entry.orderId}</div>
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
                          {paid ? (
                            <span className="ml-1 text-xs text-gray-500">
                              · Paid {paid.toLocaleDateString()}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          {delivered ? delivered.toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Payout history</h2>
          {payouts.length === 0 ? (
            <p className="text-sm text-gray-600">Once HQ processes a payout it will appear here along with the VAT breakdown.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Recorded</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Net</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">VAT</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Gross</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Orders</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {payouts.map((payout) => {
                    const created = payout.createdAt?.toDate?.();
                    return (
                      <tr key={payout.id}>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {created ? created.toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2">{formatCurrencyGBP(payout.amountNet)}</td>
                        <td className="px-3 py-2">{formatCurrencyGBP(payout.amountVat)}</td>
                        <td className="px-3 py-2">{formatCurrencyGBP(payout.amountGross)}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          {payout.lineItems.length === 0 ? (
                            <span className="text-xs text-gray-500">Awaiting ledger breakdown</span>
                          ) : (
                            <div className="space-y-1">
                              {payout.lineItems.map((item) => (
                                <div key={item.commissionId} className="rounded bg-gray-50 px-2 py-1">
                                  <div className="text-xs font-medium text-gray-800">{item.orderLabel ?? item.orderId}</div>
                                  <div className="text-[11px] text-gray-500">
                                    Net {formatCurrencyGBP(item.commissionNet)} · VAT {formatCurrencyGBP(item.commissionVat)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{payout.notes ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PortalContainer>
  );
}
