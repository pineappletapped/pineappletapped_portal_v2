"use client";
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, doc, orderBy, query, onSnapshot } from 'firebase/firestore';

interface Step {
  id?: string;
  order: number;
  title: string;
  description: string;
  mediaUrl?: string;
  fields?: { key: string; label: string; type: string; required?: boolean }[];
  agreementText?: string;
}

export default function JoinTeamStepsAdmin() {
  const [steps, setSteps] = useState<Step[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'joinTeamSteps'), orderBy('order'));
    return onSnapshot(q, snap => {
      setSteps(snap.docs.map(d => ({ id: d.id, ...(d.data() as Step) })));
    });
  }, []);

  const addStep = async () => {
    const order = steps.length;
    await addDoc(collection(db, 'joinTeamSteps'), { order, title: 'New Step', description: '' });
  };

  const saveStep = async (s: Step) => {
    if (!s.id) return;
    const { id, ...data } = s;
    await updateDoc(doc(db, 'joinTeamSteps', id), data);
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Configure Join Team Steps</h1>
      <button className="btn w-fit" onClick={addStep}>Add Step</button>
      <div className="grid gap-6">
        {steps.map((s, idx) => (
          <div key={s.id || idx} className="card grid gap-2 p-4">
            <label className="text-sm font-medium">Title</label>
            <input className="input" value={s.title} onChange={e => setSteps(prev => prev.map(p => p.id===s.id?{...p,title:e.target.value}:p))} />
            <label className="text-sm font-medium">Description</label>
            <textarea className="input" value={s.description} onChange={e => setSteps(prev => prev.map(p => p.id===s.id?{...p,description:e.target.value}:p))} />
            <label className="text-sm font-medium">Media URL</label>
            <input className="input" value={s.mediaUrl||''} onChange={e => setSteps(prev => prev.map(p => p.id===s.id?{...p,mediaUrl:e.target.value}:p))} />
            {s.fields?.length ? (
              <div className="grid gap-2">
                <h3 className="font-semibold">Fields</h3>
                {s.fields.map((f, i) => (
                  <div key={f.key} className="grid gap-1">
                    <label className="text-sm">{f.key} label</label>
                    <input className="input" value={f.label} onChange={e => setSteps(prev => prev.map(p => p.id===s.id?{...p,fields:p.fields?.map((ff,j)=>j===i?{...ff,label:e.target.value}:ff)}:p))} />
                  </div>
                ))}
              </div>
            ) : null}
            {s.agreementText !== undefined && (
              <div className="grid gap-1">
                <label className="text-sm font-medium">Agreement Text</label>
                <textarea className="input" value={s.agreementText} onChange={e => setSteps(prev => prev.map(p => p.id===s.id?{...p,agreementText:e.target.value}:p))} />
              </div>
            )}
            <button className="btn btn-sm w-fit" onClick={() => saveStep(s)}>Save</button>
          </div>
        ))}
      </div>
    </div>
  );
}
