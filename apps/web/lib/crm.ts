import {
  collection,
  getDocs,
  query,
  where,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';

type OrgScopedRecord = { id: string } & Record<string, any>;

const isValidId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const uniqueStrings = (values: string[]) => Array.from(new Set(values.filter(isValidId)));

/**
 * Load the organisation ids the provided user belongs to. Membership documents
 * are expected to contain an `orgId` field and are keyed by `${orgId}_${userId}`.
 */
export async function fetchUserOrgIds(db: Firestore, userId: string): Promise<string[]> {
  const membershipSnapshot = await getDocs(
    query(collection(db, 'memberships'), where('userId', '==', userId))
  );

  const orgIds = membershipSnapshot.docs
    .map((docSnap) => (docSnap.data() as Record<string, any>)?.orgId)
    .filter(isValidId);

  return uniqueStrings(orgIds);
}

/**
 * Fetch documents from an organisation-scoped collection for the provided org
 * ids. Firestore's `in` operator is limited to 10 values so the helper issues a
 * query per organisation id and merges the results. Callers are responsible for
 * applying any additional filtering or sorting once the merged list is returned.
 */
export async function fetchOrgDocs(
  db: Firestore,
  collectionName: string,
  orgIds: string[],
  constraints: QueryConstraint[] = []
): Promise<OrgScopedRecord[]> {
  const uniqueOrgIds = uniqueStrings(orgIds);
  if (uniqueOrgIds.length === 0) {
    return [];
  }

  const collectionRef = collection(db, collectionName);
  const snapshots = await Promise.all(
    uniqueOrgIds.map((orgId) =>
      getDocs(query(collectionRef, where('orgId', '==', orgId), ...constraints))
    )
  );

  const merged = new Map<string, OrgScopedRecord>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      merged.set(docSnap.id, { id: docSnap.id, ...data });
    });
  });

  return Array.from(merged.values());
}

export type { OrgScopedRecord };

export type CRMStatus =
  | 'outreach'
  | 'previous_prospect'
  | 'lead'
  | 'quote_request'
  | 'discovery_call'
  | 'drafting_proposal'
  | 'proposal_sent'
  | 'follow_up_call'
  | 'awaiting_decision'
  | 'client';

export const CRM_STATUS_LABELS: Record<CRMStatus, string> = {
  outreach: 'Outreach',
  previous_prospect: 'Previous prospect',
  lead: 'Lead',
  quote_request: 'Quote request',
  discovery_call: 'Discovery call booked',
  drafting_proposal: 'Drafting proposal',
  proposal_sent: 'Proposal sent',
  follow_up_call: 'Follow-up call',
  awaiting_decision: 'Awaiting decision',
  client: 'Client',
};

export const CRM_PIPELINE_STATUSES: CRMStatus[] = [
  'lead',
  'quote_request',
  'discovery_call',
  'drafting_proposal',
  'proposal_sent',
  'follow_up_call',
  'awaiting_decision',
];

export const CRM_OUTREACH_STATUSES: CRMStatus[] = ['outreach', 'previous_prospect'];

export const CRM_CLIENT_STATUSES: CRMStatus[] = ['client'];

export const CRM_ALL_STATUSES: CRMStatus[] = [
  ...CRM_OUTREACH_STATUSES,
  ...CRM_PIPELINE_STATUSES,
  ...CRM_CLIENT_STATUSES,
];

export const CRM_STAGE_OPTIONS = CRM_ALL_STATUSES.map((status) => ({
  value: status,
  label: CRM_STATUS_LABELS[status],
}));

export function normaliseCrmStatus(value: unknown): CRMStatus {
  if (typeof value !== 'string') {
    return 'client';
  }
  const trimmed = value.trim() as CRMStatus | string;
  if ((CRM_STATUS_LABELS as Record<string, string>)[trimmed]) {
    return trimmed as CRMStatus;
  }
  if (trimmed === 'prospect' || trimmed === 'sales') {
    return 'lead';
  }
  return 'client';
}

export function getNextPipelineStatus(status: CRMStatus): CRMStatus | null {
  if (status === 'awaiting_decision') {
    return 'client';
  }
  if (status === 'client') {
    return null;
  }
  const index = CRM_PIPELINE_STATUSES.indexOf(status);
  if (index === -1) {
    if (status === 'outreach' || status === 'previous_prospect') {
      return CRM_PIPELINE_STATUSES[0];
    }
    return null;
  }
  if (index < CRM_PIPELINE_STATUSES.length - 1) {
    return CRM_PIPELINE_STATUSES[index + 1];
  }
  return 'awaiting_decision';
}

export function getPreviousPipelineStatus(status: CRMStatus): CRMStatus | null {
  if (status === 'client') {
    return 'awaiting_decision';
  }
  const index = CRM_PIPELINE_STATUSES.indexOf(status);
  if (index === -1) {
    return status === 'lead' ? 'outreach' : null;
  }
  if (index > 0) {
    return CRM_PIPELINE_STATUSES[index - 1];
  }
  return 'outreach';
}
