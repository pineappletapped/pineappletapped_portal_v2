"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useRoleGate } from "@/hooks/useRoleGate";
import { describeLeadSource } from "@/lib/lead-source";
import { HQ_UNASSIGNED_TERRITORY_LABEL } from "@/lib/franchises";

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("Failed to convert Firestore timestamp", error);
      return null;
    }
  }
  if (typeof value?.seconds === "number" && typeof value?.nanoseconds === "number") {
    const millis = value.seconds * 1000 + Math.floor(value.nanoseconds / 1_000_000);
    return new Date(millis);
  }
  return null;
}

function formatDate(value: any): string | null {
  const date = toDate(value);
  return date ? date.toLocaleDateString() : null;
}

function formatDateTime(value: any): string | null {
  const date = toDate(value);
  return date ? date.toLocaleString() : null;
}

function capitaliseWord(value: string | null | undefined): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatStatusLabel(value: string | null | undefined, fallback = "Pending"): string {
  if (!value) return fallback;
  return value
    .split("_")
    .filter(Boolean)
    .map((segment) => capitaliseWord(segment))
    .join(" ");
}

function normaliseStatus(value: any): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

export default function AdminOrdersPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const [orders, setOrders] = useState<any[]>([]);
  const [franchiseMap, setFranchiseMap] = useState<
    Record<string, { name?: string | null; code?: string | null }>
  >({});
  const [statusFilter, setStatusFilter] = useState("all");
  const [emailFilter, setEmailFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);

  const handleStatusChange = async (order: any, newStatus: string) => {
    if (order.status === newStatus) return;
    let projectId = order.projectId;
    if (["deposit_paid", "paid", "balance_paid"].includes(newStatus)) {
      const prodSnap = order.serviceId
        ? await getDoc(doc(db, "products", order.serviceId))
        : null;
      const prod = prodSnap && prodSnap.exists() ? (prodSnap.data() as any) : null;
      const tasks: any[] = prod?.defaultTasks || [];
      const list = tasks.map((t) => `- ${t.title}`).join("\n");
      const confirmMsg =
        tasks.length > 0
          ? `Create project and tasks?\n${list}`
          : "Create project?";
      const ok = window.confirm(confirmMsg);
      if (!ok) return;
      if (!projectId) {
        const projRef = await addDoc(collection(db, "projects"), {
          orgId: order.orgId || null,
          serviceId: order.serviceId || null,
          orderId: order.id,
          userId: order.userId || null,
          userEmail: order.user?.email || null,
          title: order.serviceName || "New Project",
          status: "intake",
          createdAt: serverTimestamp(),
        });
        projectId = projRef.id;
        await updateDoc(doc(db, "orders", order.id), { projectId });
      }
      const existing = await getDocs(
        collection(db, "projects", projectId, "tasks")
      );
      if (existing.empty && tasks.length > 0) {
        for (const t of tasks) {
          await addDoc(collection(db, "projects", projectId, "tasks"), {
            title: t.title,
            forCustomer: !!t.forCustomer,
            subtasks: t.subtasks || [],
            status: "todo",
            createdAt: serverTimestamp(),
            assignedTo: null,
            assigneeName: null,
          });
        }
      }
    }
    await updateDoc(doc(db, "orders", order.id), { status: newStatus });
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id ? { ...o, status: newStatus, projectId } : o
      )
    );
  };

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const orderSnap = await getDocs(
          query(collection(db, "orders"), orderBy("createdAt", "desc"))
        );
        const raw = orderSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        const ids = Array.from(
          new Set(raw.map((o) => o.userId).filter((value): value is string => Boolean(value)))
        );
        const userMap: Record<string, any> = {};
        await Promise.all(
          ids.map(async (uid) => {
            try {
              const uSnap = await getDoc(doc(db, "users", uid));
              if (uSnap.exists()) userMap[uid] = uSnap.data();
            } catch (err) {
              console.warn("Failed to load user", uid, err);
            }
          })
        );

        const franchiseIds = new Set<string>();
        raw.forEach((order) => {
          if (order.franchiseId) franchiseIds.add(order.franchiseId as string);
          const assignmentFranchiseId = (order.franchiseAssignment as any)?.franchiseId;
          if (assignmentFranchiseId) {
            franchiseIds.add(String(assignmentFranchiseId));
          }
        });

        const franchiseData: Record<string, { name?: string | null; code?: string | null }> = {};
        if (franchiseIds.size > 0) {
          await Promise.all(
            Array.from(franchiseIds).map(async (franchiseId) => {
              try {
                const snap = await getDoc(doc(db, "franchises", franchiseId));
                if (snap.exists()) {
                  const data = snap.data() as any;
                  franchiseData[franchiseId] = {
                    name: (data?.name as string) || null,
                    code: (data?.code as string) || null,
                  };
                }
              } catch (franchiseErr) {
                console.warn(
                  "Failed to load franchise details",
                  franchiseId,
                  franchiseErr
                );
              }
            })
          );
        }

        setFranchiseMap(franchiseData);
        setOrders(raw.map((o) => ({ ...o, user: userMap[o.userId] })));
      } catch (err) {
        console.error("Failed to load orders", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view orders.</p>;

  const statusOptions = [
    "pending",
    "deposit_paid",
    "in_progress",
    "balance_due",
    "balance_paid",
    "paid",
    "cancelled",
  ];
  const statuses = Array.from(
    new Set([
      ...orders.map((o) => o.status).filter(Boolean),
      ...statusOptions,
    ])
  );

  const filtered = orders.filter((o) => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (
      emailFilter &&
      !(o.user?.email || "")
        .toLowerCase()
        .includes(emailFilter.toLowerCase())
    )
      return false;
    const created = o.createdAt?.toDate ? o.createdAt.toDate() : null;
    if (startDate && (!created || created < new Date(startDate))) return false;
    if (endDate && (!created || created > new Date(endDate))) return false;
    return true;
  });

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Order Management</h1>
      <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm">
          <span>Status</span>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span>Email</span>
          <input
            className="input"
            placeholder="Filter by email"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Start date</span>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>End date</span>
          <input
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>
      {filtered.length === 0 ? (
        <p>No orders found.</p>
      ) : (
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2">ID</th>
              <th className="p-2">Customer</th>
              <th className="p-2">Status</th>
              <th className="p-2">Franchise Routing</th>
              <th className="p-2">Created</th>
              <th className="p-2">Project</th>
              <th className="p-2">Items</th>
              <th className="p-2">Payments</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const name =
                o.customerName ||
                o.user?.displayName ||
                o.user?.email ||
                "-";
              const company = o.companyName || o.user?.companyName;
              const assignment = o.franchiseAssignment as
                | {
                    status?: string;
                    matchType?: string;
                    franchiseId?: string | null;
                    territoryId?: string | null;
                    territoryLabel?: string;
                    territoryPostalCode?: string;
                    normalizedPostalCode?: string;
                    inputPostalCode?: string;
                    hqFallback?: boolean;
                  }
                | null;
              const assignmentStatus =
                typeof assignment?.status === "string" ? (assignment.status as string) : null;
              const assignmentStatusLabel =
                assignmentStatus !== null ? assignmentStatus.replace(/_/g, " ") : null;
              const assignmentMatchType = assignment?.matchType || null;
              const franchiseId =
                (o.franchiseId as string | undefined) ||
                (assignment?.franchiseId as string | undefined) ||
                null;
              const franchiseDetails = franchiseId
                ? franchiseMap[franchiseId]
                : undefined;
              const franchiseName =
                franchiseDetails?.name ||
                franchiseDetails?.code ||
                franchiseId ||
                null;
              const territoryLabel =
                assignment?.territoryLabel || assignment?.territoryPostalCode || null;
              const hasTerritoryMatch = Boolean(
                assignment?.territoryId || assignment?.territoryPostalCode || assignment?.territoryLabel
              );
              const isHqIntake =
                !franchiseId &&
                (assignmentStatus === "hq_unassigned" || assignment?.hqFallback === true ||
                  (assignmentStatus === "matched" && hasTerritoryMatch));
              const assignedOperator =
                (o.franchiseAssignedUser?.displayName as string | undefined) ||
                (o.franchiseAssignedUser?.email as string | undefined) ||
                null;
              const inputPostalCode =
                (o.clientPostalCode as string | undefined) ||
                assignment?.inputPostalCode ||
                assignment?.normalizedPostalCode ||
                null;
              const royalty = (o.royalty as any) || null;
              const royaltySource =
                (royalty?.source as string | undefined) ||
                (o.royaltySource as string | undefined) ||
                (o.leadSource as string | undefined) ||
                'hq';
              const royaltyLabel = royaltySource === 'franchisee' ? 'Franchise-sourced' : 'HQ-sourced';
              const leadSourceDescription = describeLeadSource(
                (o.leadSource as string | undefined) || royaltySource
              );
              const royaltyPercentage =
                typeof royalty?.percentage === 'number'
                  ? royalty.percentage
                  : typeof o.royaltyPercentage === 'number'
                    ? o.royaltyPercentage
                    : null;
              const royaltyOrderIndex =
                typeof royalty?.orderIndex === 'number'
                  ? royalty.orderIndex
                  : typeof o.clientRoyaltyOrderIndex === 'number'
                    ? o.clientRoyaltyOrderIndex
                    : null;
              const royaltyTier = royalty?.tier as
                | { minOrder?: number | null; maxOrder?: number | null }
                | undefined;
              const orderItems = Array.isArray(o.items)
                ? (o.items as Array<Record<string, any>>)
                : Array.isArray(o.budgetItems)
                  ? (o.budgetItems as Array<Record<string, any>>)
                  : [];
              const projectId =
                typeof o.projectId === "string" && o.projectId.trim().length > 0
                  ? o.projectId
                  : null;
              const paymentSummary = (o.paymentSummary as Record<string, any> | undefined) || {};
              const depositSummary = (paymentSummary.deposit as Record<string, any> | undefined) || {};
              const balanceSummary = (paymentSummary.balance as Record<string, any> | undefined) || {};
              const depositStatus = normaliseStatus(o.depositStatus) ?? normaliseStatus(depositSummary.status);
              const balanceStatus = normaliseStatus(o.balanceStatus) ?? normaliseStatus(balanceSummary.status);
              const depositPaidAt = depositSummary.paidAt ?? o.depositPaidAt;
              const balancePaidAt = balanceSummary.paidAt ?? o.balancePaidAt;
              const lastPayment = (o.lastStripePayment as Record<string, any> | undefined) || null;
              const checkoutSessionsMap = o.stripeCheckoutSessions as Record<string, any> | undefined;
              const checkoutSessions = checkoutSessionsMap ? Object.values(checkoutSessionsMap) : [];
              const latestSession =
                checkoutSessions
                  .map((entry) => entry || {})
                  .sort((a, b) => {
                    const aDate =
                      toDate(a.updatedAt) ?? toDate(a.completedAt) ?? toDate(a.createdAt);
                    const bDate =
                      toDate(b.updatedAt) ?? toDate(b.completedAt) ?? toDate(b.createdAt);
                    const aMillis = aDate ? aDate.getTime() : 0;
                    const bMillis = bDate ? bDate.getTime() : 0;
                    return bMillis - aMillis;
                  })[0] ?? null;
              return (
                <tr key={o.id} className="border-t">
                  <td className="p-2">{o.id}</td>
                  <td className="p-2">
                    {o.userId ? (
                      <Link
                        href={`/admin/users?uid=${o.userId}`}
                        className="text-orange underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                    {company && (
                      <div className="text-xs text-gray-500">{company}</div>
                    )}
                  </td>
                  <td className="p-2">
                    <select
                      className="input capitalize"
                      value={o.status || "pending"}
                      onChange={(e) => handleStatusChange(o, e.target.value)}
                    >
                      {statusOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 align-top">
                    {franchiseName ? (
                      <div>
                        <div className="font-medium">{franchiseName}</div>
                        {territoryLabel && (
                          <div className="text-xs text-gray-500">
                            Territory: {territoryLabel}
                          </div>
                        )}
                        {assignedOperator && (
                          <div className="text-xs text-gray-500">
                            Operator: {assignedOperator}
                          </div>
                        )}
                      </div>
                    ) : isHqIntake ? (
                      <div className="grid gap-1">
                        <div className="font-medium text-sm">
                          {HQ_UNASSIGNED_TERRITORY_LABEL}
                        </div>
                        {territoryLabel && (
                          <div className="text-xs text-gray-500">
                            Territory: {territoryLabel}
                          </div>
                        )}
                        <div className="text-xs text-gray-500">
                          HQ can fulfil internally or assign to a franchisee with the 25% out-of-territory rate.
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">
                        {assignmentStatus === "unmatched"
                          ? "No territory match"
                          : "Not routed"}
                      </div>
                    )}
                    {inputPostalCode && (
                      <div className="text-[10px] uppercase text-gray-400 mt-1">
                        Postcode: {inputPostalCode}
                      </div>
                    )}
                    {assignmentStatusLabel && (
                      <div className="text-[10px] uppercase text-gray-400">
                        {assignmentStatusLabel}
                        {assignmentMatchType ? ` · ${assignmentMatchType}` : ""}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-gray-500">
                      Lead source: {leadSourceDescription}
                    </div>
                    {(royaltyPercentage !== null || royaltyOrderIndex !== null) && (
                      <div className="mt-2 text-xs text-gray-500">
                        Royalty: {royaltyPercentage !== null ? `${royaltyPercentage}%` : '—'} · {royaltyLabel}
                        {royaltyOrderIndex ? ` · order #${royaltyOrderIndex}` : ''}
                        {royaltyTier?.minOrder
                          ? royaltyTier.maxOrder != null
                            ? ` · tier ${royaltyTier.minOrder}-${royaltyTier.maxOrder}`
                            : ` · tier ${royaltyTier.minOrder}+`
                          : ''}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    {o.createdAt?.toDate
                      ? o.createdAt.toDate().toLocaleDateString()
                      : "-"}
                  </td>
                  <td className="p-2">
                    {projectId ? (
                      <Link
                        href={`/projects/${projectId}`}
                        className="text-orange underline"
                      >
                        View
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-2 align-top">
                    {orderItems.length === 0 ? (
                      <span className="text-xs text-gray-500">No items</span>
                    ) : (
                      <ul className="grid gap-2">
                        {orderItems.map((item, index) => {
                          const itemId =
                            typeof item?.id === "string" && item.id.trim().length > 0
                              ? item.id
                              : null;
                          const quantity =
                            typeof item?.quantity === "number" && Number.isFinite(item.quantity)
                              ? item.quantity
                              : null;
                          const price =
                            typeof item?.price === "number" && Number.isFinite(item.price)
                              ? item.price
                              : null;
                          const rentalTotal =
                            typeof item?.rentalTotal === "number" && Number.isFinite(item.rentalTotal)
                              ? item.rentalTotal
                              : null;
                          const description =
                            typeof item?.description === "string" ? item.description : null;
                          const deliveryLink = projectId
                            ? `/admin/deliveries/new?projectId=${encodeURIComponent(projectId)}${
                                itemId ? `&itemId=${encodeURIComponent(itemId)}` : ""
                              }${item?.name ? `&itemName=${encodeURIComponent(item.name)}` : ""}&orderId=${encodeURIComponent(o.id)}`
                            : null;
                          return (
                            <li key={itemId || `${o.id}-item-${index}`} className="space-y-1">
                              <div className="font-medium text-sm text-gray-900">
                                {item?.name || "Line item"}
                                {quantity ? (
                                  <span className="text-xs text-gray-500"> · ×{quantity}</span>
                                ) : null}
                              </div>
                              {description ? (
                                <div className="text-xs text-gray-500 whitespace-pre-line">
                                  {description}
                                </div>
                              ) : null}
                              {(price || rentalTotal) && (
                                <div className="text-xs text-gray-500">
                                  {price ? `£${price.toFixed(2)}` : null}
                                  {price && rentalTotal ? " · " : null}
                                  {rentalTotal ? `Rental £${rentalTotal.toFixed(2)}` : null}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2 text-xs">
                                {projectId ? (
                                  <Link
                                    href={`/projects/${projectId}`}
                                    className="text-orange underline"
                                  >
                                    Open project
                                  </Link>
                                ) : (
                                  <span className="text-gray-400">Project pending</span>
                                )}
                                {deliveryLink ? (
                                  <Link href={deliveryLink} className="btn btn-xs">
                                    Delivery form
                                  </Link>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </td>
                  <td className="p-2 align-top">
                    <div className="space-y-2 text-xs text-gray-600">
                      <div>
                        <div className="font-semibold text-gray-800">Deposit</div>
                        <div>
                          {depositStatus === "paid"
                            ? "Paid"
                            : formatStatusLabel(depositStatus)}
                          {formatDate(depositPaidAt)
                            ? ` · ${formatDate(depositPaidAt)}`
                            : ""}
                        </div>
                      </div>
                      <div>
                        <div className="font-semibold text-gray-800">Balance</div>
                        <div>
                          {balanceStatus === "paid"
                            ? "Paid"
                            : formatStatusLabel(balanceStatus)}
                          {formatDate(balancePaidAt)
                            ? ` · ${formatDate(balancePaidAt)}`
                            : ""}
                        </div>
                      </div>
                      {lastPayment ? (
                        <div className="space-y-1 rounded border border-slate-200 bg-white p-2 text-xs text-gray-600">
                          <div className="font-medium text-gray-800">
                            {formatStatusLabel(normaliseStatus(lastPayment.type), "Stripe")} payment
                          </div>
                          <div>
                            {typeof lastPayment.amount === "number"
                              ? `£${lastPayment.amount.toFixed(2)}`
                              : "Amount pending"}
                            {typeof lastPayment.currency === "string" && lastPayment.currency
                              ? ` ${(lastPayment.currency as string).toUpperCase()}`
                              : ""}
                          </div>
                          {formatDateTime(lastPayment.recordedAt) ? (
                            <div>Recorded {formatDateTime(lastPayment.recordedAt)}</div>
                          ) : null}
                          {typeof lastPayment.receiptUrl === "string" && lastPayment.receiptUrl ? (
                            <Link
                              href={lastPayment.receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange underline"
                            >
                              Receipt
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                      {latestSession ? (
                        <div className="space-y-1 rounded border border-dashed border-slate-300 bg-slate-50 p-2 text-xs text-gray-600">
                          <div className="font-medium text-gray-800">
                            Checkout
                            {latestSession.type
                              ? ` (${formatStatusLabel(normaliseStatus(latestSession.type), "")})`
                              : ""}
                          </div>
                          <div>
                            Status: {formatStatusLabel(normaliseStatus(latestSession.status), "Unknown")}
                            {latestSession.paymentStatus
                              ? ` · ${formatStatusLabel(normaliseStatus(latestSession.paymentStatus))}`
                              : ""}
                          </div>
                          {formatDateTime(
                            latestSession.updatedAt ?? latestSession.completedAt ?? latestSession.createdAt
                          ) ? (
                            <div>
                              Updated {formatDateTime(
                                latestSession.updatedAt ?? latestSession.completedAt ?? latestSession.createdAt
                              )}
                            </div>
                          ) : null}
                          {typeof latestSession.url === "string" && latestSession.url ? (
                            <Link
                              href={latestSession.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange underline"
                            >
                              Open session
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="p-2">
                    <Link href={`/orders/${o.id}`} className="btn-sm">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

