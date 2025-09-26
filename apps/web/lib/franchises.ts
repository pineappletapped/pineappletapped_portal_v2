import type { Timestamp } from 'firebase/firestore';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

export type FranchiseStatus = 'prospect' | 'active' | 'paused' | 'suspended';

export type FranchiseOnboardingStatus =
  | 'not_started'
  | 'in_progress'
  | 'needs_attention'
  | 'completed';

export interface FranchiseOnboardingChecklist {
  kycStatus: FranchiseOnboardingStatus;
  stripeAccountStatus: FranchiseOnboardingStatus;
  bankStatus: FranchiseOnboardingStatus;
  legalStatus: FranchiseOnboardingStatus;
  chargesEnabled: boolean;
  notes?: string | null;
  lastSyncedAt?: Timestamp | null;
  activatedAt?: Timestamp | null;
}

export type RoyaltySource = 'hq' | 'franchisee';

export interface FranchiseRoyaltyTier {
  minOrder: number;
  maxOrder?: number | null;
  percentage: number;
}

export interface FranchiseRoyaltyConfig {
  hqTiers: FranchiseRoyaltyTier[];
  franchiseSourcedPercentage: number;
}

export type QuickBooksEnvironment = 'sandbox' | 'production';

export interface FranchiseQuickBooksConfig {
  environment: QuickBooksEnvironment;
  clientId?: string | null;
  clientSecret?: string | null;
  refreshToken?: string | null;
  realmId?: string | null;
  connectedAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface Franchise {
  id: string;
  name: string;
  code: string;
  status: FranchiseStatus;
  contactEmail?: string | null;
  contactPhone?: string | null;
  stripeAccountId?: string | null;
  platformFee?: number | null;
  notes?: string | null;
  onboarding: FranchiseOnboardingChecklist;
  quickbooks: FranchiseQuickBooksConfig;
  royalty: FranchiseRoyaltyConfig;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type TerritoryType = 'postal' | 'radius';

export interface FranchiseTerritory {
  id: string;
  franchiseId: string;
  label: string;
  type: TerritoryType;
  postalCodes: string[];
  exclusive: boolean;
  radiusKm?: number | null;
  centerLat?: number | null;
  centerLng?: number | null;
  categories: string[];
  licenseFee?: number | null;
  notes?: string | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type FranchiseMemberRole = 'owner' | 'franchisee' | 'contractor' | 'hq';

export interface FranchiseMember {
  id: string;
  franchiseId: string;
  userId: string;
  role: FranchiseMemberRole;
  primary?: boolean | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

type SnapshotWithId = QueryDocumentSnapshot<DocumentData>;

function parseOnboardingStatus(value: unknown): FranchiseOnboardingStatus {
  switch (value) {
    case 'in_progress':
    case 'needs_attention':
    case 'completed':
      return value as FranchiseOnboardingStatus;
    default:
      return 'not_started';
  }
}

function parseOnboardingChecklist(data: Record<string, unknown> | null | undefined): FranchiseOnboardingChecklist {
  const notes = typeof data?.notes === 'string' ? data.notes : null;
  return {
    kycStatus: parseOnboardingStatus(data?.kycStatus),
    stripeAccountStatus: parseOnboardingStatus(data?.stripeAccountStatus),
    bankStatus: parseOnboardingStatus(data?.bankStatus),
    legalStatus: parseOnboardingStatus(data?.legalStatus),
    chargesEnabled: data?.chargesEnabled === true,
    notes,
    lastSyncedAt: (data?.lastSyncedAt as Timestamp) ?? null,
    activatedAt: (data?.activatedAt as Timestamp) ?? null,
  } satisfies FranchiseOnboardingChecklist;
}

function parseRoyaltyTier(input: unknown): FranchiseRoyaltyTier | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const data = input as Record<string, unknown>;
  const rawMin = data.minOrder ?? data.orderFrom ?? data.start ?? data.from;
  const rawMax = data.maxOrder ?? data.orderThrough ?? data.end ?? data.to;
  const rawPercentage = data.percentage ?? data.rate ?? data.percent ?? data.value;
  const minOrder = Number(rawMin);
  if (!Number.isFinite(minOrder) || minOrder <= 0) {
    return null;
  }
  const maxOrder = rawMax == null || rawMax === '' ? null : Number(rawMax);
  const percentage = Number(rawPercentage);
  if (!Number.isFinite(percentage)) {
    return null;
  }
  const tier: FranchiseRoyaltyTier = {
    minOrder: Math.max(1, Math.floor(minOrder)),
    percentage,
  };
  if (Number.isFinite(maxOrder)) {
    tier.maxOrder = Math.max(Math.floor(Number(maxOrder)), tier.minOrder);
  } else {
    tier.maxOrder = null;
  }
  return tier;
}

function parseRoyaltyConfig(raw: unknown): FranchiseRoyaltyConfig {
  const defaultConfig = defaultFranchiseRoyaltyConfig();
  if (!raw || typeof raw !== 'object') {
    return defaultConfig;
  }
  const data = raw as Record<string, unknown>;
  const tierValues: unknown = data.hqTiers ?? data.hq ?? data.slidingScale;
  const tiers: FranchiseRoyaltyTier[] = Array.isArray(tierValues)
    ? tierValues
        .map((item) => parseRoyaltyTier(item))
        .filter((item): item is FranchiseRoyaltyTier => item !== null)
    : [];
  const franchiseValue = data.franchiseSourcedPercentage ?? data.franchise ?? data.local ?? data.direct;
  const parsedFranchise = Number(franchiseValue);
  const franchisePercentage = Number.isFinite(parsedFranchise)
    ? parsedFranchise
    : defaultConfig.franchiseSourcedPercentage;
  if (tiers.length === 0) {
    return { ...defaultConfig, franchiseSourcedPercentage: franchisePercentage };
  }
  const sortedTiers = tiers.sort((a, b) => a.minOrder - b.minOrder);
  return {
    hqTiers: sortedTiers,
    franchiseSourcedPercentage: franchisePercentage,
  } satisfies FranchiseRoyaltyConfig;
}

function parseQuickBooksEnvironment(value: unknown): QuickBooksEnvironment {
  return value === 'sandbox' ? 'sandbox' : 'production';
}

function parseQuickBooksConfig(raw: unknown): FranchiseQuickBooksConfig {
  const defaults = defaultFranchiseQuickBooksConfig();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }
  const data = raw as Record<string, unknown>;
  const environment = parseQuickBooksEnvironment(data.environment);
  const clientId = typeof data.clientId === 'string' ? data.clientId.trim() : '';
  const clientSecret = typeof data.clientSecret === 'string' ? data.clientSecret.trim() : '';
  const refreshToken = typeof data.refreshToken === 'string' ? data.refreshToken.trim() : '';
  const realmId = typeof data.realmId === 'string' ? data.realmId.trim() : '';
  const connectedAt = (data.connectedAt as Timestamp) ?? null;
  const updatedAt = (data.updatedAt as Timestamp) ?? null;
  return {
    environment,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    refreshToken: refreshToken || null,
    realmId: realmId || null,
    connectedAt,
    updatedAt,
  } satisfies FranchiseQuickBooksConfig;
}

export function defaultFranchiseQuickBooksConfig(): FranchiseQuickBooksConfig {
  return {
    environment: 'production',
    clientId: null,
    clientSecret: null,
    refreshToken: null,
    realmId: null,
    connectedAt: null,
    updatedAt: null,
  };
}

export function defaultFranchiseRoyaltyConfig(): FranchiseRoyaltyConfig {
  return {
    hqTiers: [
      { minOrder: 1, maxOrder: 1, percentage: 20 },
      { minOrder: 2, maxOrder: 2, percentage: 15 },
      { minOrder: 3, maxOrder: 5, percentage: 10 },
      { minOrder: 6, maxOrder: null, percentage: 6 },
    ],
    franchiseSourcedPercentage: 6,
  };
}

export function resolveRoyaltyPercentage(
  config: FranchiseRoyaltyConfig | null | undefined,
  source: RoyaltySource,
  orderIndex: number
): { percentage: number; tier: FranchiseRoyaltyTier | null } {
  const fallback = defaultFranchiseRoyaltyConfig();
  const activeConfig = config ?? fallback;
  if (source === 'franchisee') {
    return {
      percentage:
        typeof activeConfig.franchiseSourcedPercentage === 'number'
          ? activeConfig.franchiseSourcedPercentage
          : fallback.franchiseSourcedPercentage,
      tier: null,
    };
  }
  const tiers = (activeConfig.hqTiers?.length ? activeConfig.hqTiers : fallback.hqTiers).slice();
  tiers.sort((a, b) => a.minOrder - b.minOrder);
  const index = Number(orderIndex);
  if (!Number.isFinite(index) || index <= 0) {
    return { percentage: tiers[0]?.percentage ?? fallback.hqTiers[0].percentage, tier: tiers[0] ?? fallback.hqTiers[0] };
  }
  for (const tier of tiers) {
    const withinLower = index >= tier.minOrder;
    const withinUpper = tier.maxOrder == null || index <= tier.maxOrder;
    if (withinLower && withinUpper) {
      return { percentage: tier.percentage, tier };
    }
  }
  const lastTier = tiers[tiers.length - 1] ?? fallback.hqTiers[fallback.hqTiers.length - 1];
  return { percentage: lastTier.percentage, tier: lastTier };
}

export function defaultFranchiseOnboarding(): FranchiseOnboardingChecklist {
  return {
    kycStatus: 'not_started',
    stripeAccountStatus: 'not_started',
    bankStatus: 'not_started',
    legalStatus: 'not_started',
    chargesEnabled: false,
    notes: null,
    lastSyncedAt: null,
    activatedAt: null,
  };
}

export function parseFranchise(doc: SnapshotWithId): Franchise {
  const data = doc.data() as Record<string, unknown>;
  const onboardingData =
    data.onboarding && typeof data.onboarding === 'object'
      ? (data.onboarding as Record<string, unknown>)
      : null;
  return {
    id: doc.id,
    name: (data.name as string) || 'Untitled Franchise',
    code: (data.code as string) || doc.id,
    status: ((data.status as FranchiseStatus) ?? 'prospect') as FranchiseStatus,
    contactEmail: (data.contactEmail as string) ?? null,
    contactPhone: (data.contactPhone as string) ?? null,
    stripeAccountId: (data.stripeAccountId as string) ?? null,
    platformFee: typeof data.platformFee === 'number' ? (data.platformFee as number) : null,
    notes: (data.notes as string) ?? null,
    onboarding: parseOnboardingChecklist(onboardingData),
    quickbooks: parseQuickBooksConfig(data.quickbooks),
    royalty: parseRoyaltyConfig(data.royalty),
    createdAt: (data.createdAt as Timestamp) ?? null,
    updatedAt: (data.updatedAt as Timestamp) ?? null,
  };
}

export function parseTerritory(doc: SnapshotWithId): FranchiseTerritory {
  const data = doc.data() as Record<string, unknown>;
  const postalCodesRaw = Array.isArray(data.postalCodes)
    ? (data.postalCodes as unknown[]).map((p) => String(p).trim()).filter(Boolean)
    : typeof data.postalCodes === 'string'
      ? (data.postalCodes as string)
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : [];
  return {
    id: doc.id,
    franchiseId: (data.franchiseId as string) || '',
    label: (data.label as string) || 'Unnamed Territory',
    type: ((data.type as TerritoryType) ?? 'postal') as TerritoryType,
    postalCodes: postalCodesRaw,
    exclusive: data.exclusive !== false,
    radiusKm: typeof data.radiusKm === 'number' ? (data.radiusKm as number) : null,
    centerLat: typeof data.centerLat === 'number' ? (data.centerLat as number) : null,
    centerLng: typeof data.centerLng === 'number' ? (data.centerLng as number) : null,
    categories: Array.isArray(data.categories)
      ? (data.categories as unknown[])
          .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '')).trim())
          .filter(Boolean)
      : [],
    licenseFee: typeof data.licenseFee === 'number' ? (data.licenseFee as number) : null,
    notes: (data.notes as string) ?? null,
    createdAt: (data.createdAt as Timestamp) ?? null,
    updatedAt: (data.updatedAt as Timestamp) ?? null,
  };
}

