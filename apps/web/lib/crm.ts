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

