"use client";

import { useEffect, useMemo, useState, type SVGProps } from "react";
import clsx from "clsx";
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
import {
  CRM_STATUS_LABELS,
  normaliseCrmStatus,
  type CRMStatus,
} from "@/lib/crm";
import { ROLE_LABELS, extractUserRoles, type RoleKey, type UserRoles } from "@/lib/roles";

interface RawMember {
  id: string;
  email: string;
  displayName?: string | null;
  fullName?: string | null;
  position?: string | null;
  organisation?: string | null;
  crmStatus?: string | null;
  contractor?: boolean | null;
  isStaff?: boolean | null;
  contractorInfo?: { name?: string | null } | null;
  roles?: UserRoles;
}

interface Member extends RawMember {
  crmStatus: CRMStatus;
  roles: UserRoles;
  isTeam: boolean;
}

export default function AdminAvailabilityPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["projects", "operations"]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [availability, setAvailability] = useState<Record<string, AvailabilityStatus>>({});
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selected && member.isTeam) ?? null,
    [members, selected]
  );

  const teamMembers = useMemo(
    () => members.filter((member) => member.isTeam),
    [members]
  );

  const crmContacts = useMemo(
    () => members.filter((member) => !member.isTeam),
    [members]
  );

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
        const rawUsers: RawMember[] = Array.isArray(result?.users)
          ? (result.users as RawMember[])
          : [];
        const enriched: Member[] = rawUsers.map((entry) => {
          const roles = extractUserRoles({ ...(entry ?? {}), uid: entry?.id });
          const crmStatus = normaliseCrmStatus(entry?.crmStatus);
          const isTeam =
            entry?.contractor === true ||
            entry?.isStaff === true ||
            roles.admin === true ||
            roles.operations === true ||
            roles.projects === true ||
            roles.finance === true ||
            roles.sales === true ||
            roles.marketing === true;
          return {
            ...entry,
            roles,
            crmStatus,
            isTeam,
          };
        });
        setMembers(enriched);
        setSelected((current) => {
          if (
            current &&
            enriched.some((member) => member.id === current && member.isTeam)
          ) {
            return current;
          }
          const preferred = enriched.find(
            (member) =>
              member.isTeam &&
              typeof member.email === "string" &&
              member.email.toLowerCase() === "ryan@pineappletapped.com"
          );
          const fallback = enriched.find((member) => member.isTeam);
          return preferred?.id ?? fallback?.id ?? "";
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, [allowed, guardLoading]);

  // load availability for selected member
  useEffect(() => {
    if (!allowed || !selectedMember) {
      setAvailability({});
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db || cancelled) {
          return;
        }

        const q = query(
          collection(db, "availability"),
          where("uid", "==", selectedMember.id)
        );
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
  }, [allowed, selectedMember]);

  // load upcoming bookings for the selected member
  useEffect(() => {
    if (!allowed || !selectedMember) {
      setBookings([]);
      setBookingsLoading(false);
      setBookingsError(null);
      return;
    }

    let cancelled = false;
    setBookingsLoading(true);
    setBookingsError(null);

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db || cancelled) return;

        const requests = [
          getDocs(
            query(collection(db, "bookings"), where("contractorUid", "==", selectedMember.id))
          ),
        ];

        if (selectedMember.email) {
          requests.push(
            getDocs(query(collection(db, "bookings"), where("contractorEmail", "==", selectedMember.email)))
          );
        }

        const snapshots = await Promise.all(requests);
        if (cancelled) return;

        const combined = new Map<string, Record<string, unknown>>();
        snapshots.forEach((snap) => {
          snap.docs.forEach((docSnap) => {
            combined.set(docSnap.id, docSnap.data() as Record<string, unknown>);
          });
        });

        const now = Date.now();
        const items: BookingSummary[] = Array.from(combined.entries())
          .map(([id, data]) => toBookingSummary(id, data))
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
  }, [allowed, selectedMember]);

  const resolveDb = async (): Promise<Firestore> => {
    const { db } = await ensureFirebase();
    if (!db) {
      throw new Error("Firestore is unavailable");
    }
    return db;
  };

  const updateDay = async (date: string, status: AvailabilityStatus) => {
    if (!selectedMember) {
      return;
    }
    const previous = availability[date];
    setAvailability((current) => ({ ...current, [date]: status }));

    try {
      const db = await resolveDb();
      await setDoc(doc(db, "availability", `${selectedMember.id}_${date}`), {
        uid: selectedMember.id,
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
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="space-y-6 lg:w-80 lg:flex-none">
        <section>
          <h1 className="mb-3 text-xl font-semibold text-slate-900">Team members</h1>
          {teamMembers.length === 0 ? (
            <p className="text-sm text-slate-600">
              No active team members were found. Add staff or contractors to manage their availability.
            </p>
          ) : (
            <ul className="space-y-2">
              {teamMembers.map((member) => {
                const label = resolveTeamMemberLabel(member);
                const positionLabel = describeTeamPosition(member);
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(member.id)}
                      aria-pressed={selected === member.id}
                      className={clsx(
                        "flex w-full flex-col rounded-lg border px-3 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
                        selected === member.id
                          ? "border-blue-500 bg-blue-50 text-blue-900 shadow-sm"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <span className="font-medium">{label}</span>
                      {positionLabel && (
                        <span className="text-xs text-slate-500">{positionLabel}</span>
                      )}
                      <span className="text-xs text-slate-500">{member.email}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {crmContacts.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              CRM contacts
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Prospects and clients appear here for reference and are not selectable for calendar availability.
            </p>
            <ul className="mt-3 space-y-2">
              {crmContacts.map((contact) => {
                const primary = resolveContactLabel(contact);
                const organisation = resolveOrganisation(contact);
                const positionLabel = resolveContactPosition(contact);
                const stageLabel = CRM_STATUS_LABELS[contact.crmStatus];
                return (
                  <li
                    key={contact.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{primary}</p>
                      <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {stageLabel}
                      </span>
                    </div>
                    <div className="mt-1 space-y-1 text-xs text-slate-600">
                      {organisation ? <p>{organisation}</p> : <p>{contact.email}</p>}
                      {organisation && contact.email && (
                        <p className="text-slate-500">{contact.email}</p>
                      )}
                      {positionLabel && (
                        <p className="text-slate-500">Role: {positionLabel}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      <div className="flex-1">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Manage availability</h1>
        {selectedMember ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
              <p className="font-medium text-slate-900">{resolveTeamMemberLabel(selectedMember)}</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {describeTeamPosition(selectedMember) && (
                  <span>{describeTeamPosition(selectedMember)}</span>
                )}
                <span>{selectedMember.email}</span>
              </div>
            </div>

            <AvailabilityCalendar availability={availability} onChange={updateDay} />

            <section
              aria-labelledby="calendar-legend-heading"
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h2
                id="calendar-legend-heading"
                className="text-sm font-semibold uppercase tracking-wide text-slate-600"
              >
                Calendar key
              </h2>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(Object.entries(AVAILABILITY_STATUS_META) as [
                  AvailabilityStatus,
                  AvailabilityStatusMeta,
                ][]).map(([status, meta]) => (
                  <div key={status} className="flex items-start gap-3 text-sm text-slate-700">
                    <span
                      className={clsx(
                        "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-200",
                        meta.background,
                        meta.text ?? "text-white"
                      )}
                      aria-hidden="true"
                    >
                      <span className="sr-only">{meta.label}</span>
                    </span>
                    <div>
                      <dt className="font-medium text-slate-900">{meta.label}</dt>
                      {meta.description && <dd className="text-xs text-slate-500">{meta.description}</dd>}
                    </div>
                  </div>
                ))}
              </dl>
            </section>

            <UpcomingBookings
              bookings={bookings}
              error={bookingsError}
              loading={bookingsLoading}
            />
          </div>
        ) : (
          <p className="text-sm text-slate-600">Select a team member to view availability.</p>
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

const ROLE_DISPLAY_PRIORITY: RoleKey[] = [
  "operations",
  "projects",
  "sales",
  "marketing",
  "finance",
  "admin",
];

function resolveTeamMemberLabel(member: Member): string {
  const candidates = [member.displayName, member.fullName, member.contractorInfo?.name];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return member.email;
}

function describeTeamPosition(member: Member): string | null {
  if (typeof member.position === "string") {
    const trimmed = member.position.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  for (const key of ROLE_DISPLAY_PRIORITY) {
    if (member.roles?.[key]) {
      return ROLE_LABELS[key];
    }
  }
  if (member.contractor) {
    return "Contractor";
  }
  if (member.isStaff) {
    return "Staff";
  }
  return null;
}

function resolveContactLabel(member: Member): string {
  const candidates = [member.displayName, member.fullName];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  const organisation = resolveOrganisation(member);
  if (organisation) {
    return organisation;
  }
  return member.email;
}

function resolveOrganisation(member: Member): string | null {
  if (typeof member.organisation === "string") {
    const trimmed = member.organisation.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function resolveContactPosition(member: Member): string | null {
  if (typeof member.position === "string") {
    const trimmed = member.position.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  pending: "bg-amber-100 text-amber-700 ring-amber-200",
  awaiting: "bg-amber-100 text-amber-700 ring-amber-200",
  declined: "bg-rose-100 text-rose-700 ring-rose-200",
  cancelled: "bg-rose-100 text-rose-700 ring-rose-200",
  completed: "bg-slate-100 text-slate-700 ring-slate-200",
};

const StatusPill = ({ status }: { status: string }) => {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  const className = STATUS_COLORS[normalized] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset",
        className
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
};

const UpcomingBookings = ({
  bookings,
  loading,
  error,
}: {
  bookings: BookingSummary[];
  loading: boolean;
  error: string | null;
}) => (
  <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-slate-900">Upcoming bookings</h2>
      {loading && <span className="text-sm text-slate-500">Loading…</span>}
    </div>
    {error ? (
      <p className="mt-2 text-sm text-red-600">{error}</p>
    ) : bookings.length === 0 ? (
      <p className="mt-2 text-sm text-slate-500">No upcoming bookings on file.</p>
    ) : (
      <ul className="mt-3 space-y-3">
        {bookings.map((booking) => (
          <li key={booking.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900">{booking.title ?? "Booking"}</p>
              {booking.status && <StatusPill status={booking.status} />}
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
              <div className="flex items-center gap-1">
                <dt className="sr-only">Schedule</dt>
                <CalendarIcon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <dd>{formatDateRange(booking.start, booking.end)}</dd>
              </div>
              {booking.location && (
                <div className="flex items-center gap-1">
                  <dt className="sr-only">Location</dt>
                  <MapPinIcon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <dd>{booking.location}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
    )}
  </section>
);

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

const CalendarIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M6 2a1 1 0 1 1 2 0v1h4V2a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h1V2Zm9 5H5v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7Z" />
  </svg>
);

const MapPinIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M10 2a6 6 0 0 0-6 6c0 4.116 4.19 8.244 5.431 9.377a1 1 0 0 0 1.138 0C11.81 16.244 16 12.116 16 8a6 6 0 0 0-6-6Zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
  </svg>
);

