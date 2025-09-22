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

export default function AdminOrdersPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const [orders, setOrders] = useState<any[]>([]);
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
      const orderSnap = await getDocs(
        query(collection(db, "orders"), orderBy("createdAt", "desc"))
      );
      const raw = orderSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const ids = Array.from(new Set(raw.map((o) => o.userId).filter(Boolean)));
      const userMap: Record<string, any> = {};
      await Promise.all(
        ids.map(async (uid) => {
          const uSnap = await getDoc(doc(db, "users", uid));
          if (uSnap.exists()) userMap[uid] = uSnap.data();
        })
      );
      setOrders(raw.map((o) => ({ ...o, user: userMap[o.userId] })));
      setLoading(false);
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

