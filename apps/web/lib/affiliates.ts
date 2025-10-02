import type { DocumentData, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';

export type AffiliateStatus = 'pending' | 'active' | 'paused' | 'inactive';

export interface AffiliatePayoutDetails {
  accountName: string | null;
  bankName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  notes: string | null;
}

export interface AffiliateMetrics {
  totalOrders: number;
  totalRevenueGross: number;
  totalCommissionNet: number;
  totalCommissionVat: number;
  totalCommissionGross: number;
  pendingCommissionNet: number;
  pendingCommissionVat: number;
  pendingCommissionGross: number;
  paidCommissionNet: number;
  paidCommissionVat: number;
  paidCommissionGross: number;
  totalLeads: number;
  totalQuotes: number;
  totalClicks: number;
  lastOrderAt: Timestamp | null;
  lastPayoutAt: Timestamp | null;
}

export interface AffiliateRecord {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  phone: string | null;
  status: AffiliateStatus;
  refCode: string;
  commissionRate: number;
  metrics: AffiliateMetrics;
  payout: AffiliatePayoutDetails;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  lastReferralAt: Timestamp | null;
  ownerUid: string | null;
  notes: string | null;
}

export type AffiliateApplicationDecisionAction = 'approve' | 'reject' | 'request_info';

export interface AffiliateApplicationReviewEntry {
  action: AffiliateApplicationDecisionAction;
  status: string | null;
  stage: string | null;
  notes: string | null;
  reviewerUid: string | null;
  reviewerName: string | null;
  reviewerEmail: string | null;
  decidedAt: Timestamp | null;
}

export type AffiliateApplicationReviewState = AffiliateApplicationReviewEntry;

export interface AffiliateApplicationRecord {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  location: string | null;
  focus: string | null;
  experience: string | null;
  socials: string | null;
  website: string | null;
  notes: string | null;
  status: string | null;
  stage: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  review: AffiliateApplicationReviewState | null;
  reviewHistory: AffiliateApplicationReviewEntry[];
}

export interface AffiliatePayoutRecord {
  id: string;
  affiliateId: string;
  affiliateName: string | null;
  affiliateRefCode: string | null;
  amountNet: number;
  amountVat: number;
  amountGross: number;
  currency: string;
  periodStart: Timestamp | null;
  periodEnd: Timestamp | null;
  notes: string | null;
  createdAt: Timestamp | null;
  recordedByUid: string | null;
  recordedByEmail: string | null;
}

export const AFFILIATE_DEFAULT_COMMISSION_RATE = 0.5;
export const AFFILIATE_MIN_WITHDRAWAL_NET = 50;

const numberOrZero = (value: unknown, precision = 2): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return precision >= 0 ? Number(value.toFixed(precision)) : value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return precision >= 0 ? Number(parsed.toFixed(precision)) : parsed;
    }
  }
  return 0;
};

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseTimestamp = (value: unknown): Timestamp | null => {
  if (!value) return null;
  if (typeof value === 'object' && value && 'toDate' in (value as Record<string, unknown>)) {
    return value as Timestamp;
  }
  return null;
};

const normaliseStatus = (value: unknown): AffiliateStatus => {
  if (value === 'active' || value === 'paused' || value === 'inactive') {
    return value;
  }
  return 'pending';
};

const normaliseReviewAction = (
  value: unknown,
): AffiliateApplicationDecisionAction | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'approve' || normalised === 'approved') {
    return 'approve';
  }
  if (normalised === 'reject' || normalised === 'rejected' || normalised === 'decline' || normalised === 'declined') {
    return 'reject';
  }
  if (
    normalised === 'request_info' ||
    normalised === 'request-info' ||
    normalised === 'info_requested' ||
    normalised === 'needs_info' ||
    normalised === 'needs_more_info'
  ) {
    return 'request_info';
  }
  return null;
};

