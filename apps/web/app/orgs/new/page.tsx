"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, setDoc, doc } from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';
import PortalHero from '@/components/PortalHero';

/**
 * Allows creation of a new organisation. Upon creation, the current user will
 * automatically be assigned the role of `client_admin` for the new org via a
 * membership document. After creation, the user is redirected to the new
 * organisation's detail page.
 */
export default function NewOrgPage() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const createOrg = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
      alert('You must be signed in to create an organisation.');
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      alert('Please enter an organisation name.');
      return;
    }

    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'orgs'), {
        name: trimmedName,
        createdAt: serverTimestamp(),
      });
      const orgId = docRef.id;
      await setDoc(doc(db, 'memberships', `${orgId}_${user.uid}`), {
        orgId,
        userId: user.uid,
        role: 'client_admin',
        createdAt: serverTimestamp(),
      });
      router.push(`/orgs/${orgId}`);
    } catch (error: any) {
      console.error(error);
      alert(error?.message || 'Error creating organisation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalContainer>
      <div className="grid gap-8">
        <PortalHero
          eyebrow="Organisations"
          title="Create a new organisation"
          description="Set up a collaborative workspace that keeps your projects, brand packs, and approvals aligned."
          quickActions={[
            {
              label: 'Back to organisations',
              description: 'Return to your organisation list',
              href: '/orgs',
            },
          ]}
        />

        <section className="mx-auto w-full max-w-xl rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm">
          <form onSubmit={createOrg} className="grid gap-5">
            <div className="grid gap-2">
              <label htmlFor="organisation-name" className="text-sm font-medium text-slate-700">
                Organisation name
              </label>
              <input
                id="organisation-name"
                className="input"
                placeholder="e.g. Acme Studios"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
              />
              <p className="text-xs text-slate-500">
                This name will appear on proposals, call sheets, and shared assets for your collaborators.
              </p>
            </div>

            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Creating…' : 'Create organisation'}
            </button>
          </form>
        </section>
      </div>
    </PortalContainer>
  );
}