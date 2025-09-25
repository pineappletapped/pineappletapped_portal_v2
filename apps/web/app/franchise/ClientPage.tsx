"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PortalContainer from "@/components/PortalContainer";
import { ensureFirebase, loadAuthModule } from "@/lib/firebase";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  type Firestore,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

interface FranchiseSummary {
  id: string;
  name: string;
  code: string | null;
  status: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

interface OrderRecord {
  id: string;
  [key: string]: any;
}

interface ProjectRecord {
  id: string;
  [key: string]: any;
}

interface UploadRecord {
  id: string;
  [key: string]: any;
}

interface ClientSummary {
  key: string;
  name: string;
  email: string | null;
  company: string | null;
  orderCount: number;
  totalNet: number;
  lastOrderAt: Date | null;
}

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("Failed to convert timestamp", error);
    }
  }
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string") {
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  return null;
};

const formatDate = (value: any) => {
  const date = toDate(value);
  if (!date) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const deriveFranchiseIdsFromUser = (data: any): string[] => {
  const ids = new Set<string>();
  const pushValue = (raw: unknown) => {
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) {
        ids.add(trimmed);
      }
    }
  };

  pushValue(data?.primaryFranchiseId);
  pushValue(data?.franchiseId);

  if (Array.isArray(data?.franchiseIds)) {
    data.franchiseIds.forEach((value: unknown) => pushValue(value));
  }

  const roles = data?.franchiseRoles;
  if (roles && typeof roles === "object") {
    Object.values(roles).forEach((value) => pushValue(value));
  }

  return Array.from(ids);
};

