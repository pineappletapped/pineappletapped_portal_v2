"use client";

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { getProductKit } from '@/lib/equipment';
import { useLeadSourceTag } from '@/hooks/useLeadSourceTag';

interface SelectedItem {
  id: string;
  name: string;
  note: string;
  rental?: number;
}

export default function RequestQuotePage() {
  const { value: leadSource } = useLeadSourceTag(null);
  const [products, setProducts] = useState<any[]>([]);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [projectName, setProjectName] = useState('');
  const [customRequest, setCustomRequest] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [productionPeriod, setProductionPeriod] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'products'));
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); 
    })();
  }, []);

  const addProduct = async (id: string) => {
    if (!id) return;
    const prod = products.find((p) => p.id === id);
    if (!prod) return;
    let rental = 0;
    try {
      const kit = await getProductKit(id);
      rental = kit
        .flatMap((g) => g.items)
        .reduce((sum, i) => sum + (i.rentalPrice || 0), 0);
    } catch {}
    setSelected([...selected, { id: prod.id, name: prod.name, note: '', rental }]);
  };

  const updateNote = (idx: number, note: string) => {
    const copy = [...selected];
    copy[idx].note = note;
    setSelected(copy);
  };

  const removeItem = (idx: number) => {
    setSelected(selected.filter((_, i) => i !== idx));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const callable = httpsCallable(functions, 'quote_request_public');
    setStatus('sending');
    try {
      await callable({
        name,
        email,
        company,
        projectName: projectName || null,
        items: selected.map((s) => ({ productId: s.id, note: s.note || null })),
        customRequest: customRequest || null,
        productionPeriod:
          productionPeriod === 'Specific date'
            ? productionDate || null
            : productionPeriod || null,
        leadSource,
      });
      setStatus('sent');
      setName('');
      setEmail('');
      setCompany('');
      setProjectName('');
      setCustomRequest('');
      setProductionPeriod('');
      setProductionDate('');
      setSelected([]);
    } catch (err) {
      console.error(err);
      alert('Failed to submit request');
      setStatus('idle');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4">
      <div className="max-w-3xl mx-auto py-12 grid gap-8">
        <h1 className="text-3xl font-bold text-center">Request a Quote</h1>
        <form onSubmit={submit} className="grid gap-4 bg-white/70 backdrop-blur p-6 rounded shadow">
        <div className="grid gap-2 md:grid-cols-2">
          <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <input className="input" placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} />
        <input className="input" placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
        <div>
          <label className="block mb-1">Production period</label>
          <select
            className="input w-full"
            value={productionPeriod}
            onChange={(e) => setProductionPeriod(e.target.value)}
          >
            <option value="">Select timeframe</option>
            <option>Within 1 week</option>
            <option>Within 1 month</option>
            <option>Within 3 months</option>
            <option>Within 6 months</option>
            <option>Specific date</option>
          </select>
          {productionPeriod === 'Specific date' && (
            <input
              type="date"
              className="input w-full mt-2"
              value={productionDate}
              onChange={(e) => setProductionDate(e.target.value)}
              required
            />
          )}
        </div>
        <div>
          <label className="block mb-1">Add Product</label>
          <select className="input w-full" onChange={(e) => { addProduct(e.target.value); e.target.value = ''; }}>
            <option value="">Select a product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {selected.map((s, i) => (
          <div key={i} className="card p-4 grid gap-2">
            <div className="flex justify-between items-center">
              <div className="font-medium">
                {s.name}
                {typeof s.rental === 'number' && s.rental > 0 && (
                  <span className="ml-2 text-xs text-gray-600">
                    Rental £{s.rental.toFixed(2)}
                  </span>
                )}
              </div>
              <button type="button" className="text-sm text-red-600" onClick={() => removeItem(i)}>Remove</button>
            </div>
            <textarea className="input" placeholder="Notes or adjustments" value={s.note} onChange={(e) => updateNote(i, e.target.value)} />
          </div>
        ))}
        <textarea className="input" placeholder="Custom request details" value={customRequest} onChange={(e) => setCustomRequest(e.target.value)} />
        <button type="submit" className="btn" disabled={status === 'sending'}>
          {status === 'sending' ? 'Submitting…' : status === 'sent' ? 'Submitted!' : 'Submit Request'}
        </button>
      </form>
    </div>
    </div>
  );
}
