import type { DocumentData, DocumentSnapshot, Timestamp } from 'firebase/firestore';
import type { ProductOrganiserProgram } from './products';

export interface NormalisedOrganiserProgram {
  organiserId: string;
  minimumGuarantee: number | null;
  exhibitorProductId: string | null;
  exhibitorPrice: number | null;
  upsellVariationIds: string[];
  commissionRate: number | null;
}

export interface OrganiserAccessContext {
  program: NormalisedOrganiserProgram;
  active: boolean;
  source?: 'query' | 'prop';
  token?: string | null;
}

export interface EventOrganiserProfile {
  id: string;
  userId: string;
  active: boolean;
  name: string | null;
  minimumGuarantee: number | null;
  hiddenProductIds: string[];
  programProductIds: string[];
  linkedProjectIds: string[];
  exhibitorProductId: string | null;
  upsellVariationIds: string[];
  stripeAccountId: string | null;
  stripeStatus: string | null;
  commissionRate: number | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

const normaliseString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normaliseOrganiserId = (value: unknown): string | null => {
  const str = normaliseString(value);
  return str ? str.toLowerCase() : null;
};

const normaliseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normaliseStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  value.forEach((entry) => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) {
        result.push(trimmed);
      }
    }
  });
  return result;
};

export function parseEventOrganiserSnapshot(
  snapshot: DocumentSnapshot<DocumentData>
): EventOrganiserProfile | null {
  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data() ?? {};
  const active = data?.active === true;
  const minimumGuarantee = normaliseNumber(data?.minimumGuarantee);
  const commissionRate = normaliseNumber(data?.commissionRate);

  return {
    id: snapshot.id,
    userId: normaliseString(data?.userId) ?? snapshot.id,
    active,
    name: normaliseString(data?.name),
    minimumGuarantee,
    hiddenProductIds: normaliseStringList(data?.hiddenProductIds),
    programProductIds: normaliseStringList(data?.programProductIds),
    linkedProjectIds: normaliseStringList(data?.linkedProjectIds),
    exhibitorProductId: normaliseString(data?.exhibitorProductId),
    upsellVariationIds: normaliseStringList(data?.upsellVariationIds),
    stripeAccountId: normaliseString(data?.stripeAccountId),
    stripeStatus: normaliseString(data?.stripeStatus),
    commissionRate,
    createdAt: (data?.createdAt as Timestamp) ?? null,
    updatedAt: (data?.updatedAt as Timestamp) ?? null,
  } satisfies EventOrganiserProfile;
}

export const isOrganiserProgramEnabled = (
  input?: ProductOrganiserProgram | null
): boolean => {
  if (!input || typeof input !== 'object') {
    return false;
  }
  if ((input as ProductOrganiserProgram).enabled === false) {
    return false;
  }
  return true;
};

export const normaliseOrganiserProgram = (
  input?: ProductOrganiserProgram | null
): NormalisedOrganiserProgram | null => {
  if (!input || typeof input !== 'object') {
    return null;
  }
  if ((input as ProductOrganiserProgram).enabled === false) {
    return null;
  }
  const organiserId = normaliseOrganiserId((input as ProductOrganiserProgram).organiserId);
  if (!organiserId) {
    return null;
  }
  const minimumGuarantee = normaliseNumber((input as ProductOrganiserProgram).minimumGuarantee);
  const exhibitorProductId = normaliseString((input as ProductOrganiserProgram).exhibitorProductId);
  const exhibitorPrice = normaliseNumber((input as ProductOrganiserProgram).exhibitorPrice);
  const upsellVariationIds = normaliseStringList(
    (input as ProductOrganiserProgram).upsellVariationIds
  );
  const commissionRate = normaliseNumber((input as ProductOrganiserProgram).commissionRate);
  return {
    organiserId,
    minimumGuarantee,
    exhibitorProductId,
    exhibitorPrice,
    upsellVariationIds,
    commissionRate,
  } satisfies NormalisedOrganiserProgram;
};

export const resolveOrganiserAccessContext = (
  program: ProductOrganiserProgram | null | undefined,
  candidate?: string | null,
  source: OrganiserAccessContext['source'] = 'query'
): OrganiserAccessContext | null => {
  const normalised = normaliseOrganiserProgram(program);
  if (!normalised) {
    return null;
  }
  const candidateId = normaliseOrganiserId(candidate);
  const active = Boolean(candidateId && candidateId === normalised.organiserId);
  return {
    program: normalised,
    active,
    source,
    token: candidateId,
  } satisfies OrganiserAccessContext;
};
