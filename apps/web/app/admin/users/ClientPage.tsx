"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, collectionGroup, doc, getDocs, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';

import CRMRecordForm from '@/components/CRMRecordForm';
import ComplianceBadge from '@/components/ComplianceBadge';
import { useRoleGate } from '@/hooks/useRoleGate';
import { adminListUsers, adminUpdateUser } from '@/lib/admin';
import {
  complianceDateToDisplay,
  deriveComplianceState,
  type ComplianceRecord,
} from '@/lib/compliance';
import {
  CRM_ALL_STATUSES,
  CRM_OUTREACH_STATUSES,
  CRM_PIPELINE_STATUSES,
  CRM_STAGE_OPTIONS,
  CRM_STATUS_LABELS,
  type CRMStatus,
  getNextPipelineStatus,
  getPreviousPipelineStatus,
  normaliseCrmStatus,
} from '@/lib/crm';
import { ensureFirebase } from '@/lib/firebase';

interface ProductSummary {
  id: string;
  name: string;
}

/**
 * Admin Users Management
 *
 * This page allows super administrators to view all user accounts and perform
 * management actions such as toggling staff status and sending password resets.
 */
interface AdminUser {
  id: string;
  email: string;
  fullName?: string;
  crmStatus?: CRMStatus;
  discount?: number;
  suggestedProductId?: string | null;
  [key: string]: any;
}

interface AdminComplianceRecord extends ComplianceRecord {
  pathSegments: string[];
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch (error) {
      console.warn('Failed to convert Firestore timestamp', error);
      return null;
    }
  }
  return null;
}

function formatDate(value: unknown): string {
  const date = coerceDate(value);
  return date ? date.toLocaleDateString() : '—';
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
}

