
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
  onSnapshot,
  orderBy,
  limit,
} from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';
import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import PortalContainer from '@/components/PortalContainer';
import VenueMap from '@/components/VenueMap';
import AssetReleaseBadge, { getAssetReleaseMeta } from '@/components/AssetReleaseBadge';
import { summariseKitItems } from '@/lib/kit-summary';
import type { Venue } from '@/lib/venues';

const kitDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const parseKitDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatKitWindow = (start: string | null, end: string | null): string | null => {
  const startDate = parseKitDate(start);
  const endDate = parseKitDate(end);
  if (startDate && endDate) {
    return `${kitDateFormatter.format(startDate)} – ${kitDateFormatter.format(endDate)}`;
  }
  if (startDate) {
    return `From ${kitDateFormatter.format(startDate)}`;
  }
  if (endDate) {
    return `Until ${kitDateFormatter.format(endDate)}`;
  }
  return null;
};

const bookingSlotFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const brandGuidelinesTimestampFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const BRAND_COLOR_LABELS: Record<keyof BrandGuidelineColors, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
  neutral: 'Neutral',
  highlight: 'Highlight',
};

const coerceNumber = (value: any, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseIsoString = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatBookingSlotWindow = (slot: ProjectBookingSlotRecord): string => {
  const start = parseIsoString(slot.startAt);
  const end = parseIsoString(slot.endAt);
  if (start && end) {
    return `${bookingSlotFormatter.format(start)} – ${bookingSlotFormatter.format(end)}`;
  }
  if (start) {
    return `${bookingSlotFormatter.format(start)} onwards`;
  }
  if (end) {
    return `Ends ${bookingSlotFormatter.format(end)}`;
  }
  return slot.label;
};

const normaliseUploads = (raw: unknown): BookingUploadFile[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, any>;
      const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : 'Attachment';
      const url = typeof record.url === 'string' ? record.url : null;
      if (!url) return null;
      return {
        id:
          typeof record.id === 'string' && record.id.trim().length > 0
            ? record.id.trim()
            : `${name}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        url,
        contentType: typeof record.contentType === 'string' ? record.contentType : null,
      } satisfies BookingUploadFile;
    })
    .filter((item): item is BookingUploadFile => Boolean(item));
};

const normaliseAnswers = (raw: unknown): Record<string, any> => {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    return raw.reduce<Record<string, any>>((acc, entry, index) => {
      acc[`field_${index + 1}`] = entry;
      return acc;
    }, {});
  }
  if (typeof raw === 'object') {
    return { ...(raw as Record<string, any>) };
  }
  return { value: raw };
};

const parseProjectBookingBase = (doc: { id: string; data: () => any }): ProjectBookingRecord => {
  const raw = (doc.data() as Record<string, any>) ?? {};
  const slots: ProjectBookingSlotRecord[] = Array.isArray(raw.slots)
    ? raw.slots
        .map((slot: any, index: number) => {
          if (!slot || typeof slot !== 'object') return null;
          const id =
            typeof slot.id === 'string' && slot.id.trim().length > 0
              ? slot.id.trim()
              : `${doc.id}-slot-${index + 1}`;
          const label = typeof slot.label === 'string' && slot.label.trim().length > 0 ? slot.label.trim() : `Slot ${
            index + 1
          }`;
          const startAt = typeof slot.startAt === 'string' ? slot.startAt : null;
          const endAt = typeof slot.endAt === 'string' ? slot.endAt : null;
          const capacity = coerceNumber(slot.capacity, 1);
          const priceClass = typeof slot.priceClass === 'string' ? slot.priceClass : 'included';
          const notes = typeof slot.notes === 'string' ? slot.notes : '';
          return { id, label, startAt, endAt, capacity, priceClass, notes } satisfies ProjectBookingSlotRecord;
        })
        .filter((slot): slot is ProjectBookingSlotRecord => Boolean(slot))
    : [];

  const statsRaw = raw.stats ?? {};
  const totalCapacityFallback = slots.reduce((sum, slot) => sum + coerceNumber(slot.capacity, 0), 0);
  const stats: ProjectBookingStatsRecord = {
    totalSlots: coerceNumber(statsRaw.totalSlots, slots.length),
    totalCapacity: coerceNumber(statsRaw.totalCapacity, totalCapacityFallback),
    responses: coerceNumber(statsRaw.responses, 0),
    confirmed: coerceNumber(statsRaw.confirmed, coerceNumber(statsRaw.responses, 0)),
    invitesOutstanding: coerceNumber(statsRaw.invitesOutstanding, 0),
    assetsUploaded: coerceNumber(statsRaw.assetsUploaded, 0),
  };

  const agreementRaw = raw.agreement ?? {};
  const agreement = {
    heading:
      typeof agreementRaw.heading === 'string' && agreementRaw.heading.trim().length > 0
        ? agreementRaw.heading.trim()
        : 'Participation agreement',
    body: typeof agreementRaw.body === 'string' ? agreementRaw.body : '',
    acknowledgementLabel:
      typeof agreementRaw.acknowledgementLabel === 'string' && agreementRaw.acknowledgementLabel.trim().length > 0
        ? agreementRaw.acknowledgementLabel.trim()
        : 'I agree to the terms and conditions',
    requireSignature: agreementRaw.requireSignature === false ? false : true,
  };

  return {
    id: doc.id,
    taskTitle:
      typeof raw.taskTitle === 'string' && raw.taskTitle.trim().length > 0 ? raw.taskTitle.trim() : 'Booking form',
    taskDescription: typeof raw.taskDescription === 'string' ? raw.taskDescription : '',
    introduction: typeof raw.introduction === 'string' ? raw.introduction : '',
    slots,
    responseFields: Array.isArray(raw.responseFields) ? raw.responseFields : [],
    uploadRequirements: Array.isArray(raw.uploadRequirements) ? raw.uploadRequirements : [],
    agreement,
    stats,
    updatedAt: parseTimestamp(raw.updatedAt) || parseTimestamp(raw.createdAt),
    responses: [],
    invites: [],
  };
};

const parseBookingResponseDoc = (doc: { id: string; data: () => any }): ProjectBookingResponseRecord => {
  const raw = (doc.data() as Record<string, any>) ?? {};
  const uploads = normaliseUploads(raw.uploads ?? raw.attachments);
  const organisation =
    typeof raw.organisation === 'string'
      ? raw.organisation
      : typeof raw.businessName === 'string'
        ? raw.businessName
        : typeof raw.company === 'string'
          ? raw.company
          : 'Participant';
  const contactName =
    typeof raw.contactName === 'string'
      ? raw.contactName
      : typeof raw.fullName === 'string'
        ? raw.fullName
        : typeof raw.name === 'string'
          ? raw.name
          : '';
  const contactEmail =
    typeof raw.contactEmail === 'string'
      ? raw.contactEmail
      : typeof raw.email === 'string'
        ? raw.email
        : '';

  return {
    id: doc.id,
    slotId: typeof raw.slotId === 'string' ? raw.slotId : null,
    status: typeof raw.status === 'string' ? raw.status : 'pending',
    organisation,
    contactName,
    contactEmail,
    submittedAt: parseTimestamp(raw.submittedAt ?? raw.createdAt ?? raw.updatedAt),
    agreementAcceptedAt: parseTimestamp(raw.agreementAcceptedAt ?? raw.signatureCompletedAt),
    uploads,
    answers: normaliseAnswers(raw.answers ?? raw.responses ?? raw.fields),
  };
};

const parseBookingInviteDoc = (doc: { id: string; data: () => any }): ProjectBookingInviteRecord => {
  const raw = (doc.data() as Record<string, any>) ?? {};
  return {
    id: doc.id,
    email: typeof raw.email === 'string' ? raw.email : '',
    organisation:
      typeof raw.organisation === 'string'
        ? raw.organisation
        : typeof raw.company === 'string'
          ? raw.company
          : '',
    status: typeof raw.status === 'string' ? raw.status : 'pending',
    sentAt: parseTimestamp(raw.sentAt ?? raw.createdAt),
    respondedAt: parseTimestamp(raw.respondedAt ?? raw.updatedAt),
  };
};

const isDroneAssignment = (name: string | null, category: string | null): boolean => {
  const nameMatch = name?.toLowerCase().includes('drone') ?? false;
  const categoryMatch = category?.toLowerCase().includes('drone') ?? false;
  return nameMatch || categoryMatch;
};

const parseTimestamp = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate();
      } catch (error) {
        console.warn('Failed to convert timestamp', error);
      }
    }
    if ('seconds' in value) {
      const seconds = Number((value as any).seconds);
      const nanos = Number((value as any).nanoseconds ?? 0);
      if (Number.isFinite(seconds)) {
        return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
      }
    }
  }
  if (typeof value === 'string') {
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  return null;
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

interface ContentDraftRecord {
  id: string;
  status: string;
  summary: string;
  youtubeTitles: string[];
  youtubeDescription: string;
  youtubeTags: string[];
  socialPosts: Array<{
    id: string;
    platform: string;
    headline: string;
    body: string;
    hashtags: string[];
  }>;
  deliverableLabel: string | null;
  deliverableProductId: string | null;
  deliverableProductName: string | null;
  platforms: string[];
  callToAction: string | null;
  tone: string | null;
  updatedAt: Date | null;
  publishedAt: Date | null;
}

interface BookingUploadFile {
  id: string;
  name: string;
  url: string;
  contentType: string | null;
}

interface ProjectBookingResponseRecord {
  id: string;
  slotId: string | null;
  status: string;
  organisation: string;
  contactName: string;
  contactEmail: string;
  submittedAt: Date | null;
  agreementAcceptedAt: Date | null;
  uploads: BookingUploadFile[];
  answers: Record<string, any>;
}

interface ProjectBookingInviteRecord {
  id: string;
  email: string;
  organisation: string;
  status: string;
  sentAt: Date | null;
  respondedAt: Date | null;
}

interface ProjectBookingSlotRecord {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  priceClass: string;
  notes: string;
}

interface ProjectBookingStatsRecord {
  totalSlots: number;
  totalCapacity: number;
  responses: number;
  confirmed: number;
  invitesOutstanding: number;
  assetsUploaded: number;
}

interface ProjectBookingRecord {
  id: string;
  taskTitle: string;
  taskDescription: string;
  introduction: string;
  slots: ProjectBookingSlotRecord[];
  responseFields: any[];
  uploadRequirements: any[];
  agreement: {
    heading: string;
    body: string;
    acknowledgementLabel: string;
    requireSignature: boolean;
  };
  stats: ProjectBookingStatsRecord;
  updatedAt: Date | null;
  responses: ProjectBookingResponseRecord[];
  invites: ProjectBookingInviteRecord[];
}

export default function ProjectDetail({ params }: { params: { id: string } }) {
  const [project, setProject] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [brandPacks, setBrandPacks] = useState<any[]>([]);
  const [contentDrafts, setContentDrafts] = useState<ContentDraftRecord[]>([]);
  const [contentDraftsLoading, setContentDraftsLoading] = useState(true);
  const [projectBookings, setProjectBookings] = useState<ProjectBookingRecord[]>([]);
  const [projectBookingsLoading, setProjectBookingsLoading] = useState(true);
  const [organisation, setOrganisation] = useState<{ id: string; name: string | null } | null>(null);
  const [organisationGuidelines, setOrganisationGuidelines] = useState<BrandGuidelinesState | null>(null);
  const [organisationHasGuidelines, setOrganisationHasGuidelines] = useState(false);
  const [organisationGuidelinesUpdatedAt, setOrganisationGuidelinesUpdatedAt] = useState<Date | null>(null);

  // Internal messages (staff/contractor comms)
  const [internalMessages, setInternalMessages] = useState<any[]>([]);
  const [newInternalMessage, setNewInternalMessage] = useState('');
  const [isStaffUser, setIsStaffUser] = useState(false);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueSelection, setVenueSelection] = useState('');
  const [savingVenue, setSavingVenue] = useState(false);
  const [order, setOrder] = useState<any | null>(null);
  const kitSummary = useMemo(() => summariseKitItems(order?.kitItems ?? []), [order?.kitItems]);
  const deliverableAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          !(typeof asset?.assetType === 'string' && asset.assetType.toLowerCase() === 'flight_plan')
      ),
    [assets]
  );
  const flightPlanAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          typeof asset?.assetType === 'string' && asset.assetType.toLowerCase() === 'flight_plan'
      ),
    [assets]
  );
  const hasDroneAssignments = kitSummary?.hasDrone ?? false;
  const hasDroneLineItem = Array.isArray(order?.items)
    ? order.items.some((item: any) => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const record = item as Record<string, unknown>;
        const name = typeof record.name === 'string' ? record.name.toLowerCase() : '';
        const category = typeof record.category === 'string' ? record.category.toLowerCase() : '';
        return name.includes('drone') || category.includes('drone');
      })
    : false;
  const showFlightPlanSection = hasDroneAssignments || hasDroneLineItem || flightPlanAssets.length > 0;

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

  useEffect(() => {
    if (!project?.orgId) {
      setOrganisation(null);
      setOrganisationGuidelines(null);
      setOrganisationHasGuidelines(false);
      setOrganisationGuidelinesUpdatedAt(null);
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

        setOrganisation({ id: orgSnap.id, name: orgName });
        setOrganisationGuidelines(guidelines);
        setOrganisationHasGuidelines(hasGuidelines);
        setOrganisationGuidelinesUpdatedAt(updatedAt);
      } catch (err) {
        console.error('Failed to load organisation brand guidelines', err);
        if (!cancelled) {
          setOrganisationGuidelines(null);
          setOrganisationHasGuidelines(false);
          setOrganisationGuidelinesUpdatedAt(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project?.orgId]);

  useEffect(() => {
    let active = true;

    (async () => {
      setProjectBookingsLoading(true);
      try {
        const bookingsSnap = await getDocs(collection(db, 'projects', params.id, 'projectBookings'));
        const records: ProjectBookingRecord[] = [];
        for (const bookingDoc of bookingsSnap.docs) {
          const base = parseProjectBookingBase(bookingDoc);
          let responses: ProjectBookingResponseRecord[] = [];
          let invites: ProjectBookingInviteRecord[] = [];
          try {
            const responsesSnap = await getDocs(collection(bookingDoc.ref, 'responses'));
            responses = responsesSnap.docs.map((docSnap) => parseBookingResponseDoc(docSnap));
          } catch (responseErr) {
            console.warn('Failed to load booking responses', bookingDoc.id, responseErr);
          }
          try {
            const invitesSnap = await getDocs(collection(bookingDoc.ref, 'invites'));
            invites = invitesSnap.docs.map((docSnap) => parseBookingInviteDoc(docSnap));
          } catch (inviteErr) {
            console.warn('Failed to load booking invites', bookingDoc.id, inviteErr);
          }
          records.push({ ...base, responses, invites });
        }
        if (active) {
          setProjectBookings(records);
        }
      } catch (err) {
        console.error('Failed to load project bookings', err);
        if (active) {
          setProjectBookings([]);
        }
      } finally {
        if (active) {
          setProjectBookingsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [params.id]);

  useEffect(() => {
    setContentDraftsLoading(true);
    const ref = query(
      collection(db, 'projects', params.id, 'contentDrafts'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const drafts: ContentDraftRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          const socialPosts = Array.isArray(data.socialPosts)
            ? data.socialPosts.map((item: any, index: number) => ({
                id: item?.id || `${docSnap.id}-post-${index}`,
                platform: item?.platform || 'Social',
                headline: item?.headline || '',
                body: item?.body || '',
                hashtags: Array.isArray(item?.hashtags) ? item.hashtags : [],
              }))
            : [];
          return {
            id: docSnap.id,
            status: typeof data.status === 'string' ? data.status : 'published',
            summary: typeof data.summary === 'string' ? data.summary : '',
            youtubeTitles: Array.isArray(data.youtubeTitles) ? data.youtubeTitles : [],
            youtubeDescription: typeof data.youtubeDescription === 'string' ? data.youtubeDescription : '',
            youtubeTags: Array.isArray(data.youtubeTags) ? data.youtubeTags : [],
            socialPosts,
            deliverableLabel: typeof data.deliverableLabel === 'string' ? data.deliverableLabel : null,
            deliverableProductId: typeof data.deliverableProductId === 'string' ? data.deliverableProductId : null,
            deliverableProductName: typeof data.deliverableProductName === 'string' ? data.deliverableProductName : null,
            platforms: Array.isArray(data.platforms) ? data.platforms : [],
            callToAction: typeof data.callToAction === 'string' ? data.callToAction : null,
            tone: typeof data.tone === 'string' ? data.tone : null,
            updatedAt: parseTimestamp(data.updatedAt),
            publishedAt: parseTimestamp(data.createdAt),
          } satisfies ContentDraftRecord;
        });
        setContentDrafts(drafts);
        setContentDraftsLoading(false);
      },
      (error) => {
        console.error('Failed to load content drafts', error);
        setContentDrafts([]);
        setContentDraftsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [params.id]);

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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2 text-sm text-gray-700">
              <h2 className="text-base font-semibold text-gray-900">Project files</h2>
              <p>
                Browse the read-only Drive folder shared with your team. Only Pineapple Tapped staff, franchise operators, and
                approved client members can access these files.
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
        <h2 className="mb-2 text-base font-semibold text-gray-900">Equipment assignments</h2>
        {kitSummary ? (
          <div className="space-y-3 text-sm text-gray-700">
            <p className="text-sm text-gray-600">
              Crew will collect the reserved kit shown below. Update the order if the inventory needs to change.
            </p>
            <ul className="grid gap-3">
              {kitSummary.items.map((item) => {
                const window = formatKitWindow(item.start, item.end);
                const drone = isDroneAssignment(item.name, item.category);
                return (
                  <li key={item.id} className="rounded border border-gray-200 p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="font-medium text-gray-900">
                          {item.name || 'Equipment'}
                          {item.category ? (
                            <span className="text-gray-500"> · {item.category}</span>
                          ) : null}
                          {drone ? (
                            <span className="ml-2 inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                              Drone kit
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-gray-500">ID: {item.id}</p>
                      </div>
                      {window ? <p className="text-xs text-gray-500">Window: {window}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {kitSummary.window ? (
              <p className="text-xs text-gray-500">
                Overall kit window: {kitSummary.window}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            No equipment reservations are linked to this project yet.
          </p>
        )}
      </div>
      <div className="card">
        <h2 className="mb-2 text-base font-semibold text-gray-900">Assets</h2>
        {deliverableAssets.length === 0 ? (
          <p className="text-sm text-gray-600">No assets have been uploaded yet.</p>
        ) : (
          <ul className="grid gap-3">
            {deliverableAssets.map((a) => {
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
        {deliverableAssets.length > 1 && (
          <div className="mt-2">
            <Link href={`/projects/${project.id}/compare`} className="text-sm text-blue-600 underline">Compare Versions</Link>
          </div>
        )}
      </div>
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Content publishing kits</h2>
          <span className="text-xs uppercase tracking-wide text-gray-500">
            {contentDraftsLoading ? 'Loading…' : `${contentDrafts.length} ready`}
          </span>
        </div>
        {contentDraftsLoading ? (
          <p className="text-sm text-gray-600">Loading copy packs…</p>
        ) : contentDrafts.length === 0 ? (
          <p className="text-sm text-gray-600">
            Once HQ or your franchise publishes social copy it will appear here ready for download and scheduling.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {contentDrafts.map((draft) => (
              <article key={draft.id} className="rounded-lg border border-gray-200 p-4 shadow-sm">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{draft.deliverableLabel || 'Content kit'}</p>
                    {draft.summary && <p className="text-sm text-gray-600">{draft.summary}</p>}
                    {draft.deliverableProductName && (
                      <p className="text-xs text-gray-500">
                        Linked product:{' '}
                        {draft.deliverableProductId ? (
                          <Link href={`/products/${draft.deliverableProductId}`} className="text-blue-600 hover:underline">
                            {draft.deliverableProductName}
                          </Link>
                        ) : (
                          draft.deliverableProductName
                        )}
                      </p>
                    )}
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    {draft.status}
                  </span>
                </header>
                {draft.callToAction && (
                  <p className="mt-2 text-xs text-gray-500">CTA: {draft.callToAction}</p>
                )}
                {draft.youtubeTitles.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs uppercase tracking-wide text-gray-500">YouTube titles</p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                      {draft.youtubeTitles.slice(0, 2).map((title, index) => (
                        <li key={index}>{title}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {draft.socialPosts.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Social copy</p>
                    {draft.socialPosts.slice(0, 3).map((post) => (
                      <div key={post.id} className="rounded border border-dashed border-gray-200 p-3">
                        <p className="text-xs font-semibold text-gray-700">{post.platform}</p>
                        {post.headline && <p className="text-sm font-medium text-gray-900">{post.headline}</p>}
                        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{post.body}</p>
                        {post.hashtags.length > 0 && (
                          <p className="mt-1 text-xs text-gray-500">{post.hashtags.join(' ')}</p>
                        )}
                      </div>
                    ))}
                    {draft.socialPosts.length > 3 && (
                      <p className="text-xs text-gray-500">
                        +{draft.socialPosts.length - 3} additional platform
                        {draft.socialPosts.length - 3 === 1 ? '' : 's'}
                      </p>
                    )}
                  </div>
                )}
                <footer className="mt-4 text-xs text-gray-500">
                  <p>Updated {draft.updatedAt ? draft.updatedAt.toLocaleString() : 'Recently'}</p>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
      {showFlightPlanSection ? (
        <div className="card">
          <h2 className="mb-2 text-base font-semibold text-gray-900">Flight plans &amp; approvals</h2>
          {flightPlanAssets.length === 0 ? (
            <p className="text-sm text-gray-600">
              Upload or stage flight plans to kick off the drone compliance review for this project.
            </p>
          ) : (
            <ul className="grid gap-3">
              {flightPlanAssets.map((asset) => {
                const releaseMeta = getAssetReleaseMeta(asset);
                return (
                  <li key={asset.id} className="rounded border border-gray-200 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <Link
                          href={`/projects/${project.id}/assets/${asset.id}`}
                          className="text-sm font-semibold text-blue-600 hover:underline"
                        >
                          {asset.name || asset.storageKey || 'Flight plan'}
                        </Link>
                        <p className="text-xs text-gray-500">Status: {asset.status || 'draft'}</p>
                      </div>
                      <div className="flex flex-col gap-1 sm:items-end">
                        <AssetReleaseBadge asset={asset} />
                        {releaseMeta?.description ? (
                          <p className="text-xs text-gray-500 max-w-xs sm:text-right">
                            {releaseMeta.description}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500 max-w-xs sm:text-right">
                            Review and approve the plan so aerial work can proceed.
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
      {/* Brand pack selector */}
      <div className="card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-gray-900">Booking Sessions</h2>
          <Link href={`/projects/${project?.id ?? params.id}/bookings`} className="btn-sm w-fit">
            Open bookings overview
          </Link>
        </div>
        {projectBookingsLoading ? (
          <p className="mt-3 text-sm text-gray-600">Loading booking sessions…</p>
        ) : projectBookings.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">
            No booking sessions configured for this project yet. Add a booking form to your workflow to collect
            participants.
          </p>
        ) : (
          <div className="mt-3 grid gap-4">
            {projectBookings.map((booking) => {
              const totalCapacity = booking.stats?.totalCapacity ??
                booking.slots.reduce((sum, slot) => sum + coerceNumber(slot.capacity, 0), 0);
              const responsesCount = booking.responses.length || booking.stats?.responses || 0;
              const outstandingInvites = (() => {
                const pending = booking.invites.filter((invite) => {
                  const status = invite.status?.toLowerCase?.() ?? '';
                  return !(status === 'accepted' || status === 'confirmed' || status === 'completed');
                }).length;
                return pending || booking.stats?.invitesOutstanding || 0;
              })();
              const uploadedAssets = (() => {
                const total = booking.responses.reduce((sum, response) => sum + response.uploads.length, 0);
                return total || booking.stats?.assetsUploaded || 0;
              })();
              const slotMap = new Map(booking.slots.map((slot) => [slot.id, slot] as const));

              return (
                <div key={booking.id} className="rounded border border-gray-200 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-gray-900">{booking.taskTitle || 'Booking form'}</h3>
                      {booking.introduction ? (
                        <p className="text-sm text-gray-600">{booking.introduction}</p>
                      ) : null}
                      <p className="text-xs text-gray-500">
                        {booking.slots.length} slots · {totalCapacity} seats · {responsesCount} responses · {outstandingInvites}{' '}
                        invites awaiting reply · {uploadedAssets} uploaded assets
                      </p>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>Last updated {booking.updatedAt ? booking.updatedAt.toLocaleString() : 'recently'}</p>
                    </div>
                  </div>
                  {booking.slots.length > 0 ? (
                    <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                      {booking.slots.map((slot) => (
                        <div key={slot.id} className="rounded border border-dashed border-gray-200 p-2">
                          <p className="font-semibold text-gray-700">{slot.label}</p>
                          <p>{formatBookingSlotWindow(slot)}</p>
                          <p>Capacity: {slot.capacity}</p>
                          {slot.notes ? <p className="text-[11px] text-gray-500">{slot.notes}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {booking.responses.length > 0 ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-3 py-2">Participant</th>
                            <th className="px-3 py-2">Slot</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Submitted</th>
                            <th className="px-3 py-2">Assets</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {booking.responses.map((response) => {
                            const slotLabel = response.slotId ? slotMap.get(response.slotId)?.label || 'Unassigned' : 'Unassigned';
                            return (
                              <tr key={response.id} className="align-top">
                                <td className="px-3 py-2">
                                  <div className="font-medium text-gray-900">{response.organisation || 'Participant'}</div>
                                  <div className="text-xs text-gray-600">
                                    {response.contactName}
                                    {response.contactEmail ? ` · ${response.contactEmail}` : ''}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-600">{slotLabel}</td>
                                <td className="px-3 py-2 text-xs capitalize text-gray-600">{response.status}</td>
                                <td className="px-3 py-2 text-xs text-gray-600">
                                  {response.submittedAt ? response.submittedAt.toLocaleString() : 'Pending'}
                                  {response.agreementAcceptedAt ? (
                                    <div className="text-[11px] text-green-600">
                                      Agreement accepted {response.agreementAcceptedAt.toLocaleString()}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-600">
                                  {response.uploads.length === 0 ? (
                                    <span className="text-gray-400">No uploads</span>
                                  ) : (
                                    <ul className="grid gap-1">
                                      {response.uploads.map((upload) => (
                                        <li key={upload.id}>
                                          <a
                                            href={upload.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline"
                                          >
                                            {upload.name}
                                          </a>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-gray-600">No responses yet.</p>
                  )}
                  {booking.invites.length > 0 ? (
                    <div className="mt-3 rounded border border-dashed border-gray-200 p-2 text-xs text-gray-600">
                      <p className="font-semibold text-gray-700">Invitations</p>
                      <ul className="mt-1 grid gap-1">
                        {booking.invites.map((invite) => (
                          <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              {invite.organisation ? `${invite.organisation} · ` : ''}
                              {invite.email}
                            </span>
                            <span className="capitalize">{invite.status || 'pending'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
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
        {!project?.orgId ? (
          <div className="grid gap-2">
            <p className="text-sm text-gray-600">
              Assign this project to an organisation to manage shared brand assets and keep every booking aligned.
            </p>
          </div>
        ) : organisationHasGuidelines && organisationGuidelines ? (
          <div className="grid gap-3 text-sm">
            <p className="text-emerald-700">
              Brand guidelines configured{organisation?.name ? ` for ${organisation.name}` : ''}.
            </p>
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
        ) : project.brandGuidelinesCompleted ? (
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
