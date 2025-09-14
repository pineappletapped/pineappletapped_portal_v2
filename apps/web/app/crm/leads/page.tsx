"use client";
import { useEffect, useState } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';

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
        const qLeads = query(collection(db, 'leads'), where('orgId', 'in', orgIds));
        const ls = await getDocs(qLeads);
        setLeads(ls.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
  }, []);

  const addLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;
    setSaving(true);
    try {
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
      const orgId = memSnap.docs[0]?.data()?.orgId;
      if (!orgId) throw new Error('No organisation');
      await addDoc(collection(db, 'leads'), {
        orgId,
        name,
        email,
        company,
        status,
        createdAt: serverTimestamp(),
      });
      setName(''); setEmail(''); setCompany(''); setStatus('new');
      // reload leads
      const qLeads = query(collection(db, 'leads'), where('orgId', '==', orgId));
      const ls = await getDocs(qLeads);
      setLeads(ls.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err:any) {
      console.error(err);
      alert(err.message || 'Error adding lead');
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