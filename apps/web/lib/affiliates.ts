import type { DocumentData, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';

export type AffiliateStatus = 'pending' | 'active' | 'paused' | 'inactive';

export interface AffiliatePayoutDetails {
  accountName: string | null;
  bankName: string | null;
  sortCode: string | null;
  accountNumber: string | null;
  notes: string | null;
}

export type AffiliateStripeStatus =
  | 'not_connected'
  | 'in_progress'
  | 'pending_verification'
  | 'restricted'
  | 'active';

export interface AffiliateStripeDetails {
  accountId: string | null;
  status: AffiliateStripeStatus;
  payoutsEnabled: boolean | null;
  chargesEnabled: boolean | null;
  requirementsDue: string[];
  requirementsPastDue: string[];
  requirementsEventuallyDue: string[];
  disabledReason: string | null;
  lastOnboardedAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
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
  scheduledCommissionNet: number;
  scheduledCommissionVat: number;
  scheduledCommissionGross: number;
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
  stripe: AffiliateStripeDetails;
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
  lineItems: AffiliatePayoutLineItem[];
  remittanceStoragePath: string | null;
  remittanceFileName: string | null;
  remittanceGeneratedAt: Timestamp | null;
  remittanceDownloadUrl: string | null;
}

export interface AffiliatePayoutLineItem {
  commissionId: string;
  orderId: string;
  orderLabel: string | null;
  commissionNet: number;
  commissionVat: number;
  commissionGross: number;
  currency: string;
  statusApplied: AffiliateCommissionStatus | null;
}

export type AffiliateCommissionStatus = 'pending' | 'scheduled' | 'paid' | 'cancelled';

export interface AffiliateCommissionDeliverableSummary {
  projectId: string | null;
  projectName: string | null;
  assetIds: string[];
}

export interface AffiliateCommissionRecord {
  id: string;
  affiliateId: string;
  affiliateName: string | null;
  affiliateRefCode: string | null;
  affiliateOwnerUid: string | null;
  affiliateEmail: string | null;
  orderId: string;
  orderLabel: string | null;
  orderTotalGross: number | null;
  orderTotalNet: number | null;
  orderCurrency: string | null;
  clientId: string | null;
  clientName: string | null;
  commissionNet: number;
  commissionVat: number;
  commissionGross: number;
  currency: string;
  status: AffiliateCommissionStatus;
  payoutId: string | null;
  notes: string | null;
  deliverables: AffiliateCommissionDeliverableSummary[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  deliveredAt: Timestamp | null;
  scheduledAt: Timestamp | null;
  paidAt: Timestamp | null;
}

export interface AffiliateResourceRecord {
  id: string;
  title: string;
  description: string | null;
  linkUrl: string | null;
  category: string | null;
  pinned: boolean;
  publishedAt: Timestamp | null;
  updatedAt: Timestamp | null;
  createdByName: string | null;
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

const normaliseStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
};

const booleanOrNull = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === 'yes' || trimmed === '1') {
      return true;
    }
    if (trimmed === 'false' || trimmed === 'no' || trimmed === '0') {
      return false;
    }
  }
  return null;
};

export function normaliseAffiliateStripeStatus(value: unknown): AffiliateStripeStatus {
  if (typeof value !== 'string') {
    return 'not_connected';
  }
  const normalised = value.trim().toLowerCase();
  if (
    normalised === 'in_progress' ||
    normalised === 'pending' ||
    normalised === 'onboarding' ||
    normalised === 'under_review'
  ) {
    return 'in_progress';
  }
  if (
    normalised === 'pending_verification' ||
    normalised === 'requirements_due' ||
    normalised === 'verification_needed'
  ) {
    return 'pending_verification';
  }
  if (normalised === 'restricted' || normalised === 'disabled' || normalised === 'payouts_disabled') {
    return 'restricted';
  }
  if (normalised === 'active' || normalised === 'complete' || normalised === 'enabled') {
    return 'active';
  }
  return 'not_connected';
}

export function describeAffiliateStripeStatus(status: AffiliateStripeStatus): string {
  switch (status) {
    case 'active':
      return 'Active — payouts enabled';
    case 'restricted':
      return 'Restricted — action required';
    case 'pending_verification':
      return 'Verification required';
    case 'in_progress':
      return 'Onboarding in progress';
    default:
      return 'Not connected';
  }
}

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
    scheduledCommissionNet: numberOrZero(metrics.scheduledCommissionNet),
    scheduledCommissionVat: numberOrZero(metrics.scheduledCommissionVat),
    scheduledCommissionGross: numberOrZero(metrics.scheduledCommissionGross),
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

