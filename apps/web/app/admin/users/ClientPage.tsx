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
import { collection, getDocs } from 'firebase/firestore';

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

export default function AdminUsersPage() {
  const { allowed, roles, loading: guardLoading } = useRoleGate(['admin', 'sales']);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'client' | 'prospect' | 'outreach'>('client');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [outreachProductFilter, setOutreachProductFilter] = useState('');
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

  const productById = useMemo(() => {
    const map = new Map<string, ProductSummary>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

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
    try {
      const id = crypto.randomUUID();
      const payload = { ...data, crmStatus: activeTab } as Partial<AdminUser> & Record<string, unknown>;
      if ('suggestedProductId' in payload && !payload.suggestedProductId) {
        payload.suggestedProductId = null;
      }
      const emailValue = typeof payload.email === 'string' ? payload.email.trim() : '';
      if (!emailValue) {
        throw new Error('Email is required');
      }
      const newRecord: AdminUser = {
        id,
        ...payload,
        email: emailValue,
      };
      await adminUpdateUser({ userId: id, updates: payload });
      setUsers([...users, newRecord]);
      setShowForm(false);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating record');
    }
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">CRM</h1>
      <div className="flex gap-4 border-b">
        {['client', 'prospect', 'outreach'].map(tab => (
          <button
            key={tab}
            className={`pb-2 ${activeTab === tab ? 'border-b-2 border-orange font-medium' : ''}`}
            onClick={() => setActiveTab(tab as any)}
          >
            {tab === 'client' ? 'Clients' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button className="btn" onClick={() => setShowForm(true)}>Add Record</button>
      </div>
      {activeTab === 'outreach' && (
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
      {activeTab === 'client' && renderTable(clients, 'client')}
      {activeTab === 'prospect' && renderTable(prospects, 'prospect')}
      {activeTab === 'outreach' && renderTable(filteredOutreach, 'outreach')}
      {showForm && (
        <CRMRecordForm
          status={activeTab}
          products={products}
          onSave={handleAddRecord}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}