const formatBytes = (size: number | null | undefined) => {
  if (!size || size <= 0) {
    return "—";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export default function FranchisePortalPage() {
  const [initialising, setInitialising] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [franchises, setFranchises] = useState<FranchiseSummary[]>([]);
  const [activeFranchiseId, setActiveFranchiseId] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const dbRef = useRef<Firestore | null>(null);
  const storageRef = useRef<any>(null);

  const currencyCode = useMemo(() => {
    for (const order of orders) {
      const currency =
        order.currency || order.currencyCode || order.currencyId || order.currency_code;
      if (typeof currency === "string" && currency.trim()) {
        return currency.trim().toUpperCase();
      }
    }
    return "GBP";
  }, [orders]);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: 2,
      }),
    [currencyCode]
  );

  const computeFranchiseShare = useCallback(
    (order: OrderRecord) => {
      const netRaw =
        order.netTotal ?? order.net ?? order.subtotal ?? order.total ?? order.price ?? 0;
      const net = Number(netRaw);
      const safeNet = Number.isFinite(net) ? Math.max(net, 0) : 0;
      const percentageRaw =
        order?.royalty?.percentage ?? order?.royaltyPercentage ?? order?.franchiseRoyaltyPercentage;
      const percentage = Number(percentageRaw);
      const safePercentage =
        Number.isFinite(percentage) && percentage >= 0 ? Math.min(percentage, 100) : 0;
      const hqShare = safeNet * (safePercentage / 100);
      const franchiseShare = Math.max(safeNet - hqShare, 0);
      return { net: safeNet, franchiseShare, hqShare, percentage: safePercentage };
    },
    []
  );

  const orderMetrics = useMemo(() => {
    if (!orders.length) {
      return {
        totalOrders: 0,
        totalNet: 0,
        totalFranchiseShare: 0,
        averageNet: 0,
        completedOrders: 0,
        openOrders: 0,
      };
    }
    let totalNet = 0;
    let totalFranchiseShare = 0;
    let completedOrders = 0;
    let openOrders = 0;
    orders.forEach((order) => {
      const share = computeFranchiseShare(order);
      totalNet += share.net;
      totalFranchiseShare += share.franchiseShare;
      const status = typeof order.status === "string" ? order.status.toLowerCase() : "";
      if (["complete", "completed", "paid", "balance_paid", "delivered"].includes(status)) {
        completedOrders += 1;
      } else {
        openOrders += 1;
      }
    });
    return {
      totalOrders: orders.length,
      totalNet,
      totalFranchiseShare,
      averageNet: orders.length ? totalNet / orders.length : 0,
      completedOrders,
      openOrders,
    };
  }, [computeFranchiseShare, orders]);

  const upcomingEvents = useMemo(() => {
    const events: Array<{
      id: string;
      type: string;
      date: Date | null;
      project: ProjectRecord;
    }> = [];
    projects.forEach((project) => {
      const filmingDate = toDate(project.filmingDueDate ?? project.filmingDueAt);
      const editDate = toDate(project.dueDate ?? project.editingDueDate ?? project.editingDueAt);
      const kickoffDate = toDate(project.kickoffDate);
      if (filmingDate) {
        events.push({ id: `${project.id}-filming`, type: "Filming due", date: filmingDate, project });
      }
      if (editDate) {
        events.push({ id: `${project.id}-edit`, type: "Edit due", date: editDate, project });
      }
      if (kickoffDate) {
        events.push({ id: `${project.id}-kickoff`, type: "Kick-off", date: kickoffDate, project });
      }
    });
    events.sort((a, b) => {
      const aTime = a.date ? a.date.getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.date ? b.date.getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
    return events.slice(0, 10);
  }, [projects]);

  const clients = useMemo<ClientSummary[]>(() => {
    const map = new Map<string, ClientSummary>();
    orders.forEach((order) => {
      const key =
        (typeof order.userId === "string" && order.userId) ||
        (typeof order.user?.uid === "string" && order.user.uid) ||
        (typeof order.userEmail === "string" && order.userEmail) ||
        (typeof order.customerEmail === "string" && order.customerEmail) ||
        order.id;
      const name =
        (typeof order.customerName === "string" && order.customerName) ||
        (typeof order.user?.displayName === "string" && order.user.displayName) ||
        (typeof order.user?.email === "string" && order.user.email) ||
        (typeof order.userEmail === "string" && order.userEmail) ||
        "Client";
      const email =
        (typeof order.customerEmail === "string" && order.customerEmail) ||
        (typeof order.userEmail === "string" && order.userEmail) ||
        (typeof order.user?.email === "string" && order.user.email) ||
        null;
      const company =
        (typeof order.companyName === "string" && order.companyName) ||
        (typeof order.organisation === "string" && order.organisation) ||
        null;
      const share = computeFranchiseShare(order);
      const createdAt = toDate(order.createdAt);
      const existing = map.get(key);
      if (existing) {
        existing.orderCount += 1;
        existing.totalNet += share.net;
        if (createdAt && (!existing.lastOrderAt || createdAt > existing.lastOrderAt)) {
          existing.lastOrderAt = createdAt;
        }
      } else {
        map.set(key, {
          key,
          name,
          email,
          company,
          orderCount: 1,
          totalNet: share.net,
          lastOrderAt: createdAt,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.totalNet - a.totalNet);
  }, [computeFranchiseShare, orders]);

  const resetUploadForm = useCallback(() => {
    setUploadFile(null);
    setUploadName("");
    setUploadProgress(0);
    setUploadError(null);
  }, []);

  const loadFranchiseMembership = useCallback(
    async (nextUser: User, database: Firestore) => {
      setInitialising(true);
      setError(null);
      try {
        const userSnap = await getDoc(doc(database, "users", nextUser.uid));
        const userData = userSnap.data() || {};
        const ids = new Set<string>(deriveFranchiseIdsFromUser(userData));

        const memberSnap = await getDocs(
          query(collection(database, "franchiseMembers"), where("userId", "==", nextUser.uid))
        );
        memberSnap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (data?.franchiseId && typeof data.franchiseId === "string") {
            const trimmed = data.franchiseId.trim();
            if (trimmed) {
              ids.add(trimmed);
            }
          }
        });

        if (ids.size === 0) {
          setFranchises([]);
          setActiveFranchiseId(null);
          setOrders([]);
          setProjects([]);
          setUploads([]);
          setError("No franchise membership found for your account yet.");
          return;
        }

        const summaries: FranchiseSummary[] = [];
        await Promise.all(
          Array.from(ids).map(async (franchiseId) => {
            try {
              const franchiseSnap = await getDoc(doc(database, "franchises", franchiseId));
              if (franchiseSnap.exists()) {
                const data = franchiseSnap.data() as any;
                summaries.push({
                  id: franchiseId,
                  name:
                    (typeof data?.name === "string" && data.name) ||
                    (typeof data?.code === "string" && data.code) ||
                    "Franchise",
                  code: typeof data?.code === "string" ? data.code : null,
                  status: typeof data?.status === "string" ? data.status : null,
                  contactEmail:
                    typeof data?.contactEmail === "string" ? data.contactEmail : null,
                  contactPhone:
                    typeof data?.contactPhone === "string" ? data.contactPhone : null,
                });
              } else {
                summaries.push({
                  id: franchiseId,
                  name: "Franchise",
                  code: null,
                  status: null,
                  contactEmail: null,
                  contactPhone: null,
                });
              }
            } catch (franchiseErr) {
              console.error("Failed to load franchise", franchiseId, franchiseErr);
              summaries.push({
                id: franchiseId,
                name: "Franchise",
                code: null,
                status: null,
                contactEmail: null,
                contactPhone: null,
              });
            }
          })
        );

        summaries.sort((a, b) => a.name.localeCompare(b.name));
        setFranchises(summaries);
        setActiveFranchiseId((current) => {
          if (current && ids.has(current)) {
            return current;
          }
          return summaries[0]?.id ?? null;
        });
      } catch (err) {
        console.error("Failed to load franchise membership", err);
        setFranchises([]);
        setActiveFranchiseId(null);
        setOrders([]);
        setProjects([]);
        setUploads([]);
        setError("Unable to load franchise membership information. Please try again.");
      } finally {
        setInitialising(false);
      }
    },
    []
  );

  const loadFranchiseCollections = useCallback(
    async (franchiseId: string, database: Firestore) => {
      setDataLoading(true);
      setError(null);
      try {
        const orderSnap = await getDocs(
          query(collection(database, "orders"), where("franchiseId", "==", franchiseId), limit(100))
        );
        const loadedOrders = orderSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        loadedOrders.sort((a, b) => {
          const aTime = toDate(a.createdAt)?.getTime() ?? 0;
          const bTime = toDate(b.createdAt)?.getTime() ?? 0;
          return bTime - aTime;
        });
        setOrders(loadedOrders);

        const projectSnap = await getDocs(
          query(collection(database, "projects"), where("franchiseId", "==", franchiseId), limit(100))
        );
        const loadedProjects = projectSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setProjects(loadedProjects);

        const uploadSnap = await getDocs(
          query(collection(database, "franchiseUploads"), where("franchiseId", "==", franchiseId), limit(50))
        );
        const loadedUploads = uploadSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .sort((a, b) => {
            const aTime = toDate(a.createdAt)?.getTime() ?? 0;
            const bTime = toDate(b.createdAt)?.getTime() ?? 0;
            return bTime - aTime;
          });
        setUploads(loadedUploads);
      } catch (err) {
        console.error("Failed to load franchise data", err);
        setError("Unable to load franchise data. Please refresh the page.");
        setOrders([]);
        setProjects([]);
        setUploads([]);
      } finally {
        setDataLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db, storage } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        dbRef.current = db;
        storageRef.current = storage ?? null;

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== "function") {
          throw new Error("Firebase auth listener is unavailable");
        }

        unsubscribe = onAuthStateChanged(auth, async (nextUser: User | null) => {
          if (cancelled) {
            return;
          }
          setUser(nextUser);
          if (!nextUser || !db) {
            setFranchises([]);
            setActiveFranchiseId(null);
            setOrders([]);
            setProjects([]);
            setUploads([]);
            setInitialising(false);
            setDataLoading(false);
            setError("Sign in to access the franchise portal.");
            return;
          }
          await loadFranchiseMembership(nextUser, db);
        });
      } catch (err) {
        console.error("Failed to initialise franchise portal", err);
        if (!cancelled) {
          setError("Unable to initialise the franchise portal. Please refresh the page.");
          setInitialising(false);
          setDataLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [loadFranchiseMembership]);

  useEffect(() => {
    const database = dbRef.current;
    if (!database || !activeFranchiseId) {
      return;
    }
    let cancelled = false;
    (async () => {
      await loadFranchiseCollections(activeFranchiseId, database);
      if (cancelled) {
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFranchiseId, loadFranchiseCollections]);

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!uploadFile || !activeFranchiseId) {
      setUploadError("Select a file to upload.");
      return;
    }
    const database = dbRef.current;
    const storage = storageRef.current;
    if (!database || !storage) {
      setUploadError("File storage is unavailable at the moment.");
      return;
    }

    setUploadError(null);
    setUploadProgress(0);

    try {
      const key = `franchises/${activeFranchiseId}/uploads/${Date.now()}-${encodeURIComponent(
        uploadFile.name
      )}`;
      const uploadRef = ref(storage, key);
      const task = uploadBytesResumable(uploadRef, uploadFile, {
        contentType: uploadFile.type || "application/octet-stream",
      });

      await new Promise<void>((resolve, reject) => {
        task.on(
          "state_changed",
          (snapshot) => {
            if (snapshot.totalBytes > 0) {
              setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
            }
          },
          (err) => {
            reject(err);
          },
          () => resolve()
        );
      });

      const url = await getDownloadURL(task.snapshot.ref);
      const name = uploadName.trim() || uploadFile.name;
      await addDoc(collection(database, "franchiseUploads"), {
        franchiseId: activeFranchiseId,
        name,
        storageKey: key,
        url,
        bytes: uploadFile.size,
        mime: uploadFile.type || null,
        uploadedBy: user?.uid || null,
        uploadedByEmail: user?.email || null,
        uploadedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      resetUploadForm();
      await loadFranchiseCollections(activeFranchiseId, database);
    } catch (err: any) {
      console.error("Upload failed", err);
      setUploadError(err?.message || "Failed to upload file. Please try again.");
    }
  };

  const activeFranchise = useMemo(
    () => franchises.find((item) => item.id === activeFranchiseId) ?? null,
    [activeFranchiseId, franchises]
  );

  const busy = initialising || dataLoading;

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Franchise Portal</h1>
            <p className="text-sm text-gray-600">
              Monitor orders, upload deliverables, and stay on top of upcoming jobs for your territory.
            </p>
          </div>
          {franchises.length > 1 ? (
            <select
              className="select select-bordered max-w-xs"
              value={activeFranchiseId ?? ""}
              onChange={(event) => setActiveFranchiseId(event.target.value || null)}
            >
              {franchises.map((franchise) => (
                <option key={franchise.id} value={franchise.id}>
                  {franchise.name}
                  {franchise.code ? ` (${franchise.code})` : ""}
                </option>
              ))}
            </select>
          ) : activeFranchise ? (
            <div className="text-sm text-right">
              <p className="font-medium">{activeFranchise.name}</p>
              {activeFranchise.code && <p className="text-gray-600">Code: {activeFranchise.code}</p>}
            </div>
          ) : null}
        </div>

        {error && (
          <div className="alert alert-warning">
            <span>{error}</span>
          </div>
        )}

        {busy && <p>Loading franchise data…</p>}

        {!busy && !activeFranchiseId && (
          <div className="card bg-amber-50 border border-amber-200 p-6">
            <h2 className="text-lg font-semibold mb-2">No franchise linked yet</h2>
            <p className="text-sm text-gray-700">
              Your account is not currently associated with a franchise. Please contact HQ if you believe this is a mistake.
            </p>
          </div>
        )}

        {!busy && activeFranchise && (
          <>
            <section className="grid gap-4 lg:grid-cols-4 sm:grid-cols-2">
              <div className="card bg-blue-50 border border-blue-200 p-4">
                <p className="text-sm text-blue-600">Orders this franchise</p>
                <p className="text-2xl font-semibold text-blue-900">{orderMetrics.totalOrders}</p>
              </div>
              <div className="card bg-green-50 border border-green-200 p-4">
                <p className="text-sm text-green-600">Net revenue</p>
                <p className="text-2xl font-semibold text-green-900">
                  {currencyFormatter.format(orderMetrics.totalNet)}
                </p>
              </div>
              <div className="card bg-emerald-50 border border-emerald-200 p-4">
                <p className="text-sm text-emerald-600">Estimated franchise share</p>
                <p className="text-2xl font-semibold text-emerald-900">
                  {currencyFormatter.format(orderMetrics.totalFranchiseShare)}
                </p>
              </div>
              <div className="card bg-purple-50 border border-purple-200 p-4">
                <p className="text-sm text-purple-600">Average order value</p>
                <p className="text-2xl font-semibold text-purple-900">
                  {currencyFormatter.format(orderMetrics.averageNet || 0)}
                </p>
              </div>
            </section>

            <section className="card border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Orders & earnings</h2>
                  <p className="text-sm text-gray-600">Track the latest franchise work and royalty splits.</p>
                </div>
              </div>
              {orders.length === 0 ? (
                <p className="text-sm text-gray-600">No orders routed to this franchise yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-zebra w-full">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Client</th>
                        <th>Status</th>
                        <th className="text-right">Net total</th>
                        <th className="text-right">Franchise share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.slice(0, 10).map((order) => {
                        const share = computeFranchiseShare(order);
                        return (
                          <tr key={order.id}>
                            <td>{formatDate(order.createdAt)}</td>
                            <td>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {(order.customerName as string) || (order.user?.displayName as string) || "Client"}
                                </span>
                                {(order.customerEmail || order.userEmail) && (
                                  <span className="text-xs text-gray-600">
                                    {(order.customerEmail as string) || (order.userEmail as string)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="capitalize">{order.status || "pending"}</td>
                            <td className="text-right">{currencyFormatter.format(share.net)}</td>
                            <td className="text-right">{currencyFormatter.format(share.franchiseShare)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {orders.length > 10 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Showing the 10 most recent orders. View older records in the admin order log.
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="card border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Upcoming schedule</h2>
                  <p className="text-sm text-gray-600">Key production milestones across your assigned projects.</p>
                </div>
              </div>
              {upcomingEvents.length === 0 ? (
                <p className="text-sm text-gray-600">No upcoming project milestones yet.</p>
              ) : (
                <div className="grid gap-3">
                  {upcomingEvents.map((event) => (
                    <div key={event.id} className="border border-slate-200 rounded-lg p-4">
                      <p className="text-sm text-gray-500 uppercase tracking-wide">{event.type}</p>
                      <p className="text-lg font-semibold">{formatDate(event.date)}</p>
                      <p className="text-sm text-gray-600">{event.project.title || "Untitled project"}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Upload deliverables</h2>
                  <p className="text-sm text-gray-600">Share edited files and paperwork with HQ.</p>
                </div>
              </div>
              <form onSubmit={handleUpload} className="grid gap-3 mb-6">
                <input
                  type="file"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  className="file-input"
                  required
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Display name (optional)"
                  value={uploadName}
                  onChange={(event) => setUploadName(event.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={!uploadFile}>
                  Upload file
                </button>
                {uploadProgress > 0 && (
                  <progress className="progress progress-primary w-full" value={uploadProgress} max={100} />
                )}
                {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
              </form>
              {uploads.length === 0 ? (
                <p className="text-sm text-gray-600">No uploads yet. Use the form above to share deliverables.</p>
              ) : (
                <div className="grid gap-3">
                  {uploads.map((upload) => (
                    <div key={upload.id} className="border border-slate-200 rounded-lg p-4 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <a
                            href={upload.url as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-700 hover:underline"
                          >
                            {(upload.name as string) || "Download file"}
                          </a>
                          <p className="text-xs text-gray-500">
                            {formatBytes(Number(upload.bytes))} • {upload.mime || "file"}
                          </p>
                        </div>
                        <span className="text-xs text-gray-500">{formatDate(upload.createdAt || upload.uploadedAt)}</span>
                      </div>
                      {upload.uploadedByEmail && (
                        <p className="text-xs text-gray-500">
                          Uploaded by {upload.uploadedByEmail as string}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card border border-slate-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Client directory</h2>
                  <p className="text-sm text-gray-600">Active customers attached to this franchise.</p>
                </div>
              </div>
              {clients.length === 0 ? (
                <p className="text-sm text-gray-600">No clients yet. Orders routed to this franchise will appear here.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table table-compact w-full">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Company</th>
                        <th className="text-right">Orders</th>
                        <th className="text-right">Net revenue</th>
                        <th>Last order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.slice(0, 15).map((client) => (
                        <tr key={client.key}>
                          <td>
                            <div className="flex flex-col">
                              <span className="font-medium">{client.name}</span>
                              {client.email && <span className="text-xs text-gray-600">{client.email}</span>}
                            </div>
                          </td>
                          <td>{client.company || "—"}</td>
                          <td className="text-right">{client.orderCount}</td>
                          <td className="text-right">{currencyFormatter.format(client.totalNet)}</td>
                          <td>{formatDate(client.lastOrderAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {clients.length > 15 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Showing the top 15 clients by revenue. Export the admin CRM for the full list.
                    </p>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </PortalContainer>
  );
}
