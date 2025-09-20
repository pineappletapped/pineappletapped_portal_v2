"use client";

import { useEffect, useState } from 'react';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { adminListUsers, adminUpdateUser } from '@/lib/admin';
import { useRoleGate } from '@/hooks/useRoleGate';
import { extractUserRoles, type UserRoles } from '@/lib/roles';

interface User {
  id: string;
  email: string;
  fullName?: string;
  isStaff?: boolean;
  contractor?: boolean;
  disabled?: boolean;
  roles?: UserRoles;
}

export default function AdminTeamPage() {
  const { allowed, roles, loading: guardLoading } = useRoleGate('admin');
  const [users, setUsers] = useState<User[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'staff' | 'contractor' | 'applications'>('staff');
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', fullName: '', isStaff: false, contractor: false });

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) return;
      try {
        const res: any = await adminListUsers();
        const hydrated = (res.users || []).map((user: User) => ({
          ...user,
          roles: extractUserRoles(user),
          isStaff: extractUserRoles(user).admin ?? user.isStaff,
        }));
        setUsers(hydrated);
        const appSnap = await getDocs(collection(db, 'contractorApplications'));
        setApps(appSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
      }
    })();
  }, [allowed, guardLoading]);

  if (guardLoading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this page.</p>;

  const sendReset = async (user: User) => {
    const fn = httpsCallable(functions, 'admin_sendPasswordReset');
    await fn({ email: user.email });
    alert('Reset link sent');
  };

  const toggleDisable = async (user: User) => {
    await adminUpdateUser({ userId: user.id, updates: { disabled: !user.disabled } });
    setUsers(users.map(u => u.id === user.id ? { ...u, disabled: !u.disabled } : u));
  };

  const toggleStaff = async (user: User) => {
    const next = !(user.roles?.admin);
    const updatedRoles: UserRoles = { ...(user.roles || {}) };
    if (next) {
      updatedRoles.admin = true;
    } else {
      delete updatedRoles.admin;
    }
    await adminUpdateUser({ userId: user.id, updates: { roles: updatedRoles } });
    setUsers(users.map(u => u.id === user.id ? { ...u, roles: updatedRoles, isStaff: next } : u));
  };

  const toggleContractor = async (user: User) => {
    await adminUpdateUser({ userId: user.id, updates: { contractor: !user.contractor } });
    setUsers(users.map(u => u.id === user.id ? { ...u, contractor: !u.contractor } : u));
  };

  const deleteUser = async (user: User) => {
    if (!confirm(`Delete ${user.email}?`)) return;
    const fn = httpsCallable(functions, 'admin_deleteUser');
    await fn({ userId: user.id });
    setUsers(users.filter(u => u.id !== user.id));
  };

  const createUser = async () => {
    const fn = httpsCallable(functions, 'admin_createUser');
    const payload = {
      ...newUser,
      roles: newUser.isStaff ? { admin: true } : {},
    };
    const res: any = await fn(payload);
    const roleData: UserRoles = newUser.isStaff ? { admin: true } : {};
    setUsers([
      ...users,
      {
        id: res.data.uid,
        email: newUser.email,
        fullName: newUser.fullName,
        isStaff: newUser.isStaff,
        contractor: newUser.contractor,
        disabled: false,
        roles: roleData,
      },
    ]);
    setShowCreate(false);
    setNewUser({ email: '', password: '', fullName: '', isStaff: false, contractor: false });
  };

  const approveApp = async (app: any) => {
    const fn = httpsCallable(functions, 'admin_createUser');
    const res: any = await fn({ email: app.email, password: 'changeme123', fullName: app.name, contractor: true });
    await httpsCallable(functions, 'admin_sendPasswordReset')({ email: app.email });
    await updateDoc(doc(db, 'contractorApplications', app.id), { status: 'approved', userId: res.data.uid });
    setApps(apps.filter(a => a.id !== app.id));
    setUsers([...users, { id: res.data.uid, email: app.email, fullName: app.name, contractor: true, disabled: false }]);
  };

  const rejectApp = async (app: any) => {
    await updateDoc(doc(db, 'contractorApplications', app.id), { status: 'rejected' });
    setApps(apps.filter(a => a.id !== app.id));
  };

  const staffUsers = users.filter(u => u.roles?.admin);
  const contractorUsers = users.filter(u => u.contractor);

  const renderList = (list: User[], showStaff: boolean, showContractor: boolean) => (
    list.length === 0 ? (
      <p>No records.</p>
    ) : (
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2">Email</th>
            <th className="p-2">Name</th>
            <th className="p-2">Disabled</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map(user => (
            <tr key={user.id} className="border-t">
              <td className="p-2">{user.email}</td>
              <td className="p-2">{user.fullName || '-'}</td>
              <td className="p-2">{user.disabled ? 'Yes' : 'No'}</td>
              <td className="p-2 flex gap-2 flex-wrap">
                <button onClick={() => sendReset(user)} className="btn btn-sm">Reset</button>
                <button onClick={() => toggleDisable(user)} className="btn btn-sm">{user.disabled ? 'Enable' : 'Disable'}</button>
                {showStaff && <button onClick={() => toggleStaff(user)} className="btn btn-sm">{user.isStaff ? 'Unstaff' : 'Staff'}</button>}
                {showContractor && <button onClick={() => toggleContractor(user)} className="btn btn-sm">{user.contractor ? 'Unflag' : 'Contractor'}</button>}
                <button onClick={() => deleteUser(user)} className="btn btn-sm btn-outline">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  );

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Manage Team</h1>
      <div className="flex gap-2">
        <button className={`btn btn-sm ${activeTab === 'staff' ? 'btn-outline' : ''}`} onClick={() => setActiveTab('staff')}>Staff</button>
        <button className={`btn btn-sm ${activeTab === 'contractor' ? 'btn-outline' : ''}`} onClick={() => setActiveTab('contractor')}>Contractors</button>
        <button className={`btn btn-sm ${activeTab === 'applications' ? 'btn-outline' : ''}`} onClick={() => setActiveTab('applications')}>Applications</button>
        <button className="btn btn-sm ml-auto" onClick={() => setShowCreate(!showCreate)}>Create User</button>
      </div>
      {showCreate && (
        <div className="border p-4 rounded grid gap-2">
          <input className="input" placeholder="Email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} />
          <input className="input" placeholder="Password" type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
          <input className="input" placeholder="Full name" value={newUser.fullName} onChange={e => setNewUser({ ...newUser, fullName: e.target.value })} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={newUser.isStaff} onChange={e => setNewUser({ ...newUser, isStaff: e.target.checked })} />Staff</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={newUser.contractor} onChange={e => setNewUser({ ...newUser, contractor: e.target.checked })} />Contractor</label>
          <button className="btn btn-sm" onClick={createUser}>Save</button>
        </div>
      )}
      {activeTab === 'staff' && renderList(staffUsers, true, false)}
      {activeTab === 'contractor' && renderList(contractorUsers, false, true)}
      {activeTab === 'applications' && (
        apps.length === 0 ? (
          <p>No applications.</p>
        ) : (
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Email</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {apps.map(app => (
                <tr key={app.id} className="border-t">
                  <td className="p-2">{app.name}</td>
                  <td className="p-2">{app.email}</td>
                  <td className="p-2 flex gap-2">
                    <button onClick={() => approveApp(app)} className="btn btn-sm">Approve</button>
                    <button onClick={() => rejectApp(app)} className="btn btn-sm btn-outline">Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