export default function AdminUsersPage() {
  const { allowed, loading: guardLoading } = useRoleGate(['admin', 'sales']);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [crmStage, setCrmStage] = useState<'client' | 'prospect' | 'outreach'>('client');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [outreachProductFilter, setOutreachProductFilter] = useState('');
  const [activePanel, setActivePanel] = useState<'crm' | 'compliance'>('crm');
  const [complianceRecords, setComplianceRecords] = useState<AdminComplianceRecord[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(true);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [clientValues, setClientValues] = useState<Map<string, number>>(new Map());
  const [clientValueLoading, setClientValueLoading] = useState(false);
  const [clientValueError, setClientValueError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      try {
        const result: any = await adminListUsers();
        const nextUsers: AdminUser[] = Array.isArray(result?.users)
          ? (result.users as AdminUser[]).map((entry) => ({
              ...entry,
              crmStatus: normaliseCrmStatus(entry?.crmStatus),
            }))
          : [];
        setUsers(nextUsers);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Error loading users');
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          return;
        }
        const snapshot = await getDocs(collection(db, 'products'));
        const list: ProductSummary[] = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, any>;
            const rawName = typeof data?.name === 'string' ? data.name.trim() : '';
            return {
              id: docSnap.id,
              name: rawName.length > 0 ? rawName : 'Untitled product',
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
      } catch (err) {
        console.error('Failed to load products for CRM outreach suggestions', err);
      }
    })();
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      if (guardLoading || !allowed) {
        return;
      }

      const clientIds = Array.from(
        new Set(
          users
            .filter((user) => normaliseCrmStatus(user.crmStatus) === 'client')
            .map((user) => user.id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
      );

      if (clientIds.length === 0) {
        if (!active) return;
        setClientValues(new Map());
        setClientValueError(null);
        setClientValueLoading(false);
        return;
      }

      setClientValueLoading(true);
      setClientValueError(null);

      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable.');
        }

        const results = new Map<string, number>();
        const ordersRef = collection(db, 'orders');

        for (const chunk of chunkArray(clientIds, 10)) {
          const snap = await getDocs(query(ordersRef, where('userId', 'in', chunk)));
          snap.docs.forEach((docSnap) => {
            const data = docSnap.data() as Record<string, any>;
            const userId = typeof data.userId === 'string' ? data.userId : null;
            if (!userId) {
              return;
            }
            const numericCandidates = [
              data.netTotal,
              data.price,
              data.totalAmount,
              data.total,
              data.subtotal,
            ];
            let amount = 0;
            for (const candidate of numericCandidates) {
              if (typeof candidate === 'number' && Number.isFinite(candidate)) {
                amount = candidate;
                break;
              }
              if (typeof candidate === 'string') {
                const parsed = Number(candidate);
                if (!Number.isNaN(parsed)) {
                  amount = parsed;
                  break;
                }
              }
            }
            if (amount > 0) {
              results.set(userId, (results.get(userId) || 0) + amount);
            }
          });
        }

        if (!active) return;
        setClientValues(results);
      } catch (error) {
        console.error('Failed to load client value totals', error);
        if (!active) return;
        setClientValueError('Unable to load client value totals.');
        setClientValues(new Map());
      } finally {
        if (active) {
          setClientValueLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading, users]);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          setComplianceLoading(false);
          return;
        }
        const snapshot = await getDocs(collectionGroup(db, 'compliance'));
        const entries: AdminComplianceRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const uid = docSnap.ref.parent?.parent?.id || (typeof data.uid === 'string' ? data.uid : '');
          return {
            id: docSnap.id,
            uid,
            pathSegments: docSnap.ref.path.split('/'),
            ...data,
          } as AdminComplianceRecord;
        });
        setComplianceRecords(entries);
        setComplianceLoading(false);
      } catch (err) {
        console.error('Failed to load compliance records', err);
        setComplianceError('Failed to load compliance records.');
        setComplianceLoading(false);
      }
    })();
  }, []);

  const productById = useMemo(() => {
    const map = new Map<string, ProductSummary>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const userById = useMemo(() => {
    const map = new Map<string, AdminUser>();
    users.forEach((user) => map.set(user.id, user));
    return map;
  }, [users]);

  const complianceByUser = useMemo(() => {
    const map = new Map<
      string,
      { record: AdminComplianceRecord; state: ReturnType<typeof deriveComplianceState> }
    >();
    complianceRecords.forEach((record) => {
      if (!record.uid) {
        return;
      }
      map.set(record.uid, {
        record,
        state: deriveComplianceState(record),
      });
    });
    return map;
  }, [complianceRecords]);

  const pipelineByStatus = useMemo(() => {
    const grouped = new Map<CRMStatus, AdminUser[]>();
    CRM_PIPELINE_STATUSES.forEach((status) => grouped.set(status, []));

    users.forEach((user) => {
      const stage = normaliseCrmStatus(user.crmStatus);
      if (grouped.has(stage)) {
        grouped.get(stage)!.push(user);
      }
    });

    CRM_PIPELINE_STATUSES.forEach((status) => {
      const list = grouped.get(status);
      if (!list) return;
      list.sort((a, b) => {
        const aTime =
          coerceDate(a.updatedAt)?.getTime() ||
          coerceDate(a.lastContactedAt)?.getTime() ||
          coerceDate(a.createdAt)?.getTime() ||
          0;
        const bTime =
          coerceDate(b.updatedAt)?.getTime() ||
          coerceDate(b.lastContactedAt)?.getTime() ||
          coerceDate(b.createdAt)?.getTime() ||
          0;
        return bTime - aTime;
      });
    });

    return grouped;
  }, [users]);

  const changeStatus = async (user: AdminUser, status: CRMStatus) => {
    try {
      await adminUpdateUser({ userId: user.id, updates: { crmStatus: status } });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, crmStatus: status } : u)));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating user');
    }
  };

  const updateDiscount = async (user: any, discount: number) => {
    try {
      await adminUpdateUser({ userId: user.id, updates: { discount } });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, discount } : u)));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating discount');
    }
  };

  const updateSuggestedProduct = async (user: AdminUser, productId: string) => {
    const value = productId || null;
    try {
      await adminUpdateUser({ userId: user.id, updates: { suggestedProductId: value } });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, suggestedProductId: value } : u))
      );
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating suggested product');
    }
  };

  const updateComplianceRecordLocally = (
    record: AdminComplianceRecord,
    updates: Partial<AdminComplianceRecord>
  ) => {
    setComplianceRecords((prev) =>
      prev.map((entry) =>
        entry.uid === record.uid && entry.id === record.id
          ? { ...entry, ...updates }
          : entry
      )
    );
  };

  const handleComplianceStatusChange = async (
    record: AdminComplianceRecord,
    status: 'pending' | 'approved' | 'rejected'
  ) => {
    try {
      const { db, auth: firebaseAuth } = await ensureFirebase();
      if (!db) {
        throw new Error('Firestore is unavailable.');
      }
      const reviewerUid = firebaseAuth?.currentUser?.uid || null;
      await updateDoc(doc(db, ...record.pathSegments), {
        status,
        reviewerUid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      updateComplianceRecordLocally(record, {
        status,
        reviewerUid,
        reviewedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Failed to update compliance status', err);
      alert(err?.message || 'Failed to update compliance status');
    }
  };

  const handleComplianceNotes = async (record: AdminComplianceRecord) => {
    const currentNotes =
      typeof record.reviewNotes === 'string' ? record.reviewNotes : '';
    const next = prompt('Add HQ review notes', currentNotes);
    if (next === null) return;
    const trimmed = next.trim();

    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error('Firestore is unavailable.');
      }
      await updateDoc(doc(db, ...record.pathSegments), {
        reviewNotes: trimmed || null,
        updatedAt: serverTimestamp(),
      });
      updateComplianceRecordLocally(record, {
        reviewNotes: trimmed || null,
      });
    } catch (err: any) {
      console.error('Failed to update compliance notes', err);
      alert(err?.message || 'Failed to update notes');
    }
  };

  const renderTable = (
    list: AdminUser[],
    {
      allowedStatuses,
      showSuggestedProduct = false,
      showClientValue = false,
      showCompliance = false,
    }: {
      allowedStatuses: CRMStatus[];
      showSuggestedProduct?: boolean;
      showClientValue?: boolean;
      showCompliance?: boolean;
    }
  ) => {
    if (list.length === 0) {
      return <p>No records.</p>;
    }

    const uniqueStatuses = Array.from(new Set(allowedStatuses));

    return (
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2">Email</th>
            <th className="p-2">Name</th>
            <th className="p-2">Stage</th>
            {showClientValue ? <th className="p-2">Client value</th> : null}
            {showCompliance ? <th className="p-2">Drone compliance</th> : null}
            <th className="p-2">Discount%</th>
            {showSuggestedProduct ? <th className="p-2">Suggested product</th> : null}
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((user) => {
            const stage = normaliseCrmStatus(user.crmStatus);
            const complianceEntry = showCompliance ? complianceByUser.get(user.id) : null;
            return (
              <tr key={user.id} className="border-t">
                <td className="p-2">{user.email}</td>
                <td className="p-2">{user.fullName || user.organisation || '-'}</td>
                <td className="p-2">
                  <select
                    className="border p-1 text-sm"
                    value={stage}
                    onChange={(event) => changeStatus(user, event.target.value as CRMStatus)}
                  >
                    {uniqueStatuses.map((status) => (
                      <option key={status} value={status}>
                        {CRM_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </td>
                {showClientValue ? (
                  <td className="p-2">
                    {clientValueLoading ? (
                      <span className="text-xs text-gray-500">Loading…</span>
                    ) : clientValues.has(user.id) ? (
                      formatCurrency(clientValues.get(user.id) || 0)
                    ) : (
                      '—'
                    )}
                  </td>
                ) : null}
                {showCompliance ? (
                  <td className="p-2">
                    {complianceEntry ? (
                      <div className="flex flex-col gap-1">
                        <ComplianceBadge
                          status={complianceEntry.state.status}
                          title={complianceEntry.state.issues.join('\n')}
                        />
                        <span
                          className={`text-[0.7rem] ${
                            complianceEntry.state.licenceExpired ? 'text-red-600' : 'text-gray-500'
                          }`}
                        >
                          Licence: {complianceDateToDisplay(complianceEntry.record.licenceExpiry)}
                        </span>
                        <span
                          className={`text-[0.7rem] ${
                            complianceEntry.state.insuranceExpired ? 'text-red-600' : 'text-gray-500'
                          }`}
                        >
                          Insurance: {complianceDateToDisplay(complianceEntry.record.insuranceExpiry)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">No record</span>
                    )}
                  </td>
                ) : null}
                <td className="p-2">
                  <input
                    type="number"
                    className="border p-1 w-16"
                    value={user.discount || 0}
                    onChange={(event) => updateDiscount(user, parseFloat(event.target.value) || 0)}
                  />
                </td>
                {showSuggestedProduct ? (
                  <td className="p-2">
                    <select
                      className="border p-1 text-sm"
                      value={user.suggestedProductId || ''}
                      onChange={(event) => updateSuggestedProduct(user, event.target.value)}
                    >
                      <option value="">No suggestion</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
                <td className="p-2 flex gap-2">
                  <Link className="btn-sm" href={`/admin/users/${user.id}`}>
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const outreachSelectStatuses = useMemo<CRMStatus[]>(() => {
    const combined = [
      ...CRM_OUTREACH_STATUSES,
      ...CRM_PIPELINE_STATUSES,
      'client',
    ] as CRMStatus[];
    return Array.from(new Set(combined));
  }, []);

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this page.</p>;

  const clients = users.filter((user) => normaliseCrmStatus(user.crmStatus) === 'client');
  const outreach = users.filter((user) =>
    CRM_OUTREACH_STATUSES.includes(normaliseCrmStatus(user.crmStatus))
  );
  const filteredOutreach = outreachProductFilter
    ? outreach.filter((user) => (user.suggestedProductId || '') === outreachProductFilter)
    : outreach;

  const handleAddRecord = async (data: Record<string, unknown>) => {
    setError(null);
    try {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `crm_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      const payload = { ...data, crmStatus: crmStage } as Partial<AdminUser> & Record<string, unknown>;
      if ('suggestedProductId' in payload && !payload.suggestedProductId) {
        payload.suggestedProductId = null;
      }

      const emailValue = typeof payload.email === 'string' ? payload.email.trim() : '';
      if (!emailValue) {
        throw new Error('Email is required');
      }

      payload.email = emailValue;

      const fileEntries: Array<[string, File]> = [];
      Object.entries(payload).forEach(([key, value]) => {
        if (value instanceof File) {
          fileEntries.push([key, value]);
        }
      });

      const sanitised: Partial<AdminUser> & Record<string, unknown> = {};
      Object.entries(payload).forEach(([key, value]) => {
        if (value instanceof File) {
          return;
        }
        if (typeof value === 'string') {
          sanitised[key] = value.trim();
        } else if (value !== undefined) {
          sanitised[key] = value;
        }
      });

      let defaultStage: CRMStatus = 'client';
      if (crmStage === 'prospect') {
        defaultStage = 'lead';
      } else if (crmStage === 'outreach') {
        defaultStage = 'outreach';
      }

      sanitised.crmStatus = defaultStage;
      sanitised.email = emailValue;
      const timestampIso = new Date().toISOString();
      sanitised.createdAt = timestampIso;
      sanitised.updatedAt = timestampIso;

      if (fileEntries.length > 0) {
        const { storage } = await ensureFirebase();
        if (!storage || (storage as any).__isPlaceholder) {
          throw new Error('Firebase storage is unavailable.');
        }

        const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
        await Promise.all(
          fileEntries.map(async ([key, file]) => {
            const safeName = encodeURIComponent(file.name || key);
            const objectRef = ref(storage, `crm/${id}/${Date.now()}_${safeName}`);
            await uploadBytes(objectRef, file);
            const url = await getDownloadURL(objectRef);
            sanitised[key] = url;
            sanitised[`${key}Name`] = file.name;
          })
        );
      }

      await adminUpdateUser({ userId: id, updates: sanitised });

      const newRecord: AdminUser = {
        id,
        email: emailValue,
        ...(sanitised as Partial<AdminUser>),
        crmStatus: defaultStage,
      };

      setUsers((prev) => [...prev, newRecord]);
      setShowForm(false);
    } catch (err: any) {
      console.error(err);
      const message = err?.message || 'Error creating record';
      setError(message);
      alert(message);
    }
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">CRM</h1>
      <div className="flex gap-4 border-b">
        {[
          { id: 'crm', label: 'CRM' },
          { id: 'compliance', label: 'Compliance' },
        ].map((panel) => (
          <button
            key={panel.id}
            className={`pb-2 ${
              activePanel === panel.id ? 'border-b-2 border-orange font-medium' : ''
            }`}
            onClick={() => setActivePanel(panel.id as 'crm' | 'compliance')}
          >
            {panel.label}
          </button>
        ))}
      </div>

      {activePanel === 'crm' ? (
        <>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex gap-4 border-b">
            {['client', 'prospect', 'outreach'].map(tab => (
              <button
                key={tab}
                className={`pb-2 ${crmStage === tab ? 'border-b-2 border-orange font-medium' : ''}`}
                onClick={() => setCrmStage(tab as any)}
              >
                {tab === 'client' ? 'Clients' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <button className="btn" onClick={() => setShowForm(true)}>Add Record</button>
          </div>
          {crmStage === 'outreach' && (
            <div className="flex items-center gap-2">
              <label className="text-sm" htmlFor="outreach-product-filter">Filter by product:</label>
              <select
                id="outreach-product-filter"
                className="border p-1 text-sm"
                value={outreachProductFilter}
                onChange={(e) => setOutreachProductFilter(e.target.value)}
              >
                <option value="">All products</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {crmStage === 'client' && (
            <div className="grid gap-3">
              {clientValueError ? (
                <p className="text-sm text-red-600">{clientValueError}</p>
              ) : null}
              {renderTable(clients, {
                allowedStatuses: CRM_ALL_STATUSES,
                showClientValue: true,
              })}
            </div>
          )}
          {crmStage === 'prospect' && (
            <section className="grid gap-4">
              <p className="text-sm text-gray-600">
                Progress prospects through each pipeline milestone. Use the quick stage controls to
                advance opportunities or return them to outreach when needed.
              </p>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {CRM_PIPELINE_STATUSES.map((status) => {
                  const entries = pipelineByStatus.get(status) ?? [];
                  return (
                    <section
                      key={status}
                      className="flex w-72 min-w-[18rem] flex-col gap-3 rounded border bg-white p-3 shadow-sm"
                    >
                      <header className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">
                          {CRM_STATUS_LABELS[status]}
                        </h3>
                        <span className="text-xs text-gray-500">{entries.length}</span>
                      </header>
                      <div className="grid gap-3">
                        {entries.length === 0 ? (
                          <p className="text-xs text-gray-500">No records in this stage.</p>
                        ) : (
                          entries.map((user) => {
                            const stage = normaliseCrmStatus(user.crmStatus);
                            const nextStage = getNextPipelineStatus(stage);
                            const previousStage = getPreviousPipelineStatus(stage);
                            const organisation =
                              typeof user.organisation === 'string' && user.organisation.trim().length
                                ? user.organisation.trim()
                                : null;
                            const suggestedProduct =
                              user.suggestedProductId
                                ? productById.get(user.suggestedProductId || '')?.name || null
                                : null;
                            return (
                              <article
                                key={user.id}
                                className="grid gap-2 rounded border border-orange-200 bg-orange-50 p-3 text-sm"
                              >
                                <div className="grid gap-1">
                                  <p className="font-semibold text-gray-900">
                                    {user.fullName || organisation || user.email || 'Prospect'}
                                  </p>
                                  <div className="text-xs text-gray-600">
                                    {user.email ? <span className="block">{user.email}</span> : null}
                                    {user.phone ? <span className="block">{user.phone}</span> : null}
                                    {organisation ? (
                                      <span className="block">{organisation}</span>
                                    ) : null}
                                  </div>
                                </div>
                                {suggestedProduct ? (
                                  <p className="text-xs text-gray-600">
                                    Suggested: {suggestedProduct}
                                  </p>
                                ) : null}
                                {user.notes ? (
                                  <p className="whitespace-pre-line text-xs text-gray-600">
                                    {user.notes}
                                  </p>
                                ) : null}
                                <p className="text-xs text-gray-500">
                                  Last update: {formatDate(user.updatedAt || user.lastContactedAt || user.createdAt)}
                                </p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <select
                                    className="border p-1 text-xs"
                                    value={stage}
                                    onChange={(event) =>
                                      changeStatus(user, event.target.value as CRMStatus)
                                    }
                                  >
                                    {CRM_ALL_STATUSES.map((option) => (
                                      <option key={option} value={option}>
                                        {CRM_STATUS_LABELS[option]}
                                      </option>
                                    ))}
                                  </select>
                                  <Link className="btn-sm" href={`/admin/users/${user.id}`}>
                                    View
                                  </Link>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {previousStage ? (
                                    <button
                                      className="btn-sm btn-outline"
                                      onClick={() => changeStatus(user, previousStage)}
                                    >
                                      Move to {CRM_STATUS_LABELS[previousStage]}
                                    </button>
                                  ) : null}
                                  {nextStage ? (
                                    <button
                                      className="btn-sm"
                                      onClick={() => changeStatus(user, nextStage)}
                                    >
                                      {nextStage === 'client'
                                        ? 'Mark as client'
                                        : `Move to ${CRM_STATUS_LABELS[nextStage]}`}
                                    </button>
                                  ) : null}
                                </div>
                              </article>
                            );
                          })
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          )}
          {crmStage === 'outreach' &&
            renderTable(filteredOutreach, {
              allowedStatuses: outreachSelectStatuses,
              showSuggestedProduct: true,
            })}
          {showForm && (
            <CRMRecordForm
              status={crmStage}
              products={products}
              onSave={handleAddRecord}
              onClose={() => setShowForm(false)}
            />
          )}
        </>
      ) : (
        <section className="grid gap-4">
          {complianceError && <p className="text-red-600">{complianceError}</p>}
          {complianceLoading ? (
            <p>Loading compliance records…</p>
          ) : complianceRecords.length === 0 ? (
            <p>No compliance submissions yet.</p>
          ) : (
            <table className="w-full text-sm border">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2">Team member</th>
                  <th className="p-2">Licence expiry</th>
                  <th className="p-2">Insurance expiry</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {complianceRecords.map((record) => {
                  const user = userById.get(record.uid);
                  const state = deriveComplianceState(record);
                  return (
                    <tr key={`${record.uid}-${record.id}`} className="border-t">
                      <td className="p-2">
                        <div className="flex flex-col text-sm">
                          <span className="font-medium">{user?.fullName || user?.email || record.uid || 'Unknown user'}</span>
                          {user?.email && (
                            <span className="text-xs text-gray-500">{user.email}</span>
                          )}
                        </div>
                      </td>
                      <td className={`p-2 text-sm ${state.licenceExpired ? 'text-red-600' : 'text-gray-600'}`}>
                        {complianceDateToDisplay(record.licenceExpiry)}
                      </td>
                      <td className={`p-2 text-sm ${state.insuranceExpired ? 'text-red-600' : 'text-gray-600'}`}>
                        {complianceDateToDisplay(record.insuranceExpiry)}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col gap-1">
                          <ComplianceBadge
                            status={state.status}
                            title={state.issues.join('\n')}
                          />
                          {record.reviewNotes && (
                            <span className="text-[0.7rem] text-gray-500">Notes: {record.reviewNotes}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 flex flex-wrap gap-2">
                        <button
                          className="btn-sm"
                          onClick={() => handleComplianceStatusChange(record, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => handleComplianceStatusChange(record, 'rejected')}
                        >
                          Reject
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => handleComplianceStatusChange(record, 'pending')}
                        >
                          Reset
                        </button>
                        <button className="btn-sm" onClick={() => handleComplianceNotes(record)}>
                          Notes
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}