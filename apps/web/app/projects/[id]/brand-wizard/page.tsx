"use client";

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { auth, db, storage } from '@/lib/firebase';
import { doc, getDoc, addDoc, updateDoc, collection } from 'firebase/firestore';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const handleSkip = async () => {
    if (!projectId) return;
    await updateDoc(doc(db, 'projects', projectId), { brandGuidelinesCompleted: false });
    router.push(`/projects/${projectId}`);
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
      }
      if (introFile) {
        const introRef = ref(storage, `orgs/${orgId}/projects/${projectId}/brandGuidelines/intro/${introFile.name}`);
        await uploadBytes(introRef, introFile);
        introUrl = await getDownloadURL(introRef);
      }
      if (outroFile) {
        const outroRef = ref(storage, `orgs/${orgId}/projects/${projectId}/brandGuidelines/outro/${outroFile.name}`);
        await uploadBytes(outroRef, outroFile);
        outroUrl = await getDownloadURL(outroRef);
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

  if (loading) return <p>Loading…</p>;
  if (!project) return <p>Project not found.</p>;
  return (
    <div className="grid gap-6 max-w-xl mx-auto">
      <h1 className="text-xl font-semibold">Brand Guidelines Setup</h1>
      <p className="text-sm text-gray-700">Configure your brand colours, fonts and assets. You can skip this step and complete later.</p>
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
        <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Intro Video (optional)</span>
        <input type="file" accept="video/*" onChange={(e) => setIntroFile(e.target.files?.[0] || null)} />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Outro Video (optional)</span>
        <input type="file" accept="video/*" onChange={(e) => setOutroFile(e.target.files?.[0] || null)} />
      </label>
      <div className="flex gap-4 mt-4">
        <button className="btn" onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : 'Save Guidelines'}</button>
        <button className="btn" onClick={handleSkip}>Skip</button>
      </div>
    </div>
  );
}