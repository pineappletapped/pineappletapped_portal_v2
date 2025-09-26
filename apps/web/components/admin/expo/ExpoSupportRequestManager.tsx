"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { ensureFirebase } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";

interface ExpoSupportRequest {
  id: string;
  franchiseId?: string;
  franchiseName?: string | null;
  eventName?: string | null;
  eventDate?: any;
  location?: string | null;
  standCost?: number | null;
  standCurrency?: string | null;
  expectedFootfall?: number | null;
  marketingFocus?: string | null;
  supportNotes?: string | null;
  requestedByEmail?: string | null;
  requestedByUid?: string | null;
  status?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
];

type HeadingLevel = "h1" | "h2" | "none";

function resolveHeadingTag(level: HeadingLevel) {
  switch (level) {
    case "h2":
      return "h2";
    case "none":
      return null;
    default:
      return "h1";
  }
}

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("Failed to convert timestamp", error);
      return null;
    }
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const formatDate = (value: any): string => {
  const date = toDate(value);
  if (!date) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
  }).format(date);
};

const formatCurrencyValue = (
  value: number | null | undefined,
  currency: string | null | undefined,
  fallbackCurrency: string
): string => {
  if (value === null || value === undefined) {
    return "—";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }
  const code =
    typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : fallbackCurrency;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(numeric);
  } catch (error) {
    console.warn("Failed to format currency", code, error);
    return `${code} ${numeric.toFixed(2)}`;
  }
};

const formatStatus = (value: string | null | undefined): string => {
  if (!value || typeof value !== "string") {
    return "New";
  }
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export interface ExpoSupportRequestManagerProps {
  heading?: string;
  description?: ReactNode;
  headingLevel?: HeadingLevel;
}

export default function ExpoSupportRequestManager({
  heading = "Franchise Expo Support",
  description = (
    <p className="text-sm text-gray-600">
      Track franchisee event requests so the central team can triage support, assign budgets and keep everyone in
      the loop.
    </p>
  ),
  headingLevel = "h1",
}: ExpoSupportRequestManagerProps) {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations", "sales"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<ExpoSupportRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const dbRef = useRef<Firestore | null>(null);

  const loadRequests = useCallback(async (database?: Firestore | null) => {
    const firestore = database ?? dbRef.current;
    if (!firestore) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(firestore, "franchiseExpoRequests"));
      const items: ExpoSupportRequest[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data() as Partial<ExpoSupportRequest>;
          return {
            id: docSnap.id,
            ...data,
          } as ExpoSupportRequest;
        })
        .sort((a, b) => {
          const aTime = toDate(a.createdAt)?.getTime() ?? 0;
          const bTime = toDate(b.createdAt)?.getTime() ?? 0;
          return bTime - aTime;
        });
      setRequests(items);
    } catch (err) {
      console.error("Failed to load expo requests", err);
      setError("Unable to load expo support requests. Please try again.");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        if (!db) {
          throw new Error("Firestore is unavailable");
        }
        dbRef.current = db;
        await loadRequests(db);
      } catch (err) {
        console.error("Initial expo request load failed", err);
        if (!cancelled) {
          setError("Unable to initialise expo support requests. Please refresh the page.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRequests]);

  const changeStatus = useCallback(
    async (id: string, nextStatus: string) => {
      const firestore = dbRef.current;
      if (!firestore) {
        setError("Firestore is not ready. Please refresh the page.");
        return;
      }
      setUpdatingId(id);
      try {
        await updateDoc(doc(firestore, "franchiseExpoRequests", id), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
        setRequests((prev) =>
          prev.map((request) =>
            request.id === id ? { ...request, status: nextStatus, updatedAt: new Date() } : request
          )
        );
      } catch (err) {
        console.error("Failed to update request status", err);
        setError("Unable to update the request. Please try again.");
      } finally {
        setUpdatingId(null);
      }
    },
    []
  );

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") {
      return requests;
    }
    return requests.filter((request) => (request.status ?? "new") === statusFilter);
  }, [requests, statusFilter]);

  if (guardLoading) {
    return <p>Checking access…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage franchise exhibition requests.</p>;
  }

  const HeadingTag = resolveHeadingTag(headingLevel);

  return (
    <div className="grid gap-6">
      {HeadingTag ? <HeadingTag className="text-xl font-semibold">{heading}</HeadingTag> : null}
      {description}

      <section className="rounded border p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Support pipeline</h2>
            <p className="text-sm text-gray-600">
              Review outstanding requests from franchisees and align resources ahead of each exhibition.
            </p>
          </div>
          <label className="form-control w-full md:w-64">
            <span className="label-text">Filter by status</span>
            <select className="select select-bordered" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All requests</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="mt-4 text-sm text-gray-500">Loading support requests…</p>
        ) : filteredRequests.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No requests match this filter.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>Franchise</th>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Stand cost</th>
                  <th>Footfall</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => (
                  <tr key={request.id}>
                    <td className="font-medium">{request.franchiseName || request.franchiseId || "Franchise"}</td>
                    <td>
                      <div className="font-medium">{request.eventName || "Untitled event"}</div>
                      <div className="text-xs text-gray-500">{request.supportNotes || "No notes"}</div>
                    </td>
                    <td>{formatDate(request.eventDate)}</td>
                    <td>{request.location || "—"}</td>
                    <td>{formatCurrencyValue(request.standCost, request.standCurrency, "GBP")}</td>
                    <td>{request.expectedFootfall ? `${request.expectedFootfall.toLocaleString()} people` : "—"}</td>
                    <td>
                      <span className="badge badge-outline">
                        {formatStatus(request.status)}
                      </span>
                    </td>
                    <td>
                      <div className="join join-vertical sm:join-horizontal">
                        {STATUS_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`btn btn-xs join-item ${
                              (request.status ?? "new") === option.value ? "btn-primary" : "btn-ghost"
                            }`}
                            onClick={() => changeStatus(request.id, option.value)}
                            disabled={updatingId === request.id}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
