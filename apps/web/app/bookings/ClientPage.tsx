"use client";

import { useEffect, useState } from 'react';
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
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

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
        await Promise.all(
          projectIds.map(async (projectId) => {
            try {
              const projectSnap = await getDoc(doc(db, 'projects', projectId));
              if (!projectSnap.exists()) return;
              const projectData = projectSnap.data() as any;
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
      } else {
        setKitSummaries({});
      }
    })();
  }, []);

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
      <h1 className="text-xl font-semibold">Book a Session</h1>
      {/* Available slots */}
      <div>
        <h2 className="font-semibold mb-2">Available Slots</h2>
        {loadingSlots ? <p>Loading slots…</p> : (
          slots.length === 0 ? <p>No slots available. Please request a custom date.</p> : (
            <div className="grid gap-3">
              {slots.map(slot => (
                <div key={slot.id} className="card p-4 flex justify-between items-center">
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
          )
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
        {myBookings.length === 0 ? <p>No bookings yet.</p> : (
          <div className="grid gap-3">
            {myBookings.map(b => (
              <div key={b.id} className="card p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{b.slot?.date} {b.slot?.start}-{b.slot?.end}</p>
                  <p className="text-sm text-gray-600">Status: {b.status}</p>
                  {typeof b.projectId === 'string' && kitSummaries[b.projectId] ? (
                    <div className="mt-1 space-y-1 text-xs text-gray-500">
                      <p>
                        Equipment: {kitSummaries[b.projectId].label}
                        {kitSummaries[b.projectId].hasDrone ? ' · Drone kit assigned' : ''}
                      </p>
                      {kitSummaries[b.projectId].window ? (
                        <p>Equipment window: {kitSummaries[b.projectId].window}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </PortalContainer>
  );
}