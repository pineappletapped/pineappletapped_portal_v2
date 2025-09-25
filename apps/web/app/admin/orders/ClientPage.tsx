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
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-sm">
          Status:
          <select
            className="input ml-1"
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
        <input
          className="input"
          placeholder="Filter by email"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
        />
        <input
          type="date"
          className="input"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <input
          type="date"
          className="input"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
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
                    franchiseId?: string;
                    territoryLabel?: string;
                    territoryPostalCode?: string;
                    normalizedPostalCode?: string;
                    inputPostalCode?: string;
                  }
                | null;
              const assignmentStatus = assignment?.status || null;
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
                    {assignmentStatus && (
                      <div className="text-[10px] uppercase text-gray-400">
                        {assignmentStatus}
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
                    {o.projectId ? (
                      <Link
                        href={`/projects/${o.projectId}`}
                        className="text-orange underline"
                      >
                        View
                      </Link>
                    ) : (
                      "-"
                    )}
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

