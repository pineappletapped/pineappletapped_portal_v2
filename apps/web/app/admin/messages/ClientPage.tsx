"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  Timestamp,
  Unsubscribe,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, ensureFirebase } from '@/lib/firebase';
import { adminListUsers } from '@/lib/admin';
import { extractUserRoles, UserRoles } from '@/lib/roles';

type MessageStatus = 'new' | 'in_progress' | 'closed';

interface MessageNote {
  id?: string;
  text: string;
  authorUid?: string | null;
  authorName?: string | null;
  createdAt?: Timestamp | null;
}

interface ContactMessage {
  id: string;
  kind?: string;
  fromName?: string | null;
  fromEmail?: string | null;
  company?: string | null;
  body?: string | null;
  status?: MessageStatus;
  assigneeUid?: string | null;
  resolutionNotes?: MessageNote[] | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastStatusAt?: Timestamp | null;
}

interface StaffOption {
  uid: string;
  label: string;
  email?: string | null;
}

const STATUS_OPTIONS: { value: MessageStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_LABELS: Record<MessageStatus, string> = {
  new: 'New',
  in_progress: 'In Progress',
  closed: 'Closed',
};

const STATUS_STYLES: Record<MessageStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-amber-100 text-amber-900',
  closed: 'bg-emerald-100 text-emerald-800',
};

function formatTimestamp(value?: Timestamp | null) {
  if (!value) return '';
  try {
    const date = typeof value.toDate === 'function' ? value.toDate() : null;
    if (!date) return '';
    return date.toLocaleString();
  } catch (err) {
    console.error('Failed to format timestamp', err);
    return '';
  }
}

