"use client";

import { useEffect, useState } from 'react';
import { auth, db, functions } from '@/lib/firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { extractUserRoles, hasRole } from '@/lib/roles';

/**
 * Admin Email Schedules
 *
 * Staff can define recurring outreach schedules targeting groups of leads. Each schedule
 * has a group, subject, body, schedule string (e.g. RRULE or cron), a rate per minute
 * to throttle sending, and an enabled flag. This page lists existing schedules and
 * provides a form to create new ones. Editing and deletion are also supported.
 */
export default function AdminEmailSchedulesPage() {
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [groupId, setGroupId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [schedule, setSchedule] = useState('every 1 day');
  const [rate, setRate] = useState('20');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState('');
  const [productId, setProductId] = useState('');
  const [purchaseMonth, setPurchaseMonth] = useState('');
  const [industry, setIndustry] = useState('');
  const [location, setLocation] = useState('');

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setCanManage(false); setLoading(false); return; }
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      const me = uSnap.data() as any;
      const roles = extractUserRoles(me);
      const allowed = hasRole(roles, ['admin', 'marketing']);
      setCanManage(allowed);
      if (allowed) {
        const grpSnap = await getDocs(collection(db, 'groups'));
        setGroups(grpSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const schedSnap = await getDocs(collection(db, 'emailSchedules'));
        setSchedules(schedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
  }, []);

  const createSchedule = async () => {
    if (!groupId || !subject.trim() || !body.trim() || !schedule.trim() || !rate.trim()) {
      alert('All fields are required');
      return;
    }
    try {
      const callable = httpsCallable(functions, 'emailSchedules_upsert');
      await callable({ groupId, subject: subject.trim(), body: body.trim(), schedule: schedule.trim(), ratePerMinute: Number(rate), enabled });
      const schedSnap = await getDocs(collection(db, 'emailSchedules'));
      setSchedules(schedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // Reset form
      setGroupId(''); setSubject(''); setBody(''); setSchedule('every 1 day'); setRate('20'); setEnabled(true);
      alert('Email schedule saved');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error saving schedule');
    }
  };

  const createCustomGroup = async () => {
    if (!groupName.trim()) {
      alert('Group name is required');
      return;
    }
    try {
      const callable = httpsCallable(functions, 'groups_createCustom');
      await callable({
        name: groupName.trim(),
        productId: productId || undefined,
        month: purchaseMonth ? Number(purchaseMonth) : undefined,
        industry: industry || undefined,
        location: location || undefined,
      });
      const grpSnap = await getDocs(collection(db, 'groups'));
      setGroups(grpSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setGroupName(''); setProductId(''); setPurchaseMonth(''); setIndustry(''); setLocation('');
      alert('Group created');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating group');
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      const callable = httpsCallable(functions, 'emailSchedules_delete');
      await callable({ id });
      setSchedules(schedules.filter((s) => s.id !== id));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error deleting schedule');
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!canManage) return <p>You do not have permission to manage email schedules.</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Manage Email Schedules</h1>
      {/* Custom group form */}
      <div className="card p-4 grid gap-2 max-w-lg">
        <h2 className="font-semibold">Create Custom Group</h2>
        <input className="input" placeholder="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
        <input className="input" placeholder="Product ID" value={productId} onChange={(e) => setProductId(e.target.value)} />
        <input className="input" placeholder="Purchase month (1-12)" value={purchaseMonth} onChange={(e) => setPurchaseMonth(e.target.value)} />
        <input className="input" placeholder="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
        <input className="input" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        <button className="btn w-fit" onClick={createCustomGroup}>Save Group</button>
      </div>
      {/* Create schedule form */}
      <div className="card p-4 grid gap-3 max-w-lg">
        <h2 className="font-semibold">Create Schedule</h2>
        <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Select group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name || g.id}</option>)}
        </select>
        <input type="text" className="input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className="input" rows={5} placeholder="Email body" value={body} onChange={(e) => setBody(e.target.value)} />
        <input type="text" className="input" placeholder="Schedule (e.g. every 1 day)" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        <input type="number" className="input" placeholder="Rate per minute" value={rate} onChange={(e) => setRate(e.target.value)} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
        <button className="btn w-fit" onClick={createSchedule}>Save Schedule</button>
      </div>
      {/* List schedules */}
      <div>
        <h2 className="font-semibold mb-2">Existing Schedules</h2>
        {schedules.length === 0 ? <p>No schedules.</p> : (
          <div className="grid gap-3">
            {schedules.map((sc) => (
              <div key={sc.id} className="card p-4 grid gap-1">
                <div className="flex justify-between items-center">
                  <h3 className="font-medium">{groups.find((g) => g.id === sc.groupId)?.name || sc.groupId}</h3>
                  <button className="text-sm text-red-600" onClick={() => deleteSchedule(sc.id)}>Delete</button>
                </div>
                <p className="text-xs text-gray-500">Subject: {sc.subject}</p>
                <p className="text-xs text-gray-500">Rate: {sc.ratePerMinute} emails/min</p>
                <p className="text-xs text-gray-500">Schedule: {sc.schedule}</p>
                <p className="text-xs text-gray-500">Enabled: {sc.enabled ? 'Yes' : 'No'}</p>
                <p className="text-xs text-gray-500">Next Send: {sc.nextSendAt?.toDate ? sc.nextSendAt.toDate().toLocaleString() : ''}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}