const extractStripeDetails = (data: Record<string, any>): AffiliateStripeDetails => {
  const stripe = (data.stripe ?? {}) as Record<string, any>;
  const accountId =
    stringOrNull(data.stripeAccountId ?? stripe.accountId ?? data.connectAccountId) ?? null;
  const status = normaliseAffiliateStripeStatus(data.stripeStatus ?? stripe.status);
  const payoutsEnabled = booleanOrNull(
    data.stripePayoutsEnabled ?? stripe.payoutsEnabled ?? data.payoutsEnabled
  );
  const chargesEnabled = booleanOrNull(
    data.stripeChargesEnabled ?? stripe.chargesEnabled ?? data.chargesEnabled
  );
  const requirementsDue = normaliseStringList(
    data.stripeRequirementsDue ?? stripe.requirementsDue ?? stripe.requirements?.due
  );
  const requirementsPastDue = normaliseStringList(
    data.stripeRequirementsPastDue ?? stripe.requirementsPastDue ?? stripe.requirements?.pastDue
  );
  const requirementsEventuallyDue = normaliseStringList(
    data.stripeRequirementsEventuallyDue ?? stripe.requirementsEventuallyDue ?? []
  );
  const disabledReason =
    stringOrNull(
      data.stripeDisabledReason ??
        stripe.disabledReason ??
        stripe.requirements?.disabledReason ??
        data.disabledReason
    ) ?? null;
  const lastOnboardedAt = parseTimestamp(
    stripe.lastOnboardedAt ??
      stripe.lastOnboardingAt ??
      data.stripeLastOnboardedAt ??
      data.stripeLastOnboardingAt
  );
  const lastLoginAt = parseTimestamp(
    stripe.lastLoginAt ?? data.stripeLastLoginAt ?? stripe.lastDashboardLoginAt
  );

  return {
    accountId,
    status: accountId ? status : 'not_connected',
    payoutsEnabled,
    chargesEnabled,
    requirementsDue,
    requirementsPastDue,
    requirementsEventuallyDue,
    disabledReason,
    lastOnboardedAt,
    lastLoginAt,
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
    stripe: extractStripeDetails(data),
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
  const remittance = (data.remittance ?? {}) as Record<string, any>;
  const remittancePath =
    stringOrNull(remittance.storagePath) ??
    stringOrNull(remittance.path) ??
    stringOrNull(data.remittancePath);
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
    lineItems: Array.isArray(data.lineItems)
      ? (data.lineItems as Record<string, any>[]).map((item) => ({
          commissionId: stringOrNull(item.commissionId) ?? '',
          orderId: stringOrNull(item.orderId) ?? '',
          orderLabel: stringOrNull(item.orderLabel),
          commissionNet: numberOrZero(item.commissionNet),
          commissionVat: numberOrZero(item.commissionVat),
          commissionGross: numberOrZero(item.commissionGross),
          currency: stringOrNull(item.currency) ?? 'GBP',
          statusApplied: normaliseCommissionStatus(item.statusApplied),
        }))
      : [],
    remittanceStoragePath: remittancePath,
    remittanceFileName:
      stringOrNull(remittance.fileName) ??
      (remittancePath ? remittancePath.split('/').pop() ?? null : null),
    remittanceGeneratedAt:
      parseTimestamp(remittance.generatedAt) ?? parseTimestamp(data.remittanceGeneratedAt),
    remittanceDownloadUrl:
      stringOrNull(remittance.downloadUrl) ?? stringOrNull(data.remittanceDownloadUrl),
  };
}

const normaliseCommissionStatus = (value: unknown): AffiliateCommissionStatus => {
  if (typeof value !== 'string') {
    return 'pending';
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === 'scheduled' || normalised === 'pay_scheduled') {
    return 'scheduled';
  }
  if (normalised === 'paid' || normalised === 'complete' || normalised === 'completed') {
    return 'paid';
  }
  if (normalised === 'cancelled' || normalised === 'void') {
    return 'cancelled';
  }
  return 'pending';
};

