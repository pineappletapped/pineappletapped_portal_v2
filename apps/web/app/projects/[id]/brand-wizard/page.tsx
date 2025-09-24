"use client";

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, storage } from '@/lib/firebase';
import {
  doc,
  getDoc,
  addDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Brand Guidelines Wizard
 *
 * When a customer purchases a service, they must configure their brand guidelines.
 * This wizard collects primary/secondary colours, fonts, and optional logo/intro/outro assets.
 * Users may skip and complete later. On completion it stores a brandGuidelines document and
 * marks the project as having guidelines configured.
 */
export default function BrandWizardPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const [project, setProject] = useState<any | null>(null);
  const [orgId, setOrgId] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState('#FF7A00');
  const [secondaryColor, setSecondaryColor] = useState('#0D2C54');
  const [font, setFont] = useState('');
  const [tagline, setTagline] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [introFile, setIntroFile] = useState<File | null>(null);
  const [outroFile, setOutroFile] = useState<File | null>(null);
  const [existingGuidelines, setExistingGuidelines] = useState<any[]>([]);
  const [selectedGuidelineId, setSelectedGuidelineId] = useState('');
  const [prefillLogoUrl, setPrefillLogoUrl] = useState<string | null>(null);
  const [prefillIntroUrl, setPrefillIntroUrl] = useState<string | null>(null);
  const [prefillOutroUrl, setPrefillOutroUrl] = useState<string | null>(null);
  const [usePrefillLogo, setUsePrefillLogo] = useState(false);
  const [usePrefillIntro, setUsePrefillIntro] = useState(false);
  const [usePrefillOutro, setUsePrefillOutro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigningExisting, setAssigningExisting] = useState(false);

  useEffect(() => {
    (async () => {
      if (!projectId) return;
      const snap = await getDoc(doc(db, 'projects', projectId));
      if (!snap.exists()) { setProject(null); setLoading(false); return; }
      const proj = snap.data() as any;
      setProject(proj);
      setOrgId(proj.orgId || '');
      setLoading(false);
    })();
  }, [projectId]);

  useEffect(() => {
    if (!orgId) {
      setExistingGuidelines([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const q = query(
          collection(db, 'brandGuidelines'),
          where('orgId', '==', orgId),
          orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        if (!active) return;
        setExistingGuidelines(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      } catch (err) {
        console.error('Failed to load saved brand guidelines', err);
        if (!active) return;
        try {
          const fallbackSnap = await getDocs(
            query(collection(db, 'brandGuidelines'), where('orgId', '==', orgId))
          );
          if (!active) return;
          setExistingGuidelines(fallbackSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        } catch (fallbackErr) {
          console.error('Fallback guidelines load failed', fallbackErr);
          if (!active) return;
          setExistingGuidelines([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId]);

  const applyGuidelineToForm = useCallback((guideline: any | null) => {
    if (guideline) {
      setPrimaryColor(guideline.primaryColor || '#FF7A00');
      setSecondaryColor(guideline.secondaryColor || '#0D2C54');
      setFont(guideline.font || '');
      setTagline(guideline.tagline || '');
      setPrefillLogoUrl(guideline.logoUrl || null);
      setUsePrefillLogo(Boolean(guideline.logoUrl));
      setPrefillIntroUrl(guideline.introUrl || null);
      setUsePrefillIntro(Boolean(guideline.introUrl));
      setPrefillOutroUrl(guideline.outroUrl || null);
      setUsePrefillOutro(Boolean(guideline.outroUrl));
      setLogoFile(null);
      setIntroFile(null);
      setOutroFile(null);
    } else {
      setPrefillLogoUrl(null);
      setUsePrefillLogo(false);
      setPrefillIntroUrl(null);
      setUsePrefillIntro(false);
      setPrefillOutroUrl(null);
      setUsePrefillOutro(false);
    }
  }, []);

  const handleGuidelineSelection = useCallback((guidelineId: string) => {
    setSelectedGuidelineId(guidelineId);
    const match = existingGuidelines.find((g) => g.id === guidelineId) || null;
    applyGuidelineToForm(match);
  }, [applyGuidelineToForm, existingGuidelines]);

  useEffect(() => {
    const brandGuidelinesId = project?.brandGuidelinesId;
    if (!brandGuidelinesId || selectedGuidelineId) {
      return;
    }
    const existing = existingGuidelines.find((g) => g.id === brandGuidelinesId);
    if (existing) {
      handleGuidelineSelection(existing.id);
    }
  }, [project?.brandGuidelinesId, existingGuidelines, selectedGuidelineId, handleGuidelineSelection]);

  const handleSkip = async () => {
    if (!projectId) return;
    await updateDoc(doc(db, 'projects', projectId), { brandGuidelinesCompleted: false });
    router.push(`/projects/${projectId}`);
  };

  const handleAssignExisting = async () => {
    if (!projectId || !selectedGuidelineId) return;
    setAssigningExisting(true);
    try {
      await updateDoc(doc(db, 'projects', projectId), {
        brandGuidelinesId: selectedGuidelineId,
        brandGuidelinesCompleted: true,
      });
      router.push(`/projects/${projectId}`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error assigning guidelines');
    } finally {
      setAssigningExisting(false);
    }
  };

  const handleSubmit = async () => {
    if (!projectId || !orgId) return;
    setSaving(true);
    try {
      // Upload logo and videos if provided
      let logoUrl: string | null = null;
      let introUrl: string | null = null;
      let outroUrl: string | null = null;
      if (logoFile) {
        const logoRef = ref(storage, `orgs/${orgId}/projects/${projectId}/brandGuidelines/logo/${logoFile.name}`);
        await uploadBytes(logoRef, logoFile);
        logoUrl = await getDownloadURL(logoRef);
      } else if (usePrefillLogo && prefillLogoUrl) {
        logoUrl = prefillLogoUrl;
      }
      if (introFile) {
        const introRef = ref(storage, `orgs/${orgId}/projects/${projectId}/brandGuidelines/intro/${introFile.name}`);
        await uploadBytes(introRef, introFile);
        introUrl = await getDownloadURL(introRef);
      } else if (usePrefillIntro && prefillIntroUrl) {
        introUrl = prefillIntroUrl;
      }
      if (outroFile) {
        const outroRef = ref(storage, `orgs/${orgId}/projects/${projectId}/brandGuidelines/outro/${outroFile.name}`);
        await uploadBytes(outroRef, outroFile);
        outroUrl = await getDownloadURL(outroRef);
      } else if (usePrefillOutro && prefillOutroUrl) {
        outroUrl = prefillOutroUrl;
      }
      const docRef = await addDoc(collection(db, 'brandGuidelines'), {
        orgId,
        projectId,
        primaryColor,
        secondaryColor,
        font,
        tagline,
        logoUrl,
        introUrl,
        outroUrl,
        sourceGuidelineId: selectedGuidelineId || null,
        createdAt: new Date().toISOString()
      } as any);
      await updateDoc(doc(db, 'projects', projectId), { brandGuidelinesId: docRef.id, brandGuidelinesCompleted: true });
      router.push(`/projects/${projectId}`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error saving guidelines');
    } finally {
      setSaving(false);
    }
  };

  const selectedGuideline =
    selectedGuidelineId
      ? existingGuidelines.find((g) => g.id === selectedGuidelineId) || null
      : null;

  if (loading) return <p>Loading…</p>;
  if (!project) return <p>Project not found.</p>;
  return (
    <div className="grid gap-6 max-w-xl mx-auto">
      <h1 className="text-xl font-semibold">Brand Guidelines Setup</h1>
      <p className="text-sm text-gray-700">Configure your brand colours, fonts and assets. You can skip this step and complete later.</p>
      {existingGuidelines.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="saved-guidelines" className="text-sm font-medium">
              Use saved guidelines
            </label>
            {selectedGuidelineId ? (
              <button
                type="button"
                className="btn-sm btn-outline"
                onClick={() => handleGuidelineSelection('')}
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="text-xs text-gray-600">
            Selecting a saved set will pre-fill the form below. You can still make changes before saving.
          </p>
          <select
            id="saved-guidelines"
            className="input"
            value={selectedGuidelineId}
            onChange={(e) => handleGuidelineSelection(e.target.value)}
          >
            <option value="">Choose saved guidelines…</option>
            {existingGuidelines.map((g) => {
              const createdValue =
                typeof g.createdAt === 'string'
                  ? new Date(g.createdAt).toLocaleString()
                  : g.createdAt?.toDate
                    ? g.createdAt.toDate().toLocaleString()
                    : '';
              const baseLabel =
                g.tagline?.length > 0
                  ? g.tagline
                  : g.projectId === projectId
                    ? 'Current project guidelines'
                    : g.projectId
                      ? `Project ${g.projectId}`
                      : 'Saved guidelines';
              const optionLabel = createdValue ? `${baseLabel} (${createdValue})` : baseLabel;
              return (
                <option key={g.id} value={g.id}>
                  {optionLabel}
                </option>
              );
            })}
          </select>
          {selectedGuideline ? (
            <div className="grid gap-1 rounded-md bg-white/80 p-2 text-xs text-gray-700">
              <div>
                Primary: <span className="font-medium">{selectedGuideline.primaryColor || '—'}</span> · Secondary:{' '}
                <span className="font-medium">{selectedGuideline.secondaryColor || '—'}</span>
              </div>
              {selectedGuideline.font && (
                <div>
                  Font: <span className="font-medium">{selectedGuideline.font}</span>
                </div>
              )}
              {selectedGuideline.tagline && (
                <div>
                  Tagline: <span className="font-medium">{selectedGuideline.tagline}</span>
                </div>
              )}
              {selectedGuideline.logoUrl && (
                <div className="flex items-center gap-2">
                  Saved logo
                  <a
                    href={selectedGuideline.logoUrl}
                    className="text-orange-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Preview
                  </a>
                </div>
              )}
              {selectedGuideline.introUrl && (
                <div className="flex items-center gap-2">
                  Intro video
                  <a
                    href={selectedGuideline.introUrl}
                    className="text-orange-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Preview
                  </a>
                </div>
              )}
              {selectedGuideline.outroUrl && (
                <div className="flex items-center gap-2">
                  Outro video
                  <a
                    href={selectedGuideline.outroUrl}
                    className="text-orange-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Preview
                  </a>
                </div>
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn-sm"
              onClick={handleAssignExisting}
              disabled={!selectedGuidelineId || assigningExisting}
            >
              {assigningExisting ? 'Applying…' : 'Use selected for this project'}
            </button>
          </div>
        </div>
      )}
      <label className="block">
        <span className="text-sm font-medium">Primary Colour</span>
        <input type="color" className="input w-32" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Secondary Colour</span>
        <input type="color" className="input w-32" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Font (Google Font or system)</span>
        <input type="text" className="input" placeholder="e.g. Poppins" value={font} onChange={(e) => setFont(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Tagline / description (optional)</span>
        <input type="text" className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Logo (PNG or SVG)</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setLogoFile(file);
            if (file) {
              setUsePrefillLogo(false);
            }
          }}
        />
        {prefillLogoUrl && (
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-600">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={usePrefillLogo}
                onChange={(e) => setUsePrefillLogo(e.target.checked)}
              />
              Reuse saved logo
            </label>
            <a
              href={prefillLogoUrl}
              className="text-orange-600 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview
            </a>
          </div>
        )}
      </label>
      <label className="block">
        <span className="text-sm font-medium">Intro Video (optional)</span>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setIntroFile(file);
            if (file) {
              setUsePrefillIntro(false);
            }
          }}
        />
        {prefillIntroUrl && (
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-600">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={usePrefillIntro}
                onChange={(e) => setUsePrefillIntro(e.target.checked)}
              />
              Reuse saved intro video
            </label>
            <a
              href={prefillIntroUrl}
              className="text-orange-600 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview
            </a>
          </div>
        )}
      </label>
      <label className="block">
        <span className="text-sm font-medium">Outro Video (optional)</span>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setOutroFile(file);
            if (file) {
              setUsePrefillOutro(false);
            }
          }}
        />
        {prefillOutroUrl && (
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-600">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={usePrefillOutro}
                onChange={(e) => setUsePrefillOutro(e.target.checked)}
              />
              Reuse saved outro video
            </label>
            <a
              href={prefillOutroUrl}
              className="text-orange-600 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Preview
            </a>
          </div>
        )}
      </label>
      <div className="flex gap-4 mt-4">
        <button className="btn" onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : 'Save Guidelines'}</button>
        <button className="btn" onClick={handleSkip}>Skip</button>
      </div>
    </div>
  );
}