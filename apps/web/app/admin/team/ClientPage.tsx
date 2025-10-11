"use client";

import { useEffect, useMemo, useState } from 'react';
import { db, functions } from '@/lib/firebase';
import { ensureFirebase } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { adminListUsers, adminUpdateUser } from '@/lib/admin';
import { useRoleGate } from '@/hooks/useRoleGate';
import {
  ROLE_DEFINITIONS,
  extractUserRoles,
  isGodAdmin,
  type RoleKey,
  type UserRoles,
} from '@/lib/roles';
import {
  getCoverageStatusLabel,
  getCoverageStatusTone,
  parseInsuranceAssignmentDoc,
  parseInsurancePolicyDoc,
  type InsuranceCoverageStatus,
} from '@/lib/insurance';

interface User {
  id: string;
  email: string;
  fullName?: string;
  isStaff?: boolean;
  contractor?: boolean;
  disabled?: boolean;
  roles?: UserRoles;
  displayName?: string | null;
  contractorInfo?: { name?: string | null } | null;
}

interface CoverageEntry {
  policyId: string;
  policyName: string;
  status: InsuranceCoverageStatus;
  expiresAt: Date | null;
}

const coverageToneClass = (status: InsuranceCoverageStatus) => {
  const tone = getCoverageStatusTone(status);
  const mapping: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700',
    info: 'bg-blue-100 text-blue-700',
    danger: 'bg-rose-100 text-rose-700',
    muted: 'bg-slate-200 text-slate-700',
    default: 'bg-slate-100 text-slate-700',
  };
  return `inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
    mapping[tone] ?? mapping.default
  }`;
};

const formatCoverageExpiry = (value: Date | null) => {
  if (!value || Number.isNaN(value.getTime())) return '';
  return `Expires ${value.toLocaleDateString()}`;
};

