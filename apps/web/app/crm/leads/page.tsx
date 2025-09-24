"use client";
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { fetchOrgDocs, fetchUserOrgIds } from '@/lib/crm';

/**
 * Leads page: allows creation of leads and viewing existing leads belonging to the
 * user's organisations. A lead has name, email, company and status. Only staff or
 * client admins can create leads. Client members can view but not modify.
 */
export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('new');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          setLeads([]);
          return;
        }

        const loadedLeads = await fetchOrgDocs(db, 'leads', orgIds);
        setLeads(loadedLeads);
      } catch (err) {
        console.error('Failed to load leads', err);
        if (!cancelled) {
          setError('Failed to load leads. Please try again.');
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
        console.error('Failed to initialise CRM leads view', err);
        if (!cancelled) {
          setError('Failed to initialise CRM. Please refresh the page.');
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

  const addLead = async (e: React.FormEvent) => {
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
        throw new Error('You must be signed in to add leads.');
      }

      const orgIds = orgIdsRef.current.length
        ? orgIdsRef.current
        : await fetchUserOrgIds(db, user.uid);
      if (orgIds.length === 0) {
        throw new Error('No organisation membership found for your account.');
      }

      const orgId = orgIds[0];
      if (!orgId) {
        throw new Error('Unable to determine an organisation for the new lead.');
      }

      await addDoc(collection(db, 'leads'), {
        orgId,
        name,
        email,
        company,
        status,
        createdAt: serverTimestamp(),
      });

      setName('');
      setEmail('');
      setCompany('');
      setStatus('new');

      const refreshed = await fetchOrgDocs(db, 'leads', orgIds);
      setLeads(refreshed);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Error adding lead');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Leads</h1>
      {/* Add lead form */}
      <form onSubmit={addLead} className="card p-4 grid gap-2 max-w-md">
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <input
          className="input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option>
          <option value="opportunity">Opportunity</option>
        </select>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? 'Saving…' : 'Add Lead'}
        </button>
      </form>
      {/* Leads list */}
      <div className="card p-4">
        <h2 className="font-semibold mb-2">Existing Leads</h2>
        {leads.length === 0 ? <p>No leads.</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t">
                  <td>{l.name}</td>
                  <td>{l.email}</td>
                  <td>{l.company}</td>
                  <td>{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}