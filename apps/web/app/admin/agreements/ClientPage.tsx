"use client";

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { db, functions } from '@/lib/firebase';
import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import 'react-quill/dist/quill.snow.css';
import { useRoleGate } from '@/hooks/useRoleGate';

interface Agreement {
  id?: string;
  title: string;
  category: string;
  content: string;
  requireSign: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  history?: { event: string; at: Timestamp }[];
  signatures?: { uid: string; signedAt: Timestamp }[];
}

const DEFAULT_AGREEMENTS: Agreement[] = [
  {
    title: 'Franchise Agreements',
    category: 'Franchise',
    content: '',
    requireSign: true,
    history: [],
    signatures: [],
  },
  {
    title: 'Affiliate Agreements',
    category: 'Affiliate',
    content: '',
    requireSign: true,
    history: [],
    signatures: [],
  },
  {
    title: 'Team Contracts',
    category: 'Internal',
    content: '',
    requireSign: true,
    history: [],
    signatures: [],
  },
];

const DEFAULT_POLICIES = [
  {
    title: 'Data Privacy',
    content: '',
    audience: 'client',
    version: '1.0',
  },
  {
    title: 'Terms of Business (Videography)',
    content: '',
    audience: 'client',
    version: '1.0',
  },
  {
    title: 'Terms of Business (Live Events)',
    content: '',
    audience: 'client',
    version: '1.0',
  },
];

const emptyForm: Agreement = {
  title: '',
  category: '',
  content: '',
  requireSign: false,
  history: [],
  signatures: []
};