export function parseMember(doc: SnapshotWithId): FranchiseMember {
  const data = doc.data() as Record<string, unknown>;
  return {
    id: doc.id,
    franchiseId: (data.franchiseId as string) || '',
    userId: (data.userId as string) || '',
    role: ((data.role as FranchiseMemberRole) ?? 'franchisee') as FranchiseMemberRole,
    primary: data.primary === true,
    createdAt: (data.createdAt as Timestamp) ?? null,
    updatedAt: (data.updatedAt as Timestamp) ?? null,
  };
}

export function territorySummary(territory: FranchiseTerritory): string {
  if (territory.type === 'radius') {
    const center =
      typeof territory.centerLat === 'number' && typeof territory.centerLng === 'number'
        ? `${territory.centerLat.toFixed(4)}, ${territory.centerLng.toFixed(4)}`
        : 'Unspecified centre';
    const radius = typeof territory.radiusKm === 'number' ? `${territory.radiusKm} km radius` : 'Radius pending';
    return `${territory.label} · ${radius} · ${center}`;
  }
  const codes = territory.postalCodes.slice(0, 6).join(', ');
  const suffix = territory.postalCodes.length > 6 ? '…' : '';
  return `${territory.label} · ${territory.postalCodes.length} codes · ${codes}${suffix}`;
}

export function canActivateFranchise(onboarding: FranchiseOnboardingChecklist): boolean {
  return (
    onboarding.kycStatus === 'completed' &&
    onboarding.stripeAccountStatus === 'completed' &&
    onboarding.chargesEnabled === true
  );
}
