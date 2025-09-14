'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import PortalContainer from '@/components/PortalContainer';

interface SelectedItem {
  id: string;
  name: string;
  note: string;
}

export default function NewProject() {
  const [products, setProducts] = useState<any[]>([]);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [projectName, setProjectName] = useState('');
  const [customRequest, setCustomRequest] = useState('');
  const [productionPeriod, setProductionPeriod] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'products'));
      setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, []);

  const addProduct = (id: string) => {
    if (!id) return;
    const prod = products.find((p) => p.id === id);
    if (!prod) return;
    setSelected([...selected, { id: prod.id, name: prod.name, note: '' }]);
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
    const user = auth.currentUser;
    if (!user) {
      alert('You must be signed in');
      return;
    }
      await addDoc(collection(db, 'quoteRequests'), {
        userId: user.uid,
        projectName: projectName || null,
        items: selected.map((s) => ({ productId: s.id, note: s.note || null })),
        customRequest: customRequest || null,
        productionPeriod:
          productionPeriod === 'Specific date'
            ? productionDate || null
            : productionPeriod || null,
        createdAt: serverTimestamp(),
        status: 'pending',
      });
    router.push('/projects');
  };

  return (
    <PortalContainer>
      <div className="max-w-2xl mx-auto grid gap-4">
        <h1 className="text-xl font-semibold">Request a Quote</h1>
        <form onSubmit={submit} className="grid gap-4">
          <div>
            <label className="block mb-1">Project name</label>
            <input
              className="input w-full"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My project"
            />
          </div>
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
            <select
              className="input w-full"
              onChange={(e) => {
                addProduct(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="">Select a product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {selected.map((s, i) => (
            <div key={i} className="card p-4 grid gap-2">
              <div className="flex justify-between items-center">
                <div className="font-medium">{s.name}</div>
                <button
                  type="button"
                  className="text-sm text-red-600"
                  onClick={() => removeItem(i)}
                >
                  Remove
                </button>
              </div>
              <textarea
                className="input"
                placeholder="Notes or adjustments"
                value={s.note}
                onChange={(e) => updateNote(i, e.target.value)}
              />
            </div>
          ))}
          <textarea
            className="input"
            placeholder="Custom request details"
            value={customRequest}
            onChange={(e) => setCustomRequest(e.target.value)}
          />
          <button
            type="submit"
            className="btn"
            disabled={selected.length === 0 && !customRequest}
          >
            Submit Request
          </button>
        </form>
      </div>
    </PortalContainer>
  );
}
