"use client";

import { useEffect, useState } from 'react';
import { db, storage } from '@/lib/firebase';
import {
  addDoc,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import Image from 'next/image';
import type { Category } from '@/lib/categories';
import { useRoleGate } from '@/hooks/useRoleGate';

interface PageDoc { id: string; title: string; slug: string; }
interface HomeCard { id: string; title: string; text: string; link?: string; }

export default function WebsiteDesignPage() {
  const { allowed, loading: guardLoading } = useRoleGate(['marketing']);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'home' | 'pages' | 'menu' | 'branding'>('pages');

  const [pages, setPages] = useState<PageDoc[]>([]);
  const [pageTitle, setPageTitle] = useState('');
  const [pageSlug, setPageSlug] = useState('');

  const [menuCats, setMenuCats] = useState<Category[]>([]);

  const [homeTitle, setHomeTitle] = useState('');
  const [homeSubtitle, setHomeSubtitle] = useState('');
  const [homeAboutTitle, setHomeAboutTitle] = useState('');
  const [homeAboutText, setHomeAboutText] = useState('');
  const [homeCtaTitle, setHomeCtaTitle] = useState('');
  const [homeCtaText, setHomeCtaText] = useState('');
  const [homeCtaBtnText, setHomeCtaBtnText] = useState('');
  const [homeCtaBtnLink, setHomeCtaBtnLink] = useState('');
  const [homeCards, setHomeCards] = useState<HomeCard[]>([]);
  const [cardTitle, setCardTitle] = useState('');
  const [cardText, setCardText] = useState('');
  const [cardLink, setCardLink] = useState('');

  const [logoUrl, setLogoUrl] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [metaPixelId, setMetaPixelId] = useState('');
  const [linkedinPartnerId, setLinkedinPartnerId] = useState('');
  const [savingAnalytics, setSavingAnalytics] = useState(false);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      try {
        const [pSnap, cSnap, brandingSnap, homeSnap] = await Promise.all([
          getDocs(collection(db, 'pages')),
          getDocs(collection(db, 'categories')),
          getDoc(doc(db, 'settings', 'branding')),
          getDoc(doc(db, 'settings', 'homepage')),
        ]);
        setPages(pSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setMenuCats(
          cSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .sort((a, b) => (a.order || 0) - (b.order || 0))
        );
        const branding = brandingSnap.data() as any;
        setLogoUrl(branding?.logoUrl || '');
        setMetaPixelId(branding?.metaPixelId || '');
        setLinkedinPartnerId(branding?.linkedinPartnerId || '');
        const home = homeSnap.data() as any;
        if (home) {
          setHomeTitle(home.heroTitle || '');
          setHomeSubtitle(home.heroSubtitle || '');
          setHomeAboutTitle(home.aboutTitle || '');
          setHomeAboutText(home.aboutText || '');
          setHomeCtaTitle(home.ctaTitle || '');
          setHomeCtaText(home.ctaText || '');
          setHomeCtaBtnText(home.ctaButtonText || '');
          setHomeCtaBtnLink(home.ctaButtonLink || '');
          setHomeCards(home.cards || []);
        }
      } catch (error) {
        console.error('Failed to load website configuration', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  const addPage = async (e: React.FormEvent) => {
    e.preventDefault();
    const docRef = await addDoc(collection(db, 'pages'), { title: pageTitle, slug: pageSlug });
    setPages(p => [...p, { id: docRef.id, title: pageTitle, slug: pageSlug }]);
    setPageTitle('');
    setPageSlug('');
  };

  const addHomeCard = (e: React.FormEvent) => {
    e.preventDefault();
    const newCard: HomeCard = {
      id: crypto.randomUUID(),
      title: cardTitle,
      text: cardText,
      link: cardLink || undefined,
    };
    setHomeCards(c => [...c, newCard]);
    setCardTitle('');
    setCardText('');
    setCardLink('');
  };

  const saveHomepage = async (e: React.FormEvent) => {
    e.preventDefault();
    await setDoc(
      doc(db, 'settings', 'homepage'),
      {
        heroTitle: homeTitle,
        heroSubtitle: homeSubtitle,
        aboutTitle: homeAboutTitle,
        aboutText: homeAboutText,
        ctaTitle: homeCtaTitle,
        ctaText: homeCtaText,
        ctaButtonText: homeCtaBtnText,
        ctaButtonLink: homeCtaBtnLink,
        cards: homeCards,
      },
      { merge: true }
    );
  };

  const updateCard = (id: string, field: keyof HomeCard, value: string) => {
    setHomeCards(cards => cards.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const removeCard = (id: string) => {
    setHomeCards(cards => cards.filter(c => c.id !== id));
  };

  const onMenuDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const ordered = [...menuCats].sort((a, b) => (a.order || 0) - (b.order || 0));
    const [moved] = ordered.splice(result.source.index, 1);
    ordered.splice(result.destination.index, 0, moved);
    const updated = ordered.map((c, idx) => ({ ...c, order: idx }));
    setMenuCats(updated);
    const batch = writeBatch(db);
    updated.forEach((c) => batch.update(doc(db, 'categories', c.id), { order: c.order }));
    await batch.commit();
  };

  const uploadLogo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logoFile) return;
    try {
      setLogoUploading(true);
      const key = `site/logo-${Date.now()}-${logoFile.name}`;
      const r = ref(storage, key);
      await uploadBytes(r, logoFile, { contentType: logoFile.type });
      const url = await getDownloadURL(r);
      await setDoc(doc(db, 'settings', 'branding'), { logoUrl: url }, { merge: true });
      setLogoUrl(url);
      setLogoFile(null);
    } catch (err: any) {
      alert(err.message || 'Upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  const saveAnalytics = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingAnalytics(true);
      await setDoc(
        doc(db, 'settings', 'branding'),
        { metaPixelId: metaPixelId || null, linkedinPartnerId: linkedinPartnerId || null },
        { merge: true }
      );
    } catch (err: any) {
      alert(err.message || 'Save failed');
    } finally {
      setSavingAnalytics(false);
    }
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage the website design.</p>;

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Website Design</h1>
      <div className="flex gap-2">
        <button onClick={() => setTab('home')} className={`btn-sm ${tab === 'home' ? 'btn' : 'btn-outline'}`}>Homepage</button>
        <button onClick={() => setTab('pages')} className={`btn-sm ${tab === 'pages' ? 'btn' : 'btn-outline'}`}>Pages</button>
        <button onClick={() => setTab('menu')} className={`btn-sm ${tab === 'menu' ? 'btn' : 'btn-outline'}`}>Menu</button>
        <button onClick={() => setTab('branding')} className={`btn-sm ${tab === 'branding' ? 'btn' : 'btn-outline'}`}>Branding</button>
      </div>

      {tab === 'pages' && (
        <div className="grid gap-4">
          <form onSubmit={addPage} className="grid gap-2 max-w-md">
            <input className="input" placeholder="Title" value={pageTitle} onChange={e => setPageTitle(e.target.value)} required />
            <input className="input" placeholder="Slug" value={pageSlug} onChange={e => setPageSlug(e.target.value)} required />
            <button type="submit" className="btn btn-sm w-fit">Add Page</button>
          </form>
          <ul className="grid gap-2">
            {pages.map(p => (
              <li key={p.id} className="border p-2 rounded">
                <span className="font-medium">{p.title}</span> – /{p.slug}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'menu' && (
        <div className="grid gap-4">
          <p>Drag to reorder menu categories:</p>
          <DragDropContext onDragEnd={onMenuDragEnd}>
            <Droppable droppableId="menu">
              {(provided) => (
                <ul ref={provided.innerRef} {...provided.droppableProps} className="grid gap-2">
                  {menuCats
                    .slice()
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .map((m, index) => (
                      <Draggable key={m.id} draggableId={m.id} index={index}>
                        {(prov) => (
                          <li
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            {...prov.dragHandleProps}
                            className="border p-2 rounded"
                          >
                            {m.name}
                          </li>
                        )}
                      </Draggable>
                    ))}
                  {provided.placeholder}
                </ul>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      )}

      {tab === 'branding' && (
        <div className="grid gap-4">
          <form onSubmit={uploadLogo} className="grid gap-2 max-w-md">
            {logoUrl && (
              <Image
                src={logoUrl}
                alt="logo"
                width={48}
                height={48}
                className="h-12 object-contain"
              />
            )}
            <input type="file" accept="image/*" onChange={e => setLogoFile(e.target.files?.[0] || null)} />
            <button type="submit" className="btn btn-sm w-fit" disabled={!logoFile || logoUploading}>
              {logoUploading ? 'Uploading…' : 'Upload Logo'}
            </button>
          </form>
          <form onSubmit={saveAnalytics} className="grid gap-2 max-w-md">
            <input
              className="input"
              placeholder="Meta Pixel ID"
              value={metaPixelId}
              onChange={e => setMetaPixelId(e.target.value)}
            />
            <input
              className="input"
              placeholder="LinkedIn Partner ID"
              value={linkedinPartnerId}
              onChange={e => setLinkedinPartnerId(e.target.value)}
            />
            <button type="submit" className="btn btn-sm w-fit" disabled={savingAnalytics}>
              {savingAnalytics ? 'Saving…' : 'Save Analytics'}
            </button>
          </form>
        </div>
      )}

      {tab === 'home' && (
        <div className="grid gap-4">
          <form onSubmit={saveHomepage} className="grid gap-2 max-w-md">
            <input
              className="input"
              placeholder="Hero title"
              value={homeTitle}
              onChange={e => setHomeTitle(e.target.value)}
            />
            <input
              className="input"
              placeholder="Hero subtitle"
              value={homeSubtitle}
              onChange={e => setHomeSubtitle(e.target.value)}
            />
            <input
              className="input"
              placeholder="About title"
              value={homeAboutTitle}
              onChange={e => setHomeAboutTitle(e.target.value)}
            />
            <textarea
              className="textarea"
              placeholder="About text"
              value={homeAboutText}
              onChange={e => setHomeAboutText(e.target.value)}
            />
            <input
              className="input"
              placeholder="CTA title"
              value={homeCtaTitle}
              onChange={e => setHomeCtaTitle(e.target.value)}
            />
            <textarea
              className="textarea"
              placeholder="CTA text"
              value={homeCtaText}
              onChange={e => setHomeCtaText(e.target.value)}
            />
            <input
              className="input"
              placeholder="CTA button text"
              value={homeCtaBtnText}
              onChange={e => setHomeCtaBtnText(e.target.value)}
            />
            <input
              className="input"
              placeholder="CTA button link"
              value={homeCtaBtnLink}
              onChange={e => setHomeCtaBtnLink(e.target.value)}
            />
            <button type="submit" className="btn btn-sm w-fit">Save Homepage</button>
          </form>
          <form onSubmit={addHomeCard} className="grid gap-2 max-w-md">
            <input className="input" placeholder="Card title" value={cardTitle} onChange={e => setCardTitle(e.target.value)} required />
            <textarea className="textarea" placeholder="Card text" value={cardText} onChange={e => setCardText(e.target.value)} required />
            <input className="input" placeholder="Link (optional)" value={cardLink} onChange={e => setCardLink(e.target.value)} />
            <button type="submit" className="btn btn-sm w-fit">Add Card</button>
          </form>
          <ul className="grid gap-2">
            {homeCards.map(c => (
              <li key={c.id} className="border p-2 rounded grid gap-2">
                <input className="input" value={c.title} onChange={e => updateCard(c.id, 'title', e.target.value)} />
                <textarea className="textarea" value={c.text} onChange={e => updateCard(c.id, 'text', e.target.value)} />
                <input className="input" value={c.link || ''} onChange={e => updateCard(c.id, 'link', e.target.value)} placeholder="Link" />
                <button onClick={() => removeCard(c.id)} className="btn btn-xs btn-outline w-fit">Delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