const renderCoverage = (entries: CoverageEntry[]) => {
  if (entries.length === 0) {
    return <span className="text-gray-400">No cover recorded</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry) => (
        <div key={`${entry.policyId}-${entry.status}`} className="flex flex-col">
          <span className={coverageToneClass(entry.status)}>{getCoverageStatusLabel(entry.status)}</span>
          <span className="text-[10px] text-gray-500">
            {entry.policyName}
            {entry.expiresAt ? ` · ${formatCoverageExpiry(entry.expiresAt)}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function AdminTeamPage() {
  const { allowed, roles, loading: guardLoading } = useRoleGate('admin');
  const [users, setUsers] = useState<User[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'staff' | 'contractor' | 'applications'>('staff');
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', fullName: '', isStaff: false, contractor: false });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isEditingPanel, setIsEditingPanel] = useState(false);
  const [savingPanel, setSavingPanel] = useState(false);
  const [panelAction, setPanelAction] = useState<string | null>(null);
  const [panelForm, setPanelForm] = useState({
    fullName: '',
    displayName: '',
    contractor: false,
    roles: {} as UserRoles,
  });
  const [coverageMap, setCoverageMap] = useState<Map<string, CoverageEntry[]>>(new Map());

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) return;
      try {
        const res: any = await adminListUsers();
        const hydrated = (res.users || []).map((user: User) => {
          const docForRoles: Partial<User> & { id: string } = {
            ...user,
            id: user.id,
          };
          const roles = extractUserRoles({ ...docForRoles, uid: user.id });
          return {
            ...user,
            roles,
            isStaff: roles.admin === true || user.isStaff === true,
          };
        });
        setUsers(hydrated);
        const appSnap = await getDocs(collection(db, 'contractorApplications'));
        setApps(appSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
      }
    })();
  }, [allowed, guardLoading]);

  const sendReset = async (user: User) => {
    const fn = httpsCallable(functions, 'admin_sendPasswordReset');
    await fn({ email: user.email });
    alert('Reset link sent');
  };

  const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) || null, [users, selectedUserId]);

  useEffect(() => {
    if (!selectedUser) {
      setIsEditingPanel(false);
      setPanelForm({ fullName: '', displayName: '', contractor: false, roles: {} });
      return;
    }
    setPanelForm({
      fullName: selectedUser.fullName ?? '',
      displayName: selectedUser.displayName ?? '',
      contractor: Boolean(selectedUser.contractor),
      roles: { ...(selectedUser.roles || {}) },
    });
    setIsEditingPanel(false);
  }, [selectedUser]);

  if (guardLoading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this page.</p>;

  const closePanel = () => {
    if (savingPanel || panelAction) return;
    setSelectedUserId(null);
  };

  const handlePanelFieldChange = (key: 'fullName' | 'displayName', value: string) => {
    setPanelForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePanelContractorToggle = (checked: boolean) => {
    setPanelForm((prev) => ({ ...prev, contractor: checked }));
  };

  const handlePanelRoleToggle = (roleKey: RoleKey, checked: boolean) => {
    setPanelForm((prev) => {
      const nextRoles: UserRoles = { ...(prev.roles || {}) };
      if (checked) {
        nextRoles[roleKey] = true;
      } else {
        delete nextRoles[roleKey];
      }
      return { ...prev, roles: nextRoles };
    });
  };

  const toggleDisable = async (user: User) => {
    setPanelAction('disable');
    try {
      await adminUpdateUser({ userId: user.id, updates: { disabled: !user.disabled } });
      setUsers(users.map(u => u.id === user.id ? { ...u, disabled: !u.disabled } : u));
    } finally {
      setPanelAction(null);
    }
  };

  const deleteUser = async (user: User) => {
    if (!confirm(`Delete ${user.email}?`)) return;
    setPanelAction('delete');
    try {
      const fn = httpsCallable(functions, 'admin_deleteUser');
      await fn({ userId: user.id });
      setUsers(users.filter(u => u.id !== user.id));
      setSelectedUserId((current) => (current === user.id ? null : current));
    } finally {
      setPanelAction(null);
    }
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

  const resolveName = (user: User) => {
    if (typeof user.fullName === 'string' && user.fullName.trim().length > 0) {
      return user.fullName;
    }
    const profileName = user.contractorInfo?.name;
    if (typeof profileName === 'string' && profileName.trim().length > 0) {
      return profileName;
    }
    if (typeof user.displayName === 'string' && user.displayName.trim().length > 0) {
      return user.displayName;
    }
    return user.email;
  };

  const renderList = (list: User[]) => (
    list.length === 0 ? (
      <p>No records.</p>
    ) : (
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2">Email</th>
            <th className="p-2">Name</th>
            <th className="p-2">Insurance</th>
            <th className="p-2">Disabled</th>
            <th className="p-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map(user => (
            <tr key={user.id} className="border-t">
              <td className="p-2">{user.email}</td>
              <td className="p-2">{resolveName(user) || '-'}</td>
              <td className="p-2 text-xs text-gray-600">
                {renderCoverage(coverageMap.get(user.id) ?? [])}
              </td>
              <td className="p-2">{user.disabled ? 'Yes' : 'No'}</td>
              <td className="p-2 text-right">
                <button onClick={() => setSelectedUserId(user.id)} className="btn btn-sm">Manage</button>
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
      {activeTab === 'staff' && renderList(staffUsers)}
      {activeTab === 'contractor' && renderList(contractorUsers)}
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
      {selectedUser && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40" onClick={closePanel} aria-hidden="true" />
          <aside
            className="relative z-50 ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
          >
            <header className="flex items-start justify-between gap-2 border-b px-6 py-4">
              <div className="grid gap-1">
                <h2 className="text-lg font-semibold">{resolveName(selectedUser)}</h2>
                <p className="text-sm text-gray-500">{selectedUser.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {isEditingPanel ? (
                  <>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => {
                        if (savingPanel) return;
                        setIsEditingPanel(false);
                        setPanelForm({
                          fullName: selectedUser.fullName ?? '',
                          displayName: selectedUser.displayName ?? '',
                          contractor: Boolean(selectedUser.contractor),
                          roles: { ...(selectedUser.roles || {}) },
                        });
                      }}
                      disabled={savingPanel}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        if (!selectedUser) return;
                        setSavingPanel(true);
                        try {
                          const godLocked = isGodAdmin(selectedUser);
                          const nextRoles = godLocked
                            ? { ...(selectedUser.roles || {}), admin: true }
                            : { ...(panelForm.roles || {}) };
                          if (godLocked) {
                            nextRoles.admin = true;
                          }
                          const updates: Partial<User> & { roles: UserRoles } = {
                            fullName: panelForm.fullName,
                            displayName: panelForm.displayName,
                            contractor: panelForm.contractor,
                            roles: nextRoles,
                          };
                          await adminUpdateUser({ userId: selectedUser.id, updates });
                          setUsers((prev) =>
                            prev.map((u) =>
                              u.id === selectedUser.id
                                ? {
                                    ...u,
                                    ...updates,
                                    roles: updates.roles,
                                    contractor: updates.contractor,
                                    fullName: updates.fullName,
                                    displayName: updates.displayName,
                                    isStaff: updates.roles.admin === true,
                                  }
                                : u
                            )
                          );
                          setIsEditingPanel(false);
                        } catch (err) {
                          console.error(err);
                          alert('Failed to update user.');
                        } finally {
                          setSavingPanel(false);
                        }
                      }}
                      disabled={savingPanel}
                    >
                      Save
                    </button>
                  </>
                ) : (
                  <button className="btn btn-sm" onClick={() => setIsEditingPanel(true)}>
                    Edit
                  </button>
                )}
                <button className="btn btn-sm btn-outline" onClick={closePanel} disabled={savingPanel || Boolean(panelAction)}>
                  Close
                </button>
              </div>
            </header>
            <div className="grid flex-1 gap-6 overflow-y-auto px-6 py-4">
              <section className="grid gap-3">
                <h3 className="text-xs font-semibold uppercase text-gray-500">Profile</h3>
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Full name</span>
                  {isEditingPanel ? (
                    <input
                      className="input"
                      value={panelForm.fullName}
                      onChange={(e) => handlePanelFieldChange('fullName', e.target.value)}
                    />
                  ) : (
                    <p className="rounded border bg-gray-50 px-3 py-2 text-sm">{selectedUser.fullName || '—'}</p>
                  )}
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-gray-600">Display name</span>
                  {isEditingPanel ? (
                    <input
                      className="input"
                      value={panelForm.displayName}
                      onChange={(e) => handlePanelFieldChange('displayName', e.target.value)}
                    />
                  ) : (
                    <p className="rounded border bg-gray-50 px-3 py-2 text-sm">{selectedUser.displayName || '—'}</p>
                  )}
                </label>
              </section>
              <section className="grid gap-3">
                <h3 className="text-xs font-semibold uppercase text-gray-500">Account management</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                    {selectedUser.disabled ? 'Disabled' : 'Active'}
                  </span>
                  {selectedUser.contractor && (
                    <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700">Contractor</span>
                  )}
                  {selectedUser.roles?.admin && (
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">Admin</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-sm"
                    onClick={() => toggleDisable(selectedUser)}
                    disabled={panelAction === 'disable'}
                  >
                    {selectedUser.disabled ? 'Enable account' : 'Disable account'}
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={async () => {
                      setPanelAction('reset');
                      try {
                        await sendReset(selectedUser);
                      } finally {
                        setPanelAction(null);
                      }
                    }}
                    disabled={panelAction === 'reset'}
                  >
                    Send password reset
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => deleteUser(selectedUser)}
                    disabled={panelAction === 'delete' || isGodAdmin(selectedUser)}
                  >
                    Delete user
                  </button>
                </div>
              </section>
              <section className="grid gap-3">
                <h3 className="text-xs font-semibold uppercase text-gray-500">Permissions</h3>
                {isGodAdmin(selectedUser) && (
                  <p className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    This account is protected and must always retain admin access.
                  </p>
                )}
                <div className="grid gap-2">
                  {ROLE_DEFINITIONS.map((role) => {
                    const checked = isEditingPanel
                      ? Boolean(panelForm.roles?.[role.key])
                      : Boolean(selectedUser.roles?.[role.key]);
                    return (
                      <label key={role.key} className="flex items-start gap-3 rounded border px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          disabled={!isEditingPanel || isGodAdmin(selectedUser)}
                          onChange={(event) => handlePanelRoleToggle(role.key, event.target.checked)}
                        />
                        <span>
                          <span className="font-medium">{role.label}</span>
                          <span className="block text-xs text-gray-500">{role.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {isEditingPanel && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={panelForm.contractor}
                      onChange={(event) => handlePanelContractorToggle(event.target.checked)}
                    />
                    Contractor access
                  </label>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
  useEffect(() => {
    if (guardLoading || !allowed) return;
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) return;
        const [assignmentSnap, policySnap] = await Promise.all([
          getDocs(collection(db, 'insuranceAssignments')),
          getDocs(collection(db, 'insurancePolicies')),
        ]);
        const policyNames = new Map<string, string>();
        policySnap.docs.forEach((docSnap) => {
          const policy = parseInsurancePolicyDoc(docSnap.id, docSnap.data() as Record<string, unknown>);
          policyNames.set(docSnap.id, policy.name);
        });
        const map = new Map<string, CoverageEntry[]>();
        assignmentSnap.docs.forEach((docSnap) => {
          const assignment = parseInsuranceAssignmentDoc(docSnap.id, docSnap.data() as Record<string, unknown>);
          if (assignment.targetType !== 'user') return;
          const entries = map.get(assignment.targetId) ?? [];
          entries.push({
            policyId: assignment.policyId,
            policyName: policyNames.get(assignment.policyId) ?? assignment.policyId,
            status: assignment.status,
            expiresAt: assignment.expiresAt ?? null,
          });
          map.set(assignment.targetId, entries);
        });
        setCoverageMap(map);
      } catch (err) {
        console.error('Failed to load insurance coverage for team manager', err);
      }
    })();
  }, [allowed, guardLoading]);
