"use client";

import { useEffect, useState } from "react";
import AvailabilityCalendar, {
  AVAILABILITY_STATUS_META,
  type AvailabilityStatus,
  type AvailabilityStatusMeta,
} from "@/components/AvailabilityCalendar";
import { ensureFirebase } from "@/lib/firebase";
import {
  doc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { adminListUsers } from "@/lib/admin";
import { useRoleGate } from "@/hooks/useRoleGate";

interface User {
  id: string;
  displayName?: string;
  email: string;
}

export default function AdminAvailabilityPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["projects", "operations"]);
  const [members, setMembers] = useState<User[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [availability, setAvailability] = useState<Record<string, AvailabilityStatus>>({});
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // load staff status and team list
  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoadingMembers(false);
        return;
      }
      try {
        const result: any = await adminListUsers();
        const users: User[] = result.users || [];
        setMembers(users);
        const def =
          users.find((u) => u.email === "ryan@pineappletapped.com") || users[0];
        if (def) setSelected(def.id);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, [allowed, guardLoading]);

  // load availability for selected member
  useEffect(() => {
    if (!allowed || !selected) return;

    let cancelled = false;

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db || cancelled) {
          return;
        }

        const q = query(collection(db, "availability"), where("uid", "==", selected));
        const snap = await getDocs(q);
        const map: Record<string, AvailabilityStatus> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.date && data.status) map[data.date] = data.status;
        });
        if (!cancelled) {
          setAvailability(map);
        }
      } catch (error) {
        console.error("Failed to load availability", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, selected]);

  // load upcoming bookings for the selected member
  useEffect(() => {
    if (!allowed || !selected) {
      setBookings([]);
      return;
    }

    let cancelled = false;
    setBookingsLoading(true);
    setBookingsError(null);

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db || cancelled) return;

        const snap = await getDocs(
          query(collection(db, "bookings"), where("contractorUid", "==", selected))
        );

        if (cancelled) return;

        const now = Date.now();
        const items: BookingSummary[] = snap.docs
          .map((docSnap) => toBookingSummary(docSnap.id, docSnap.data() as Record<string, unknown>))
          .filter((item) => {
            if (!item.start) return true;
            return item.start.getTime() >= now;
          })
          .sort((a, b) => {
            const aTime = a.start ? a.start.getTime() : Number.POSITIVE_INFINITY;
            const bTime = b.start ? b.start.getTime() : Number.POSITIVE_INFINITY;
            return aTime - bTime;
          })
          .slice(0, 5);

        setBookings(items);
      } catch (error) {
        console.error("Failed to load bookings", error);
        if (!cancelled) {
          setBookingsError("We couldn't load upcoming bookings. Please try again.");
          setBookings([]);
        }
      } finally {
        if (!cancelled) {
          setBookingsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, selected]);

  const resolveDb = async (): Promise<Firestore> => {
    const { db } = await ensureFirebase();
    if (!db) {
      throw new Error("Firestore is unavailable");
    }
    return db;
  };

  const updateDay = async (date: string, status: AvailabilityStatus) => {
    const previous = availability[date];
    setAvailability((current) => ({ ...current, [date]: status }));

    try {
      const db = await resolveDb();
      await setDoc(doc(db, "availability", `${selected}_${date}`), {
        uid: selected,
        date,
        status,
      });
    } catch (error) {
      console.error("Failed to update availability", error);
      setAvailability((current) => {
        if (typeof previous === "undefined") {
          const { [date]: _ignored, ...rest } = current;
          return rest;
        }
        return { ...current, [date]: previous };
      });
    }
  };

  if (guardLoading || loadingMembers) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage availability.</p>;

  return (
    <div className="flex gap-6">
      <div className="w-72 space-y-2">
        <h1 className="text-xl font-semibold mb-4">Team Members</h1>
        {members.map((m) => (
          <button
            key={m.id}
            className={`block w-full text-left rounded-lg border px-3 py-2 text-sm font-medium transition ${
              selected === m.id
                ? "border-blue-500 bg-blue-50 text-blue-900 shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            }`}
            onClick={() => setSelected(m.id)}
          >
            {m.displayName || m.email}
          </button>
        ))}
      </div>
      <div className="flex-1">
        <h1 className="text-xl font-semibold mb-4">Manage Availability</h1>
        {selected ? (
          <div className="space-y-6">
            <AvailabilityCalendar availability={availability} onChange={updateDay} />
            <div>
              <h2 className="text-sm font-semibold text-slate-600">Calendar key</h2>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(Object.entries(AVAILABILITY_STATUS_META) as [
                  AvailabilityStatus,
                  AvailabilityStatusMeta,
                ][]).map(([status, meta]) => (
                  <div key={status} className="flex items-center gap-2 text-sm text-slate-700">
                    <span
                      className={`inline-flex h-3 w-3 shrink-0 rounded-full border border-slate-200 ${meta.background}`}
                      aria-hidden="true"
                    />
                    <span>{meta.label}</span>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">Upcoming bookings</h2>
                {bookingsLoading && <span className="text-sm text-slate-500">Loading…</span>}
              </div>
              {bookingsError ? (
                <p className="mt-2 text-sm text-red-600">{bookingsError}</p>
              ) : bookings.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No upcoming bookings on file.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {bookings.map((booking) => (
                    <li
                      key={booking.id}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    >
                      <div className="font-medium text-slate-900">
                        {booking.title ?? "Booking"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{formatDateRange(booking.start, booking.end)}</span>
                        {booking.location && <span>• {booking.location}</span>}
                        {booking.status && (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                            {booking.status}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <p>Select a team member to view availability.</p>
        )}
      </div>
    </div>
  );
}

interface BookingSummary {
  id: string;
  start: Date | null;
  end: Date | null;
  status: string | null;
  title: string | null;
  location: string | null;
}

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && typeof (value as any).toDate === "function") {
    try {
      const converted = (value as any).toDate();
      return converted instanceof Date ? converted : null;
    } catch (error) {
      console.warn("parseDate failed", error);
      return null;
    }
  }
  return null;
};

const combineDateAndTime = (date: string | null | undefined, time: string | null | undefined) => {
  if (!date) return null;
  if (!time) return parseDate(date);
  const isoCandidate = `${date}T${time}`;
  return parseDate(isoCandidate) ?? parseDate(date);
};

const toBookingSummary = (
  id: string,
  data: Record<string, unknown>
): BookingSummary => {
  const rawSlot = data.slot;
  const slot =
    rawSlot && typeof rawSlot === "object"
      ? (rawSlot as { date?: string | null; start?: string | null; end?: string | null })
      : null;

  const start =
    parseDate(data.start) ||
    combineDateAndTime(slot?.date ?? null, slot?.start ?? null) ||
    parseDate(slot?.date ?? null);
  const end =
    parseDate(data.end) ||
    combineDateAndTime(slot?.date ?? null, slot?.end ?? null) ||
    parseDate(slot?.date ?? null);

  const status = typeof data.status === "string" ? data.status : null;
  const title =
    (typeof data.projectName === "string" && data.projectName.trim().length > 0
      ? data.projectName.trim()
      : null) ||
    (typeof data.serviceName === "string" && data.serviceName.trim().length > 0
      ? data.serviceName.trim()
      : null) ||
    (typeof data.serviceId === "string" && data.serviceId.trim().length > 0
      ? data.serviceId.trim()
      : null) ||
    null;
  const location =
    typeof data.location === "string" && data.location.trim().length > 0
      ? data.location.trim()
      : null;

  return {
    id,
    start,
    end,
    status,
    title,
    location,
  };
};

const formatDateRange = (start: Date | null, end: Date | null) => {
  if (!start && !end) return "Schedule TBC";
  if (start && end) {
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (sameDay) {
      return `${dateFormatter.format(start)} • ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
    }
    return `${dateFormatter.format(start)} ${timeFormatter.format(start)} – ${dateFormatter.format(end)} ${timeFormatter.format(end)}`;
  }
  const single = start || end;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(single!);
};