const parseReviewEntry = (value: unknown): AffiliateApplicationReviewEntry | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const data = value as Record<string, unknown>;
  const action =
    normaliseReviewAction(data.action) ||
    normaliseReviewAction(data.decision) ||
    normaliseReviewAction(data.lastAction) ||
    normaliseReviewAction(data.statusAction);
  if (!action) {
    return null;
  }

  const status = stringOrNull(data.status) ?? stringOrNull(data.lastStatus);
  const stage = stringOrNull(data.stage) ?? stringOrNull(data.lastStage);
  const notes = stringOrNull(data.notes) ?? stringOrNull(data.note);
  const reviewerUid = stringOrNull(data.reviewerUid) ?? stringOrNull(data.reviewedByUid);
  const reviewerName =
    stringOrNull(data.reviewerName) ?? stringOrNull(data.reviewerDisplayName) ?? stringOrNull(data.reviewedByName);
  const reviewerEmail = stringOrNull(data.reviewerEmail) ?? stringOrNull(data.reviewedByEmail);
  const decidedAt =
    parseTimestamp(data.decidedAt) ??
    parseTimestamp((data.timestamp as Timestamp | undefined) ?? null) ??
    parseTimestamp((data.createdAt as Timestamp | undefined) ?? null);

  return {
    action,
    status: status ?? null,
    stage: stage ?? null,
    notes: notes ?? null,
    reviewerUid,
    reviewerName,
    reviewerEmail,
    decidedAt,
  } satisfies AffiliateApplicationReviewEntry;
};

const parseReviewState = (value: unknown, history: AffiliateApplicationReviewEntry[]): AffiliateApplicationReviewState | null => {
  const entry = parseReviewEntry(value);
  if (entry) {
    return entry;
  }
  if (history.length === 0) {
    return null;
  }
  return history[history.length - 1];
};

const normaliseCommissionRate = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1.5) {
    return Number(parsed.toFixed(4));
  }
  return AFFILIATE_DEFAULT_COMMISSION_RATE;
};

const normaliseRefCode = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
};

const extractMetrics = (data: Record<string, any>): AffiliateMetrics => {
  const metrics = (data.metrics ?? {}) as Record<string, any>;
  return {
    totalOrders: numberOrZero(metrics.totalOrders, 0),
    totalRevenueGross: numberOrZero(metrics.totalRevenueGross),
    totalCommissionNet: numberOrZero(metrics.totalCommissionNet),
    totalCommissionVat: numberOrZero(metrics.totalCommissionVat),
    totalCommissionGross: numberOrZero(metrics.totalCommissionGross),
    pendingCommissionNet: numberOrZero(metrics.pendingCommissionNet),
    pendingCommissionVat: numberOrZero(metrics.pendingCommissionVat),
    pendingCommissionGross: numberOrZero(metrics.pendingCommissionGross),
    paidCommissionNet: numberOrZero(metrics.paidCommissionNet),
    paidCommissionVat: numberOrZero(metrics.paidCommissionVat),
    paidCommissionGross: numberOrZero(metrics.paidCommissionGross),
    totalLeads: numberOrZero(metrics.totalLeads, 0),
    totalQuotes: numberOrZero(metrics.totalQuotes, 0),
    totalClicks: numberOrZero(metrics.totalClicks, 0),
    lastOrderAt: parseTimestamp(metrics.lastOrderAt),
    lastPayoutAt: parseTimestamp(metrics.lastPayoutAt),
  };
};

const extractPayoutDetails = (data: Record<string, any>): AffiliatePayoutDetails => {
  const payout = (data.payout ?? {}) as Record<string, any>;
  return {
    accountName: stringOrNull(payout.accountName),
    bankName: stringOrNull(payout.bankName),
    sortCode: stringOrNull(payout.sortCode),
    accountNumber: stringOrNull(payout.accountNumber),
    notes: stringOrNull(payout.notes),
  };
};

export function parseAffiliateDoc(doc: QueryDocumentSnapshot<DocumentData>): AffiliateRecord {
  const data = doc.data() as Record<string, any>;
  const fallbackCode = doc.id.replace(/[^a-z0-9]/gi, '').toLowerCase() || `aff-${doc.id.slice(0, 6)}`;
  return {
    id: doc.id,
    name: stringOrNull(data.name) ?? 'Affiliate partner',
    email: stringOrNull(data.email),
    company: stringOrNull(data.company),
    phone: stringOrNull(data.phone),
    status: normaliseStatus(data.status),
    refCode: normaliseRefCode(data.refCode, fallbackCode),
    commissionRate: normaliseCommissionRate(data.commissionRate),
    metrics: extractMetrics(data),
    payout: extractPayoutDetails(data),
    createdAt: parseTimestamp(data.createdAt),
    updatedAt: parseTimestamp(data.updatedAt),
    lastReferralAt: parseTimestamp(data.lastReferralAt),
    ownerUid: stringOrNull(data.ownerUid),
    notes: stringOrNull(data.notes),
  };
}

