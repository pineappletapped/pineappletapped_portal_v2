
'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import type { BrandGuidelineColors, BrandGuidelinesState } from '@/lib/brand-guidelines';
import { parseBrandGuidelines } from '@/lib/brand-guidelines';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import PortalContainer from '@/components/PortalContainer';
import VenueMap from '@/components/VenueMap';
import type { Venue } from '@/lib/venues';
import {
  createCustomRiskDocumentsSample,
  createGenericRiskDocumentsSample,
  resolveRiskDocumentsForProject,
  RISK_DOCUMENT_KIND_LABELS,
} from '@/lib/risk-documents';
import type { ResolvedRiskDocument } from '@/lib/risk-documents';

const brandGuidelinesTimestampFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const riskDocumentDateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
});

const BRAND_COLOR_LABELS: Record<keyof BrandGuidelineColors, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
  neutral: 'Neutral',
  highlight: 'Highlight',
};

const parseRiskDocumentDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseFirestoreDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (value && typeof value === 'object' && typeof (value as any).toDate === 'function') {
    try {
      const parsed = (value as any).toDate();
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    } catch (err) {
      console.warn('Failed to parse Firestore timestamp', err);
    }
  }
  return null;
};

export default function ProjectDetail({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [organisation, setOrganisation] = useState<{ id: string; name: string | null } | null>(null);
  const [organisationGuidelines, setOrganisationGuidelines] = useState<BrandGuidelinesState | null>(null);
  const [organisationHasGuidelines, setOrganisationHasGuidelines] = useState(false);
  const [organisationGuidelinesUpdatedAt, setOrganisationGuidelinesUpdatedAt] = useState<Date | null>(null);
  const [organisationBrandStatus, setOrganisationBrandStatus] = useState<
    'complete' | 'needs_setup' | 'needs_amendments' | null
  >(null);
  const [organisationNeedsAmendments, setOrganisationNeedsAmendments] = useState(false);
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const [acknowledgingWelcome, setAcknowledgingWelcome] = useState(false);

  // Internal messages (staff/contractor comms)
  const [internalMessages, setInternalMessages] = useState<any[]>([]);
  const [newInternalMessage, setNewInternalMessage] = useState('');
  const [isStaffUser, setIsStaffUser] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [locationForm, setLocationForm] = useState({ address: '', postalCode: '' });
  const [locationFeedback, setLocationFeedback] = useState<
    | { kind: 'success' | 'error'; message: string }
    | null
  >(null);
  const [updatingLocation, setUpdatingLocation] = useState(false);
  const [order, setOrder] = useState<any | null>(null);
  const genericRiskLibrary = useMemo(() => createGenericRiskDocumentsSample(), []);
  const customRiskLibrary = useMemo(() => createCustomRiskDocumentsSample(), []);
  const normalisePostcode = (value: string | null | undefined) =>
    typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : '';
  const deliverableAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          !(typeof asset?.assetType === 'string' && asset.assetType.toLowerCase() === 'flight_plan')
      ),
    [assets]
  );
  const clientRiskDocuments = useMemo<ResolvedRiskDocument[]>(() => {
    if (!project?.id) {
      return [];
    }
    const productIds = Array.isArray(order?.items)
      ? (order.items as any[])
          .map((item) => (item && typeof item.id === 'string' ? item.id : null))
          .filter((id): id is string => Boolean(id))
      : [];
    const categories = Array.isArray(order?.items)
      ? (order.items as any[])
          .map((item) => (item && typeof item.category === 'string' ? item.category : null))
          .filter((category): category is string => Boolean(category))
      : [];
    return resolveRiskDocumentsForProject({
      projectId: project.id,
      projectName: typeof project.name === 'string' ? project.name : null,
      projectReference: typeof project.reference === 'string' ? project.reference : null,
      productIds,
      categories,
      audience: 'client',
      genericLibrary: genericRiskLibrary,
      customLibrary: customRiskLibrary,
    });
  }, [customRiskLibrary, genericRiskLibrary, order?.items, project?.id, project?.name, project?.reference]);

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

  const handleManualLocationSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project) return;

    const previousAddress = fallbackLocationName || '';
    const previousPostal = fallbackPostalCode || '';
    const address = locationForm.address.trim();
    const postal = locationForm.postalCode.trim().toUpperCase();

    if (!address) {
      setLocationFeedback({ kind: 'error', message: 'Please provide the filming address before saving.' });
      return;
    }

    setUpdatingLocation(true);
    setLocationFeedback(null);

    try {
      await updateDoc(doc(db, 'projects', project.id), {
        location: address,
        clientPostalCode: postal || null,
        locationUpdateRequestedAt: serverTimestamp(),
      });
      setProject((prev: any) =>
        prev
          ? {
              ...prev,
              location: address,
              clientPostalCode: postal || null,
            }
          : prev
      );
      setLocationForm({ address, postalCode: postal });

      if (order?.id) {
        try {
          await updateDoc(doc(db, 'orders', order.id), {
            location: address,
            clientPostalCode: postal || null,
            locationUpdateRequestedAt: serverTimestamp(),
          });
          setOrder((prev: any) =>
            prev
              ? {
                  ...prev,
                  location: address,
                  clientPostalCode: postal || null,
                }
              : prev
          );
        } catch (orderUpdateError) {
          console.error('Failed to sync order location', orderUpdateError);
        }
      }

      const user = auth.currentUser;
      const changes: string[] = [];
      if (previousAddress && previousAddress !== address) {
        changes.push(`address updated from “${previousAddress}” to “${address}”`);
      } else if (!previousAddress) {
        changes.push(`address provided as “${address}”`);
      }
      const previousPostcodeNormalised = normalisePostcode(previousPostal);
      const newPostcodeNormalised = normalisePostcode(postal);
      if (previousPostcodeNormalised !== newPostcodeNormalised) {
        if (previousPostcodeNormalised && newPostcodeNormalised) {
          changes.push(`postcode changed from ${previousPostal} to ${postal}`);
        } else if (!previousPostcodeNormalised && newPostcodeNormalised) {
          changes.push(`postcode set to ${postal}`);
        } else if (previousPostcodeNormalised && !newPostcodeNormalised) {
          changes.push('postcode cleared');
        }
      }
      const bodyMessage =
        changes.length > 0
          ? `Client requested a filming location update: ${changes.join('; ')}.`
          : `Client confirmed the filming address as ${address}${postal ? ` (${postal})` : ''}.`;

      try {
        await addDoc(collection(db,'contractorMessages'), {
          projectId: project.id,
          fromUid: user?.uid ?? null,
          body:
            previousPostcodeNormalised !== newPostcodeNormalised
              ? `${bodyMessage} Review potential travel surcharges.`
              : bodyMessage,
          createdAt: serverTimestamp(),
          systemGenerated: true,
          kind: 'location_update',
        });
        await loadInternalMessages();
      } catch (notifyErr) {
        console.error('Failed to log location change internally', notifyErr);
      }

      setLocationFeedback({
        kind: 'success',
        message: 'Thanks! Our production team will review the update and confirm any next steps.',
      });
    } catch (err) {
      console.error('Failed to update filming location', err);
      setLocationFeedback({
        kind: 'error',
        message: 'We could not save the filming location. Please try again or send us a message.',
      });
    } finally {
      setUpdatingLocation(false);
    }
  };

  const acknowledgeWelcome = useCallback(async () => {
    if (!project?.id || acknowledgingWelcome) {
      return;
    }
    setAcknowledgingWelcome(true);
    try {
      await updateDoc(doc(db, 'projects', project.id), {
        customerWelcomePending: false,
        customerWelcomeAcknowledgedAt: serverTimestamp(),
      });
      setProject((prev: any) =>
        prev
          ? {
              ...prev,
              customerWelcomePending: false,
            }
          : prev,
      );
      setShowWelcomeBanner(false);
    } catch (err) {
      console.error('Failed to acknowledge project welcome', err);
    } finally {
      setAcknowledgingWelcome(false);
    }
  }, [acknowledgingWelcome, project?.id]);

  useEffect(()=>{
    (async()=>{
      const pd = await getDoc(doc(db, 'projects', params.id));
      if (!pd.exists()) {
        setProject(null);
        return;
      }
      const data = pd.data();
      setProject({ id: pd.id, ...data });
      setShowWelcomeBanner(Boolean((data as any)?.customerWelcomePending));
      const projectBrandStatus =
        typeof (data as any)?.brandGuidelinesStatus === 'string'
          ? ((data as any).brandGuidelinesStatus as 'complete' | 'needs_setup' | 'needs_amendments')
          : null;
      const projectBrandCompleted = Boolean((data as any)?.brandGuidelinesCompleted);
      const projectBrandHasAssets = Boolean((data as any)?.brandGuidelinesHasAssets);
      const projectBrandNeedsAmendments = Boolean((data as any)?.brandGuidelinesNeedsAmendments);
      const initialBrandStatus = projectBrandNeedsAmendments
        ? 'needs_amendments'
        : projectBrandStatus && ['complete', 'needs_amendments', 'needs_setup'].includes(projectBrandStatus)
          ? projectBrandStatus
          : projectBrandCompleted || projectBrandHasAssets
            ? 'complete'
            : 'needs_setup';
      const initialBrandNeedsAmendments =
        projectBrandNeedsAmendments || initialBrandStatus === 'needs_amendments';
      setOrganisationBrandStatus(initialBrandStatus);
      setOrganisationNeedsAmendments(initialBrandNeedsAmendments);
      setOrganisationHasGuidelines(
        projectBrandHasAssets || projectBrandCompleted || initialBrandNeedsAmendments,
      );
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

  useEffect(() => {
    if (!project?.orgId) {
      setOrganisation(null);
      setOrganisationGuidelines(null);
      const fallbackHasGuidelines =
        Boolean(project?.brandGuidelinesHasAssets) ||
        Boolean(project?.brandGuidelinesCompleted) ||
        Boolean(project?.brandGuidelinesNeedsAmendments);
      setOrganisationHasGuidelines(fallbackHasGuidelines);
      setOrganisationGuidelinesUpdatedAt(null);
      const fallbackStatus = project?.brandGuidelinesNeedsAmendments
        ? 'needs_amendments'
        : fallbackHasGuidelines
          ? 'complete'
          : 'needs_setup';
      setOrganisationBrandStatus(fallbackStatus);
      setOrganisationNeedsAmendments(Boolean(project?.brandGuidelinesNeedsAmendments));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const orgSnap = await getDoc(doc(db, 'orgs', project.orgId));
        if (cancelled) return;
        if (!orgSnap.exists()) {
          setOrganisation(null);
          setOrganisationGuidelines(null);
          setOrganisationHasGuidelines(false);
          setOrganisationGuidelinesUpdatedAt(null);
          setOrganisationBrandStatus('needs_setup');
          setOrganisationNeedsAmendments(false);
          return;
        }

        const orgData = orgSnap.data() as any;
        const orgName =
          typeof orgData?.name === 'string' && orgData.name.trim().length > 0 ? orgData.name.trim() : null;
        const guidelines = parseBrandGuidelines(orgData?.brandGuidelines);
        const hasGuidelines = Boolean(
          (orgData?.brandGuidelines && typeof orgData.brandGuidelines === 'object' && Object.keys(orgData.brandGuidelines).length > 0) ||
            (typeof orgData?.brandLogoUrl === 'string' && orgData.brandLogoUrl.trim().length > 0) ||
            orgData?.brandGuidelinesUpdatedAt
        );
        const updatedAt = parseFirestoreDate(orgData?.brandGuidelinesUpdatedAt);
        const rawStatus = typeof orgData?.brandGuidelinesStatus === 'string' ? orgData.brandGuidelinesStatus : null;
        const normalisedStatus: 'complete' | 'needs_setup' | 'needs_amendments' =
          rawStatus === 'complete' || rawStatus === 'needs_amendments' || rawStatus === 'needs_setup'
            ? rawStatus
            : hasGuidelines
              ? 'complete'
              : 'needs_setup';
        const needsAmendments = Boolean(orgData?.brandGuidelinesNeedsAmendments) || normalisedStatus === 'needs_amendments';

        setOrganisation({ id: orgSnap.id, name: orgName });
        setOrganisationGuidelines(guidelines);
        setOrganisationHasGuidelines(hasGuidelines || needsAmendments);
        setOrganisationGuidelinesUpdatedAt(updatedAt);
        setOrganisationBrandStatus(normalisedStatus);
        setOrganisationNeedsAmendments(needsAmendments);
      } catch (err) {
        console.error('Failed to load organisation brand guidelines', err);
        if (!cancelled) {
          setOrganisationGuidelines(null);
          setOrganisationHasGuidelines(false);
          setOrganisationGuidelinesUpdatedAt(null);
          setOrganisationBrandStatus(null);
          setOrganisationNeedsAmendments(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    project?.orgId,
    project?.brandGuidelinesHasAssets,
    project?.brandGuidelinesCompleted,
    project?.brandGuidelinesNeedsAmendments,
  ]);


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

  useEffect(() => {
    setLocationForm((prev) => {
      const next = {
        address: fallbackLocationName,
        postalCode: fallbackPostalCode,
      };
      if (prev.address === next.address && prev.postalCode === next.postalCode) {
        return prev;
      }
      return next;
    });
  }, [fallbackLocationName, fallbackPostalCode]);

  const locationHasChanges =
    locationForm.address.trim() !== (fallbackLocationName || '') ||
    normalisePostcode(locationForm.postalCode) !== normalisePostcode(fallbackPostalCode);
  const postcodeWillChange =
    normalisePostcode(locationForm.postalCode) !== normalisePostcode(fallbackPostalCode);

  if (!project) return <div>Loading…</div>;
  const projectVenueId = project?.venueId || '';
  const savedVenue = projectVenueId
    ? venues.find((v) => v.id === projectVenueId) || null
    : null;
  const currentVenueName = savedVenue?.name || project?.venueName || '';
  const budgetTotals = project?.budgetTotals || null;
  const budgetItems = Array.isArray(project?.budgetItems)
    ? (project.budgetItems as any[])
    : [];

  const derivedBrandStatus: 'complete' | 'needs_setup' | 'needs_amendments' =
    organisationNeedsAmendments || organisationBrandStatus === 'needs_amendments'
      ? 'needs_amendments'
      : organisationBrandStatus === 'complete'
        ? 'complete'
        : organisationBrandStatus === 'needs_setup'
          ? 'needs_setup'
          : project?.brandGuidelinesNeedsAmendments
            ? 'needs_amendments'
            : project?.brandGuidelinesCompleted || project?.brandGuidelinesHasAssets
              ? 'complete'
              : 'needs_setup';

  const hasAnyBrandGuidelines =
    organisationHasGuidelines ||
    derivedBrandStatus !== 'needs_setup' ||
    Boolean(project?.brandGuidelinesCompleted) ||
    Boolean(project?.brandGuidelinesHasAssets);

  return (
    <PortalContainer>
      <div className="grid gap-6">
        {showWelcomeBanner ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-base font-semibold text-emerald-900">Thank you for your order!</p>
                <p>
                  We&apos;ve set up your project workspace. Keep an eye on this page for progress updates and next steps from the
                  production team.
                </p>
              </div>
              <button
                type="button"
                className="btn-sm btn-outline border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                onClick={acknowledgeWelcome}
                disabled={acknowledgingWelcome}
              >
                {acknowledgingWelcome ? 'Closing…' : 'Great, thanks'}
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold text-gray-900">{project.name || 'Project overview'}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
              <span>{project.reference || 'No reference'}</span>
              <StatusBadge status={project.status || 'draft'} />
            </div>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2 text-sm text-gray-700">
              <h2 className="text-base font-semibold text-gray-900">Project Files</h2>
              <p>
                Browse the read-only Drive folder shared with your team. Only Pineapple Tapped staff, franchise operators,
                and approved client members can access these files.
              </p>
              <p className="text-xs text-gray-500">
                {order?.drive?.orderFolderName
                  ? `Linked folder: ${order.drive.orderFolderName}`
                  : 'The Drive folder will appear here once the delivery team provisions it.'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <Link href={`/projects/${project.id}/files`} className="btn btn-outline">
                Open files
              </Link>
            </div>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold text-gray-900">Project Tasks</h2>
            <Link href={`/projects/${project.id}/tasks`} className="btn-sm w-fit">
              View tasks
            </Link>
          </div>
          <p className="text-sm text-gray-600">
            Track deliverables, approvals, and production milestones in one place. We&apos;ll notify you as soon as new
            tasks are assigned or completed.
          </p>
        </div>

        <div className="card space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-gray-900">Brand Guidelines</h2>
              <p className="text-sm text-gray-600">
                Keep your colours, fonts, and creative direction aligned across every deliverable. Updates here feed
                directly into the production team&apos;s tooling.
              </p>
            </div>
          </div>
          {project?.orgId || hasAnyBrandGuidelines ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {derivedBrandStatus === 'needs_amendments' ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Needs amendments
                </span>
              ) : derivedBrandStatus === 'complete' ? (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  Guidelines complete
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Needs setup
                </span>
              )}
            </div>
          ) : null}
          {!project?.orgId ? (
            <div className="grid gap-2">
              <p className="text-sm text-gray-600">
                Assign this project to an organisation to manage shared brand assets and keep every booking aligned.
              </p>
            </div>
          ) : hasAnyBrandGuidelines ? (
            <div className="grid gap-3 text-sm">
              {organisationNeedsAmendments || organisationBrandStatus === 'needs_amendments' ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-700">
                  {organisation?.name
                    ? `${organisation.name}'s brand guidelines need amendments before the next deliverable.`
                    : 'The shared brand guidelines need amendments before the next deliverable.'}
                </div>
              ) : (
                <p className="text-emerald-700">
                  Brand guidelines configured{organisation?.name ? ` for ${organisation.name}` : ''}.
                </p>
              )}
              {organisationGuidelines ? (
                <>
                  <div className="grid gap-3 text-gray-700 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Primary font</p>
                      <p className="text-sm text-gray-900">{organisationGuidelines.fonts.primary || '—'}</p>
                      {organisationGuidelines.fonts.headingStyle ? (
                        <p className="text-xs text-gray-500">{organisationGuidelines.fonts.headingStyle}</p>
                      ) : null}
                    </div>
                    {organisationGuidelines.fonts.secondary ? (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Secondary font</p>
                        <p className="text-sm text-gray-900">{organisationGuidelines.fonts.secondary}</p>
                      </div>
                    ) : null}
                    {organisationGuidelines.fonts.accent ? (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Accent font</p>
                        <p className="text-sm text-gray-900">{organisationGuidelines.fonts.accent}</p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {(['primary', 'secondary', 'accent', 'neutral', 'highlight'] as const).map((colorKey) => {
                      const value = organisationGuidelines.colors[colorKey];
                      if (!value) return null;
                      return (
                        <div
                          key={colorKey}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
                        >
                          <span
                            className="h-8 w-8 rounded-full border border-slate-300"
                            style={{ backgroundColor: value }}
                          />
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              {BRAND_COLOR_LABELS[colorKey]}
                            </p>
                            <p className="text-sm font-medium text-slate-900">{value}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
              {organisationGuidelinesUpdatedAt ? (
                <p className="text-xs text-gray-500">
                  Updated {brandGuidelinesTimestampFormatter.format(organisationGuidelinesUpdatedAt)}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {organisation?.id ? (
                  <Link href={`/orgs/${organisation.id}/brand-guidelines?project=${project.id}`} className="btn-sm w-fit">
                    Manage brand guidelines
                  </Link>
                ) : null}
                {organisation?.id ? (
                  <Link href={`/orgs/${organisation.id}`} className="btn-sm btn-outline w-fit">
                    Open organisation workspace
                  </Link>
                ) : null}
              </div>
            </div>
          ) : project.brandGuidelinesCompleted || project.brandGuidelinesHasAssets ? (
            <div className="grid gap-3 text-sm">
              <p className="text-amber-700">
                These guidelines were saved against the project before organisation workspaces were introduced.
              </p>
              {project.brandFontName ? (
                <div className="flex flex-wrap items-center gap-2 text-gray-700">
                  <span className="font-medium text-gray-900">Primary font:</span>
                  <span>{project.brandFontName}</span>
                  {project.brandFontSource ? (
                    <span className="text-xs uppercase tracking-wide text-gray-500">{project.brandFontSource}</span>
                  ) : null}
                </div>
              ) : null}
              {project.brandFontCategory ? (
                <p className="text-xs text-gray-500">Category: {project.brandFontCategory}</p>
              ) : null}
              {organisation?.id ? (
                <Link href={`/orgs/${organisation.id}/brand-guidelines?project=${project.id}`} className="btn-sm w-fit">
                  Move guidelines to organisation
                </Link>
              ) : (
                <Link href={`/projects/${project.id}/brand-wizard`} className="btn-sm w-fit">
                  Review saved guidelines
                </Link>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm text-amber-600">
                {organisation?.name
                  ? `${organisation.name} hasn’t shared their brand guidelines yet.`
                  : 'Brand guidelines not configured for this organisation.'}
              </p>
              {organisation?.id ? (
                <Link href={`/orgs/${organisation.id}/brand-guidelines?project=${project.id}`} className="btn-sm w-fit">
                  Set up brand guidelines
                </Link>
              ) : null}
            </div>
          )}
        </div>

        <div className="card space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-gray-900">Additional Assets</h2>
              <p className="text-sm text-gray-600">
                Upload references, branding packs, or supporting footage for the production team. Files land in your
                shared Drive workspace and are timestamped for quick review.
              </p>
            </div>
            <Link href={`/projects/${project.id}/upload`} className="btn self-start">
              Upload assets
            </Link>
          </div>
          {deliverableAssets.length === 0 ? (
            <p className="text-sm text-gray-600">No additional assets have been uploaded yet.</p>
          ) : (
            <ul className="grid gap-3">
              {deliverableAssets.map((a) => (
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-gray-900">Shared Documents</h2>
            <p className="text-sm text-gray-600">
              Risk assessments, insurance certificates, call sheets, and planning docs live here so everyone works from
              the same playbook. We&apos;ll add new paperwork as soon as it&apos;s ready.
            </p>
          </div>
          {clientRiskDocuments.length === 0 ? (
            <p className="text-sm text-gray-600">
              We’ll publish the relevant RAMS and shared documentation here once HQ links them to your booking.
            </p>
          ) : (
            <ul className="grid gap-3">
              {clientRiskDocuments.map((doc) => {
                const reviewedDate = parseRiskDocumentDate(doc.lastReviewedOn);
                const reviewLabel = reviewedDate ? riskDocumentDateFormatter.format(reviewedDate) : 'Recently reviewed';
                return (
                  <li key={doc.id} className="rounded border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-gray-900">{doc.title}</p>
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          {RISK_DOCUMENT_KIND_LABELS[doc.kind]} · {doc.task}
                          {doc.type === 'custom' && doc.projectName ? ` · ${doc.projectName}` : ''}
                        </p>
                        <p className="text-sm text-gray-600">{doc.summary}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-xs text-gray-500">
                        <span>{reviewLabel}</span>
                        <span>{doc.owner === 'hq' ? 'Issued by HQ' : 'Provided by franchise team'}</span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-blue-600">
                      <Link href={doc.documentUrl || '#'} target="_blank" rel="noreferrer" className="font-medium underline">
                        View document
                      </Link>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          doc.status === 'in-review'
                            ? 'bg-amber-50 text-amber-700'
                            : doc.status === 'archived'
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {doc.status === 'in-review'
                          ? 'In review'
                          : doc.status === 'archived'
                            ? 'Archived'
                            : 'Current'}
                      </span>
                    </div>
                    {doc.audienceNotes ? (
                      <p className="mt-2 text-xs text-gray-500">{doc.audienceNotes}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-gray-900">Filming Location</h2>
            <p className="text-sm text-gray-600">
              Confirm the shooting address or let us know if plans change. Significant postcode changes may affect travel
              or accommodation charges, so we&apos;ll review every update before locking in the schedule.
            </p>
          </div>
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
                This location was provided during checkout. Update the address below if plans have changed.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-600">No venue information has been provided yet.</p>
          )}

          {locationFeedback ? (
            <div
              className={`rounded-md border p-3 text-sm ${
                locationFeedback.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {locationFeedback.message}
            </div>
          ) : null}

          <form onSubmit={handleManualLocationSubmit} className="grid gap-3 text-sm">
            <label className="font-medium text-gray-900" htmlFor="project-location-address">
              Update filming address
            </label>
            <textarea
              id="project-location-address"
              className="input min-h-[96px]"
              value={locationForm.address}
              onChange={(event) => setLocationForm((prev) => ({ ...prev, address: event.target.value }))}
              placeholder="Street, city, venue details"
            />
            <div className="grid gap-1">
              <label className="font-medium text-gray-900" htmlFor="project-location-postcode">
                Postcode
              </label>
              <input
                id="project-location-postcode"
                className="input"
                value={locationForm.postalCode}
                onChange={(event) => setLocationForm((prev) => ({ ...prev, postalCode: event.target.value }))}
                placeholder="e.g. MK46 4AA"
              />
            </div>
            <p className="text-xs text-amber-600">
              Changing the postcode may add a travel surcharge once the production team reviews the update.
            </p>
            {postcodeWillChange ? (
              <p className="text-xs font-medium text-amber-700">
                We&apos;ll flag this postcode change with HQ or your franchise manager for approval.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-sm" disabled={!locationHasChanges || updatingLocation}>
                {updatingLocation ? 'Saving…' : 'Save location'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setLocationForm({ address: fallbackLocationName, postalCode: fallbackPostalCode })}
                disabled={updatingLocation}
              >
                Reset
              </button>
            </div>
          </form>
        </div>

        <div className="card space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-gray-900">Book an additional filming session</h2>
            <p className="text-sm text-gray-600">
              Need another shoot day for progress updates or transformation content? Choose a date that works for your
              team and we&apos;ll handle the scheduling.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/projects/${project.id}/bookings`} className="btn-sm w-fit">
              Open scheduling
            </Link>
            <p className="text-xs text-gray-500">
              We&apos;ll confirm crew availability and let you know if any additional costs apply before finalising.
            </p>
          </div>
        </div>

        <div className="card">
          <h2 className="mb-2 text-base font-semibold text-gray-900">Messages</h2>
          <div className="grid gap-2 mb-3">
            {messages.length === 0 ? (
              <p className="text-sm text-gray-600">No messages yet. Start the conversation below.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="rounded border border-gray-200 p-2 text-sm text-gray-700">
                  {m.body}
                </div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Write a message…"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
            />
            <button type="button" className="btn" onClick={sendMessage}>
              Send
            </button>
          </div>
        </div>

        {isStaffUser && (
          <div className="card">
            <h2 className="mb-2 text-base font-semibold text-gray-900">Internal Notes</h2>
            <div className="grid gap-2 mb-3">
              {internalMessages.length === 0 ? (
                <p className="text-sm text-gray-600">No internal messages.</p>
              ) : (
                internalMessages.map((m) => (
                  <div key={m.id} className="rounded border border-gray-200 p-2 text-sm text-gray-700">
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
              <button type="button" className="btn" onClick={sendInternalMessage}>
                Send
              </button>
            </div>
          </div>
        )}

        {pendingSignature && (
          <div className="card">
            <h2 className="mb-2 text-base font-semibold text-gray-900">Signature Required</h2>
            <p className="text-sm mb-2">A document requires your signature for this project.</p>
            <Link href={`/projects/${project.id}/signature`} className="btn-sm">
              Review &amp; sign
            </Link>
          </div>
        )}
      </div>
    </PortalContainer>
  );
}
