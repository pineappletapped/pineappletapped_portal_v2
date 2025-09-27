
'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import PortalContainer from '@/components/PortalContainer';
import VenueMap from '@/components/VenueMap';
import AssetReleaseBadge, { getAssetReleaseMeta } from '@/components/AssetReleaseBadge';
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
  const [order, setOrder] = useState<any | null>(null);

  // Signature request
  const [pendingSignature, setPendingSignature] = useState<any | null>(null);
  const safeNumber = (value: any) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };
  const formatCurrency = (value: any) => `£${safeNumber(value).toFixed(2)}`;

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
      if (data?.orderId) {
        try {
          const orderSnap = await getDoc(doc(db, 'orders', data.orderId));
          if (orderSnap.exists()) {
            const orderData = orderSnap.data();
            setOrder(orderData ? { id: orderSnap.id, ...orderData } : null);
          } else {
            setOrder(null);
          }
        } catch (orderErr) {
          console.error('Failed to load linked order', orderErr);
          setOrder(null);
        }
      } else {
        setOrder(null);
      }
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
        const roles = extractUserRoles(uSnap.data());
        setIsStaffUser(hasRole(roles, ['admin', 'projects']));
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

  const fallbackLocationName = useMemo(() => {
    if (typeof project?.location === 'string' && project.location.trim()) {
      return project.location.trim();
    }
    if (typeof order?.location === 'string' && order.location.trim()) {
      return order.location.trim();
    }
    return '';
  }, [order?.location, project?.location]);
  const fallbackPostalCode = useMemo(() => {
    if (typeof project?.clientPostalCode === 'string' && project.clientPostalCode.trim()) {
      return project.clientPostalCode.trim();
    }
    if (typeof order?.clientPostalCode === 'string' && order.clientPostalCode.trim()) {
      return order.clientPostalCode.trim();
    }
    return '';
  }, [order?.clientPostalCode, project?.clientPostalCode]);

  if (!project) return <div>Loading…</div>;
  const projectVenueId = project?.venueId || '';
  const savedVenue = projectVenueId
    ? venues.find((v) => v.id === projectVenueId) || null
    : null;
  const currentVenueName = savedVenue?.name || project?.venueName || '';
  const editingVenue = venueSelection
    ? venues.find((v) => v.id === venueSelection) || null
    : null;
  const budgetTotals = project?.budgetTotals || null;
  const budgetItems = Array.isArray(project?.budgetItems)
    ? (project.budgetItems as any[])
    : [];

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold text-gray-900">{project.name || 'Project overview'}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
              <span>{project.reference || 'No reference'}</span>
              <StatusBadge status={project.status || 'draft'} />
            </div>
          </div>
          <Link href={`/projects/${project.id}/upload`} className="btn self-start">Upload Asset</Link>
        </div>
        <div className="card space-y-3">
          <h2 className="text-base font-semibold text-gray-900">Venue</h2>
        {currentVenueName ? (
          <div className="grid gap-2 text-sm text-gray-700">
            <p>
              <span className="font-medium">Current venue:</span> {currentVenueName}
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
                <span className="font-medium">Fixed parking rate:</span> £
                {Number(savedVenue.parkingRate).toFixed(2)}
              </p>
            )}
            {savedVenue?.parkingTips && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Parking tips:</span> {savedVenue.parkingTips}
              </p>
            )}
            {savedVenue?.accessInfo && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Access information:</span> {savedVenue.accessInfo}
              </p>
            )}
            {savedVenue?.internetInfo && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Internet details:</span> {savedVenue.internetInfo}
              </p>
            )}
            {savedVenue?.notes && (
              <p className="whitespace-pre-line">
                <span className="font-medium">Notes:</span> {savedVenue.notes}
              </p>
            )}
            <VenueMap venue={savedVenue} className="mt-2" />
          </div>
        ) : fallbackLocationName ? (
          <div className="grid gap-2 text-sm text-gray-700">
            <p>
              <span className="font-medium">Filming address:</span> {fallbackLocationName}
            </p>
            {fallbackPostalCode && (
              <p>
                <span className="font-medium">Postcode:</span> {fallbackPostalCode}
              </p>
            )}
            <p className="text-xs text-gray-500">
              This location was provided during checkout. Link a saved venue once production is confirmed.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-600">No venue information has been provided yet.</p>
        )}
        {isStaffUser && (
          <form onSubmit={handleVenueSave} className="mt-4 grid gap-3 text-sm">
            <label className="font-medium text-gray-900">Link a saved venue</label>
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
              Choose &ldquo;Custom / none&rdquo; to keep using the client supplied address.
            </p>
            {editingVenue && (
              <div className="grid gap-1 rounded bg-slate-100 p-2 text-xs text-gray-600">
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
                <VenueMap venue={editingVenue} className="mt-1" height={200} />
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
      {budgetTotals ? (
        <div className="card p-4">
          <h2 className="mb-2 text-base font-semibold text-gray-900">Budget</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Net Revenue</span>
              <span>{formatCurrency(budgetTotals.netRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Gross Revenue</span>
              <span>{formatCurrency(budgetTotals.grossRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Labour</span>
              <span>{formatCurrency(budgetTotals.labour)}</span>
            </div>
            <div className="flex justify-between">
              <span>Kit</span>
              <span>{formatCurrency(budgetTotals.kit)}</span>
            </div>
            <div className="flex justify-between">
              <span>Travel</span>
              <span>{formatCurrency(budgetTotals.travel)}</span>
            </div>
            <div className="flex justify-between">
              <span>Parking</span>
              <span>{formatCurrency(budgetTotals.parking)}</span>
            </div>
            <div className="flex justify-between">
              <span>Rental</span>
              <span>{formatCurrency(budgetTotals.rental)}</span>
            </div>
            <div className="flex justify-between font-medium border-t pt-1">
              <span>Total Cost</span>
              <span>{formatCurrency(budgetTotals.totalCost)}</span>
            </div>
            <div
              className={`flex justify-between font-semibold ${
                safeNumber(budgetTotals.profit) < 0 ? 'text-red-600' : ''
              }`}
            >
              <span>Estimated Profit</span>
              <span>{formatCurrency(budgetTotals.profit)}</span>
            </div>
          </div>
          {budgetItems.length ? (
            <div className="mt-3">
              <h3 className="font-medium text-sm mb-1">Per Product</h3>
              <ul className="divide-y">
                {budgetItems.map((item: any) => (
                  <li key={item.id} className="py-2 text-sm">
                    <div className="flex justify-between">
                      <span>
                        {item.name || item.id} × {item.quantity || 1}
                      </span>
                      <span>{formatCurrency(item.budget?.total?.totalCost)}</span>
                    </div>
                    <div className="text-xs text-gray-600 text-right">
                      Labour {formatCurrency(item.budget?.total?.labour)} · Kit {formatCurrency(item.budget?.total?.kit)} · Travel {formatCurrency(item.budget?.total?.travel)} · Parking {formatCurrency(item.budget?.total?.parking)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="card">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Assets</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-gray-600">No assets have been uploaded yet.</p>
        ) : (
          <ul className="grid gap-3">
            {assets.map((a) => {
              const releaseMeta = getAssetReleaseMeta(a);
              return (
                <li key={a.id} className="rounded border border-gray-200 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <Link
                        href={`/projects/${project.id}/assets/${a.id}`}
                        className="text-sm font-semibold text-blue-600 hover:underline"
                      >
                        {a.name || a.storageKey || 'Asset'}
                      </Link>
                      <p className="text-xs text-gray-500">
                        Status: {a.status || 'draft'}
                        {typeof a.version === 'number' ? ` · Version ${a.version}` : ''}
                      </p>
                    </div>
                    {releaseMeta ? (
                      <div className="flex flex-col gap-1 sm:items-end">
                        <AssetReleaseBadge asset={a} />
                        {releaseMeta.description ? (
                          <p className="text-xs text-gray-500 max-w-xs sm:text-right">
                            {releaseMeta.description}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {/* Compare Versions */}
        {assets.length > 1 && (
          <div className="mt-2">
            <Link href={`/projects/${project.id}/compare`} className="text-sm text-blue-600 underline">Compare Versions</Link>
          </div>
        )}
      </div>
      {/* Brand pack selector */}
      <div className="card">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Brand Pack</h2>
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
        <h2 className="mb-2 text-base font-semibold text-gray-900">Brand Guidelines</h2>
        {project.brandGuidelinesCompleted ? (
          <div className="grid gap-2 text-sm">
            <p className="text-green-700">Completed</p>
            {project.brandFontName ? (
              <div className="flex flex-wrap items-center gap-2 text-gray-700">
                <span className="font-medium text-gray-900">Font:</span>
                <span>{project.brandFontName}</span>
                {project.brandFontSource ? (
                  <span className="text-xs uppercase tracking-wide text-gray-500">
                    {project.brandFontSource}
                  </span>
                ) : null}
                {project.brandFontDownloadUrl ? (
                  <a
                    href={project.brandFontDownloadUrl}
                    className="text-orange-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download font
                  </a>
                ) : null}
              </div>
            ) : null}
            {project.brandFontCategory ? (
              <p className="text-xs text-gray-500">Category: {project.brandFontCategory}</p>
            ) : null}
            <Link href={`/projects/${project.id}/brand-wizard`} className="btn-sm w-fit">Update Guidelines</Link>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-red-600">Not configured</p>
            <Link href={`/projects/${project.id}/brand-wizard`} className="btn-sm w-fit">Complete Guidelines</Link>
          </div>
        )}
      </div>

      {/* Tasks link */}
      <div className="card">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Project Tasks</h2>
        <Link href={`/projects/${project.id}/tasks`} className="btn-sm w-fit">View Tasks</Link>
      </div>
      <div className="card">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Messages</h2>
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
          <h2 className="mb-2 text-base font-semibold text-gray-900">Internal Notes</h2>
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
          <h2 className="mb-2 text-base font-semibold text-gray-900">Signature Required</h2>
          <p className="text-sm mb-2">A document requires your signature for this project.</p>
          <Link href={`/projects/${project.id}/signature`} className="btn-sm">Review & Sign</Link>
        </div>
      )}
      </div>
    </PortalContainer>
  );
}
