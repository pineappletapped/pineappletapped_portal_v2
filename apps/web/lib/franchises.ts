import type { Timestamp } from 'firebase/firestore';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

export type FranchiseStatus = 'prospect' | 'active' | 'paused' | 'suspended';

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

export function parseFranchise(doc: SnapshotWithId): Franchise {
  const data = doc.data() as Record<string, unknown>;
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
