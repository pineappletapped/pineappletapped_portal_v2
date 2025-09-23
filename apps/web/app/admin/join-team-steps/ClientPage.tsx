"use client";
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, doc, orderBy, query, onSnapshot } from 'firebase/firestore';

type StepField = { key: string; label: string; type: string; required?: boolean };

interface Step {
  id?: string;
  order: number;
  title: string;
  description: string;
  mediaUrl?: string;
  fields?: StepField[];
  agreementText?: string;
}

const FIELD_TYPES: { value: StepField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'url', label: 'URL' },
];

export default function JoinTeamStepsAdmin() {
  const [steps, setSteps] = useState<Step[]>([]);
  useEffect(() => {
    const q = query(collection(db, 'joinTeamSteps'), orderBy('order'));
    return onSnapshot(q, snap => {
      setSteps(
        snap.docs.map(d => {
          const data = d.data() as Step;
          return { id: d.id, ...data, fields: data.fields ?? [] };
        }),
      );
    });
  }, []);

  const addStep = async () => {
    const order = steps.length;
    await addDoc(collection(db, 'joinTeamSteps'), {
      order,
      title: 'New Step',
      description: '',
      fields: [],
    });
  };

  const updateStepState = (id: string | undefined, updater: (step: Step) => Step) => {
    if (!id) return;
    setSteps(prev => prev.map(step => (step.id === id ? updater(step) : step)));
  };

  const updateStepValue = <K extends keyof Step>(id: string | undefined, key: K, value: Step[K]) => {
    updateStepState(id, step => ({ ...step, [key]: value }));
  };

  const ensureUniqueFieldKey = (fields: StepField[] = []) => {
    const used = new Set(fields.map(field => field.key));
    let counter = fields.length + 1;
    let candidate = `field${counter}`;
    while (used.has(candidate)) {
      counter += 1;
      candidate = `field${counter}`;
    }
    return candidate;
  };

  const addField = (id: string | undefined) => {
    if (!id) return;
    updateStepState(id, step => {
      const fields = step.fields ?? [];
      const nextKey = ensureUniqueFieldKey(fields);
      return {
        ...step,
        fields: [...fields, { key: nextKey, label: 'New field', type: 'text', required: false }],
      };
    });
  };

  const updateField = (id: string | undefined, index: number, updates: Partial<StepField>) => {
    if (!id) return;
    updateStepState(id, step => {
      const fields = step.fields ?? [];
      const nextFields = fields.map((field, idx) => (idx === index ? { ...field, ...updates } : field));
      return { ...step, fields: nextFields };
    });
  };

  const removeField = (id: string | undefined, index: number) => {
    if (!id) return;
    updateStepState(id, step => {
      const fields = step.fields ?? [];
      return { ...step, fields: fields.filter((_, idx) => idx !== index) };
    });
  };

  const saveStep = async (s: Step) => {
    if (!s.id) return;
    const { id, ...data } = s;
    await updateDoc(doc(db, 'joinTeamSteps', id), {
      ...data,
      fields: data.fields ?? [],
    });
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Configure Join Team Steps</h1>
      <button className="btn w-fit" onClick={addStep}>Add Step</button>
      <div className="grid gap-6">
        {steps.map((s, idx) => (
          <div key={s.id || idx} className="card grid gap-3 p-4">
            <div className="grid gap-1">
              <label className="text-sm font-medium" htmlFor={`title-${s.id}`}>Title</label>
              <input
                id={`title-${s.id}`}
                className="input"
                value={s.title}
                onChange={e => updateStepValue(s.id, 'title', e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium" htmlFor={`description-${s.id}`}>Description</label>
              <textarea
                id={`description-${s.id}`}
                className="input"
                value={s.description}
                onChange={e => updateStepValue(s.id, 'description', e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-sm font-medium" htmlFor={`media-${s.id}`}>Media URL</label>
              <input
                id={`media-${s.id}`}
                className="input"
                value={s.mediaUrl ?? ''}
                onChange={e => updateStepValue(s.id, 'mediaUrl', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Fields</h3>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => addField(s.id)}
                >
                  Add field
                </button>
              </div>
              {s.fields && s.fields.length > 0 ? (
                <div className="grid gap-3">
                  {s.fields.map((f, i) => {
                    const hasPresetType = FIELD_TYPES.some(option => option.value === f.type);
                    return (
                      <div key={`${s.id}-field-${i}`} className="rounded-md border border-neutral-200 p-3">
                        <div className="grid gap-1">
                          <label className="text-sm font-medium" htmlFor={`field-key-${s.id}-${i}`}>
                            Field key
                          </label>
                          <input
                            id={`field-key-${s.id}-${i}`}
                            className="input"
                            value={f.key}
                            onChange={e => updateField(s.id, i, { key: e.target.value })}
                          />
                        </div>
                        <div className="mt-2 grid gap-1">
                          <label className="text-sm font-medium" htmlFor={`field-label-${s.id}-${i}`}>
                            Field label
                          </label>
                          <input
                            id={`field-label-${s.id}-${i}`}
                            className="input"
                            value={f.label}
                            onChange={e => updateField(s.id, i, { label: e.target.value })}
                          />
                        </div>
                        <div className="mt-2 grid gap-2 sm:flex sm:items-center">
                          <label className="text-sm font-medium" htmlFor={`field-type-${s.id}-${i}`}>
                            Field type
                          </label>
                          <select
                            id={`field-type-${s.id}-${i}`}
                            className="input max-w-[12rem]"
                            value={f.type}
                            onChange={e => updateField(s.id, i, { type: e.target.value })}
                          >
                            {!hasPresetType && f.type ? (
                              <option value={f.type}>{f.type}</option>
                            ) : null}
                            {FIELD_TYPES.map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <label className="mt-2 inline-flex items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={Boolean(f.required)}
                            onChange={e => updateField(s.id, i, { required: e.target.checked })}
                          />
                          Required field
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs mt-3 text-red-600 hover:text-red-700"
                          onClick={() => removeField(s.id, i)}
                        >
                          Remove field
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-neutral-500">No fields added yet.</p>
              )}
            </div>
            {s.agreementText !== undefined && (
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor={`agreement-${s.id}`}>
                  Agreement Text
                </label>
                <textarea
                  id={`agreement-${s.id}`}
                  className="input"
                  value={s.agreementText}
                  onChange={e => updateStepValue(s.id, 'agreementText', e.target.value)}
                />
              </div>
            )}
            <button className="btn btn-sm w-fit" onClick={() => saveStep(s)}>Save</button>
          </div>
        ))}
      </div>
    </div>
  );
}
