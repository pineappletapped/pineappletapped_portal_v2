"use client";
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, orderBy, query, getDocs, serverTimestamp } from 'firebase/firestore';

type StepField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  profileFieldKey?: string | null;
};

interface Step {
  id: string;
  order: number;
  title: string;
  description: string;
  mediaUrl?: string;
  fields?: StepField[];
  agreementText?: string;
}

export default function JoinTeamPage() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [current, setCurrent] = useState(0);
  const [form, setForm] = useState<Record<string, string>>({});
  const [agree, setAgree] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    (async () => {
      const q = query(collection(db, 'joinTeamSteps'), orderBy('order'));
      const snap = await getDocs(q);
      const list: Step[] = snap.docs.map(d => {
        const data = d.data() as Omit<Step, 'id'>;
        return { id: d.id, ...data };
      });
      setSteps(list);
    })();
  }, []);

  const next = () => setCurrent(c => c + 1);
  const back = () => setCurrent(c => Math.max(0, c - 1));

  const submit = async () => {
    await addDoc(collection(db, 'contractorApplications'), {
      ...form,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    setSent(true);
  };

  if (sent) return <p>Thank you for your application. We&apos;ll be in touch!</p>;
  if (!steps.length) return <p>Loading…</p>;

  const step = steps[current];
  const isLast = current === steps.length - 1;

  return (
    <div className="max-w-xl mx-auto grid gap-4">
      <h1 className="text-xl font-semibold">Join Our Team</h1>
      <div className="card p-4 grid gap-4">
        <h2 className="text-lg font-semibold">{step.title}</h2>
        {step.mediaUrl && (
          <Image
            src={step.mediaUrl}
            alt={step.title}
            width={640}
            height={360}
            className="h-auto w-full max-h-48 rounded object-cover"
          />
        )}
        <p>{step.description}</p>
        {step.fields?.map(f => (
          f.type === 'textarea' ? (
            <textarea
              key={f.key}
              className="input"
              placeholder={f.label}
              required={f.required}
              value={form[f.key] || ''}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
            />
          ) : (
            <input
              key={f.key}
              type={f.type}
              className="input"
              placeholder={f.label}
              required={f.required}
              value={form[f.key] || ''}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
            />
          )
        ))}
        {step.agreementText && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} required />
            <span>{step.agreementText}</span>
          </label>
        )}
        <div className="flex justify-between">
          {current > 0 && <button className="btn btn-outline" onClick={back} type="button">Back</button>}
          {!isLast && <button className="btn" onClick={next} type="button">Next</button>}
          {isLast && <button className="btn" disabled={step.agreementText ? !agree : false} onClick={submit}>Submit</button>}
        </div>
      </div>
    </div>
  );
}
