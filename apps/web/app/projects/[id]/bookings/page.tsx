"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import PortalContainer from '@/components/PortalContainer';
import { auth, db, functions } from '@/lib/firebase';
import { extractUserRoles, hasRole } from '@/lib/roles';

interface BookingUploadFile {
  id: string;
  name: string;
  url: string;
}

interface ProjectBookingResponseRecord {
  id: string;
  slotId: string | null;
  status: string;
  organisation: string;
  contactName: string;
  contactEmail: string;
  submittedAt: Date | null;
  agreementAcceptedAt: Date | null;
  uploads: BookingUploadFile[];
  answers: Record<string, any>;
}

interface ProjectBookingInviteRecord {
  id: string;
  email: string;
  organisation: string;
  status: string;
  sentAt: Date | null;
  respondedAt: Date | null;
}

interface ProjectBookingSlotRecord {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  notes: string;
}

interface ProjectBookingStatsRecord {
  totalSlots: number;
  totalCapacity: number;
  responses: number;
  invitesOutstanding: number;
  assetsUploaded: number;
}

interface ProjectBookingRecord {
  id: string;
  taskTitle: string;
  introduction: string;
  slots: ProjectBookingSlotRecord[];
  stats: ProjectBookingStatsRecord;
  agreement: {
    heading: string;
    body: string;
    acknowledgementLabel: string;
    requireSignature: boolean;
  };
  responses: ProjectBookingResponseRecord[];
  invites: ProjectBookingInviteRecord[];
  updatedAt: Date | null;
}

interface InviteLinkInfo {
  email: string;
  organisation: string | null;
  url: string;
}

interface InviteFormState {
  entries: string;
  message: string;
  loading: boolean;
  error: string | null;
  success: string | null;
  links: InviteLinkInfo[];
}

const bookingSlotFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const coerceNumber = (value: any, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseTimestamp = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate();
      } catch (err) {
        console.warn('Failed to convert timestamp', err);
      }
    }
    if ('seconds' in value) {
      const seconds = Number((value as any).seconds);
      const nanos = Number((value as any).nanoseconds ?? 0);
      if (Number.isFinite(seconds)) {
        return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
      }
    }
  }
  if (typeof value === 'string') {
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  return null;
};

