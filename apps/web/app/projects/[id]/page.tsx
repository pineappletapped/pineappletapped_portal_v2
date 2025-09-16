
'use client';
import { useEffect, useState, useCallback } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import PortalContainer from '@/components/PortalContainer';
import type { Venue } from '@/lib/venues';

export default function ProjectDetail({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [brandPacks, setBrandPacks] = useState<any[]>([]);

  // Internal messages (staff/contractor comms)
  const [internalMessages, setInternalMessages] = useState<any[]>([]);
  const [newInternalMessage, setNewInternalMessage] = useState('');
  const [isStaffUser, setIsStaffUser] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueSelection, setVenueSelection] = useState('');
  const [savingVenue, setSavingVenue] = useState(false);

  // Signature request
  const [pendingSignature, setPendingSignature] = useState<any | null>(null);

  // Helper to load messages in order
  const loadMessages = useCallback(async () => {
    const mq = query(collection(db,'messages'), where('projectId','==', params.id));
    const md = await getDocs(mq);
    const items = md.docs.map(d => ({ id: d.id, ...d.data() }));
    items.sort((a:any,b:any)=>{
      const at=a.createdAt?.toMillis? a.createdAt.toMillis():0;
      const bt=b.createdAt?.toMillis? b.createdAt.toMillis():0;
      return at-bt;
    });
    setMessages(items);
  }, [params.id]);

  // Load internal contractor messages
  const loadInternalMessages = useCallback(async () => {
    const iq = query(collection(db,'contractorMessages'), where('projectId','==', params.id));
    const idocs = await getDocs(iq);
    const items = idocs.docs.map(d => ({ id: d.id, ...d.data() }));
    items.sort((a:any,b:any)=>{
      const at=a.createdAt?.toMillis? a.createdAt.toMillis():0;
      const bt=b.createdAt?.toMillis? b.createdAt.toMillis():0;
      return at-bt;
    });
    setInternalMessages(items);
  }, [params.id]);

  const handleVenueSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project) return;
    setSavingVenue(true);
    try {
      const selected = venueSelection
        ? venues.find((v) => v.id === venueSelection) || null
        : null;
      await updateDoc(doc(db, 'projects', project.id), {
        venueId: venueSelection || null,
        venueName: selected?.name || null,
      });
      setProject((prev: any) =>
        prev
          ? {
              ...prev,
              venueId: venueSelection || null,
              venueName: selected?.name || null,
            }
          : prev
      );
    } catch (err) {
      console.error('update venue failed', err);
      alert('Failed to update the venue. Please try again.');
    } finally {
      setSavingVenue(false);
    }
  };

  useEffect(()=>{
    (async()=>{
      const pd = await getDoc(doc(db, 'projects', params.id));
      if (!pd.exists()) {
        setProject(null);
        return;
      }
      const data = pd.data();
      setProject({ id: pd.id, ...data });
      setVenueSelection(((data as any)?.venueId as string) || '');
      const aq = query(collection(db,'assets'), where('projectId','==', params.id));
      const ad = await getDocs(aq);
      setAssets(ad.docs.map(d=>({id:d.id, ...d.data()})));
      await loadMessages();
      await loadInternalMessages();
      // Load available brand packs for this project's organisation
      if (data?.orgId) {
        const bq = query(collection(db,'brandPacks'), where('orgId','==', data.orgId));
        const bds = await getDocs(bq);
        setBrandPacks(bds.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      const venueSnap = await getDocs(collection(db,'venues'));
      const venueList = venueSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) } as Venue))
        .sort((a, b) => a.name.localeCompare(b.name));
      setVenues(venueList);
      if (!(data as any)?.venueName && (data as any)?.venueId) {
        const match = venueList.find((v) => v.id === (data as any).venueId);
        if (match) {
          setProject((prev: any) => (prev ? { ...prev, venueName: match.name } : prev));
        }
      }
      // Determine if current user is staff
      const user = auth.currentUser;
      if (user) {
        const uSnap = await getDoc(doc(db, 'users', user.uid));
        setIsStaffUser((uSnap.data() as any)?.isStaff === true);
        // Load signature request for this project & user
        const sigQ = query(collection(db,'signatures'), where('projectId','==', params.id), where('signerUid','==', user.uid), where('status','==','requested'));
        const sigSnap = await getDocs(sigQ);
        if (!sigSnap.empty) {
          setPendingSignature({ id: sigSnap.docs[0].id, ...sigSnap.docs[0].data() });
        }
      }
    })();
  },[params.id, loadMessages, loadInternalMessages]);

  // Send a new message
  const sendMessage = async () => {
    const user = auth.currentUser;
    if (!user) return alert('You must be signed in to send messages');
    const body = newMessage.trim();
    if (!body) return;
    const msgRef = await addDoc(collection(db,'messages'), {
      projectId: params.id,
      uid: user.uid,
      body,
      createdAt: serverTimestamp()
    });
    // Create notifications for other project members
    try {
      // Fetch project to get orgId
      const pSnap = await getDoc(doc(db, 'projects', params.id));
      const pData = pSnap.data() as any;
      const orgId = pData?.orgId;
      if (orgId) {
        // Find all memberships for org
        const memSnap = await getDocs(query(collection(db,'memberships'), where('orgId','==', orgId)));
        const userIds = memSnap.docs.map(m => (m.data() as any).userId).filter(uid => uid !== user.uid);
        for (const uid of userIds) {
          await addDoc(collection(db,'notifications'), {
            userId: uid,
            message: `New message on project ${pData?.name || params.id}`,
            createdAt: serverTimestamp(),
          });
        }
      }
    } catch (err) {
      console.error('notification error', err);
    }
    setNewMessage('');
    await loadMessages();
  };

  // Send internal contractor message (only for staff)
  const sendInternalMessage = async () => {
    const user = auth.currentUser;
    if (!user) return alert('You must be signed in');
    const body = newInternalMessage.trim();
    if (!body) return;
    await addDoc(collection(db,'contractorMessages'), {
      projectId: params.id,
      fromUid: user.uid,
      body,
      createdAt: serverTimestamp()
    });
    setNewInternalMessage('');
    await loadInternalMessages();
  };

  // Update project brand pack
  const updateBrandPack = async (packId: string) => {
    if (!project) return;
    await updateDoc(doc(db, 'projects', params.id), { brandPackId: packId || null });
    setProject({ ...project, brandPackId: packId || null });
  };

  if (!project) return <div>Loading…</div>;
  const projectVenueId = project?.venueId || '';
  const savedVenue = projectVenueId
    ? venues.find((v) => v.id === projectVenueId) || null
    : null;
  const currentVenueName = savedVenue?.name || project?.venueName || '';
  const editingVenue = venueSelection
    ? venues.find((v) => v.id === venueSelection) || null
    : null;

  return (
    <PortalContainer>
      <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <div className="text-sm text-gray-500">{project.reference || '—'} · <StatusBadge status={project.status || 'draft'} /></div>
        </div>
        <Link href={`/projects/${project.id}/upload`} className="btn">Upload Asset</Link>
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Venue</h2>
        {currentVenueName ? (
          <div className="grid gap-2 text-sm text-gray-700">
            <p>
              <span className="font-medium">Current Venue:</span> {currentVenueName}
            </p>
            {savedVenue?.address && (
              <p>
                <span className="font-medium">Address:</span> {savedVenue.address}
              </p>
            )}
            {savedVenue?.mileageFromWellingborough !== null &&
              savedVenue?.mileageFromWellingborough !== undefined && (
                <p>
                  <span className="font-medium">Distance from Wellingborough:</span>{' '}
                  {savedVenue.mileageFromWellingborough} miles
                </p>
              )}
            {savedVenue?.parkingRate !== null && savedVenue?.parkingRate !== undefined && (
              <p>
                <span className="font-medium">Fixed Parking Rate:</span> £
                {Number(savedVenue.parkingRate).toFixed(2)}
              </p>
            )}
            {savedVenue?.parkingTips && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Parking Tips:</span> {savedVenue.parkingTips}
              </p>
            )}
            {savedVenue?.accessInfo && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Access Information:</span> {savedVenue.accessInfo}
              </p>
            )}
            {savedVenue?.internetInfo && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Internet Details:</span> {savedVenue.internetInfo}
              </p>
            )}
            {savedVenue?.notes && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Notes:</span> {savedVenue.notes}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600">No venue linked to this project.</p>
        )}
        {isStaffUser && (
          <form onSubmit={handleVenueSave} className="mt-4 grid gap-2">
            <label className="text-sm font-medium">Update Venue</label>
            <select
              className="input"
              value={venueSelection}
              onChange={(e) => setVenueSelection(e.target.value)}
            >
              <option value="">Custom / none</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500">
              Choose &ldquo;Custom / none&rdquo; to remove the linked venue from this project.
            </p>
            {editingVenue && (
              <div className="rounded bg-slate-100 p-2 text-xs text-gray-600 grid gap-1">
                {editingVenue.mileageFromWellingborough !== null &&
                  editingVenue.mileageFromWellingborough !== undefined && (
                    <div>
                      Mileage: {editingVenue.mileageFromWellingborough} miles
                    </div>
                  )}
                {editingVenue.parkingRate !== null && editingVenue.parkingRate !== undefined && (
                  <div>
                    Parking Rate: £{Number(editingVenue.parkingRate).toFixed(2)}
                  </div>
                )}
                {editingVenue.parkingTips && (
                  <div className="truncate">
                    <span className="font-medium">Parking:</span> {editingVenue.parkingTips}
                  </div>
                )}
                {editingVenue.accessInfo && (
                  <div className="truncate">
                    <span className="font-medium">Access:</span> {editingVenue.accessInfo}
                  </div>
                )}
                {editingVenue.internetInfo && (
                  <div className="truncate">
                    <span className="font-medium">Internet:</span> {editingVenue.internetInfo}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button type="submit" className="btn btn-sm w-fit" disabled={savingVenue}>
                {savingVenue ? 'Saving…' : 'Save Venue'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setVenueSelection(projectVenueId || '')}
                disabled={savingVenue}
              >
                Reset
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Assets</h2>
        <div className="grid gap-2">
          {assets.map(a => (
            <Link key={a.id} href={`/projects/${project.id}/assets/${a.id}`} className="hover:underline">{a.name || a.storageKey}</Link>
          )) || <p>No assets.</p>}
        </div>
        {/* Compare Versions */}
        {assets.length > 1 && (
          <div className="mt-2">
            <Link href={`/projects/${project.id}/compare`} className="text-sm text-blue-600 underline">Compare Versions</Link>
          </div>
        )}
      </div>
      {/* Brand pack selector */}
      <div className="card">
        <h2 className="font-semibold mb-2">Brand Pack</h2>
        {brandPacks.length === 0 ? (
          <p className="text-sm">No brand packs available for this organisation.</p>
        ) : (
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Selected:</span>
              <span className="font-medium">
                {project.brandPackId ? brandPacks.find((b) => b.id === project.brandPackId)?.name || '—' : 'None'}
              </span>
            </div>
            <select
              className="input mt-2"
              value={project.brandPackId || ''}
              onChange={(e) => updateBrandPack(e.target.value)}
            >
              <option value="">No brand pack</option>
              {brandPacks.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Brand guidelines task */}
      <div className="card">
        <h2 className="font-semibold mb-2">Brand Guidelines</h2>
        {project.brandGuidelinesCompleted ? (
          <p className="text-sm text-green-700">Completed</p>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-red-600">Not configured</p>
            <Link href={`/projects/${project.id}/brand-wizard`} className="btn-sm w-fit">Complete Guidelines</Link>
          </div>
        )}
      </div>

      {/* Tasks link */}
      <div className="card">
        <h2 className="font-semibold mb-2">Project Tasks</h2>
        <Link href={`/projects/${project.id}/tasks`} className="btn-sm w-fit">View Tasks</Link>
      </div>
      <div className="card">
        <h2 className="font-semibold mb-2">Messages</h2>
        <div className="grid gap-2 mb-3">
          {messages.length === 0 ? (
            <p>No messages.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="text-sm">
                {m.body}
              </div>
            ))
          )}
        </div>
        {/* Message input */}
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Write a message…"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
          />
          <button type="button" className="btn" onClick={sendMessage}>Send</button>
        </div>
      </div>
      {isStaffUser && (
        <div className="card">
          <h2 className="font-semibold mb-2">Internal Notes</h2>
          <div className="grid gap-2 mb-3">
            {internalMessages.length === 0 ? (
              <p>No internal messages.</p>
            ) : (
              internalMessages.map((m) => (
                <div key={m.id} className="text-sm">
                  {m.body}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Write an internal note…"
              value={newInternalMessage}
              onChange={(e) => setNewInternalMessage(e.target.value)}
            />
            <button type="button" className="btn" onClick={sendInternalMessage}>Send</button>
          </div>
        </div>
      )}
      {/* Signature request */}
      {pendingSignature && (
        <div className="card">
          <h2 className="font-semibold mb-2">Signature Required</h2>
          <p className="text-sm mb-2">A document requires your signature for this project.</p>
          <Link href={`/projects/${project.id}/signature`} className="btn-sm">Review & Sign</Link>
        </div>
      )}
      </div>
    </PortalContainer>
  );
}
