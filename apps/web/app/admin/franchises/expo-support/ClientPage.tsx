"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  serverTimestamp,
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
    typeof currency === "string" && currency.trim()
      ? currency.trim().toUpperCase()
      : fallbackCurrency;
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

export default function AdminFranchiseExpoSupportPage() {
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
            request.id === id
              ? { ...request, status: nextStatus, updatedAt: new Date() }
              : request
          )
        );
      } catch (err) {
        console.error("Failed to update expo request status", err);
        setError("Could not update the request status. Please try again.");
      } finally {
        setUpdatingId((current) => (current === id ? null : current));
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
    return <p>Checking permissions…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage expo support requests.</p>;
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Expo support requests</h1>
          <p className="text-sm text-gray-600">
            Track franchise expo collaboration requests and confirm when HQ is attending.
          </p>
        </div>
        <div className="flex gap-3">
          <select
            className="select select-bordered"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => loadRequests()} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <p>Loading expo requests…</p>
      ) : filteredRequests.length === 0 ? (
        <p className="text-sm text-gray-600">No expo support requests found for the selected filter.</p>
      ) : (
        <div className="grid gap-4">
          {filteredRequests.map((request) => {
            const footfallText =
              typeof request.expectedFootfall === "number" && Number.isFinite(request.expectedFootfall)
                ? request.expectedFootfall.toLocaleString("en-GB")
                : "—";
            const standCostLabel = formatCurrencyValue(
              request.standCost ?? null,
              request.standCurrency ?? null,
              "GBP"
            );
            return (
              <div key={request.id} className="border border-slate-200 rounded-lg p-4 grid gap-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{request.eventName || "Expo"}</h2>
                    <p className="text-sm text-gray-600">
                      {request.franchiseName || request.franchiseId || "Franchise"} • {formatDate(request.eventDate)}
                    </p>
                    {request.location && <p className="text-sm text-gray-600">{request.location}</p>}
                  </div>
                  <div className="grid gap-2 text-sm text-right">
                    <div>
                      <span className="font-medium">Status:</span> {formatStatus(request.status)}
                    </div>
                    <div>
                      <span className="font-medium">Stand cost:</span> {standCostLabel}
                    </div>
                    <div>
                      <span className="font-medium">Expected footfall:</span> {footfallText}
                    </div>
                    <div>
                      <span className="font-medium">Submitted:</span> {formatDate(request.createdAt)}
                    </div>
                  </div>
                </div>
                {(request.marketingFocus || request.supportNotes) && (
                  <div className="grid gap-3 text-sm">
                    {request.marketingFocus && (
                      <div>
                        <p className="font-medium text-slate-700">Event goals</p>
                        <p className="text-gray-700 whitespace-pre-wrap">{request.marketingFocus}</p>
                      </div>
                    )}
                    {request.supportNotes && (
                      <div>
                        <p className="font-medium text-slate-700">Additional support notes</p>
                        <p className="text-gray-700 whitespace-pre-wrap">{request.supportNotes}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-gray-600">
                    {request.requestedByEmail && <p>Requested by {request.requestedByEmail}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600" htmlFor={`expo-status-${request.id}`}>
                      Update status
                    </label>
                    <select
                      id={`expo-status-${request.id}`}
                      className="select select-bordered"
                      value={request.status ?? "new"}
                      onChange={(event) => changeStatus(request.id, event.target.value)}
                      disabled={updatingId === request.id}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