function resolveNoteId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, boolean>>({});
  const [notePending, setNotePending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let unsubscribe: Unsubscribe | null = null;
    let active = true;

    (async () => {
      try {
        await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable');
        }
        const q = query(
          collection(db, 'messages'),
          where('kind', '==', 'contact'),
          orderBy('createdAt', 'desc')
        );
        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            if (!active) return;
            const hydrated = snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...(docSnap.data() as ContactMessage),
            }));
            setMessages(hydrated);
            setLoading(false);
          },
          (err) => {
            console.error('Failed to load messages', err);
            if (!active) return;
            setError(err.message || 'Failed to load messages');
            setLoading(false);
          }
        );
      } catch (err: any) {
        console.error('Failed to initialise contact message listener', err);
        if (!active) return;
        setError(err.message || 'Failed to load messages');
        setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await ensureFirebase();
        const result: any = await adminListUsers();
        if (!active) return;
        const options: StaffOption[] = (result.users || [])
          .map((user: any) => ({
            id: user.id,
            email: user.email || null,
            label: user.fullName || user.displayName || user.email || 'Unnamed user',
            roles: extractUserRoles(user as { roles?: UserRoles; isStaff?: boolean }),
          }))
          .filter((user: any) => {
            const roles: UserRoles = user.roles || {};
            return (
              roles.admin ||
              roles.sales ||
              roles.operations ||
              roles.projects ||
              roles.marketing ||
              roles.finance
            );
          })
          .map((user: any) => ({
            uid: user.id,
            label: user.label,
            email: user.email,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setStaff(options);
      } catch (err) {
        console.error('Failed to load staff directory', err);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const staffMap = useMemo(() => {
    const entries = staff.map((member) => [member.uid, member] as const);
    return new Map(entries);
  }, [staff]);

  const markPending = (id: string, next: boolean) => {
    setPendingUpdates((prev) => ({ ...prev, [id]: next }));
  };

  const markNotePending = (id: string, next: boolean) => {
    setNotePending((prev) => ({ ...prev, [id]: next }));
  };

  const updateMessage = async (id: string, updates: Record<string, any>) => {
    if (!db) return;
    try {
      markPending(id, true);
      const docRef = doc(db, 'messages', id);
      const payload: Record<string, any> = {
        ...updates,
        updatedAt: serverTimestamp(),
      };
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        payload.lastStatusAt = serverTimestamp();
      }
      await updateDoc(docRef, payload);
    } catch (err: any) {
      console.error('Failed to update message', err);
      alert(err.message || 'Failed to update message');
    } finally {
      markPending(id, false);
    }
  };

  const handleStatusChange = async (message: ContactMessage, nextStatus: MessageStatus) => {
    await updateMessage(message.id, { status: nextStatus });
  };

  const handleAssigneeChange = async (message: ContactMessage, assigneeUid: string) => {
    const nextValue = assigneeUid || null;
    await updateMessage(message.id, { assigneeUid: nextValue });
  };

  const handleNoteChange = (id: string, value: string) => {
    setNoteDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const handleAddNote = async (message: ContactMessage) => {
    if (!db) return;
    const text = (noteDrafts[message.id] || '').trim();
    if (!text) return;

    try {
      markNotePending(message.id, true);
      const currentUser = auth?.currentUser || null;
      const docRef = doc(db, 'messages', message.id);
      await updateDoc(docRef, {
        resolutionNotes: arrayUnion({
          id: resolveNoteId(),
          text,
          authorUid: currentUser?.uid || null,
          authorName: currentUser?.displayName || currentUser?.email || null,
          createdAt: serverTimestamp(),
        }),
        updatedAt: serverTimestamp(),
      });
      setNoteDrafts((prev) => ({ ...prev, [message.id]: '' }));
    } catch (err: any) {
      console.error('Failed to save note', err);
      alert(err.message || 'Failed to save note');
    } finally {
      markNotePending(message.id, false);
    }
  };

  const renderStatusBadge = (status: MessageStatus) => {
    const label = STATUS_LABELS[status];
    const style = STATUS_STYLES[status] || 'bg-gray-200 text-gray-800';
    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
      >
        {label}
      </span>
    );
  };

  const renderNotes = (message: ContactMessage) => {
    const rawNotes = Array.isArray(message.resolutionNotes)
      ? (message.resolutionNotes as MessageNote[])
      : [];
    if (rawNotes.length === 0) {
      return <p className="text-sm text-gray-500">No internal notes yet.</p>;
    }

    const sorted = [...rawNotes].sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? 0;
      return aTime - bTime;
    });

    return (
      <ul className="space-y-3">
        {sorted.map((note) => (
          <li key={note.id || note.text.slice(0, 16)} className="rounded-md bg-gray-50 p-3 text-sm">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-500">
              <span>{note.authorName || 'Unattributed'}</span>
              <span>{formatTimestamp(note.createdAt || null)}</span>
            </div>
            <p className="whitespace-pre-wrap text-gray-700">{note.text}</p>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Contact Messages</h1>
        <p className="mt-1 text-sm text-gray-600">
          Assign enquiries to team members, track progress, and capture internal follow-up notes.
        </p>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p>Loading messages…</p>
      ) : messages.length === 0 ? (
        <p>No messages.</p>
      ) : (
        <div className="grid gap-4">
          {messages.map((message) => {
            const status = message.status || 'new';
            const createdAt = formatTimestamp(message.createdAt || null);
            const assignee = message.assigneeUid
              ? staffMap.get(message.assigneeUid)
              : undefined;
            const pending = pendingUpdates[message.id];
            const noteSaving = notePending[message.id];

            return (
              <div key={message.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {message.fromName || 'Anonymous'}{' '}
                      {message.fromEmail ? (
                        <span className="text-gray-500">&lt;{message.fromEmail}&gt;</span>
                      ) : null}
                    </p>
                    {message.company ? (
                      <p className="text-sm text-gray-500">{message.company}</p>
                    ) : null}
                    {createdAt ? (
                      <p className="text-xs text-gray-400">Received {createdAt}</p>
                    ) : null}
                  </div>
                  {renderStatusBadge(status)}
                </div>

                <div className="mt-4 space-y-3 text-sm text-gray-700">
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {message.body || 'No message provided.'}
                  </p>
                  {message.fromEmail ? (
                    <a
                      className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-700"
                      href={`mailto:${message.fromEmail}`}
                    >
                      Reply via email
                    </a>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    Assigned to
                    <select
                      className="rounded border border-gray-300 bg-white p-2 text-sm"
                      value={message.assigneeUid || ''}
                      onChange={(event) => handleAssigneeChange(message, event.target.value)}
                      disabled={pending}
                    >
                      <option value="">Unassigned</option>
                      {staff.map((member) => (
                        <option key={member.uid} value={member.uid}>
                          {member.label}
                        </option>
                      ))}
                    </select>
                    {assignee?.email ? (
                      <span className="text-xs font-normal text-gray-500">{assignee.email}</span>
                    ) : null}
                  </label>

                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    Status
                    <select
                      className="rounded border border-gray-300 bg-white p-2 text-sm"
                      value={status}
                      onChange={(event) =>
                        handleStatusChange(message, event.target.value as MessageStatus)
                      }
                      disabled={pending}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-5 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Internal notes</h3>
                    <p className="text-xs text-gray-500">
                      Keep track of follow-up steps, replies, or links for the team.
                    </p>
                  </div>
                  {renderNotes(message)}
                  <div className="space-y-2">
                    <textarea
                      className="w-full rounded border border-gray-300 p-2 text-sm"
                      rows={3}
                      placeholder="Add a note or paste a reply link"
                      value={noteDrafts[message.id] || ''}
                      onChange={(event) => handleNoteChange(message.id, event.target.value)}
                      disabled={noteSaving}
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                        onClick={() => handleAddNote(message)}
                        disabled={noteSaving || !noteDrafts[message.id]?.trim()}
                      >
                        {noteSaving ? 'Saving…' : 'Add note'}
                      </button>
                    </div>
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
