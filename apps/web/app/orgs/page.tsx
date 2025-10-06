"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ensureFirebase, loadAuthModule } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import PortalContainer from '@/components/PortalContainer';
import PortalHero from '@/components/PortalHero';

/**
 * Lists all organisations that the currently signed in user is a member of.
 * Users can navigate into an organisation or create a new one. Memberships are
 * stored in the `memberships` collection with an `orgId_userId` id pattern and
 * fields { orgId, userId, role }. This page fetches memberships for the
 * authenticated user and then loads the associated org documents.
 */
export default function OrgsPage() {
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<{ id: string; name: string; role?: string }[]>([]);
  const ensuringDefault = useRef(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || !db) {
          throw new Error('Firebase auth or database is unavailable.');
        }

        const { onAuthStateChanged } = await loadAuthModule();
        if (cancelled) {
          return;
        }
        if (typeof onAuthStateChanged !== 'function') {
          throw new Error('Firebase auth listener helper is unavailable.');
        }

        unsubscribe = onAuthStateChanged(auth, async (user: any) => {
          if (cancelled) {
            return;
          }

          if (!user) {
            setOrgs([]);
            setLoading(false);
            return;
          }

          try {
            const memSnap = await getDocs(
              query(collection(db, 'memberships'), where('userId', '==', user.uid))
            );
            const memberships = memSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
            const orgPromises = memberships.map((m) => getDoc(doc(db, 'orgs', m.orgId)));
            const orgDocs = await Promise.all(orgPromises);
            let list = orgDocs.map((docSnap) => {
              const orgId = docSnap.id;
              const m = memberships.find((mm) => mm.orgId === orgId);
              return { id: orgId, name: (docSnap.data() as any)?.name || 'Untitled', role: m?.role };
            });

            if (list.length === 0 && !ensuringDefault.current) {
              ensuringDefault.current = true;
              try {
                const res = await fetch('/api/orgs/ensure-default', { method: 'POST' });
                if (res.ok) {
                  const payload = (await res.json()) as {
                    organisation?: { id: string; name: string };
                  };
                  if (payload.organisation) {
                    list = [
                      {
                        id: payload.organisation.id,
                        name: payload.organisation.name || 'Untitled organisation',
                        role: 'client_admin',
                      },
                    ];
                  }
                }
              } catch (defaultError) {
                console.error('Failed to ensure default organisation', defaultError);
              }
            }

            setOrgs(list);
          } catch (error) {
            console.error('Failed to load organisations', error);
            setOrgs([]);
          } finally {
            if (!cancelled) {
              setLoading(false);
            }
          }
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to initialise Firebase for organisations list', error);
          setOrgs([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const heroMetrics = useMemo(
    () => [
      {
        label: 'Active organisations',
        value: loading ? '—' : orgs.length.toString(),
      },
    ],
    [loading, orgs.length]
  );

  return (
    <PortalContainer>
      <div className="grid gap-8">
        <PortalHero
          eyebrow="Client portal"
          title="Manage organisations"
          description="Switch between your organisations, invite collaborators, and keep project spaces aligned with your brand."
          metrics={heroMetrics}
          quickActions={[
            {
              label: 'Create organisation',
              description: 'Set up a new workspace for your team',
              href: '/orgs/new',
            },
          ]}
        />

        <section className="rounded-3xl border border-slate-200/70 bg-white/70 p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Your organisations</h2>
              <p className="text-sm text-slate-500">
                Select an organisation to review brand packs, project activity, and shared resources.
              </p>
            </div>
            <Link href="/orgs/new" className="btn self-start sm:self-auto">
              New organisation
            </Link>
          </div>

          <div className="mt-6 grid gap-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`org-skeleton-${index}`}
                  className="h-20 animate-pulse rounded-2xl border border-slate-200/60 bg-slate-100"
                />
              ))
            ) : orgs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-10 text-center text-sm text-slate-500">
                You are not a member of any organisations yet. Create one to unlock collaborative project spaces and shared
                branding resources.
              </div>
            ) : (
              orgs.map((org) => (
                <Link
                  key={org.id}
                  href={`/orgs/${org.id}`}
                  className="group flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white p-5 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-base font-semibold text-slate-900">{org.name}</span>
                    {org.role && (
                      <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                        {org.role.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    View organisation workspace
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </PortalContainer>
  );
}