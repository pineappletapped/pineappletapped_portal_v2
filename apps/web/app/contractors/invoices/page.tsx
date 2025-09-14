"use client";

import { useEffect, useState } from 'react';
import { auth, db, storage } from '@/lib/firebase';
import { collection, query, where, getDocs, addDoc, doc, getDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

/**
 * Contractor Invoices
 *
 * Allows contractors to view their submitted invoices and upload new ones. An
 * invoice includes a PDF or document upload, amount, description, and must
 * be linked to a project. Admins will later be able to approve and pay
 * invoices via the admin finance dashboard.
 */
export default function ContractorInvoicesPage() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({
    projectId: '',
    amount: '',
    description: '',
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setLoading(false); return; }
      // Load invoices
      const invSnap = await getDocs(query(collection(db, 'invoices'), where('contractorId','==', user.uid)));
      setInvoices(invSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // Load projects (for simplicity show all projects in orgs user belongs to)
      // Fetch memberships
      const memSnap = await getDocs(query(collection(db,'memberships'), where('userId','==', user.uid)));
      const orgIds = memSnap.docs.map((d) => (d.data() as any).orgId);
      const projectsData: any[] = [];
      for (const orgId of orgIds) {
        const pSnap = await getDocs(query(collection(db,'projects'), where('orgId','==', orgId)));
        pSnap.docs.forEach((pDoc) => {
          projectsData.push({ id: pDoc.id, ...pDoc.data() });
        });
      }
      setProjects(projectsData);
      setLoading(false);
    })();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setForm((prev) => ({ ...prev, file }));
  };

  const submitInvoice = async () => {
    const user = auth.currentUser;
    if (!user) return alert('You must be signed in');
    if (!form.projectId) return alert('Please select a project');
    if (!form.amount) return alert('Please enter an amount');
    if (!form.file) return alert('Please attach the invoice file');
    setUploading(true);
    try {
      // Get project data to set orgId
      const pDoc = await getDoc(doc(db,'projects', form.projectId));
      const pData = pDoc.data() as any;
      const orgId = pData?.orgId;
      // Upload file to storage
      const ext = form.file.name.split('.').pop();
      const fileKey = `orgs/${orgId}/invoices/${user.uid}_${Date.now()}.${ext}`;
      const storageRef = ref(storage, fileKey);
      const uploadTask = uploadBytesResumable(storageRef, form.file);
      await uploadTask;
      const url = await getDownloadURL(storageRef);
      // Save invoice doc
      await addDoc(collection(db,'invoices'), {
        contractorId: user.uid,
        orgId,
        projectId: form.projectId,
        amount: parseFloat(form.amount),
        description: form.description,
        fileKey,
        url,
        status: 'submitted',
        createdAt: new Date().toISOString(),
      });
      // Reload invoices
      const invSnap = await getDocs(query(collection(db, 'invoices'), where('contractorId','==', user.uid)));
      setInvoices(invSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setForm({ projectId:'', amount:'', description:'', file: null });
      alert('Invoice submitted');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error submitting invoice');
    }
    setUploading(false);
  };

  if (loading) return <p>Loading…</p>;
  return (
    <div className="p-4 max-w-3xl mx-auto grid gap-6">
      <h1 className="text-xl font-semibold">Your Invoices</h1>
      {invoices.length === 0 ? <p>No invoices submitted.</p> : (
        <div className="grid gap-3">
          {invoices.map((inv) => (
            <div key={inv.id} className="card p-3 grid gap-1">
              <p className="font-medium">Amount: £{inv.amount?.toFixed ? inv.amount.toFixed(2) : inv.amount}</p>
              <p className="text-sm">Project: {projects.find((p) => p.id === inv.projectId)?.name || inv.projectId}</p>
              {inv.description && <p className="text-sm">{inv.description}</p>}
              <p className="text-sm">Status: {inv.status}</p>
              <a className="text-blue-600 underline text-sm" href={inv.url} target="_blank">View Invoice</a>
            </div>
          ))}
        </div>
      )}
      <div className="card p-4 grid gap-3">
          <h2 className="font-semibold mb-2">Submit New Invoice</h2>
          <select name="projectId" className="input" value={form.projectId} onChange={handleChange}>
            <option value="">Select project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input type="number" name="amount" className="input" placeholder="Amount (e.g. 150)" value={form.amount} onChange={handleChange} />
          <textarea name="description" className="input" placeholder="Description (optional)" value={form.description} onChange={handleChange} />
          <input type="file" accept=".pdf,.doc,.docx,.png,.jpg" onChange={handleFile} />
          <button className="btn" onClick={submitInvoice} disabled={uploading}>{uploading ? 'Uploading…' : 'Submit Invoice'}</button>
      </div>
    </div>
  );
}