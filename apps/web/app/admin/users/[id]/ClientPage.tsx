"use client";

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { useRoleGate } from '@/hooks/useRoleGate';
import { adminListUsers, adminUpdateUser } from '@/lib/admin';
import { ensureFirebase, functions } from '@/lib/firebase';
import {
  CRM_STAGE_OPTIONS,
  CRM_STATUS_LABELS,
  type CRMStatus,
  normaliseCrmStatus,
} from '@/lib/crm';

interface CRMUserRecord {
  id: string;
  email?: string | null;
  fullName?: string | null;
  phone?: string | null;
  organisation?: string | null;
  crmStatus?: string | null;
  discount?: number | null;
  aiBio?: string | null;
  aiBioStructured?: Record<string, unknown> | null;
  aiBioWarnings?: string[] | null;
  aiBioMetadata?: Record<string, unknown> | null;
  aiBioGeneratedAt?: any;
  linkedinBio?: string | null;
  [key: string]: any;
}

interface ContactDraft {
  fullName: string;
  email: string;
  phone: string;
  organisation: string;
  linkedinBio: string;
}

interface OrderRecord {
  id: string;
  price?: number;
  status?: string;
  createdAt?: any;
  items?: Array<{ name?: string }>;
}

interface ProjectRecord {
  id: string;
  title?: string | null;
  status?: string | null;
  kickoffDate?: any;
  dueDate?: any;
  franchiseAssignment?: { territoryLabel?: string | null } | null;
}

interface QuoteRecord {
  id: string;
  status?: string | null;
  projectName?: string | null;
  contactName?: string | null;
  clientName?: string | null;
  companyName?: string | null;
  service?: string | null;
  projectType?: string | null;
  requestType?: string | null;
  eventType?: string | null;
  title?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  createdAt?: any;
}

interface ProposalRecord {
  id: string;
  status?: string | null;
  title?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  clientCompany?: string | null;
  clientEmail?: string | null;
  createdAt?: any;
}

interface EventRecord {
  id: string;
  path?: string | null;
  createdAt?: any;
}

function coerceDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate();
    } catch (error) {
      console.warn('Failed to convert Firestore timestamp', error);
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: any): string {
  const date = coerceDate(value);
  if (!date) return '—';
  return date.toLocaleDateString();
}

function formatDateTime(value: any): string {
  const date = coerceDate(value);
  if (!date) return '—';
  return date.toLocaleString();
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

function shortId(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 8);
}

function resolveQuoteLabel(quote: QuoteRecord): string {
  const label =
    quote?.projectName ||
    quote?.service ||
    quote?.projectType ||
    quote?.eventType ||
    quote?.requestType ||
    quote?.title ||
    quote?.companyName ||
    quote?.contactName ||
    quote?.clientName ||
    '';
  if (label) return label;
  return `Quote ${shortId(quote?.id)}`.trim();
}

function resolveQuoteClient(quote: QuoteRecord, customer?: CRMUserRecord | null): string {
  return (
    quote?.contactName ||
    quote?.clientName ||
    quote?.companyName ||
    customer?.fullName ||
    customer?.email ||
    quote?.userEmail ||
    quote?.userId ||
    '—'
  );
}

