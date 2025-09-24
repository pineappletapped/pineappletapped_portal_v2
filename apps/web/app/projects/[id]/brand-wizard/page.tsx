"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
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

type GoogleFontEntry = {
  id: string;
  family: string;
  category?: string;
  variants?: string[];
  subsets?: string[];
};

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
  const [fontMode, setFontMode] = useState<'google' | 'custom' | 'manual'>('google');
  const [googleFonts, setGoogleFonts] = useState<GoogleFontEntry[]>([]);
  const [googleFontsLoading, setGoogleFontsLoading] = useState(false);
  const [googleFontsError, setGoogleFontsError] = useState<string | null>(null);
  const [fontQuery, setFontQuery] = useState('');
  const [selectedGoogleFontId, setSelectedGoogleFontId] = useState('');
  const [customFontFile, setCustomFontFile] = useState<File | null>(null);
  const [customFontName, setCustomFontName] = useState('');
  const [manualFontUrl, setManualFontUrl] = useState('');
  const [prefillFontUrl, setPrefillFontUrl] = useState<string | null>(null);
  const [prefillFontStoragePath, setPrefillFontStoragePath] = useState<string | null>(null);
  const [usePrefillFont, setUsePrefillFont] = useState(false);
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
    let active = true;
    setGoogleFontsLoading(true);
    fetch('/data/google-fonts.json')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }
        return res.json() as Promise<GoogleFontEntry[]>;
      })
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data)) {
          setGoogleFonts(data);
        } else {
          setGoogleFonts([]);
        }
      })
      .catch((err) => {
        console.error('Failed to load Google Fonts catalogue', err);
        if (!active) return;
        setGoogleFontsError('Unable to load Google Fonts right now.');
        setGoogleFonts([]);
      })
      .finally(() => {
        if (!active) return;
        setGoogleFontsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

  useEffect(() => {
    if (fontMode !== 'google') {
      if (selectedGoogleFontId) {
        setSelectedGoogleFontId('');
      }
      return;
    }
    if (!font) {
      if (selectedGoogleFontId) {
        setSelectedGoogleFontId('');
      }
      return;
    }
    const match = googleFonts.find((entry) => entry.family === font);
    if (match) {
      setSelectedGoogleFontId((prev) => (prev === match.id ? prev : match.id));
    } else if (selectedGoogleFontId) {
      setSelectedGoogleFontId('');
    }
  }, [font, fontMode, googleFonts, selectedGoogleFontId]);

  const applyGuidelineToForm = useCallback((guideline: any | null) => {
    if (guideline) {
      setPrimaryColor(guideline.primaryColor || '#FF7A00');
      setSecondaryColor(guideline.secondaryColor || '#0D2C54');
      setFont(guideline.font || '');
      const savedSource: 'google' | 'custom' | 'manual' =
        guideline.fontSource === 'google' || guideline.fontSource === 'custom'
          ? guideline.fontSource
          : guideline.fontSource === 'manual'
            ? 'manual'
            : guideline.fontDownloadUrl
              ? 'google'
              : 'manual';
      setFontMode(savedSource);
      if (savedSource === 'custom') {
        setCustomFontName(guideline.font || '');
        setPrefillFontUrl(guideline.fontDownloadUrl || null);
        setUsePrefillFont(Boolean(guideline.fontDownloadUrl));
        setManualFontUrl('');
        setPrefillFontStoragePath(guideline.fontStoragePath || null);
      } else if (savedSource === 'manual') {
        setManualFontUrl(guideline.fontDownloadUrl || '');
        setPrefillFontUrl(null);
        setUsePrefillFont(false);
        setCustomFontName('');
        setPrefillFontStoragePath(null);
      } else {
        setManualFontUrl('');
        setPrefillFontUrl(null);
        setUsePrefillFont(false);
        setCustomFontName('');
        setPrefillFontStoragePath(null);
      }
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
      setCustomFontFile(null);
    } else {
      setFont('');
      setFontMode('google');
      setCustomFontName('');
      setManualFontUrl('');
      setPrefillFontUrl(null);
      setUsePrefillFont(false);
      setPrefillFontStoragePath(null);
      setPrefillLogoUrl(null);
      setUsePrefillLogo(false);
      setPrefillIntroUrl(null);
      setUsePrefillIntro(false);
      setPrefillOutroUrl(null);
      setUsePrefillOutro(false);
      setCustomFontFile(null);
      setFontQuery('');
      setSelectedGoogleFontId('');
    }
  }, []);

  const filteredGoogleFonts = useMemo(() => {
    if (!fontQuery.trim()) {
      return googleFonts;
    }
    const q = fontQuery.trim().toLowerCase();
    return googleFonts.filter((entry) => {
      const familyMatch = entry.family.toLowerCase().includes(q);
      const categoryMatch = entry.category ? entry.category.toLowerCase().includes(q) : false;
      return familyMatch || categoryMatch;
    });
  }, [googleFonts, fontQuery]);

  const selectedGoogleFont = useMemo(() => {
    if (selectedGoogleFontId) {
      return googleFonts.find((entry) => entry.id === selectedGoogleFontId) || null;
    }
    if (fontMode === 'google' && font) {
      return googleFonts.find((entry) => entry.family === font) || null;
    }
    return null;
  }, [selectedGoogleFontId, googleFonts, fontMode, font]);

  const googleDownloadHref = useMemo(() => {
    if (fontMode !== 'google') {
      return null;
    }
    const family = selectedGoogleFont?.family || (font ? font : '');
    if (!family) {
      return null;
    }
    return `https://fonts.google.com/download?family=${encodeURIComponent(family)}`;
  }, [fontMode, selectedGoogleFont, font]);

  const handleSelectGoogleFont = useCallback((entry: GoogleFontEntry) => {
    setFontMode('google');
    setFont(entry.family);
    setCustomFontName('');
    setManualFontUrl('');
    setPrefillFontUrl(null);
    setPrefillFontStoragePath(null);
    setUsePrefillFont(false);
    setCustomFontFile(null);
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
      const chosen = existingGuidelines.find((g) => g.id === selectedGuidelineId) || null;
      await updateDoc(doc(db, 'projects', projectId), {
        brandGuidelinesId: selectedGuidelineId,
        brandGuidelinesCompleted: true,
        brandFontName: chosen?.font || null,
        brandFontSource: chosen?.fontSource || null,
        brandFontDownloadUrl: chosen?.fontDownloadUrl || null,
        brandFontCategory: chosen?.fontCategory || null,
        brandFontStoragePath: chosen?.fontStoragePath || null,
      });
      if (orgId && chosen?.font) {
        try {
          await updateDoc(doc(db, 'orgs', orgId), {
            brandFontName: chosen.font,
            brandFontSource: chosen.fontSource || null,
            brandFontDownloadUrl: chosen.fontDownloadUrl || null,
            brandFontCategory: chosen.fontCategory || null,
          });
        } catch (orgErr) {
          console.error('Failed to update organisation font metadata', orgErr);
        }
      }
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
      let fontNameToSave = font.trim();
      let fontSourceToSave: 'google' | 'custom' | 'manual' = fontMode;
      let fontDownloadUrlToSave: string | null = null;
      let fontCategoryToSave: string | null = null;
      let fontStoragePath: string | null = null;

      if (fontMode === 'google') {
        const googleMatch = selectedGoogleFont || googleFonts.find((entry) => entry.family === fontNameToSave) || null;
        const chosenFamily = googleMatch?.family || fontNameToSave;
        if (!chosenFamily) {
          alert('Please select a Google Font or choose another option.');
          setSaving(false);
          return;
        }
        fontNameToSave = chosenFamily;
        fontDownloadUrlToSave = `https://fonts.google.com/download?family=${encodeURIComponent(chosenFamily)}`;
        fontCategoryToSave = googleMatch?.category || null;
      } else if (fontMode === 'custom') {
        const customName = customFontName.trim() || fontNameToSave;
        if (!customName) {
          alert('Please provide the name of your custom font.');
          setSaving(false);
          return;
        }
        fontNameToSave = customName;
        if (usePrefillFont && prefillFontUrl) {
          fontDownloadUrlToSave = prefillFontUrl;
          fontStoragePath = prefillFontStoragePath;
        } else if (customFontFile) {
          const fontPath = `orgs/${orgId}/projects/${projectId}/brandGuidelines/font/${customFontFile.name}`;
          const fontRef = ref(storage, fontPath);
          await uploadBytes(fontRef, customFontFile);
          fontDownloadUrlToSave = await getDownloadURL(fontRef);
          fontStoragePath = fontPath;
        } else {
          alert('Please upload your custom font file or reuse the saved file.');
          setSaving(false);
          return;
        }
        fontCategoryToSave = null;
      } else {
        fontSourceToSave = 'manual';
        fontNameToSave = fontNameToSave.trim();
        if (!fontNameToSave) {
          alert('Please enter the font name.');
          setSaving(false);
          return;
        }
        fontDownloadUrlToSave = manualFontUrl.trim() ? manualFontUrl.trim() : null;
        fontCategoryToSave = null;
      }

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
        font: fontNameToSave,
        fontSource: fontSourceToSave,
        fontDownloadUrl: fontDownloadUrlToSave,
        fontCategory: fontCategoryToSave,
        fontStoragePath,
        tagline,
        logoUrl,
        introUrl,
        outroUrl,
        sourceGuidelineId: selectedGuidelineId || null,
        createdAt: new Date().toISOString()
      } as any);
      await updateDoc(doc(db, 'projects', projectId), {
        brandGuidelinesId: docRef.id,
        brandGuidelinesCompleted: true,
        brandFontName: fontNameToSave,
        brandFontSource: fontSourceToSave,
        brandFontDownloadUrl: fontDownloadUrlToSave,
        brandFontCategory: fontCategoryToSave,
        brandFontStoragePath: fontStoragePath || null,
      });
      if (orgId) {
        try {
          await updateDoc(doc(db, 'orgs', orgId), {
            brandFontName: fontNameToSave,
            brandFontSource: fontSourceToSave,
            brandFontDownloadUrl: fontDownloadUrlToSave,
            brandFontCategory: fontCategoryToSave,
          });
        } catch (orgErr) {
          console.error('Failed to update organisation font metadata', orgErr);
        }
      }
      setFont(fontNameToSave);
      if (fontMode === 'custom') {
        setCustomFontName(fontNameToSave);
      }
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
              {selectedGuideline.fontSource && (
                <div>
                  Font source: <span className="font-medium">{selectedGuideline.fontSource}</span>
                </div>
              )}
              {selectedGuideline.fontDownloadUrl && (
                <div className="flex items-center gap-2">
                  Font download
                  <a
                    href={selectedGuideline.fontDownloadUrl}
                    className="text-orange-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download
                  </a>
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
      <div className="grid gap-2">
        <span className="text-sm font-medium">Brand Font</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`btn-sm ${fontMode === 'google' ? '' : 'btn-outline'}`}
            onClick={() => {
              setFontMode('google');
              setManualFontUrl('');
              setUsePrefillFont(false);
              setPrefillFontUrl(null);
              setPrefillFontStoragePath(null);
              setCustomFontFile(null);
            }}
          >
            Google Fonts
          </button>
          <button
            type="button"
            className={`btn-sm ${fontMode === 'custom' ? '' : 'btn-outline'}`}
            onClick={() => {
              setFontMode('custom');
              setManualFontUrl('');
              if (!customFontName && fontMode !== 'custom' && font) {
                setCustomFontName(font);
              }
            }}
          >
            Upload custom
          </button>
          <button
            type="button"
            className={`btn-sm ${fontMode === 'manual' ? '' : 'btn-outline'}`}
            onClick={() => {
              setFontMode('manual');
              setUsePrefillFont(false);
              setPrefillFontUrl(null);
              setPrefillFontStoragePath(null);
              setCustomFontFile(null);
            }}
          >
            Manual entry
          </button>
        </div>
        {fontMode === 'google' && (
          <div className="grid gap-2 rounded-lg border border-orange-200/70 bg-white p-3">
            <label className="grid gap-1 text-xs font-medium text-gray-700" htmlFor="google-font-search">
              <span>Search Google Fonts</span>
              <input
                id="google-font-search"
                type="search"
                className="input"
                placeholder="Start typing a font name…"
                value={fontQuery}
                onChange={(e) => setFontQuery(e.target.value)}
              />
            </label>
            {googleFontsLoading ? (
              <p className="text-xs text-gray-600">Loading Google Fonts…</p>
            ) : googleFontsError ? (
              <p className="text-xs text-red-600">{googleFontsError}</p>
            ) : (
              <ul
                role="listbox"
                className="max-h-64 overflow-y-auto rounded-md border border-orange-100 bg-white shadow-inner"
              >
                {filteredGoogleFonts.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-500">No fonts match your search.</li>
                ) : (
                  filteredGoogleFonts.map((entry) => {
                    const isSelected =
                      (selectedGoogleFont && selectedGoogleFont.id === entry.id) || font === entry.family;
                    return (
                      <li key={entry.id} className="border-b border-orange-50 last:border-b-0">
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 ${
                            isSelected ? 'bg-orange-100 font-semibold text-orange-900' : 'text-gray-700'
                          }`}
                          onClick={() => handleSelectGoogleFont(entry)}
                        >
                          <span>{entry.family}</span>
                          {entry.category ? (
                            <span className="text-xs uppercase tracking-wide text-gray-500">{entry.category}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
            {font && googleDownloadHref ? (
              <p className="text-xs text-gray-600">
                Download pack:{' '}
                <a
                  href={googleDownloadHref}
                  className="text-orange-600 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download {selectedGoogleFont?.family || font}
                </a>
              </p>
            ) : null}
          </div>
        )}
        {fontMode === 'custom' && (
          <div className="grid gap-3 rounded-lg border border-orange-200/70 bg-white p-3">
            <label className="grid gap-1 text-xs font-medium text-gray-700">
              <span>Font name</span>
              <input
                type="text"
                className="input"
                placeholder="Your custom font name"
                value={customFontName}
                onChange={(e) => {
                  setCustomFontName(e.target.value);
                  setFont(e.target.value);
                }}
              />
            </label>
            <div className="grid gap-1 text-xs text-gray-700">
              <span className="font-medium">Upload font file (.ttf, .otf, .woff, .woff2, .zip)</span>
              <input
                type="file"
                accept=".ttf,.otf,.woff,.woff2,.zip"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setCustomFontFile(file);
                  if (file) {
                    const displayName = file.name.replace(/\.[^.]+$/, '');
                    if (!customFontName) {
                      setCustomFontName(displayName);
                      setFont(displayName);
                    }
                    setUsePrefillFont(false);
                    setPrefillFontStoragePath(null);
                  }
                }}
              />
              {prefillFontUrl ? (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-gray-600">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={usePrefillFont}
                      onChange={(e) => setUsePrefillFont(e.target.checked)}
                    />
                    Reuse saved font file
                  </label>
                  <a
                    href={prefillFontUrl}
                    className="text-orange-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download saved font
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {fontMode === 'manual' && (
          <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3">
            <label className="grid gap-1 text-xs font-medium text-gray-700">
              <span>Font name</span>
              <input
                type="text"
                className="input"
                placeholder="e.g. Poppins"
                value={font}
                onChange={(e) => setFont(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-gray-700">
              <span>Download link (optional)</span>
              <input
                type="url"
                className="input"
                placeholder="https://example.com/my-font.zip"
                value={manualFontUrl}
                onChange={(e) => setManualFontUrl(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>
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