const parseIso = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatSlotWindow = (slot: ProjectBookingSlotRecord): string => {
  const start = parseIso(slot.startAt);
  const end = parseIso(slot.endAt);
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

const normaliseUploads = (raw: unknown): BookingUploadFile[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, any>;
      const url = typeof record.url === 'string' ? record.url : null;
      if (!url) return null;
      const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : 'Attachment';
      return {
        id:
          typeof record.id === 'string' && record.id.trim().length > 0
            ? record.id.trim()
            : `${name}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        url,
      } satisfies BookingUploadFile;
    })
    .filter((item): item is BookingUploadFile => Boolean(item));
};

const normaliseAnswers = (raw: unknown): Record<string, any> => {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    return raw.reduce<Record<string, any>>((acc, entry, index) => {
      acc[`field_${index + 1}`] = entry;
      return acc;
    }, {});
  }
  if (typeof raw === 'object') {
    return { ...(raw as Record<string, any>) };
  }
  return { value: raw };
};

const parseBookingDoc = (doc: { id: string; data: () => any }): Omit<ProjectBookingRecord, 'responses' | 'invites'> => {
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
          const capacity = coerceNumber(slot.capacity, 1);
          const notes = typeof slot.notes === 'string' ? slot.notes : '';
          return { id, label, startAt, endAt, capacity, notes } satisfies ProjectBookingSlotRecord;
        })
        .filter((slot): slot is ProjectBookingSlotRecord => Boolean(slot))
    : [];

  const statsRaw = raw.stats ?? {};
  const totalCapacityFallback = slots.reduce((sum, slot) => sum + coerceNumber(slot.capacity, 0), 0);
  const stats: ProjectBookingStatsRecord = {
    totalSlots: coerceNumber(statsRaw.totalSlots, slots.length),
    totalCapacity: coerceNumber(statsRaw.totalCapacity, totalCapacityFallback),
    responses: coerceNumber(statsRaw.responses, 0),
    invitesOutstanding: coerceNumber(statsRaw.invitesOutstanding, 0),
    assetsUploaded: coerceNumber(statsRaw.assetsUploaded, 0),
  };

  const agreementRaw = raw.agreement ?? {};
  const agreement = {
    heading:
      typeof agreementRaw.heading === 'string' && agreementRaw.heading.trim().length > 0
        ? agreementRaw.heading.trim()
        : 'Participation agreement',
    body: typeof agreementRaw.body === 'string' ? agreementRaw.body : '',
    acknowledgementLabel:
      typeof agreementRaw.acknowledgementLabel === 'string' && agreementRaw.acknowledgementLabel.trim().length > 0
        ? agreementRaw.acknowledgementLabel.trim()
        : 'I agree to the terms and conditions',
    requireSignature: agreementRaw.requireSignature === false ? false : true,
  };

  return {
    id: doc.id,
    taskTitle:
      typeof raw.taskTitle === 'string' && raw.taskTitle.trim().length > 0 ? raw.taskTitle.trim() : 'Booking form',
    introduction: typeof raw.introduction === 'string' ? raw.introduction : '',
    slots,
    stats,
    agreement,
    updatedAt: parseTimestamp(raw.updatedAt) || parseTimestamp(raw.createdAt),
  };
};

const parseResponseDoc = (doc: { id: string; data: () => any }): ProjectBookingResponseRecord => {
  const raw = (doc.data() as Record<string, any>) ?? {};
  const organisation =
    typeof raw.organisation === 'string'
      ? raw.organisation
      : typeof raw.businessName === 'string'
        ? raw.businessName
        : typeof raw.company === 'string'
          ? raw.company
          : 'Participant';
  const contactName =
    typeof raw.contactName === 'string'
      ? raw.contactName
      : typeof raw.fullName === 'string'
        ? raw.fullName
        : typeof raw.name === 'string'
          ? raw.name
          : '';
  const contactEmail =
    typeof raw.contactEmail === 'string'
      ? raw.contactEmail
      : typeof raw.email === 'string'
        ? raw.email
        : '';
  return {
    id: doc.id,
    slotId: typeof raw.slotId === 'string' ? raw.slotId : null,
    status: typeof raw.status === 'string' ? raw.status : 'pending',
    organisation,
    contactName,
    contactEmail,
    submittedAt: parseTimestamp(raw.submittedAt ?? raw.createdAt ?? raw.updatedAt),
    agreementAcceptedAt: parseTimestamp(raw.agreementAcceptedAt ?? raw.signatureCompletedAt),
    uploads: normaliseUploads(raw.uploads ?? raw.attachments),
    answers: normaliseAnswers(raw.answers ?? raw.responses ?? raw.fields),
  };
};

const parseInviteDoc = (doc: { id: string; data: () => any }): ProjectBookingInviteRecord => {
  const raw = (doc.data() as Record<string, any>) ?? {};
  return {
    id: doc.id,
    email: typeof raw.email === 'string' ? raw.email : '',
    organisation:
      typeof raw.organisation === 'string'
        ? raw.organisation
        : typeof raw.company === 'string'
          ? raw.company
          : '',
    status: typeof raw.status === 'string' ? raw.status : 'pending',
    sentAt: parseTimestamp(raw.sentAt ?? raw.createdAt),
    respondedAt: parseTimestamp(raw.respondedAt ?? raw.updatedAt),
  };
};

export default function ProjectBookingsPage({ params }: { params: { id: string } }) {
  const [bookings, setBookings] = useState<ProjectBookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStaffUser, setIsStaffUser] = useState(false);
  const [inviteForms, setInviteForms] = useState<Record<string, InviteFormState>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          if (active) {
            setIsStaffUser(false);
          }
          return;
        }
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const roles = extractUserRoles(userSnap.data());
        if (active) {
          setIsStaffUser(hasRole(roles, ['admin', 'projects']));
        }
      } catch (err) {
        console.warn('Failed to determine staff access for booking invites', err);
        if (active) {
          setIsStaffUser(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const fetchBookings = useCallback(async (): Promise<ProjectBookingRecord[]> => {
    const bookingsSnap = await getDocs(collection(db, 'projects', params.id, 'projectBookings'));
    const records: ProjectBookingRecord[] = [];
    for (const bookingDoc of bookingsSnap.docs) {
      const base = parseBookingDoc(bookingDoc);
      let responses: ProjectBookingResponseRecord[] = [];
      let invites: ProjectBookingInviteRecord[] = [];
      try {
        const responsesSnap = await getDocs(collection(bookingDoc.ref, 'responses'));
        responses = responsesSnap.docs.map((docSnap) => parseResponseDoc(docSnap));
      } catch (responseErr) {
        console.warn('Failed to load booking responses', bookingDoc.id, responseErr);
      }
      try {
        const invitesSnap = await getDocs(collection(bookingDoc.ref, 'invites'));
        invites = invitesSnap.docs.map((docSnap) => parseInviteDoc(docSnap));
      } catch (inviteErr) {
        console.warn('Failed to load booking invites', bookingDoc.id, inviteErr);
      }
      records.push({ ...base, responses, invites });
    }
    return records;
  }, [params.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchBookings()
      .then((records) => {
        if (active) {
          setBookings(records);
        }
      })
      .catch((err) => {
        console.error('Failed to load project bookings', err);
        if (active) {
          setError('Unable to load booking sessions.');
          setBookings([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [fetchBookings]);

  const baseInviteForm = useMemo<InviteFormState>(
    () => ({ entries: '', message: '', loading: false, error: null, success: null, links: [] }),
    [],
  );

  const updateInviteForm = useCallback(
    (bookingId: string, updates: Partial<InviteFormState>) => {
      setInviteForms((prev) => {
        const current = prev[bookingId] ?? baseInviteForm;
        return {
          ...prev,
          [bookingId]: { ...current, ...updates },
        };
      });
    },
    [baseInviteForm],
  );

  const parseInviteEntries = useCallback((raw: string) => {
    const invites: Array<{ email: string; organisation?: string; contactName?: string }> = [];
    const seen = new Set<string>();
    const pattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
    raw
      .split(/\r?\n|;/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        let email = '';
        let organisation = '';
        let contactName = '';
        const angle = line.match(/<([^>]+)>/);
        if (angle && typeof angle.index === 'number') {
          const angleIndex = angle.index;
          email = angle[1].trim();
          contactName = line.slice(0, angleIndex).replace(/["']/g, '').trim();
          const remainder = line.slice(angleIndex + angle[0].length).replace(/^,/, '').trim();
          organisation = remainder;
        } else if (line.includes(',')) {
          const [first, second] = line.split(',', 2);
          email = first.trim();
          organisation = second.trim();
        } else {
          email = line;
        }
        if (!pattern.test(email)) {
          return;
        }
        const key = email.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        invites.push({
          email: key,
          organisation: organisation || undefined,
          contactName: contactName || undefined,
        });
      });
    return invites;
  }, []);

  const handleInviteEntriesChange = useCallback(
    (bookingId: string, value: string) => {
      updateInviteForm(bookingId, { entries: value });
    },
    [updateInviteForm],
  );

  const handleInviteMessageChange = useCallback(
    (bookingId: string, value: string) => {
      updateInviteForm(bookingId, { message: value });
    },
    [updateInviteForm],
  );

  const sendInvites = useCallback(
    async (bookingId: string) => {
      const current = inviteForms[bookingId] ?? baseInviteForm;
      const parsed = parseInviteEntries(current.entries);
      if (parsed.length === 0) {
        updateInviteForm(bookingId, {
          error: 'Add at least one valid email address before sending.',
          success: null,
        });
        return;
      }
      updateInviteForm(bookingId, { loading: true, error: null, success: null });
      try {
        const callable = httpsCallable(functions, 'projectBookings_sendInvites');
        const result = await callable({
          projectId: params.id,
          bookingId,
          invites: parsed,
          message: current.message,
        });
        const payload = (result?.data as Record<string, unknown>) ?? {};
        const created = typeof payload.created === 'number' ? payload.created : parsed.length;
        const linksRaw = Array.isArray(payload.links) ? payload.links : [];
        const links: InviteLinkInfo[] = linksRaw
          .map((link) => ({
            email: typeof link?.email === 'string' ? link.email : '',
            organisation:
              typeof (link as any)?.organisation === 'string' ? ((link as any).organisation as string) : null,
            url: typeof link?.url === 'string' ? link.url : '',
          }))
          .filter((link) => link.email && link.url);
        updateInviteForm(bookingId, {
          loading: false,
          error: null,
          success:
            created > 0
              ? `Sent ${created} invite${created === 1 ? '' : 's'}.`
              : 'Everyone on your list has already been invited.',
          entries: '',
          links,
        });
        const refreshed = await fetchBookings();
        setBookings(refreshed);
      } catch (err) {
        console.error('Failed to send project booking invites', err);
        updateInviteForm(bookingId, {
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to send invites.',
        });
      }
    },
    [baseInviteForm, fetchBookings, inviteForms, parseInviteEntries, params.id, updateInviteForm],
  );

  const aggregateStats = useMemo(() => {
    const totalSlots = bookings.reduce((sum, booking) => sum + booking.slots.length, 0);
    const totalCapacity = bookings.reduce((sum, booking) => sum + booking.stats.totalCapacity, 0);
    const responses = bookings.reduce((sum, booking) => sum + booking.responses.length, 0);
    const invites = bookings.reduce((sum, booking) => sum + booking.invites.length, 0);
    const assets = bookings.reduce(
      (sum, booking) => sum + booking.responses.reduce((acc, response) => acc + response.uploads.length, 0),
      0
    );
    return { totalSlots, totalCapacity, responses, invites, assets };
  }, [bookings]);

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Project booking sessions</h1>
            <p className="text-sm text-gray-600">Review participant responses, outstanding invites, and uploaded assets.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/projects/${params.id}`} className="btn-sm btn-outline">
              Back to project
            </Link>
          </div>
        </div>

        <section className="grid gap-2 rounded border border-gray-200 p-4 text-sm text-gray-700 sm:grid-cols-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Total sessions</p>
            <p className="text-lg font-semibold text-gray-900">{aggregateStats.totalSlots}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Total capacity</p>
            <p className="text-lg font-semibold text-gray-900">{aggregateStats.totalCapacity}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Responses</p>
            <p className="text-lg font-semibold text-gray-900">{aggregateStats.responses}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Invites sent</p>
            <p className="text-lg font-semibold text-gray-900">{aggregateStats.invites}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Assets uploaded</p>
            <p className="text-lg font-semibold text-gray-900">{aggregateStats.assets}</p>
          </div>
        </section>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {loading ? (
          <p className="text-sm text-gray-600">Loading booking sessions…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-gray-600">No booking sessions have been configured for this project yet.</p>
        ) : (
          <div className="grid gap-6">
            {bookings.map((booking) => {
              const slotMap = new Map(booking.slots.map((slot) => [slot.id, slot] as const));
              const outstandingInvites = booking.invites.filter((invite) => {
                const status = invite.status?.toLowerCase?.() ?? '';
                return !(status === 'accepted' || status === 'confirmed' || status === 'completed');
              }).length;
              const assetsUploaded = booking.responses.reduce(
                (sum, response) => sum + response.uploads.length,
                booking.stats.assetsUploaded
              );
              const inviteForm = inviteForms[booking.id] ?? baseInviteForm;

              return (
                <article key={booking.id} className="rounded border border-gray-200 bg-white p-4 shadow-sm">
                  <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{booking.taskTitle}</h2>
                      {booking.introduction ? (
                        <p className="text-sm text-gray-600">{booking.introduction}</p>
                      ) : null}
                      <p className="text-xs text-gray-500">
                        {booking.slots.length} slots · {booking.stats.totalCapacity} seats · {booking.responses.length} responses ·{' '}
                        {outstandingInvites} invites awaiting reply · {assetsUploaded} uploaded assets
                      </p>
                    </div>
                    <div className="text-xs text-gray-500">
                      <p>Last updated {booking.updatedAt ? booking.updatedAt.toLocaleString() : 'recently'}</p>
                      <p>Agreement: {booking.agreement.requireSignature ? 'Signature required' : 'Tick box acknowledgement'}</p>
                    </div>
                  </header>

                  {booking.slots.length > 0 ? (
                    <div className="mt-4 grid gap-2 text-sm text-gray-700 md:grid-cols-2 lg:grid-cols-3">
                      {booking.slots.map((slot) => (
                        <div key={slot.id} className="rounded border border-dashed border-gray-200 p-3">
                          <p className="font-medium text-gray-900">{slot.label}</p>
                          <p className="text-xs text-gray-600">{formatSlotWindow(slot)}</p>
                          <p className="text-xs text-gray-600">Capacity: {slot.capacity}</p>
                          {slot.notes ? <p className="text-xs text-gray-500">{slot.notes}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <section className="mt-4">
                    <h3 className="text-sm font-semibold text-gray-900">Responses</h3>
                    {booking.responses.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-600">No responses received yet.</p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-3 py-2">Participant</th>
                              <th className="px-3 py-2">Slot</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Submitted</th>
                              <th className="px-3 py-2">Uploads</th>
                              <th className="px-3 py-2">Answers</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {booking.responses.map((response) => {
                              const slotLabel = response.slotId ? slotMap.get(response.slotId)?.label || 'Unassigned' : 'Unassigned';
                              return (
                                <tr key={response.id} className="align-top">
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-gray-900">{response.organisation || 'Participant'}</div>
                                    <div className="text-xs text-gray-600">
                                      {response.contactName}
                                      {response.contactEmail ? ` · ${response.contactEmail}` : ''}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-gray-600">{slotLabel}</td>
                                  <td className="px-3 py-2 text-xs capitalize text-gray-600">{response.status}</td>
                                  <td className="px-3 py-2 text-xs text-gray-600">
                                    {response.submittedAt ? response.submittedAt.toLocaleString() : 'Pending'}
                                    {response.agreementAcceptedAt ? (
                                      <div className="text-[11px] text-green-600">
                                        Agreement accepted {response.agreementAcceptedAt.toLocaleString()}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-gray-600">
                                    {response.uploads.length === 0 ? (
                                      <span className="text-gray-400">No uploads</span>
                                    ) : (
                                      <ul className="grid gap-1">
                                        {response.uploads.map((upload) => (
                                          <li key={upload.id}>
                                            <a
                                              href={upload.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-blue-600 hover:underline"
                                            >
                                              {upload.name}
                                            </a>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-gray-600">
                                    {Object.keys(response.answers).length === 0 ? (
                                      <span className="text-gray-400">No additional answers</span>
                                    ) : (
                                      <ul className="grid gap-1">
                                        {Object.entries(response.answers).map(([key, value]) => (
                                          <li key={key}>
                                            <span className="font-medium text-gray-700">{key}:</span>{' '}
                                            <span className="text-gray-600">
                                              {typeof value === 'string' ? value : JSON.stringify(value)}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section className="mt-4">
                    <h3 className="text-sm font-semibold text-gray-900">Invitations</h3>
                    {isStaffUser ? (
                      <div className="mt-2 space-y-2 rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Invite recipients
                          </span>
                          <textarea
                            value={inviteForm.entries}
                            onChange={(e) => handleInviteEntriesChange(booking.id, e.target.value)}
                            className="input min-h-[100px] w-full"
                            placeholder="name@example.com, Business Name"
                          />
                          <span className="text-xs text-gray-500">
                            Paste emails (one per line). You can add a comma followed by the organisation name or use “Name &lt;email@example.com&gt;”.
                          </span>
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Message</span>
                          <textarea
                            value={inviteForm.message}
                            onChange={(e) => handleInviteMessageChange(booking.id, e.target.value)}
                            className="input min-h-[60px] w-full"
                            placeholder="Add an optional note for recipients"
                          />
                        </label>
                        {inviteForm.error ? (
                          <p className="text-xs text-red-600">{inviteForm.error}</p>
                        ) : null}
                        {inviteForm.success ? (
                          <p className="text-xs text-emerald-600">{inviteForm.success}</p>
                        ) : null}
                        {inviteForm.links.length > 0 ? (
                          <div className="rounded border border-gray-200 bg-white/80 p-2 text-xs text-gray-600">
                            <p className="font-medium text-gray-700">Invite links</p>
                            <ul className="mt-1 grid gap-1">
                              {inviteForm.links.map((link) => (
                                <li key={`${link.email}-${link.url}`} className="flex flex-wrap items-center gap-1">
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    {link.email}
                                  </a>
                                  {link.organisation ? (
                                    <span className="text-gray-500">· {link.organisation}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => sendInvites(booking.id)}
                            className="inline-flex items-center justify-center rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={inviteForm.loading}
                          >
                            {inviteForm.loading ? 'Sending…' : 'Send invites'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {booking.invites.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-600">No invites sent yet.</p>
                    ) : (
                      <ul className="mt-2 grid gap-2 text-sm text-gray-700">
                        {booking.invites.map((invite) => (
                          <li
                            key={invite.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-gray-200 p-2"
                          >
                            <div>
                              <p className="font-medium text-gray-900">{invite.organisation || invite.email}</p>
                              <p className="text-xs text-gray-600">{invite.email}</p>
                            </div>
                            <div className="text-right text-xs text-gray-600">
                              <p className="capitalize">{invite.status || 'pending'}</p>
                              {invite.sentAt ? <p>Sent {invite.sentAt.toLocaleString()}</p> : null}
                              {invite.respondedAt ? <p>Responded {invite.respondedAt.toLocaleString()}</p> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </PortalContainer>
  );
}