export function parseAffiliateCommissionDoc(
  doc: QueryDocumentSnapshot<DocumentData>
): AffiliateCommissionRecord {
  const data = doc.data() as Record<string, any>;
  const deliverablesRaw = Array.isArray(data.deliverables) ? data.deliverables : [];
  const deliverables: AffiliateCommissionDeliverableSummary[] = deliverablesRaw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, any>;
      return {
        projectId: stringOrNull(record.projectId),
        projectName: stringOrNull(record.projectName),
        assetIds: Array.isArray(record.assetIds)
          ? record.assetIds.filter((id): id is string => typeof id === 'string')
          : [],
      } as AffiliateCommissionDeliverableSummary;
    })
    .filter((entry): entry is AffiliateCommissionDeliverableSummary => Boolean(entry));

  return {
    id: doc.id,
    affiliateId: stringOrNull(data.affiliateId) ?? '',
    affiliateName: stringOrNull(data.affiliateName),
    affiliateRefCode: stringOrNull(data.affiliateRefCode),
    affiliateOwnerUid: stringOrNull(data.affiliateOwnerUid),
    affiliateEmail: stringOrNull(data.affiliateEmail),
    orderId: stringOrNull(data.orderId) ?? doc.id,
    orderLabel: stringOrNull(data.orderLabel),
    orderTotalGross: data.orderTotalGross === null ? null : numberOrZero(data.orderTotalGross),
    orderTotalNet: data.orderTotalNet === null ? null : numberOrZero(data.orderTotalNet),
    orderCurrency: stringOrNull(data.orderCurrency),
    clientId: stringOrNull(data.clientId),
    clientName: stringOrNull(data.clientName),
    commissionNet: numberOrZero(data.commissionNet),
    commissionVat: numberOrZero(data.commissionVat),
    commissionGross: numberOrZero(data.commissionGross),
    currency: stringOrNull(data.currency) ?? 'GBP',
    status: normaliseCommissionStatus(data.status),
    payoutId: stringOrNull(data.payoutId),
    notes: stringOrNull(data.notes),
    deliverables,
    createdAt: parseTimestamp(data.createdAt),
    updatedAt: parseTimestamp(data.updatedAt),
    deliveredAt: parseTimestamp(data.deliveredAt),
    scheduledAt: parseTimestamp(data.scheduledAt),
    paidAt: parseTimestamp(data.paidAt),
  };
}

const escapeCsvValue = (value: string): string => {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export function buildAffiliateCommissionCsv(entries: AffiliateCommissionRecord[]): string {
  const header = [
    'Affiliate',
    'Affiliate code',
    'Order',
    'Client',
    'Net',
    'VAT',
    'Gross',
    'Currency',
    'Status',
    'Delivered at',
    'Payout ID',
  ];
  const rows = entries.map((entry) => {
    const deliveredAt = entry.deliveredAt?.toDate?.();
    return [
      entry.affiliateName ?? entry.affiliateId,
      entry.affiliateRefCode ?? '',
      entry.orderLabel ?? entry.orderId,
      entry.clientName ?? '',
      Number(entry.commissionNet ?? 0).toFixed(2),
      Number(entry.commissionVat ?? 0).toFixed(2),
      Number(entry.commissionGross ?? 0).toFixed(2),
      entry.currency ?? 'GBP',
      entry.status,
      deliveredAt ? deliveredAt.toISOString() : '',
      entry.payoutId ?? '',
    ];
  });
  return [header, ...rows]
    .map((cols) => cols.map((value) => escapeCsvValue(String(value ?? ''))).join(','))
    .join('\n');
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

export function parseAffiliateResourceDoc(
  doc: QueryDocumentSnapshot<DocumentData>
): AffiliateResourceRecord {
  const data = doc.data() as Record<string, any>;
  return {
    id: doc.id,
    title: stringOrNull(data.title) ?? 'Resource',
    description: stringOrNull(data.description) ?? stringOrNull(data.summary),
    linkUrl:
      stringOrNull(data.url) ??
      stringOrNull(data.linkUrl) ??
      stringOrNull(data.ctaUrl),
    category: stringOrNull(data.category) ?? stringOrNull(data.topic),
    pinned: Boolean(data.pinned === true || data.isPinned === true),
    publishedAt: parseTimestamp(data.publishedAt) ?? parseTimestamp(data.createdAt),
    updatedAt: parseTimestamp(data.updatedAt),
    createdByName: stringOrNull(data.createdByName) ?? stringOrNull(data.authorName),
  };
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