export default function AdminAgreementsPage() {
  const { allowed, loading: guardLoading } = useRoleGate(['admin']);
  const [tab, setTab] = useState<'agreements' | 'policies'>('agreements');
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [agreementForm, setAgreementForm] = useState<Agreement>(emptyForm);
  const [forceResign, setForceResign] = useState(false);
  const [policies, setPolicies] = useState<any[]>([]);
  const [policyForm, setPolicyForm] = useState({ title: '', content: '', audience: 'client', version: '1.0' });
  const [loading, setLoading] = useState(true);
  const [showAgreementModal, setShowAgreementModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

  const loadAgreements = async () => {
    const agSnap = await getDocs(collection(db, 'agreements'));
    const list: Agreement[] = [];
    for (const d of agSnap.docs) {
      const data = d.data() as any;
      const sigSnap = await getDocs(collection(db, 'agreements', d.id, 'signatures'));
      list.push({
        id: d.id,
        title: data.title || '',
        category: data.category || '',
        content: data.content || '',
        requireSign: data.requireSign || false,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        history: data.history || [],
        signatures: sigSnap.docs.map((s) => s.data() as any)
      });
    }
    const existingTitles = new Set(list.map((item) => item.title.trim().toLowerCase()));
    DEFAULT_AGREEMENTS.forEach((defaultAgreement) => {
      if (!existingTitles.has(defaultAgreement.title.trim().toLowerCase())) {
        list.push({ ...defaultAgreement });
      }
    });
    list.sort((a, b) => {
      const aTime = a.createdAt?.seconds || 0;
      const bTime = b.createdAt?.seconds || 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return a.title.localeCompare(b.title);
    });
    setAgreements(list);
  };

  const loadPolicies = async () => {
    const polSnap = await getDocs(collection(db, 'policies'));
    const loaded = polSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    const existingTitles = new Set(loaded.map((item) => item.title.trim().toLowerCase()));
    const merged = [
      ...loaded,
      ...DEFAULT_POLICIES.filter((policy) => !existingTitles.has(policy.title.trim().toLowerCase())),
    ].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    setPolicies(merged);
  };

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      await Promise.all([loadAgreements(), loadPolicies()]);
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  const saveAgreement = async () => {
    if (!agreementForm.title.trim() || !agreementForm.content.trim()) {
      alert('Title and content are required');
      return;
    }
    try {
      const callable = httpsCallable(functions, 'agreements_update');
      await callable({
        id: agreementForm.id,
        title: agreementForm.title.trim(),
        category: agreementForm.category.trim(),
        content: agreementForm.content.trim(),
        requireSign: agreementForm.requireSign,
        forceResign,
      });
      await loadAgreements();
      setAgreementForm(emptyForm);
      setForceResign(false);
      setShowAgreementModal(false);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error saving agreement');
    }
  };

  const savePolicy = async () => {
    if (!policyForm.title.trim() || !policyForm.content.trim() || !policyForm.version.trim()) {
      alert('Title, content and version are required');
      return;
    }
    try {
      const callable = httpsCallable(functions, 'policies_upsert');
      await callable({
        title: policyForm.title.trim(),
        content: policyForm.content.trim(),
        audience: policyForm.audience,
        version: policyForm.version.trim(),
      });
      await loadPolicies();
      setPolicyForm({ title: '', content: '', audience: 'client', version: '1.0' });
      setShowPolicyModal(false);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error saving policy');
    }
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage agreements and policies.</p>;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Manage Agreements & Policies</h1>
        {tab === 'agreements' ? (
          <button
            className="btn"
            onClick={() => {
              setAgreementForm(emptyForm);
              setForceResign(false);
              setShowAgreementModal(true);
            }}
          >
            New Agreement
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => {
              setPolicyForm({ title: '', content: '', audience: 'client', version: '1.0' });
              setShowPolicyModal(true);
            }}
          >
            New Policy
          </button>
        )}
      </div>

      <div className="flex gap-4 border-b">
        <button
          className={`pb-2 ${tab === 'agreements' ? 'border-b-2 font-medium' : 'text-gray-500'}`}
          onClick={() => setTab('agreements')}
        >
          Agreements
        </button>
        <button
          className={`pb-2 ${tab === 'policies' ? 'border-b-2 font-medium' : 'text-gray-500'}`}
          onClick={() => setTab('policies')}
        >
          Policies
        </button>
      </div>

      {tab === 'agreements' ? (
        agreements.length === 0 ? (
          <p>No agreements.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">Title</th>
                  <th className="px-2 py-1">Category</th>
                  <th className="px-2 py-1">Requires Sign</th>
                  <th className="px-2 py-1">Created</th>
                  <th className="px-2 py-1">Updated</th>
                  <th className="px-2 py-1">Signed</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((ag) => (
                  <tr key={ag.id} className="border-t">
                    <td className="px-2 py-1">{ag.title}</td>
                    <td className="px-2 py-1">{ag.category}</td>
                    <td className="px-2 py-1">{ag.requireSign ? 'Yes' : 'No'}</td>
                    <td className="px-2 py-1">{ag.createdAt?.toDate().toLocaleDateString()}</td>
                    <td className="px-2 py-1">{ag.updatedAt ? ag.updatedAt.toDate().toLocaleDateString() : '-'}</td>
                    <td className="px-2 py-1">{ag.signatures?.length || 0}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setAgreementForm({ ...ag });
                          setForceResign(false);
                          setShowAgreementModal(true);
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : policies.length === 0 ? (
        <p>No policies.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-2 py-1">Title</th>
                <th className="px-2 py-1">Audience</th>
                <th className="px-2 py-1">Version</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((pol) => (
                <tr key={pol.id} className="border-t">
                  <td className="px-2 py-1">{pol.title}</td>
                  <td className="px-2 py-1 capitalize">{pol.audience}</td>
                  <td className="px-2 py-1">v{pol.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAgreementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white p-4 rounded w-full max-w-2xl max-h-[90vh] overflow-y-auto grid gap-3">
            <h2 className="font-semibold">{agreementForm.id ? 'Edit Agreement' : 'Create Agreement'}</h2>
            <input
              type="text"
              className="input"
              placeholder="Title"
              value={agreementForm.title}
              onChange={(e) => setAgreementForm({ ...agreementForm, title: e.target.value })}
            />
            <input
              type="text"
              className="input"
              placeholder="Category (e.g. Product, Staff Policy)"
              value={agreementForm.category}
              onChange={(e) => setAgreementForm({ ...agreementForm, category: e.target.value })}
            />
            <ReactQuill theme="snow" value={agreementForm.content} onChange={(v) => setAgreementForm({ ...agreementForm, content: v })} />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={agreementForm.requireSign}
                onChange={(e) => setAgreementForm({ ...agreementForm, requireSign: e.target.checked })}
              />
              Requires e-signature
            </label>
            {agreementForm.requireSign && (
              <label className="flex items-center gap-2 ml-4">
                <input
                  type="checkbox"
                  checked={forceResign}
                  onChange={(e) => setForceResign(e.target.checked)}
                />
                Force re-sign on save
              </label>
            )}
            {(agreementForm.history?.length || 0) > 0 && (
              <div className="mt-2">
                <h3 className="font-semibold">Change Log</h3>
                <ul className="text-sm">
                  {agreementForm.history!.map((h, i) => (
                    <li key={i}>{h.event} – {h.at?.toDate().toLocaleString()}</li>
                  ))}
                </ul>
              </div>
            )}
            {(agreementForm.signatures?.length || 0) > 0 && (
              <div>
                <h3 className="font-semibold">Signatures</h3>
                <ul className="text-sm">
                  {agreementForm.signatures!.map((s) => (
                    <li key={s.uid}>{s.uid} – {s.signedAt?.toDate().toLocaleString()}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowAgreementModal(false);
                  setAgreementForm(emptyForm);
                  setForceResign(false);
                }}
              >
                Cancel
              </button>
              <button className="btn" onClick={saveAgreement}>{agreementForm.id ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {showPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white p-4 rounded w-full max-w-lg grid gap-3">
            <h2 className="font-semibold">Create Policy</h2>
            <input
              type="text"
              className="input"
              placeholder="Title"
              value={policyForm.title}
              onChange={(e) => setPolicyForm({ ...policyForm, title: e.target.value })}
            />
            <select
              className="input"
              value={policyForm.audience}
              onChange={(e) => setPolicyForm({ ...policyForm, audience: e.target.value })}
            >
              <option value="client">Client</option>
              <option value="contractor">Contractor</option>
            </select>
            <input
              type="text"
              className="input"
              placeholder="Version"
              value={policyForm.version}
              onChange={(e) => setPolicyForm({ ...policyForm, version: e.target.value })}
            />
            <textarea
              className="input"
              rows={6}
              placeholder="Policy content"
              value={policyForm.content}
              onChange={(e) => setPolicyForm({ ...policyForm, content: e.target.value })}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                className="btn btn-ghost"
                onClick={() => setShowPolicyModal(false)}
              >
                Cancel
              </button>
              <button className="btn" onClick={savePolicy}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

