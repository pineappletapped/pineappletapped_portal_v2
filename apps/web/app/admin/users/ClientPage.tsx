"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { functions, ensureFirebase } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { adminListUsers, adminUpdateUser } from '@/lib/admin';
import {
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  extractUserRoles,
  RoleKey,
  UserRoles,
} from '@/lib/roles';
import { useRoleGate } from '@/hooks/useRoleGate';
import CRMRecordForm from '@/components/CRMRecordForm';
import ComplianceBadge from '@/components/ComplianceBadge';
import {
  complianceDateToDisplay,
  deriveComplianceState,
  type ComplianceRecord,
} from '@/lib/compliance';
import { collection, collectionGroup, doc, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';

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
  crmStatus?: string;
  discount?: number;
  roles?: UserRoles;
  suggestedProductId?: string | null;
  [key: string]: any;
}

interface AdminComplianceRecord extends ComplianceRecord {
  pathSegments: string[];
}

export default function AdminUsersPage() {
  const { allowed, roles, loading: guardLoading } = useRoleGate(['admin', 'sales']);
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
  const canEditRoles = useMemo(() => !!roles?.admin, [roles]);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      try {
        const result: any = await adminListUsers();
        const hydrated = (result.users || []).map((user: AdminUser) => ({
          ...user,
          roles: extractUserRoles(user),
        }));
        setUsers(hydrated);
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

  const changeStatus = async (user: any, status: string) => {
    try {
      await adminUpdateUser({ userId: user.id, updates: { crmStatus: status } });
      setUsers(users.map(u => u.id === user.id ? { ...u, crmStatus: status } : u));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating user');
    }
  };

  const updateRole = async (user: AdminUser, role: RoleKey, enabled: boolean) => {
    if (!canEditRoles) return;
    try {
      const currentRoles = extractUserRoles(user);
      const updatedRoles = { ...currentRoles } as UserRoles;
      if (enabled) {
        updatedRoles[role] = true;
      } else {
        delete updatedRoles[role];
      }
      await adminUpdateUser({ userId: user.id, updates: { roles: updatedRoles } });
      setUsers(users.map(u => u.id === user.id ? { ...u, roles: updatedRoles } : u));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating user');
    }
  };

  const updateDiscount = async (user: any, discount: number) => {
    try {
      await adminUpdateUser({ userId: user.id, updates: { discount } });
      setUsers(users.map(u => u.id === user.id ? { ...u, discount } : u));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating discount');
    }
  };

  const updateSuggestedProduct = async (user: AdminUser, productId: string) => {
    const value = productId || null;
    try {
      await adminUpdateUser({ userId: user.id, updates: { suggestedProductId: value } });
      setUsers(users.map(u => (u.id === user.id ? { ...u, suggestedProductId: value } : u)));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating suggested product');
    }
  };

  const sendReset = async (user: any) => {
    const ok = confirm(`Send password reset email to ${user.email}?`);
    if (!ok) return;
    try {
      const callable = httpsCallable(functions, 'admin_sendPasswordReset');
      await callable({ email: user.email });
      alert('Reset link sent');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error sending reset email');
    }
  };

  const mergeUser = async (source: any) => {
    const email = prompt('Merge into which user email?');
    if (!email) return;
    const target = users.find(u => u.email === email);
    if (!target) {
      alert('Target user not found');
      return;
    }
    try {
      const callable = httpsCallable(functions, 'admin_mergeUsers');
      await callable({ sourceId: source.id, targetId: target.id });
      setUsers(users.filter(u => u.id !== source.id));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error merging users');
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

  const renderRoleBadges = (user: AdminUser) => {
    const activeRoles = ROLE_KEYS.filter((role) => user.roles?.[role]);
    if (activeRoles.length === 0) {
      return <span>-</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {activeRoles.map((role) => (
          <span key={role} className="badge badge-outline text-xs">
            {ROLE_LABELS[role]}
          </span>
        ))}
      </div>
    );
  };

  const renderRoleEditor = (user: AdminUser) => {
    if (!canEditRoles) {
      return renderRoleBadges(user);
    }

    return (
      <div className="grid gap-2">
        {renderRoleBadges(user)}
        <details className="text-xs">
          <summary className="cursor-pointer text-blue-600">Manage roles</summary>
          <div className="mt-2 grid gap-1">
            {ROLE_DEFINITIONS.map((role) => (
              <label key={role.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!user.roles?.[role.key]}
                  onChange={(e) => updateRole(user, role.key, e.target.checked)}
                />
                <span>
                  <span className="font-medium">{role.label}</span>
                  <span className="block text-[0.7rem] text-gray-500">{role.description}</span>
                </span>
              </label>
            ))}
          </div>
        </details>
      </div>
    );
  };

  const renderTable = (list: AdminUser[], status: 'client' | 'prospect' | 'outreach') => (
    list.length === 0 ? (
      <p>No records.</p>
    ) : (
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2">Email</th>
            <th className="p-2">Name</th>
            <th className="p-2">Stage</th>
            <th className="p-2">Roles</th>
            <th className="p-2">Drone compliance</th>
            <th className="p-2">Discount%</th>
            <th className="p-2">Suggested Product</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map(user => (
            <tr key={user.id} className="border-t">
              <td className="p-2">{user.email}</td>
              <td className="p-2">{user.fullName || '-'}</td>
              <td className="p-2">
                <select
                  className="border p-1 text-sm"
                  value={user.crmStatus || 'client'}
                  onChange={(e) => changeStatus(user, e.target.value)}
                >
                  <option value="client">Client</option>
                  <option value="prospect">Prospect</option>
                  <option value="outreach">Outreach</option>
                </select>
              </td>
              <td className="p-2">
                {canEditRoles ? renderRoleEditor(user) : renderRoleBadges(user)}
              </td>
              <td className="p-2">
                {(() => {
                  const entry = complianceByUser.get(user.id);
                  if (!entry) {
                    return <span className="text-xs text-gray-500">No record</span>;
                  }
                  const { state, record } = entry;
                  return (
                    <div className="flex flex-col gap-1">
                      <ComplianceBadge
                        status={state.status}
                        title={state.issues.join('\n')}
                      />
                      <span
                        className={`text-[0.7rem] ${state.licenceExpired ? 'text-red-600' : 'text-gray-500'}`}
                      >
                        Licence: {complianceDateToDisplay(record.licenceExpiry)}
                      </span>
                      <span
                        className={`text-[0.7rem] ${state.insuranceExpired ? 'text-red-600' : 'text-gray-500'}`}
                      >
                        Insurance: {complianceDateToDisplay(record.insuranceExpiry)}
                      </span>
                    </div>
                  );
                })()}
              </td>
              <td className="p-2">
                <input
                  type="number"
                  className="border p-1 w-16"
                  value={user.discount || 0}
                  onChange={(e) => updateDiscount(user, parseFloat(e.target.value) || 0)}
                />
              </td>
              <td className="p-2">
                {status === 'outreach' ? (
                  <select
                    className="border p-1 text-sm"
                    value={user.suggestedProductId || ''}
                    onChange={(e) => updateSuggestedProduct(user, e.target.value)}
                  >
                    <option value="">No suggestion</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{productById.get(user.suggestedProductId || '')?.name || '-'}</span>
                )}
              </td>
              <td className="p-2 flex gap-2">
                <Link className="btn-sm" href={`/admin/users/${user.id}`}>View</Link>
                {user.email && (
                  <button className="btn-sm" onClick={() => sendReset(user)}>Reset</button>
                )}
                <button className="btn-sm" onClick={() => mergeUser(user)}>Merge</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  );

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this page.</p>;

  const clients = users.filter(u => (u.crmStatus || 'client') === 'client');
  const prospects = users.filter(u => u.crmStatus === 'prospect');
  const outreach = users.filter(u => u.crmStatus === 'outreach');
  const filteredOutreach = outreachProductFilter
    ? outreach.filter((u) => (u.suggestedProductId || '') === outreachProductFilter)
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

      sanitised.crmStatus = crmStage;
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
      <h1 className="text-xl font-semibold">Users workspace</h1>
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
          {crmStage === 'client' && renderTable(clients, 'client')}
          {crmStage === 'prospect' && renderTable(prospects, 'prospect')}
          {crmStage === 'outreach' && renderTable(filteredOutreach, 'outreach')}
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