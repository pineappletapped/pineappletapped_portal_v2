"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore';

export default function NewExpensePage() {
  const [loading, setLoading] = useState(true);
  const [isStaff, setIsStaff] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({
    projectId: '',
    amount: '',
    description: '',
    date: '',
    paymentMethod: '',
  });

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      const uSnap = await getDocs(
        query(collection(db, 'users'), where('__name__', '==', user.uid))
      );
      const me = uSnap.docs[0]?.data();
      const staff = me?.isStaff === true;
      setIsStaff(staff);
      if (staff) {
        const projSnap = await getDocs(collection(db, 'projects'));
        setProjects(projSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      setLoading(false);
    })();
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const saveExpense = async () => {
    if (!form.amount) return alert('Amount required');
    try {
      await addDoc(collection(db, 'expenses'), {
        projectId: form.projectId || null,
        amount: parseFloat(form.amount),
        description: form.description || '',
        date: form.date || new Date().toISOString(),
        paymentMethod: form.paymentMethod || 'unknown',
        createdAt: new Date().toISOString(),
      });
      alert('Expense logged');
      setForm({ projectId: '', amount: '', description: '', date: '', paymentMethod: '' });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error logging expense');
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have access to this page.</p>;

  return (
    <div className="p-4 grid gap-4 max-w-xl">
      <h1 className="text-xl font-semibold">Log Expense</h1>
      <select
        name="projectId"
        className="input"
        value={form.projectId}
        onChange={handleChange}
      >
        <option value="">General business expense</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        name="amount"
        className="input"
        placeholder="Amount"
        value={form.amount}
        onChange={handleChange}
      />
      <textarea
        name="description"
        className="input"
        placeholder="Description"
        value={form.description}
        onChange={handleChange}
      />
      <input
        type="date"
        name="date"
        className="input"
        value={form.date}
        onChange={handleChange}
      />
      <select
        name="paymentMethod"
        className="input"
        value={form.paymentMethod}
        onChange={handleChange}
      >
        <option value="">Payment method</option>
        <option value="card">Card</option>
        <option value="cash">Cash</option>
        <option value="bank">Bank Transfer</option>
        <option value="other">Other</option>
      </select>
      <div className="flex gap-2">
        <button className="btn" onClick={saveExpense}>
          Save Expense
        </button>
        <Link href="/admin/finance" className="btn-outline">
          Cancel
        </Link>
      </div>
    </div>
  );
}
