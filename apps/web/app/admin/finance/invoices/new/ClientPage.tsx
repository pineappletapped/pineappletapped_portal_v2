"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore';
import { getProducts } from '@/lib/products';
import { useRoleGate } from '@/hooks/useRoleGate';

interface LineItem {
  description: string;
  amount: string;
  productId: string;
}

export default function NewInvoicePage() {
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({
    orgId: '',
    projectId: '',
    dueDate: '',
    items: [{ description: '', amount: '', productId: '' }] as LineItem[],
  });
  const { allowed, loading: guardLoading } = useRoleGate(['admin', 'finance']);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      const orgSnap = await getDocs(collection(db, 'orgs'));
      setOrgs(orgSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      const prodList = await getProducts();
      setProducts(prodList);
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  useEffect(() => {
    (async () => {
      if (!allowed) return;
      if (!form.orgId) {
        setProjects([]);
        return;
      }
      const pSnap = await getDocs(
        query(collection(db, 'projects'), where('orgId', '==', form.orgId))
      );
      setProjects(pSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [allowed, form.orgId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (
    idx: number,
    field: keyof LineItem,
    value: string
  ) => {
    setForm((prev) => {
      const items = [...prev.items];
      const updated = { ...items[idx], [field]: value };
      if (field === 'productId') {
        updated.description =
          products.find((p) => p.id === value)?.name || items[idx].description;
      }
      items[idx] = updated;
      return { ...prev, items };
    });
  };

  const addItem = () =>
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, { description: '', amount: '', productId: '' }],
    }));

  const removeItem = (idx: number) =>
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));

  const total = form.items.reduce(
    (sum, i) => sum + parseFloat(i.amount || '0'),
    0
  );

  const saveInvoice = async () => {
    if (!form.orgId || form.items.length === 0)
      return alert('Organisation and at least one line item required');
    try {
      await addDoc(collection(db, 'clientInvoices'), {
        orgId: form.orgId,
        projectId: form.projectId || null,
        dueDate: form.dueDate || null,
        items: form.items.map((i) => ({
          description: i.description,
          amount: parseFloat(i.amount),
          productId: i.productId || null,
        })),
        total,
        status: 'unpaid',
        createdAt: new Date().toISOString(),
      });
      alert('Invoice created');
      setForm({
        orgId: '',
        projectId: '',
        dueDate: '',
        items: [{ description: '', amount: '', productId: '' }],
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating invoice');
    }
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have access to this page.</p>;

  return (
    <div className="p-4 grid gap-4 max-w-2xl">
      <h1 className="text-xl font-semibold">Create Invoice</h1>
      <select
        name="orgId"
        className="input"
        value={form.orgId}
        onChange={handleChange}
      >
        <option value="">Select organisation</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {form.orgId && (
        <select
          name="projectId"
          className="input"
          value={form.projectId}
          onChange={handleChange}
        >
          <option value="">No specific project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <input
        type="date"
        name="dueDate"
        className="input"
        value={form.dueDate}
        onChange={handleChange}
      />
      <div className="grid gap-2">
        {form.items.map((item, idx) => (
          <div key={idx} className="border rounded p-2 grid gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1"
                placeholder="Description"
                value={item.description}
                onChange={(e) =>
                  handleItemChange(idx, 'description', e.target.value)
                }
              />
              <input
                type="number"
                className="input w-32"
                placeholder="Amount"
                value={item.amount}
                onChange={(e) => handleItemChange(idx, 'amount', e.target.value)}
              />
            </div>
            <select
              className="input"
              value={item.productId}
              onChange={(e) => handleItemChange(idx, 'productId', e.target.value)}
            >
              <option value="">Custom line item</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {form.items.length > 1 && (
              <button
                className="btn-outline btn-sm self-end"
                onClick={() => removeItem(idx)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="btn-outline btn-sm" onClick={addItem}>
        Add Line Item
      </button>
      <p className="font-semibold text-right">Total: £{total.toFixed(2)}</p>
      <div className="flex gap-2">
        <button className="btn" onClick={saveInvoice}>
          Save Invoice
        </button>
        <Link href="/admin/finance" className="btn-outline">
          Cancel
        </Link>
      </div>
    </div>
  );
}
