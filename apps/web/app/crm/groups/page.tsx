"use client";
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { fetchOrgDocs, fetchUserOrgIds } from '@/lib/crm';

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
  const [error, setError] = useState<string | null>(null);

  // Mass outreach state
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sending, setSending] = useState(false);
  const orgIdsRef = useRef<string[]>([]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const handleUserChange = async (user: User | null, db: any) => {
      if (cancelled) {
        return;
      }

      if (!user) {
        orgIdsRef.current = [];
        setGroups([]);
        setLeads([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const orgIds = await fetchUserOrgIds(db, user.uid);
        orgIdsRef.current = orgIds;
        if (orgIds.length === 0) {
          setGroups([]);
          setLeads([]);
          return;
        }

        const [loadedGroups, loadedLeads] = await Promise.all([
          fetchOrgDocs(db, 'groups', orgIds),
          fetchOrgDocs(db, 'leads', orgIds),
        ]);
        setGroups(loadedGroups);
        setLeads(loadedLeads);
      } catch (err) {
        console.error('Failed to load CRM groups', err);
        if (!cancelled) {
          setError('Failed to load groups. Please try again.');
          setGroups([]);
          setLeads([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || !db) {
          throw new Error('Firebase auth or database is unavailable.');
        }

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== 'function') {
          throw new Error('Firebase auth listener helper is unavailable.');
        }

        unsubscribe = onAuthStateChanged(auth, (user: User | null) => handleUserChange(user, db));
      } catch (err) {
        console.error('Failed to initialise CRM groups view', err);
        if (!cancelled) {
          setError('Failed to initialise CRM. Please refresh the page.');
          setGroups([]);
          setLeads([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const { auth, db } = await ensureFirebase();
      if (!auth || !db) {
        throw new Error('Firebase auth or database is unavailable.');
      }

      const user: User | null = auth.currentUser;
      if (!user) {
        throw new Error('You must be signed in to create groups.');
      }

      const orgIds = orgIdsRef.current.length
        ? orgIdsRef.current
        : await fetchUserOrgIds(db, user.uid);
      if (orgIds.length === 0) {
        throw new Error('No organisation membership found for your account.');
      }

      const orgId = orgIds[0];
      if (!orgId) {
        throw new Error('Unable to determine an organisation for the new group.');
      }

      await addDoc(collection(db, 'groups'), {
        orgId,
        name: groupName,
        leadIds: [],
        createdAt: serverTimestamp(),
      });

      setGroupName('');

      const refreshed = await fetchOrgDocs(db, 'groups', orgIds);
      setGroups(refreshed);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Error adding group');
    } finally {
      setSaving(false);
    }
  };

  const addLeadToGroup = async (groupId: string) => {
    if (!selectedLeadId) {
      return;
    }

    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error('Firebase database is unavailable.');
      }

      await updateDoc(doc(db, 'groups', groupId), {
        leadIds: arrayUnion(selectedLeadId),
      });

      const orgIds = orgIdsRef.current;
      if (orgIds.length > 0) {
        const refreshed = await fetchOrgDocs(db, 'groups', orgIds);
        setGroups(refreshed);
      }

      alert('Lead added');
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Error adding lead to group');
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
      const { functions } = await ensureFirebase();
      if (!functions) {
        throw new Error('Email service is unavailable.');
      }

      const callable = httpsCallable(functions, 'sendGroupEmail');
      const result = await callable({ groupId, subject: emailSubject, body: emailBody });
      alert(`Sent to ${(result.data as any).count} leads`);
      setEmailSubject('');
      setEmailBody('');
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Error sending group email');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Groups</h1>
      <form onSubmit={addGroup} className="card p-4 grid gap-2 max-w-md">
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
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