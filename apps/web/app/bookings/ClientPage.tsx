"use client";

import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, addDoc, orderBy, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import PortalContainer from '@/components/PortalContainer';
import { KitSummary, summariseKitItems } from '@/lib/kit-summary';

type BookingRecord = {
  id: string;
  projectId: string | null;
  slot: {
    date: string | null;
    start: string | null;
    end: string | null;
  } | null;
  status: string | null;
};

interface ProjectBookingSlotRecord {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  notes: string;
}

interface ProjectBookingRecord {
  id: string;
  projectId: string;
  taskTitle: string;
  slots: ProjectBookingSlotRecord[];
}

const bookingSlotFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const parseIsoDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatProjectSlotWindow = (slot: ProjectBookingSlotRecord): string => {
  const start = parseIsoDate(slot.startAt);
  const end = parseIsoDate(slot.endAt);
  if (start && end) {
    return `${bookingSlotFormatter.format(start)} – ${bookingSlotFormatter.format(end)}`;
  }
  if (start) {
    return `${bookingSlotFormatter.format(start)} onwards`;
  }
  if (end) {
    return `Ends ${bookingSlotFormatter.format(end)}`;
  }
  return slot.label;
};

const parseProjectBookingDocument = (
  doc: { id: string; data: () => any; ref: any },
  projectId: string
): ProjectBookingRecord => {
  const raw = (doc.data() as Record<string, any>) ?? {};
  const slots: ProjectBookingSlotRecord[] = Array.isArray(raw.slots)
    ? raw.slots
        .map((slot: any, index: number) => {
          if (!slot || typeof slot !== 'object') return null;
          const id =
            typeof slot.id === 'string' && slot.id.trim().length > 0
              ? slot.id.trim()
              : `${doc.id}-slot-${index + 1}`;
          const label = typeof slot.label === 'string' && slot.label.trim().length > 0 ? slot.label.trim() : `Slot ${
            index + 1
          }`;
          const startAt = typeof slot.startAt === 'string' ? slot.startAt : null;
          const endAt = typeof slot.endAt === 'string' ? slot.endAt : null;
          const capacity = Number.isFinite(Number(slot.capacity)) ? Number(slot.capacity) : 1;
          const notes = typeof slot.notes === 'string' ? slot.notes : '';
          return { id, label, startAt, endAt, capacity, notes } satisfies ProjectBookingSlotRecord;
        })
        .filter((slot): slot is ProjectBookingSlotRecord => Boolean(slot))
    : [];

  return {
    id: doc.id,
    projectId,
    taskTitle:
      typeof raw.taskTitle === 'string' && raw.taskTitle.trim().length > 0 ? raw.taskTitle.trim() : 'Booking form',
    slots,
  };
};

/**
 * Bookings page.
 *
 * Displays available booking slots sourced from the `availability` collection and
 * allows clients to reserve a slot. If no suitable slot is available the
 * client can submit a custom request which triggers the `bookings_request`
 * callable. Bookings created by the user are also listed with their status.
 */