export function parseAffiliateApplicationDoc(
  doc: QueryDocumentSnapshot<DocumentData>
): AffiliateApplicationRecord {
  const data = doc.data() as Record<string, any>;
  const reviewHistoryRaw = Array.isArray(data.reviewHistory) ? data.reviewHistory : [];
  const reviewHistory = reviewHistoryRaw
    .map((entry) => parseReviewEntry(entry))
    .filter((entry): entry is AffiliateApplicationReviewEntry => Boolean(entry))
    .sort((a, b) => {
      const aTime = a.decidedAt?.toMillis?.() ?? 0;
      const bTime = b.decidedAt?.toMillis?.() ?? 0;
      return aTime - bTime;
    });
  const review = parseReviewState(data.review, reviewHistory);
  return {
    id: doc.id,
    fullName: stringOrNull(data.fullName) ?? stringOrNull(data.name) ?? 'Applicant',
    email: stringOrNull(data.email) ?? '',
    phone: stringOrNull(data.phone),
    location: stringOrNull(data.location) ?? stringOrNull(data.region),
    focus: stringOrNull(data.marketingFocus) ?? stringOrNull(data.focus),
    experience: stringOrNull(data.experience),
    socials: stringOrNull(data.socials) ?? stringOrNull(data.socialHandles),
    website: stringOrNull(data.website) ?? stringOrNull(data.portfolioUrl),
    notes: stringOrNull(data.notes) ?? stringOrNull(data.additionalInfo),
    status: stringOrNull(data.status),
    stage: stringOrNull(data.stage) ?? stringOrNull(data.processStage),
    createdAt: parseTimestamp(data.createdAt),
    updatedAt: parseTimestamp(data.updatedAt),
    review,
    reviewHistory,
  };
}

export function parseAffiliatePayoutDoc(
  doc: QueryDocumentSnapshot<DocumentData>
): AffiliatePayoutRecord {
  const data = doc.data() as Record<string, any>;
  return {
    id: doc.id,
    affiliateId: stringOrNull(data.affiliateId) ?? doc.id,
    affiliateName: stringOrNull(data.affiliateName),
    affiliateRefCode: stringOrNull(data.affiliateRefCode),
    amountNet: numberOrZero(data.amountNet),
    amountVat: numberOrZero(data.amountVat),
    amountGross: numberOrZero(data.amountGross),
    currency: stringOrNull(data.currency) ?? 'GBP',
    periodStart: parseTimestamp(data.periodStart),
    periodEnd: parseTimestamp(data.periodEnd),
    notes: stringOrNull(data.notes),
    createdAt: parseTimestamp(data.createdAt),
    recordedByUid: stringOrNull(data.recordedByUid),
    recordedByEmail: stringOrNull(data.recordedByEmail),
  };
}

export function buildAffiliateShareLink(refCode: string, origin?: string | null): string {
  const safeCode = refCode.trim();
  const base = (origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();
  if (base) {
    try {
      const url = new URL(base);
      url.searchParams.set('affiliate', safeCode);
      return url.toString();
    } catch {
      // fall back to string concatenation below
    }
  }
  const host = typeof window !== 'undefined' ? window.location.origin : '';
  const prefix = base || host || 'https://pineappletapped.com';
  const separator = prefix.includes('?') ? '&' : '?';
  return `${prefix}${separator}affiliate=${encodeURIComponent(safeCode)}`;
}

export function formatCurrencyGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function describeCommissionRate(rate: number): string {
  const percentage = Number.isFinite(rate) ? rate * 100 : AFFILIATE_DEFAULT_COMMISSION_RATE * 100;
  return `${percentage.toFixed(1)}% of HQ commission`;
}
