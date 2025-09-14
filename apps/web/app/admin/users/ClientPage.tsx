"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth, db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { adminListUsers, adminUpdateUser } from '@/lib/admin';
import { doc, getDoc } from 'firebase/firestore';
import CRMRecordForm from '@/components/CRMRecordForm';

/**
 * Admin Users Management
 *
 * This page allows super administrators to view all user accounts and perform
 * management actions such as toggling staff status and sending password resets.
 */
export default function AdminUsersPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'client' | 'prospect' | 'outreach'>('client');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const current = auth.currentUser;
      if (!current) {
        setIsStaff(false);
        return;
      }
      const uSnap = await getDoc(doc(db, 'users', current.uid));
      const me = uSnap.data() as any;
      setIsStaff(me?.isStaff === true);
      if (me?.isStaff) {
        try {
          const result: any = await adminListUsers();
          setUsers(result.users || []);
        } catch (err: any) {
          console.error(err);
          setError(err.message || 'Error loading users');
        }
      }
      setLoading(false);
    })();
  }, []);

  const changeStatus = async (user: any, status: string) => {
    try {
      await adminUpdateUser({ userId: user.id, updates: { crmStatus: status } });
      setUsers(users.map(u => u.id === user.id ? { ...u, crmStatus: status } : u));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating user');
    }
  };

  const toggleStaff = async (user: any) => {
    const ok = confirm(`Toggle staff for ${user.email}?`);
    if (!ok) return;
    try {
      await adminUpdateUser({ userId: user.id, updates: { isStaff: !user.isStaff } });
      setUsers(users.map(u => u.id === user.id ? { ...u, isStaff: !u.isStaff } : u));
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

  const renderTable = (list: any[]) => (
    list.length === 0 ? (
      <p>No records.</p>
    ) : (
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2">Email</th>
            <th className="p-2">Name</th>
            <th className="p-2">Stage</th>
            <th className="p-2">Staff</th>
            <th className="p-2">Discount%</th>
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
              <td className="p-2">{user.isStaff ? 'Yes' : 'No'}</td>
              <td className="p-2">
                <input
                  type="number"
                  className="border p-1 w-16"
                  value={user.discount || 0}
                  onChange={(e) => updateDiscount(user, parseFloat(e.target.value) || 0)}
                />
              </td>
              <td className="p-2 flex gap-2">
                <Link className="btn-sm" href={`/admin/users/${user.id}`}>View</Link>
                <button className="btn-sm" onClick={() => toggleStaff(user)}>
                  {user.isStaff ? 'Revoke Staff' : 'Make Staff'}
                </button>
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

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to view this page.</p>;

  const clients = users.filter(u => (u.crmStatus || 'client') === 'client');
  const prospects = users.filter(u => u.crmStatus === 'prospect');
  const outreach = users.filter(u => u.crmStatus === 'outreach');

  const handleAddRecord = async (data: any) => {
    try {
      const id = crypto.randomUUID();
      await adminUpdateUser({ userId: id, updates: { ...data, crmStatus: activeTab } });
      setUsers([...users, { id, ...data, crmStatus: activeTab }]);
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
      {activeTab === 'client' && renderTable(clients)}
      {activeTab === 'prospect' && renderTable(prospects)}
      {activeTab === 'outreach' && renderTable(outreach)}
      {showForm && (
        <CRMRecordForm
          status={activeTab}
          onSave={handleAddRecord}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}