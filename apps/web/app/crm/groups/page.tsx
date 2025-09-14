"use client";
import { useEffect, useState } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

/**
 * Groups page: allows creation of contact groups and assigning leads into groups for
 * mass outreach. Only staff or client admins can modify groups. Members can view.
 */
export default function GroupsPage() {
  const [groups, setGroups] = useState<any[]>([]);
  const [groupName, setGroupName] = useState('');
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Mass outreach state
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      // find org memberships
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const orgIds = memSnap.docs.map((m) => (m.data() as any).orgId);
      if (orgIds.length > 0) {
        const gq = query(collection(db, 'groups'), where('orgId', 'in', orgIds));
        const gs = await getDocs(gq);
        setGroups(gs.docs.map((d) => ({ id: d.id, ...d.data() })));
        const lq = query(collection(db, 'leads'), where('orgId', 'in', orgIds));
        const ls = await getDocs(lq);
        setLeads(ls.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
  }, []);

  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    try {
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const orgId = memSnap.docs[0]?.data()?.orgId;
      await addDoc(collection(db, 'groups'), {
        orgId,
        name: groupName,
        leadIds: [],
        createdAt: serverTimestamp(),
      });
      setGroupName('');
      const gq = query(collection(db, 'groups'), where('orgId', '==', orgId));
      const gs = await getDocs(gq);
      setGroups(gs.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error adding group');
    } finally {
      setSaving(false);
    }
  };

  const addLeadToGroup = async (groupId: string) => {
    if (!selectedLeadId) return;
    try {
      await updateDoc(doc(db, 'groups', groupId), {
        leadIds: arrayUnion(selectedLeadId),
      });
      // refresh groups
      const user = auth.currentUser;
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user?.uid)));
      const orgId = memSnap.docs[0]?.data()?.orgId;
      const gq = query(collection(db, 'groups'), where('orgId', '==', orgId));
      const gs = await getDocs(gq);
      setGroups(gs.docs.map((d) => ({ id: d.id, ...d.data() })));
      alert('Lead added');
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error adding lead to group');
    }
  };

  // Send mass email to a group
  const sendEmailToGroup = async (groupId: string) => {
    if (!emailSubject || !emailBody) {
      alert('Please provide a subject and message body');
      return;
    }
    setSending(true);
    try {
      const callable = httpsCallable(functions, 'sendGroupEmail');
      const result = await callable({ groupId, subject: emailSubject, body: emailBody });
      alert(`Sent to ${(result.data as any).count} leads`);
      setEmailSubject('');
      setEmailBody('');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error sending group email');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Groups</h1>
      <form onSubmit={addGroup} className="card p-4 grid gap-2 max-w-md">
        <input
          className="input"
          placeholder="Group name"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          required
        />
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : 'Create Group'}
        </button>
      </form>
      <div className="card p-4">
        <h2 className="font-semibold mb-2">Existing Groups</h2>
        {groups.length === 0 ? <p>No groups.</p> : groups.map((g) => (
          <div key={g.id} className="border-t py-2">
            <div className="flex justify-between items-center mb-1">
              <span className="font-medium">{g.name}</span>
              <div className="flex gap-2">
                <select className="input" value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)}>
                  <option value="">Select lead</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <button className="btn-sm" onClick={() => addLeadToGroup(g.id)}>Add Lead</button>
              </div>
            </div>
            <p className="text-xs text-gray-600">{g.leadIds?.length || 0} leads</p>
            {/* Mass email form */}
            <div className="mt-2 grid gap-2">
              <input
                className="input"
                placeholder="Email subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
              <textarea
                className="input"
                placeholder="Email body"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
              />
              <button className="btn-sm" disabled={sending} onClick={() => sendEmailToGroup(g.id)}>
                {sending ? 'Sending…' : 'Send Email to Group'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}