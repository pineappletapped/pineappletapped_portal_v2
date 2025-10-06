"use client";
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { auth, db, ensureFirebase } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';
import PortalContainer from '@/components/PortalContainer';
import PortalHero from '@/components/PortalHero';

/**
 * Shows details for a single organisation, including its members, brand packs and
 * projects. This page fetches the organisation by id and displays related
 * collections. Projects currently must have an `orgId` field set when created.
 */
export default function OrgDetailPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params?.orgId;
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [brandPacks, setBrandPacks] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('client_member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteExpiry, setInviteExpiry] = useState('');
  const [inviteScopes, setInviteScopes] = useState('');

  const canInvite = myRole === 'client_admin' || isStaff;

  const heroMetrics = useMemo(
    () => [
      { label: 'Members', value: members.length.toString() },
      { label: 'Brand packs', value: brandPacks.length.toString() },
      { label: 'Projects', value: projects.length.toString() },
    ],
    [brandPacks.length, members.length, projects.length]
  );

  const handleInviteScroll = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const target = document.getElementById('org-invite-form');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const heroQuickActions = useMemo(() => {
    const actions: { label: string; description: string; href?: string; onClick?: () => void }[] = [];
    if (org?.id) {
      actions.push({
        label: 'New brand pack',
        description: 'Upload updated guidelines and assets',
        href: `/orgs/${org.id}/brand-packs/new`,
      });
    }
    if (canInvite) {
      actions.push({
        label: 'Invite a teammate',
        description: 'Share access to this organisation',
        onClick: handleInviteScroll,
      });
    }
    return actions;
  }, [canInvite, handleInviteScroll, org?.id]);

  // Invite a new member by email and assign a role. Only client_admin or staff can invite.
  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteLoading(true);
    try {
      await ensureFirebase();
      // Find user by email
      const uSnap = await getDocs(query(collection(db, 'users'), where('email', '==', inviteEmail)));
      if (uSnap.empty) {
        alert('No user found with that email');
        return;
      }
      const uDoc = uSnap.docs[0];
      const userId = uDoc.id;
      // Create or update membership
      const expiresAtValue = inviteExpiry ? Timestamp.fromDate(new Date(Date.now() + Number(inviteExpiry) * 24 * 60 * 60 * 1000)) : null;
      await setDoc(doc(db, 'memberships', `${orgId}_${userId}`), {
        orgId,
        userId,
        role: inviteRole,
        scopes: inviteScopes ? inviteScopes.split(',').map(s => s.trim()).filter(Boolean) : null,
        expiresAt: expiresAtValue,
        createdAt: serverTimestamp()
      });
      // Reload members
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('orgId', '==', orgId)));
      const mems = memSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
      const userPromises = mems.map((m) => getDoc(doc(db, 'users', m.userId)));
      const userSnaps = await Promise.all(userPromises);
      setMembers(
        mems.map((m, i) => {
          const u = userSnaps[i];
          return { id: u.id, ...u.data(), role: m.role };
        })
      );
      setInviteEmail('');
      setInviteRole('client_member');
      setInviteExpiry('');
      setInviteScopes('');
      alert('Invitation successful');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error inviting member');
    } finally {
      setInviteLoading(false);
    }
  };

  useEffect(() => {
    if (!orgId) return;
    let active = true;

    (async () => {
      try {
        await ensureFirebase();
        if (!active) return;

        const orgSnap = await getDoc(doc(db, 'orgs', orgId));
        if (!orgSnap.exists()) {
          throw new Error('Organisation not found');
        }

        const memSnap = await getDocs(query(collection(db, 'memberships'), where('orgId', '==', orgId)));
        const memberships = memSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
        const userSnaps = await Promise.all(memberships.map((m) => getDoc(doc(db, 'users', m.userId))));
        const loadedMembers = memberships.map((m, index) => {
          const userDoc = userSnaps[index];
          return { id: userDoc.id, ...userDoc.data(), role: m.role };
        });

        const currentUser = auth.currentUser;
        let nextRole: string | null = null;
        let nextIsStaff = false;
        if (currentUser) {
          const myMembership = memberships.find((m) => m.userId === currentUser.uid);
          nextRole = myMembership?.role || null;
          const currentUserSnap = await getDoc(doc(db, 'users', currentUser.uid));
          const roles = extractUserRoles(currentUserSnap.data());
          nextIsStaff = hasRole(roles, ['admin', 'projects']);
        }

        const brandPackSnap = await getDocs(query(collection(db, 'brandPacks'), where('orgId', '==', orgId)));
        const loadedBrandPacks = brandPackSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const projectSnap = await getDocs(query(collection(db, 'projects'), where('orgId', '==', orgId)));
        const loadedProjects = projectSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (!active) return;

        setOrg({ id: orgSnap.id, ...orgSnap.data() });
        setMembers(loadedMembers);
        setMyRole(nextRole);
        setIsStaff(nextIsStaff);
        setBrandPacks(loadedBrandPacks);
        setProjects(loadedProjects);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load organisation details', error);
        if (active) {
          setOrg(null);
          setMembers([]);
          setBrandPacks([]);
          setProjects([]);
          setMyRole(null);
          setIsStaff(false);
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [orgId]);

  if (!orgId) {
    return (
      <PortalContainer>
        <div className="rounded-3xl border border-rose-100 bg-rose-50 p-6 text-sm text-rose-700">
          Organisation id missing.
        </div>
      </PortalContainer>
    );
  }

  if (loading) {
    return (
      <PortalContainer>
        <div className="grid gap-8">
          <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />
          <div className="grid gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`org-loading-${index}`}
                className="h-40 animate-pulse rounded-3xl border border-slate-200/70 bg-white"
              />
            ))}
          </div>
        </div>
      </PortalContainer>
    );
  }

  if (!org) {
    return (
      <PortalContainer>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-700">
          Organisation not found.
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-8">
        <PortalHero
          eyebrow="Organisations"
          title={org.name || 'Untitled organisation'}
          description="Collaborate with your team, share assets, and keep every project aligned with the right brand context."
          metrics={heroMetrics}
          quickActions={heroQuickActions}
        />

        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Team members</h2>
              <p className="text-sm text-slate-500">Manage who can access this organisation and the projects it contains.</p>
            </div>
            <span className="text-sm font-medium text-slate-500">{members.length} member{members.length === 1 ? '' : 's'}</span>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              {members.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-sm text-slate-500">
                  No members yet. Invite collaborators to share updates and files effortlessly.
                </div>
              ) : (
                members.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {member.fullName || member.email || member.id}
                      </p>
                      {member.email && (
                        <p className="text-xs text-slate-500">{member.email}</p>
                      )}
                    </div>
                    <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-600">
                      {(member.role || '').replace(/_/g, ' ') || 'member'}
                    </span>
                  </div>
                ))
              )}
            </div>

            {canInvite && (
              <form
                id="org-invite-form"
                onSubmit={inviteMember}
                className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 shadow-sm focus-within:border-slate-300"
              >
                <fieldset className="grid gap-3">
                  <legend className="text-sm font-semibold text-slate-700">Invite a member</legend>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500" htmlFor="invite-email">
                    Email address
                  </label>
                  <input
                    id="invite-email"
                    type="email"
                    className="input"
                    placeholder="name@email.com"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    required
                  />

                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500" htmlFor="invite-role">
                    Role
                  </label>
                  <select
                    id="invite-role"
                    className="input"
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value)}
                  >
                    <option value="client_member">Client member</option>
                    <option value="client_admin">Client admin</option>
                    <option value="viewer">Viewer</option>
                  </select>

                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500" htmlFor="invite-scopes">
                    Scopes (optional)
                  </label>
                  <input
                    id="invite-scopes"
                    type="text"
                    className="input"
                    placeholder="Comma separated project or asset IDs"
                    value={inviteScopes}
                    onChange={(event) => setInviteScopes(event.target.value)}
                  />

                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500" htmlFor="invite-expiry">
                    Expiry in days (optional)
                  </label>
                  <input
                    id="invite-expiry"
                    type="number"
                    className="input"
                    placeholder="e.g. 30"
                    min="0"
                    value={inviteExpiry}
                    onChange={(event) => setInviteExpiry(event.target.value)}
                  />

                  <button type="submit" className="btn mt-2" disabled={inviteLoading}>
                    {inviteLoading ? 'Inviting…' : 'Send invite'}
                  </button>
                </fieldset>
              </form>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Brand packs</h2>
              <p className="text-sm text-slate-500">Reference the latest logos, typography, and colour palettes before kicking off new work.</p>
            </div>
            <Link href={`/orgs/${org.id}/brand-packs/new`} className="btn btn-outline self-start sm:self-auto">
              Upload brand pack
            </Link>
          </div>

          <div className="mt-6 grid gap-3">
            {brandPacks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-sm text-slate-500">
                No brand packs yet. Add one to centralise your guidelines and share them with the team.
              </div>
            ) : (
              brandPacks.map((pack) => (
                <div
                  key={pack.id}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4">
                    {pack.logoUrl ? (
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                        <Image
                          src={pack.logoUrl}
                          alt={`${pack.name || 'Brand pack'} logo`}
                          width={48}
                          height={48}
                          className="h-12 w-12 rounded-2xl object-contain"
                        />
                      </span>
                    ) : (
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-600">
                        {pack.name?.slice(0, 2)?.toUpperCase() || 'BP'}
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{pack.name || 'Untitled brand pack'}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {pack.primaryColor && (
                          <span
                            className="inline-flex h-4 w-4 rounded-full border border-slate-200"
                            style={{ background: pack.primaryColor }}
                            aria-label="Primary colour"
                          />
                        )}
                        {pack.secondaryColor && (
                          <span
                            className="inline-flex h-4 w-4 rounded-full border border-slate-200"
                            style={{ background: pack.secondaryColor }}
                            aria-label="Secondary colour"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    {pack.updatedAt?.toDate ? `Updated ${pack.updatedAt.toDate().toLocaleDateString()}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
              <p className="text-sm text-slate-500">Stay on top of in-flight productions connected to this organisation.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-sm text-slate-500">
                No projects yet. Kick things off from the Projects page to see them appear here.
              </div>
            ) : (
              projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="group flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white p-5 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                >
                  <span className="text-sm font-semibold text-slate-900">{project.name || 'Untitled project'}</span>
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">View project workspace</span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </PortalContainer>
  );
}