export default function BookingsPage() {
  const [slots, setSlots] = useState<any[]>([]);
  const [customDate, setCustomDate] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [myBookings, setMyBookings] = useState<BookingRecord[]>([]);
  const [kitSummaries, setKitSummaries] = useState<Record<string, KitSummary>>({});
  const [projectFilter, setProjectFilter] = useState<'all' | string>('all');
  const [availableProjectIds, setAvailableProjectIds] = useState<string[]>([]);
  const [projectDirectory, setProjectDirectory] = useState<Record<string, string>>({});
  const [projectBookingSessions, setProjectBookingSessions] = useState<Record<string, ProjectBookingRecord[]>>({});
  const [loadingProjectSessions, setLoadingProjectSessions] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const projectOptions = useMemo(() => {
    return availableProjectIds.map((id) => ({
      id,
      label: projectDirectory[id] || `Project ${id.slice(0, 6)}`,
    }));
  }, [availableProjectIds, projectDirectory]);

  const displayedBookings = useMemo(() => {
    if (projectFilter === 'all') return myBookings;
    return myBookings.filter((booking) => booking.projectId === projectFilter);
  }, [myBookings, projectFilter]);

  const selectedProjectSlots = useMemo(() => {
    if (projectFilter === 'all') return [] as { bookingId: string; taskTitle: string; slot: ProjectBookingSlotRecord }[];
    const sessions = projectBookingSessions[projectFilter] ?? [];
    return sessions.flatMap((booking) =>
      booking.slots.map((slot) => ({ bookingId: booking.id, taskTitle: booking.taskTitle, slot }))
    );
  }, [projectFilter, projectBookingSessions]);

  useEffect(() => {
    (async () => {
      try {
        // fetch available slots
        const now = new Date();
        const q = query(collection(db, 'availability'), where('isBookable', '==', true), orderBy('date'));
        const snap = await getDocs(q);
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setSlots(all);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingSlots(false);
      }
      // fetch my bookings
      const user = auth.currentUser;
      if (!user) return;
      const bq = query(collection(db, 'bookings'), where('uid', '==', user.uid));
      const bsnap = await getDocs(bq);
      const bookingsList: BookingRecord[] = bsnap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const slot =
          data && typeof data.slot === 'object' && data.slot !== null
            ? (data.slot as Record<string, unknown>)
            : null;
        return {
          id: d.id,
          projectId: typeof data.projectId === 'string' ? data.projectId : null,
          slot: slot
            ? {
                date: typeof slot.date === 'string' ? slot.date : null,
                start: typeof slot.start === 'string' ? slot.start : null,
                end: typeof slot.end === 'string' ? slot.end : null,
              }
            : null,
          status: typeof data.status === 'string' ? data.status : null,
        };
      });
      setMyBookings(bookingsList);

      const projectIds = Array.from(
        new Set(
          bookingsList
            .map((booking) =>
              typeof booking.projectId === 'string' && booking.projectId.trim().length > 0
                ? booking.projectId.trim()
                : null
            )
            .filter((value): value is string => Boolean(value))
        )
      );
      if (projectIds.length > 0) {
        const summaryMap: Record<string, KitSummary> = {};
        const directoryMap: Record<string, string> = {};
        await Promise.all(
          projectIds.map(async (projectId) => {
            try {
              const projectSnap = await getDoc(doc(db, 'projects', projectId));
              if (!projectSnap.exists()) return;
              const projectData = projectSnap.data() as any;
              if (typeof projectData?.title === 'string' && projectData.title.trim().length > 0) {
                directoryMap[projectId] = projectData.title.trim();
              } else if (typeof projectData?.name === 'string' && projectData.name.trim().length > 0) {
                directoryMap[projectId] = projectData.name.trim();
              }
              const orderId =
                typeof projectData?.orderId === 'string' && projectData.orderId.trim().length > 0
                  ? projectData.orderId.trim()
                  : null;
              if (!orderId) return;
              const orderSnap = await getDoc(doc(db, 'orders', orderId));
              if (!orderSnap.exists()) return;
              const orderData = orderSnap.data() as any;
              const summary = summariseKitItems(orderData?.kitItems ?? []);
              if (summary) {
                summaryMap[projectId] = summary;
              }
            } catch (err) {
                console.warn('Failed to resolve booking kit summary', { projectId }, err);
            }
          })
        );
        setKitSummaries(summaryMap);
        setProjectDirectory(directoryMap);
        setAvailableProjectIds(projectIds);
      } else {
        setKitSummaries({});
        setProjectDirectory({});
        setAvailableProjectIds([]);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (availableProjectIds.length === 0) {
        if (!cancelled) {
          setProjectBookingSessions({});
        }
        return;
      }

      try {
        setLoadingProjectSessions(true);
        const results: Record<string, ProjectBookingRecord[]> = {};
        await Promise.all(
          availableProjectIds.map(async (projectId) => {
            try {
              const snap = await getDocs(collection(db, 'projects', projectId, 'projectBookings'));
              results[projectId] = snap.docs.map((docSnap) => parseProjectBookingDocument(docSnap, projectId));
            } catch (err) {
              console.warn('Failed to load project booking sessions', { projectId }, err);
              results[projectId] = [];
            }
          })
        );

        if (!cancelled) {
          setProjectBookingSessions(results);
        }
      } catch (err) {
        console.error('Failed to load project booking sessions', err);
        if (!cancelled) {
          setProjectBookingSessions({});
        }
      } finally {
        if (!cancelled) {
          setLoadingProjectSessions(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [availableProjectIds]);

  const bookSlot = async (slot: any) => {
    if (!slot) return;
    const callable = httpsCallable(functions, 'bookings_request');
    setSubmitting(true);
    try {
      const resp = await callable({ orgId: slot.orgId, slot: {
        date: slot.date,
        start: slot.start,
        end: slot.end
      }, location: slot.location || null, notes: null });
      alert('Booking requested');
      router.refresh();
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error requesting booking');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    const date = customDate;
    const start = customStart;
    const end = customEnd;
    if (!date || !start || !end) {
      alert('Please provide date and times');
      return;
    }
    const callable = httpsCallable(functions, 'bookings_request');
    setSubmitting(true);
    try {
      await callable({ orgId: null, slot: { date, start, end }, location: null, notes: customNotes });
      alert('Booking request submitted');
      setCustomDate(''); setCustomStart(''); setCustomEnd(''); setCustomNotes('');
      router.refresh();
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error submitting request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalContainer>
      <div className="grid gap-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold">Book a Session</h1>
          {projectOptions.length > 0 ? (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <span>Project</span>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter((e.target.value || 'all') as typeof projectFilter)}
                className="input max-w-xs text-sm"
              >
                <option value="all">All projects</option>
                {projectOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {/* Available slots */}
        <div>
          <h2 className="font-semibold mb-2">
            {projectFilter === 'all'
              ? 'Available Slots'
              : `Sessions for ${projectDirectory[projectFilter] || 'selected project'}`}
          </h2>
          {projectFilter !== 'all' ? (
            loadingProjectSessions ? (
              <p>Loading project sessions…</p>
            ) : selectedProjectSlots.length === 0 ? (
              <p>No sessions are currently available for this project. Please contact your coordinator for support.</p>
            ) : (
              <div className="grid gap-3">
                {selectedProjectSlots.map(({ bookingId, taskTitle, slot }) => (
                  <div key={`${bookingId}-${slot.id}`} className="card space-y-1 p-4">
                    <p className="font-medium">{taskTitle}</p>
                    <p className="text-sm text-gray-600">{formatProjectSlotWindow(slot)}</p>
                    <p className="text-xs text-gray-500">Capacity: {slot.capacity}</p>
                    {slot.notes ? <p className="text-xs text-gray-500">Notes: {slot.notes}</p> : null}
                  </div>
                ))}
              </div>
            )
          ) : loadingSlots ? (
            <p>Loading slots…</p>
          ) : slots.length === 0 ? (
            <p>No slots available. Please request a custom date.</p>
          ) : (
            <div className="grid gap-3">
              {slots.map((slot) => (
                <div key={slot.id} className="card flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{slot.date} {slot.start}-{slot.end}</p>
                    {slot.location && <p className="text-sm text-gray-600">{slot.location}</p>}
                  </div>
                  <button
                    className="btn-sm"
                    disabled={submitting}
                    onClick={() => bookSlot(slot)}
                  >
                    {submitting ? 'Submitting…' : 'Book'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      {/* Custom request */}
      <div className="card p-4">
        <h2 className="font-semibold mb-2">Request a Custom Date</h2>
        <form onSubmit={submitCustom} className="grid gap-3">
          <input type="date" className="input" value={customDate} onChange={e => setCustomDate(e.target.value)} required />
          <div className="flex gap-2">
            <input type="time" className="input flex-1" value={customStart} onChange={e => setCustomStart(e.target.value)} required />
            <input type="time" className="input flex-1" value={customEnd} onChange={e => setCustomEnd(e.target.value)} required />
          </div>
          <input type="text" className="input" placeholder="Notes (optional)" value={customNotes} onChange={e => setCustomNotes(e.target.value)} />
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>
      {/* User bookings */}
      <div>
        <h2 className="font-semibold mb-2">My Bookings</h2>
        {displayedBookings.length === 0 ? (
          <p>
            {projectFilter === 'all'
              ? 'No bookings yet.'
              : 'No bookings recorded for this project yet.'}
          </p>
        ) : (
          <div className="grid gap-3">
            {displayedBookings.map((booking) => {
              const projectName = booking.projectId ? projectDirectory[booking.projectId] || booking.projectId : null;
              return (
                <div key={booking.id} className="card flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{booking.slot?.date} {booking.slot?.start}-{booking.slot?.end}</p>
                    <p className="text-sm text-gray-600">Status: {booking.status}</p>
                    {projectName ? (
                      <p className="text-xs text-gray-500">Project: {projectName}</p>
                    ) : null}
                    {booking.projectId && kitSummaries[booking.projectId] ? (
                      <div className="mt-1 space-y-1 text-xs text-gray-500">
                        <p>
                          Equipment: {kitSummaries[booking.projectId].label}
                          {kitSummaries[booking.projectId].hasDrone ? ' · Drone kit assigned' : ''}
                        </p>
                        {kitSummaries[booking.projectId].window ? (
                          <p>Equipment window: {kitSummaries[booking.projectId].window}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </PortalContainer>
  );
}