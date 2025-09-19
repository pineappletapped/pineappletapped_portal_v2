"use client";
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, getDoc as getDoc2, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

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

  // Invite a new member by email and assign a role. Only client_admin or staff can invite.
  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteLoading(true);
    try {
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
    (async () => {
      const orgSnap = await getDoc(doc(db, 'orgs', orgId));
      setOrg({ id: orgSnap.id, ...orgSnap.data() });
      // Members: query memberships by orgId
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('orgId', '==', orgId)));
      const mems = memSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
      // Fetch user docs for each membership
      const userPromises = mems.map((m) => getDoc(doc(db, 'users', m.userId)));
      const userSnaps = await Promise.all(userPromises);
      setMembers(
        mems.map((m, i) => {
          const u = userSnaps[i];
          return { id: u.id, ...u.data(), role: m.role };
        })
      );
      // Determine current user's role and staff flag
      const user = auth.currentUser;
      if (user) {
        const myMem = mems.find((m) => m.userId === user.uid);
        setMyRole(myMem?.role || null);
        // Check staff
        const uDocSnap = await getDoc(doc(db, 'users', user.uid));
        setIsStaff((uDocSnap.data() as any)?.isStaff === true);
      }
      // Brand packs
      const bpSnap = await getDocs(query(collection(db, 'brandPacks'), where('orgId', '==', orgId)));
      setBrandPacks(bpSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // Projects
      const projSnap = await getDocs(query(collection(db, 'projects'), where('orgId', '==', orgId)));
      setProjects(projSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
  }, [orgId]);

  if (!orgId) return <p>Organisation id missing.</p>;
  if (loading || !org) return <p>Loading…</p>;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{org.name}</h1>
        </div>
        <Link href={`/orgs/${org.id}/brand-packs/new`} className="btn">New Brand Pack</Link>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Members</h2>
        <div className="grid gap-2">
          {members.length === 0 ? <p>No members.</p> : members.map((m) => (
            <div key={m.id} className="flex justify-between text-sm">
              <div>{m.fullName || m.email || m.id}</div>
              <div className="text-gray-500">{m.role}</div>
            </div>
          ))}
        </div>
        {/* Invite new member */}
        {(myRole === 'client_admin' || isStaff) && (
          <form onSubmit={inviteMember} className="mt-4 grid gap-2">
            <h3 className="font-medium text-sm">Invite Member</h3>
            <input
              type="email"
              className="input"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
            <select
              className="input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="client_member">Client Member</option>
              <option value="client_admin">Client Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          {/* Optional scopes as comma separated IDs for contractor access */}
          <input
            type="text"
            className="input"
            placeholder="Scopes (comma separated project or asset IDs)"
            value={inviteScopes}
            onChange={(e) => setInviteScopes(e.target.value)}
          />
          {/* Expiration in days */}
          <input
            type="number"
            className="input"
            placeholder="Expires in days (optional)"
            min="0"
            value={inviteExpiry}
            onChange={(e) => setInviteExpiry(e.target.value)}
          />
            <button type="submit" className="btn" disabled={inviteLoading}>
              {inviteLoading ? 'Inviting…' : 'Send Invite'}
            </button>
          </form>
        )}
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Brand Packs</h2>
        <div className="grid gap-2">
          {brandPacks.length === 0 ? <p>No brand packs.</p> : brandPacks.map((b) => (
            <div key={b.id} className="flex items-center gap-3">
              {b.logoUrl && (
                <Image
                  src={b.logoUrl}
                  alt={`${b.name} logo`}
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded object-contain"
                />
              )}
              <div className="font-medium">{b.name}</div>
              <div className="flex gap-2">
                {b.primaryColor && <span className="inline-block h-3 w-3 rounded-full" style={{ background: b.primaryColor }} />}
                {b.secondaryColor && <span className="inline-block h-3 w-3 rounded-full" style={{ background: b.secondaryColor }} />}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Projects</h2>
        <div className="grid gap-2">
          {projects.length === 0 ? <p>No projects.</p> : projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="hover:underline">
              {p.name || 'Untitled'}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}