function resolveProposalLabel(proposal: ProposalRecord): string {
  const label =
    proposal?.title ||
    proposal?.projectName ||
    proposal?.clientCompany ||
    proposal?.clientName ||
    '';
  if (label) return label;
  return `Proposal ${shortId(proposal?.id)}`.trim();
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id;
  const router = useRouter();
  const { allowed, loading: guardLoading } = useRoleGate(['sales']);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<CRMUserRecord | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [bioDraft, setBioDraft] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [bioGenerating, setBioGenerating] = useState(false);
  const [bioNotice, setBioNotice] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);
  const [stageSaving, setStageSaving] = useState(false);
  const [discountDraft, setDiscountDraft] = useState<number>(0);
  const [discountSaving, setDiscountSaving] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({
    fullName: '',
    email: '',
    phone: '',
    organisation: '',
    linkedinBio: '',
  });

  useEffect(() => {
    let active = true;

    (async () => {
      if (guardLoading || !userId) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable.');
        }

        const userSnap = await getDoc(doc(db, 'users', userId));
        if (!userSnap.exists()) {
          if (active) {
            setUser(null);
            setOrders([]);
            setProjects([]);
            setQuotes([]);
            setProposals([]);
            setEvents([]);
          }
          return;
        }

        const payload = { id: userSnap.id, ...userSnap.data() } as CRMUserRecord;
        if (!active) return;
        setUser(payload);
        setBioDraft(typeof payload.aiBio === 'string' ? payload.aiBio : '');
        setDiscountDraft(
          typeof payload.discount === 'number' && !Number.isNaN(payload.discount)
            ? payload.discount
            : 0
        );
        setContactDraft({
          fullName: typeof payload.fullName === 'string' ? payload.fullName : '',
          email: typeof payload.email === 'string' ? payload.email : '',
          phone: typeof payload.phone === 'string' ? payload.phone : '',
          organisation:
            typeof payload.organisation === 'string' ? payload.organisation : '',
          linkedinBio:
            typeof payload.linkedinBio === 'string' ? payload.linkedinBio : '',
        });

        const email = typeof payload.email === 'string' ? payload.email : null;

        const [orderSnap, eventSnap, projectSnap, quoteSnap, proposalSnap] = await Promise.all([
          getDocs(query(collection(db, 'orders'), where('userId', '==', userId))),
          getDocs(query(collection(db, 'analyticsEvents'), where('uid', '==', userId))),
          getDocs(query(collection(db, 'projects'), where('userId', '==', userId))),
          getDocs(query(collection(db, 'quoteRequests'), where('userId', '==', userId))),
          email
            ? getDocs(query(collection(db, 'proposals'), where('clientEmail', '==', email)))
            : Promise.resolve(null),
        ]);

        if (!active) return;

        const orderList: OrderRecord[] = orderSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as OrderRecord[];
        orderList.sort((a, b) => {
          const aDate = coerceDate(a.createdAt)?.getTime() || 0;
          const bDate = coerceDate(b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

        const eventList: EventRecord[] = eventSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as EventRecord[];
        eventList.sort((a, b) => {
          const aDate = coerceDate(a.createdAt)?.getTime() || 0;
          const bDate = coerceDate(b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

        const projectList: ProjectRecord[] = projectSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as ProjectRecord[];
        projectList.sort((a, b) => {
          const aDate = coerceDate(a.dueDate)?.getTime() || 0;
          const bDate = coerceDate(b.dueDate)?.getTime() || 0;
          return bDate - aDate;
        });

        const quoteList: QuoteRecord[] = quoteSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as QuoteRecord[];
        quoteList.sort((a, b) => {
          const aDate = coerceDate(a.createdAt)?.getTime() || 0;
          const bDate = coerceDate(b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

        const proposalList: ProposalRecord[] =
          proposalSnap && 'docs' in proposalSnap
            ? (proposalSnap.docs.map((docSnap: any) => ({
                id: docSnap.id,
                ...docSnap.data(),
              })) as ProposalRecord[])
            : [];
        proposalList.sort((a, b) => {
          const aDate = coerceDate(a.createdAt)?.getTime() || 0;
          const bDate = coerceDate(b.createdAt)?.getTime() || 0;
          return bDate - aDate;
        });

        setOrders(orderList);
        setEvents(eventList);
        setProjects(projectList);
        setQuotes(quoteList);
        setProposals(proposalList);
      } catch (err: any) {
        console.error('Failed to load CRM profile', err);
        if (active) {
          setError(err?.message || 'Failed to load client profile.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading, userId]);

  const summary = useMemo(() => {
    const revenue = orders.reduce((total, order) => {
      const price = typeof order.price === 'number' ? order.price : Number(order.price) || 0;
      return total + price;
    }, 0);

    const lastOrder = orders.length > 0 ? coerceDate(orders[0].createdAt) : null;
    const lastEvent = events.length > 0 ? coerceDate(events[0].createdAt) : null;
    const openProjects = projects.filter(
      (project) => (project.status || '').toLowerCase() !== 'completed'
    ).length;
    const openQuotes = quotes.filter((quote) => (quote.status || '').toLowerCase() !== 'closed').length;

    return {
      revenue,
      orders: orders.length,
      openProjects,
      openQuotes,
      lastActivity: lastEvent || lastOrder,
    };
  }, [orders, events, projects, quotes]);

  const handleStageChange = async (nextStage: CRMStatus) => {
    if (!user) return;
    setStageSaving(true);
    try {
      await adminUpdateUser({ userId, updates: { crmStatus: nextStage } });
      setUser((prev) => (prev ? { ...prev, crmStatus: nextStage } : prev));
    } catch (err: any) {
      console.error('Failed to update CRM stage', err);
      alert(err?.message || 'Failed to update CRM stage');
    } finally {
      setStageSaving(false);
    }
  };

  const handleDiscountSave = async () => {
    if (!user) return;
    setDiscountSaving(true);
    try {
      await adminUpdateUser({ userId, updates: { discount: discountDraft } });
      setUser((prev) => (prev ? { ...prev, discount: discountDraft } : prev));
    } catch (err: any) {
      console.error('Failed to update discount', err);
      alert(err?.message || 'Failed to update discount');
    } finally {
      setDiscountSaving(false);
    }
  };

  const handleSaveBio = async () => {
    if (!user) return;
    setSavingBio(true);
    try {
      const trimmed = bioDraft.trim();
      await adminUpdateUser({ userId, updates: { aiBio: trimmed || null } });
      setUser((prev) => (prev ? { ...prev, aiBio: trimmed || null } : prev));
    } catch (err: any) {
      console.error('Failed to save AI bio', err);
      alert(err?.message || 'Failed to save AI bio');
    } finally {
      setSavingBio(false);
    }
  };

  const handleGenerateBio = async () => {
    if (!userId) return;
    setBioNotice(null);
    setBioError(null);
    setBioGenerating(true);
    try {
      const response = await fetch('/api/admin/crm/generate-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      let payload: any = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Failed to generate AI bio.';
        throw new Error(message);
      }

      const generatedBio = typeof payload?.bio === 'string' ? payload.bio : '';
      const warnings = Array.isArray(payload?.warnings)
        ? (payload.warnings as unknown[])
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter((entry): entry is string => Boolean(entry))
        : [];

      if (generatedBio) {
        setBioDraft(generatedBio);
        setBioNotice(warnings.length ? 'AI bio generated. Review the assistant warnings below.' : 'AI bio generated and saved.');
      } else {
        setBioNotice('The assistant did not return any content. You can try again or add your own notes.');
      }

      setUser((prev) =>
        prev
          ? {
              ...prev,
              aiBio: generatedBio || prev.aiBio || null,
              aiBioWarnings: warnings.length ? warnings : null,
              aiBioStructured:
                payload && typeof payload === 'object' && payload.structured
                  ? (payload.structured as Record<string, unknown>)
                  : prev.aiBioStructured,
            }
          : prev
      );
    } catch (error: any) {
      console.error('Failed to generate AI bio', error);
      setBioError(error?.message || 'Failed to generate AI bio. Please try again.');
    } finally {
      setBioGenerating(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    const confirmed = window.confirm(`Send password reset email to ${user.email}?`);
    if (!confirmed) return;
    setSendingReset(true);
    try {
      await ensureFirebase();
      const callable = httpsCallable(functions, 'admin_sendPasswordReset');
      await callable({ email: user.email });
      alert('Password reset email sent.');
    } catch (err: any) {
      console.error('Failed to send password reset email', err);
      alert(err?.message || 'Failed to send password reset email');
    } finally {
      setSendingReset(false);
    }
  };

  const handleMerge = async () => {
    if (!user) return;
    const email = prompt('Merge this profile into which email address?');
    if (!email) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      return;
    }
    if (user.email && user.email.trim().toLowerCase() === trimmed) {
      alert('Please choose a different email address to merge into.');
      return;
    }
    setMergeLoading(true);
    try {
      const directory = await adminListUsers();
      const target = Array.isArray(directory?.users)
        ? (directory.users as Array<{ id: string; email?: string | null }>).find(
            (entry) =>
              typeof entry?.email === 'string' &&
              entry.email.trim().toLowerCase() === trimmed &&
              entry.id !== user.id
          )
        : null;
      if (!target) {
        alert('No matching account found for that email.');
        return;
      }
      const callable = httpsCallable(functions, 'admin_mergeUsers');
      await callable({ sourceId: user.id, targetId: target.id });
      alert('Merge requested. The account list will update shortly.');
    } catch (err: any) {
      console.error('Failed to merge user', err);
      alert(err?.message || 'Failed to merge users.');
    } finally {
      setMergeLoading(false);
    }
  };

  useEffect(() => {
    if (!user || editingContact) {
      return;
    }
    setContactDraft({
      fullName: typeof user.fullName === 'string' ? user.fullName : '',
      email: typeof user.email === 'string' ? user.email : '',
      phone: typeof user.phone === 'string' ? user.phone : '',
      organisation: typeof user.organisation === 'string' ? user.organisation : '',
      linkedinBio: typeof user.linkedinBio === 'string' ? user.linkedinBio : '',
    });
  }, [user, editingContact]);

  const startEditingContact = () => {
    if (!user) return;
    setContactDraft({
      fullName: typeof user.fullName === 'string' ? user.fullName : '',
      email: typeof user.email === 'string' ? user.email : '',
      phone: typeof user.phone === 'string' ? user.phone : '',
      organisation: typeof user.organisation === 'string' ? user.organisation : '',
      linkedinBio: typeof user.linkedinBio === 'string' ? user.linkedinBio : '',
    });
    setEditingContact(true);
  };

  const cancelEditingContact = () => {
    if (!user) return;
    setContactDraft({
      fullName: typeof user.fullName === 'string' ? user.fullName : '',
      email: typeof user.email === 'string' ? user.email : '',
      phone: typeof user.phone === 'string' ? user.phone : '',
      organisation: typeof user.organisation === 'string' ? user.organisation : '',
      linkedinBio: typeof user.linkedinBio === 'string' ? user.linkedinBio : '',
    });
    setEditingContact(false);
  };

  const handleContactDraftChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    setContactDraft((prev) => ({ ...prev, [name]: value }));
  };

  const handleContactSave = async () => {
    if (!user) return;
    const email = contactDraft.email.trim();
    if (!email) {
      alert('Email is required.');
      return;
    }
    setContactSaving(true);
    try {
      const updates = {
        fullName: contactDraft.fullName.trim() || null,
        email,
        phone: contactDraft.phone.trim() || null,
        organisation: contactDraft.organisation.trim() || null,
        linkedinBio: contactDraft.linkedinBio.trim() || null,
      };
      await adminUpdateUser({ userId, updates });
      setUser((prev) => (prev ? { ...prev, ...updates } : prev));
      setEditingContact(false);
    } catch (err: any) {
      console.error('Failed to update contact details', err);
      alert(err?.message || 'Failed to update contact details');
    } finally {
      setContactSaving(false);
    }
  };

  const handleDeleteRecord = async () => {
    if (!userId || !user) return;
    const name = user.fullName || user.organisation || user.email || 'this record';
    const confirmed = window.confirm(
      `Delete ${name}? This action cannot be undone and will remove the CRM record.`,
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error('Firestore is unavailable.');
      }
      await deleteDoc(doc(db, 'users', userId));
      router.push('/admin/users');
    } catch (err: any) {
      console.error('Failed to delete CRM record', err);
      alert(err?.message || 'Failed to delete CRM record');
    } finally {
      setDeleting(false);
    }
  };

  if (guardLoading || loading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to view this page.</p>;
  }

  if (!user) {
    return (
      <div className="grid gap-4">
        <p>Client record not found.</p>
        <Link className="text-orange" href="/admin/users">
          ← Back to CRM
        </Link>
      </div>
    );
  }

  const affiliateInfo =
    user.affiliate && typeof user.affiliate === 'object'
      ? (user.affiliate as Record<string, unknown>)
      : null;
  const affiliateLabel = affiliateInfo
    ? (typeof affiliateInfo.name === 'string' && affiliateInfo.name.trim()) ||
      (typeof affiliateInfo.refCode === 'string' && affiliateInfo.refCode.trim()) ||
      null
    : null;
  const affiliateNotes =
    affiliateInfo && typeof affiliateInfo.notes === 'string' && affiliateInfo.notes.trim()
      ? (affiliateInfo.notes as string)
      : null;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold">
            {user.fullName || user.organisation || user.email || 'Client'}
          </h1>
          <div className="text-sm text-gray-600">
            <p>{user.email}</p>
            {user.phone ? <p>{user.phone}</p> : null}
            {user.organisation ? <p>{user.organisation}</p> : null}
            {affiliateLabel ? (
              <p className="text-xs font-medium text-purple-600">
                Referred by {affiliateLabel}
                {affiliateNotes ? ` · ${affiliateNotes}` : ''}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-outline disabled:cursor-not-allowed disabled:opacity-60"
            disabled={contactSaving || deleting}
            onClick={() => (editingContact ? cancelEditingContact() : startEditingContact())}
            type="button"
          >
            {editingContact ? 'Cancel edit' : 'Edit contact details'}
          </button>
          <button
            className="btn-outline border-red-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={deleting || contactSaving}
            onClick={handleDeleteRecord}
            type="button"
          >
            {deleting ? 'Deleting…' : 'Delete record'}
          </button>
          <Link className="btn-outline" href="/admin/users">
            Back to CRM
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Contact details</h2>
        </div>
        {editingContact ? (
          <form
            className="mt-4 grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              handleContactSave();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-gray-700">
                Full name
                <input
                  className="border p-2"
                  name="fullName"
                  onChange={handleContactDraftChange}
                  type="text"
                  value={contactDraft.fullName}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-gray-700">
                Organisation
                <input
                  className="border p-2"
                  name="organisation"
                  onChange={handleContactDraftChange}
                  type="text"
                  value={contactDraft.organisation}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-gray-700">
                Email
                <input
                  className="border p-2"
                  name="email"
                  onChange={handleContactDraftChange}
                  type="email"
                  value={contactDraft.email}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium text-gray-700">
                Phone
                <input
                  className="border p-2"
                  name="phone"
                  onChange={handleContactDraftChange}
                  type="tel"
                  value={contactDraft.phone}
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm font-medium text-gray-700">
              LinkedIn bio
              <textarea
                className="border p-2"
                name="linkedinBio"
                onChange={handleContactDraftChange}
                rows={4}
                value={contactDraft.linkedinBio}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-sm" disabled={contactSaving} type="submit">
                {contactSaving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                className="btn-sm btn-outline"
                disabled={contactSaving}
                onClick={cancelEditingContact}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="mt-4 grid gap-4 text-sm text-gray-700 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Email</dt>
              <dd className="mt-1 text-gray-900">{user.email || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Phone</dt>
              <dd className="mt-1 text-gray-900">{user.phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Full name</dt>
              <dd className="mt-1 text-gray-900">{user.fullName || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Organisation</dt>
              <dd className="mt-1 text-gray-900">{user.organisation || '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase text-gray-500">LinkedIn bio</dt>
              <dd className="mt-1 whitespace-pre-line text-gray-900">
                {user.linkedinBio ? user.linkedinBio : '—'}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Account snapshot</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-gray-500">Lifetime spend</p>
            <p className="mt-1 text-xl font-semibold">{formatCurrency(summary.revenue)}</p>
          </div>
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-gray-500">Orders</p>
            <p className="mt-1 text-xl font-semibold">{summary.orders}</p>
          </div>
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-gray-500">Open projects</p>
            <p className="mt-1 text-xl font-semibold">{summary.openProjects}</p>
          </div>
          <div className="rounded border bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-gray-500">Open quotes</p>
            <p className="mt-1 text-xl font-semibold">{summary.openQuotes}</p>
          </div>
        </div>
        <div className="text-sm text-gray-600">
          <span className="font-medium">Last engagement:</span>{' '}
          {summary.lastActivity ? summary.lastActivity.toLocaleString() : '—'}
        </div>
      </section>

      <section className="grid gap-4 rounded border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Manage client</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-xs uppercase text-gray-500">CRM stage</span>
            <select
              className="input"
              value={normaliseCrmStatus(user.crmStatus)}
              onChange={(event) => handleStageChange(event.target.value as CRMStatus)}
              disabled={stageSaving}
            >
              {CRM_STAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-500">
              Current: {CRM_STATUS_LABELS[normaliseCrmStatus(user.crmStatus)]}
            </span>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs uppercase text-gray-500">Discount (%)</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                className="input"
                value={discountDraft}
                onChange={(event) => setDiscountDraft(Number(event.target.value) || 0)}
                onBlur={handleDiscountSave}
                disabled={discountSaving}
              />
              {discountSaving ? <span className="text-xs text-gray-500">Saving…</span> : null}
            </div>
          </label>
        </div>
        <div className="grid gap-2">
          <label className="text-xs uppercase text-gray-500">AI bio</label>
          <textarea
            className="input min-h-[120px]"
            value={bioDraft}
            onChange={(event) => setBioDraft(event.target.value)}
            placeholder="Add a generated bio or talking points for this client"
          />
          <div className="flex items-center gap-3">
            <button className="btn" onClick={handleSaveBio} disabled={savingBio || bioGenerating}>
              {savingBio ? 'Saving…' : 'Save bio'}
            </button>
            <button className="btn-outline" onClick={handleGenerateBio} disabled={bioGenerating || savingBio}>
              {bioGenerating ? 'Generating…' : 'Generate bio'}
            </button>
            <button
              className="btn-outline"
              onClick={handlePasswordReset}
              disabled={sendingReset}
            >
              {sendingReset ? 'Sending reset…' : 'Send password reset'}
            </button>
            <button
              className="btn-outline"
              onClick={handleMerge}
              disabled={mergeLoading}
            >
              {mergeLoading ? 'Merging…' : 'Merge with another account'}
            </button>
          </div>
          {bioNotice ? <p className="text-xs text-gray-600">{bioNotice}</p> : null}
          {bioError ? <p className="text-xs text-red-600">{bioError}</p> : null}
          {Array.isArray(user.aiBioWarnings) && user.aiBioWarnings.length ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              <p className="font-semibold">Assistant warnings</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {user.aiBioWarnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sales history</h2>
          <Link className="text-sm text-orange" href="/admin/orders">
            Manage orders
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-gray-600">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="p-2">Order</th>
                  <th className="p-2">Items</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Placed</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t">
                    <td className="p-2">
                      <Link className="text-orange" href={`/orders/${order.id}`}>
                        {order.id}
                      </Link>
                    </td>
                    <td className="p-2">
                      {order.items?.length
                        ? order.items.map((item) => item.name || 'Item').join(', ')
                        : '—'}
                    </td>
                    <td className="p-2 capitalize">{order.status || '—'}</td>
                    <td className="p-2">{formatDate(order.createdAt)}</td>
                    <td className="p-2 text-right">
                      {formatCurrency(typeof order.price === 'number' ? order.price : Number(order.price) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-gray-600">No projects captured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="p-2">Title</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Kick-off</th>
                  <th className="p-2">Due</th>
                  <th className="p-2">Territory</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="border-t">
                    <td className="p-2 font-medium">{project.title || 'Untitled project'}</td>
                    <td className="p-2 capitalize">{project.status || '—'}</td>
                    <td className="p-2">{formatDate(project.kickoffDate)}</td>
                    <td className="p-2">{formatDate(project.dueDate)}</td>
                    <td className="p-2">
                      {project.franchiseAssignment?.territoryLabel || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Quotes &amp; proposals</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold uppercase text-gray-500">Quotes</h3>
            {quotes.length === 0 ? (
              <p className="text-sm text-gray-600">No quotes submitted.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-500">
                      <th className="p-2">Quote</th>
                      <th className="p-2">Project</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Requested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((quote) => (
                      <tr key={quote.id} className="border-t">
                        <td className="p-2">
                          <Link className="text-orange" href={`/crm/quotes/${quote.id}`}>
                            <span className="block font-medium text-gray-900">
                              {resolveQuoteLabel(quote)}
                            </span>
                            <span className="block text-xs text-gray-600">
                              {resolveQuoteClient(quote, user)}
                            </span>
                            <span className="block text-xs text-gray-500">
                              {shortId(quote.id)}
                            </span>
                          </Link>
                        </td>
                        <td className="p-2">{quote.projectName || '—'}</td>
                        <td className="p-2 capitalize">{quote.status || 'pending'}</td>
                        <td className="p-2">{formatDate(quote.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold uppercase text-gray-500">Proposals</h3>
            {proposals.length === 0 ? (
              <p className="text-sm text-gray-600">No proposals issued.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-500">
                      <th className="p-2">Proposal</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((proposal) => (
                      <tr key={proposal.id} className="border-t">
                        <td className="p-2">
                          <div className="grid gap-0.5">
                            <span className="font-medium text-gray-900">
                              {resolveProposalLabel(proposal)}
                            </span>
                            {(proposal.clientName || proposal.clientEmail) && (
                              <span className="text-xs text-gray-600">
                                {proposal.clientName || proposal.clientEmail}
                              </span>
                            )}
                            <span className="text-xs text-gray-500">{shortId(proposal.id)}</span>
                          </div>
                        </td>
                        <td className="p-2 capitalize">{proposal.status || 'sent'}</td>
                        <td className="p-2">{formatDate(proposal.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        {events.length === 0 ? (
          <p className="text-sm text-gray-600">No tracked interactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="p-2">Page</th>
                  <th className="p-2">Visited</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t">
                    <td className="p-2">{event.path || '—'}</td>
                    <td className="p-2">{formatDateTime(event.createdAt)}</td>
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
