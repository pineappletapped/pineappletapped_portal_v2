"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

import CRMRecordForm from '@/components/CRMRecordForm';
import ComplianceBadge from '@/components/ComplianceBadge';
import CrmPipelineBoard from '@/components/CrmPipelineBoard';
import { useRoleGate } from '@/hooks/useRoleGate';
import { adminListUsers, adminUpdateUser } from '@/lib/admin';
import {
  complianceDateToDisplay,
  deriveComplianceState,
  type ComplianceRecord,
} from '@/lib/compliance';
import {
  CRM_ALL_STATUSES,
  CRM_OUTREACH_STATUSES,
  CRM_PIPELINE_STATUSES,
  CRM_STAGE_OPTIONS,
  CRM_STATUS_LABELS,
  collectCrmFranchiseTokens,
  type CRMStatus,
  normaliseCrmStatus,
} from '@/lib/crm';
import { ensureFirebase } from '@/lib/firebase';
import { coerceDate, formatDateTime } from '@/lib/datetime';

interface ProductSummary {
  id: string;
  name: string;
}

/**
 * Admin Users Management
 *
 * This page allows super administrators to view all user accounts and perform
 * management actions such as toggling staff status and sending password resets.
 */
interface AdminUser {
  id: string;
  email: string;
  fullName?: string;
  crmStatus?: CRMStatus;
  discount?: number;
  suggestedProductId?: string | null;
  organisation?: string | null;
  position?: string | null;
  phone?: string | null;
  notes?: string | null;
  linkedinBio?: string | null;
  origin?: string | null;
  updatedAt?: unknown;
  lastContactedAt?: unknown;
  createdAt?: unknown;
  memberships?: Array<{ orgId: string; orgName?: string | null; role?: string | null }>;
  [key: string]: any;
}

interface AdminComplianceRecord extends ComplianceRecord {
  pathSegments: string[];
}

interface FranchiseSummary {
  id: string;
  name: string;
  code: string | null;
}

interface OrganisationSummary {
  id: string;
  name: string;
}

async function findOrganisationByName(db: Firestore, name: string): Promise<OrganisationSummary | null> {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  const normalised = trimmed.toLowerCase();

  try {
    const lowerSnap = await getDocs(
      query(collection(db, 'orgs'), where('nameLower', '==', normalised), limit(1))
    );
    if (!lowerSnap.empty) {
      const docSnap = lowerSnap.docs[0];
      const data = docSnap.data() as Record<string, any>;
      const resolvedName = typeof data?.name === 'string' && data.name.trim().length > 0 ? data.name : trimmed;
      return { id: docSnap.id, name: resolvedName };
    }
  } catch (error) {
    console.warn('Failed to query organisation by nameLower', { name }, error);
  }

  try {
    const rangeSnap = await getDocs(
      query(collection(db, 'orgs'), where('name', '>=', trimmed), where('name', '<=', `${trimmed}\uf8ff`), limit(5))
    );
    if (!rangeSnap.empty) {
      for (const docSnap of rangeSnap.docs) {
        const data = docSnap.data() as Record<string, any>;
        const candidateName = typeof data?.name === 'string' ? data.name : '';
        if (candidateName.trim().toLowerCase() === normalised) {
          const resolvedName = candidateName.trim().length > 0 ? candidateName : trimmed;
          return { id: docSnap.id, name: resolvedName };
        }
      }
      const firstMatch = rangeSnap.docs[0];
      const firstData = firstMatch.data() as Record<string, any>;
      const fallbackName =
        typeof firstData?.name === 'string' && firstData.name.trim().length > 0 ? firstData.name : trimmed;
      return { id: firstMatch.id, name: fallbackName };
    }
  } catch (error) {
    console.warn('Failed to search organisation by range', { name }, error);
  }

  return null;
}

async function createOrganisationFromCrm(
  db: Firestore,
  name: string,
  context: {
    contactId: string;
    contactEmail: string;
    contactName?: string | null;
    website?: string | null;
    location?: string | null;
    address?: string | null;
    socials?: string | null;
    actorUid?: string | null;
  }
): Promise<OrganisationSummary> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Organisation name is required.');
  }

  const orgRef = doc(collection(db, 'orgs'));
  const payload: Record<string, unknown> = {
    name: trimmed,
    nameLower: trimmed.toLowerCase(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: context.actorUid ?? null,
    source: 'crm',
    primaryContactId: context.contactId,
    primaryContactEmail: context.contactEmail,
    primaryContactLinkedAt: serverTimestamp(),
  };

  if (context.contactName && context.contactName.trim()) {
    payload.primaryContactName = context.contactName.trim();
  }
  if (context.website && context.website.trim()) {
    payload.website = context.website.trim();
  }
  if (context.location && context.location.trim()) {
    payload.location = context.location.trim();
  }
  if (context.address && context.address.trim()) {
    payload.address = context.address.trim();
  }
  if (context.socials && context.socials.trim()) {
    payload.socials = context.socials.trim();
  }

  await setDoc(orgRef, payload);

  return { id: orgRef.id, name: trimmed };
}

async function maybeUpdateOrganisationDetails(
  db: Firestore,
  orgId: string,
  details: { website?: string | null; location?: string | null; address?: string | null; socials?: string | null }
) {
  const orgRef = doc(db, 'orgs', orgId);
  try {
    const orgSnap = await getDoc(orgRef);
    if (!orgSnap.exists()) {
      return;
    }
    const data = (orgSnap.data() as Record<string, any>) || {};
    const updates: Record<string, unknown> = {};

    if (details.website && details.website.trim() && !data.website) {
      updates.website = details.website.trim();
    }
    if (details.location && details.location.trim() && !data.location) {
      updates.location = details.location.trim();
    }
    if (details.address && details.address.trim() && !data.address) {
      updates.address = details.address.trim();
    }
    if (details.socials && details.socials.trim() && !data.socials) {
      updates.socials = details.socials.trim();
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    updates.updatedAt = serverTimestamp();
    await updateDoc(orgRef, updates);
  } catch (error) {
    console.warn('Failed to enrich existing organisation with CRM details', { orgId }, error);
  }
}

async function ensureOrganisationMembership(
  db: Firestore,
  orgId: string,
  userId: string,
  actorUid: string | null
): Promise<string> {
  const membershipRef = doc(db, 'memberships', `${orgId}_${userId}`);
  const snap = await getDoc(membershipRef);
  const membershipExists = snap.exists();
  const defaultRole = 'client_admin';
  const existingData = membershipExists ? ((snap.data() as Record<string, any>) ?? {}) : {};
  const role =
    typeof existingData.role === 'string' && existingData.role.trim().length > 0 ? existingData.role : defaultRole;

  const payload: Record<string, unknown> = {
    orgId,
    userId,
    role,
    updatedAt: serverTimestamp(),
  };

  if (!membershipExists) {
    payload.createdAt = serverTimestamp();
    payload.addedBy = actorUid ?? null;
  } else if (!existingData.addedBy && actorUid) {
    payload.addedBy = actorUid;
  }

  await setDoc(membershipRef, payload, { merge: true });

  return role;
}

interface CrmAuditLogEntry {
  id: string;
  recordId: string;
  recordEmail: string | null;
  action: string;
  field: string | null;
  before: unknown;
  after: unknown;
  actorUid: string | null;
  actorEmail: string | null;
  actorName: string | null;
  createdAt: Date | null;
  franchiseIds: string[];
  note?: string | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    result.push(items.slice(i, i + chunkSize));
  }
  return result;
}

function resolvePrimaryOrganisation(user: AdminUser): string | null {
  if (Array.isArray(user.memberships) && user.memberships.length > 0) {
    const preferred =
      user.memberships.find((entry) => entry?.role === 'client_admin') || user.memberships[0];
    if (preferred) {
      if (preferred.orgName && preferred.orgName.trim()) {
        return preferred.orgName;
      }
      if (preferred.orgId && preferred.orgId.trim()) {
        return preferred.orgId;
      }
    }
  }
  if (typeof user.organisation === 'string' && user.organisation.trim()) {
    return user.organisation;
  }
  return null;
}

export default function AdminUsersPage() {
  const { allowed, loading: guardLoading } = useRoleGate(['admin', 'sales']);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [crmStage, setCrmStage] = useState<'client' | 'prospect' | 'outreach'>('client');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [outreachProductFilter, setOutreachProductFilter] = useState('');
  const [activePanel, setActivePanel] = useState<'crm' | 'compliance'>('crm');
  const [complianceRecords, setComplianceRecords] = useState<AdminComplianceRecord[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(true);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [clientValues, setClientValues] = useState<Map<string, number>>(new Map());
  const [clientValueLoading, setClientValueLoading] = useState(false);
  const [clientValueError, setClientValueError] = useState<string | null>(null);
  const [franchises, setFranchises] = useState<FranchiseSummary[]>([]);
  const [franchiseFilter, setFranchiseFilter] = useState<string>('all');
  const [auditLogs, setAuditLogs] = useState<CrmAuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditExpanded, setAuditExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      try {
        const result: any = await adminListUsers();
        const nextUsers: AdminUser[] = Array.isArray(result?.users)
          ? (result.users as AdminUser[]).map((entry) => ({
              ...entry,
              crmStatus: normaliseCrmStatus(entry?.crmStatus),
            }))
          : [];
        setUsers(nextUsers);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Error loading users');
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          return;
        }
        const snapshot = await getDocs(collection(db, 'products'));
        const list: ProductSummary[] = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, any>;
            const rawName = typeof data?.name === 'string' ? data.name.trim() : '';
            return {
              id: docSnap.id,
              name: rawName.length > 0 ? rawName : 'Untitled product',
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
      } catch (err) {
        console.error('Failed to load products for CRM outreach suggestions', err);
      }
    })();
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      if (guardLoading || !allowed) {
        return;
      }

      const clientIds = Array.from(
        new Set(
          users
            .filter((user) => normaliseCrmStatus(user.crmStatus) === 'client')
            .map((user) => user.id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
      );

      if (clientIds.length === 0) {
        if (!active) return;
        setClientValues(new Map());
        setClientValueError(null);
        setClientValueLoading(false);
        return;
      }

      setClientValueLoading(true);
      setClientValueError(null);

      try {
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable.');
        }

        const results = new Map<string, number>();
        const ordersRef = collection(db, 'orders');

        for (const chunk of chunkArray(clientIds, 10)) {
          const snap = await getDocs(query(ordersRef, where('userId', 'in', chunk)));
          snap.docs.forEach((docSnap) => {
            const data = docSnap.data() as Record<string, any>;
            const userId = typeof data.userId === 'string' ? data.userId : null;
            if (!userId) {
              return;
            }
            const numericCandidates = [
              data.netTotal,
              data.price,
              data.totalAmount,
              data.total,
              data.subtotal,
            ];
            let amount = 0;
            for (const candidate of numericCandidates) {
              if (typeof candidate === 'number' && Number.isFinite(candidate)) {
                amount = candidate;
                break;
              }
              if (typeof candidate === 'string') {
                const parsed = Number(candidate);
                if (!Number.isNaN(parsed)) {
                  amount = parsed;
                  break;
                }
              }
            }
            if (amount > 0) {
              results.set(userId, (results.get(userId) || 0) + amount);
            }
          });
        }

        if (!active) return;
        setClientValues(results);
      } catch (error) {
        console.error('Failed to load client value totals', error);
        if (!active) return;
        setClientValueError('Unable to load client value totals.');
        setClientValues(new Map());
      } finally {
        if (active) {
          setClientValueLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading, users]);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          setComplianceLoading(false);
          return;
        }
        const snapshot = await getDocs(collectionGroup(db, 'compliance'));
        const entries: AdminComplianceRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const uid = docSnap.ref.parent?.parent?.id || (typeof data.uid === 'string' ? data.uid : '');
          return {
            id: docSnap.id,
            uid,
            pathSegments: docSnap.ref.path.split('/'),
            ...data,
          } as AdminComplianceRecord;
        });
        setComplianceRecords(entries);
        setComplianceLoading(false);
      } catch (err) {
        console.error('Failed to load compliance records', err);
        setComplianceError('Failed to load compliance records.');
        setComplianceLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          return;
        }
        const snapshot = await getDocs(collection(db, 'franchises'));
        const list: FranchiseSummary[] = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, any>;
            const rawName = typeof data?.name === 'string' ? data.name.trim() : '';
            const rawCode = typeof data?.code === 'string' ? data.code.trim() : '';
            return {
              id: docSnap.id,
              name: rawName || rawCode || 'Franchise',
              code: rawCode || null,
            } satisfies FranchiseSummary;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setFranchises(list);
      } catch (error) {
        console.error('Failed to load franchises for CRM filter', error);
      }
    })();
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) {
          setAuditLoading(false);
          return;
        }
        const logsQuery = query(
          collection(db, 'crmAuditLogs'),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        unsubscribe = onSnapshot(
          logsQuery,
          (snapshot) => {
            const entries: CrmAuditLogEntry[] = snapshot.docs.map((docSnap) => {
              const data = docSnap.data() as Record<string, any>;
              const createdAt = coerceDate(data.createdAt);
              const franchiseIds = Array.isArray(data.franchiseIds)
                ? (data.franchiseIds as unknown[])
                    .map((value) => (typeof value === 'string' ? value : null))
                    .filter((value): value is string => !!value && value.trim().length > 0)
                : [];
              return {
                id: docSnap.id,
                recordId: typeof data.recordId === 'string' ? data.recordId : docSnap.id,
                recordEmail: typeof data.recordEmail === 'string' ? data.recordEmail : null,
                action: typeof data.action === 'string' ? data.action : 'update',
                field: typeof data.field === 'string' ? data.field : null,
                before: data.before ?? null,
                after: data.after ?? null,
                actorUid: typeof data.actorUid === 'string' ? data.actorUid : null,
                actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail : null,
                actorName: typeof data.actorName === 'string' ? data.actorName : null,
                createdAt,
                franchiseIds,
                note: typeof data.note === 'string' ? data.note : null,
              } satisfies CrmAuditLogEntry;
            });
            setAuditLogs(entries);
            setAuditError(null);
            setAuditLoading(false);
          },
          (error) => {
            console.error('Failed to subscribe to CRM audit log', error);
            setAuditError('Failed to load CRM activity log.');
            setAuditLoading(false);
          }
        );
      } catch (error) {
        console.error('Failed to load CRM audit log', error);
        setAuditError('Failed to load CRM activity log.');
        setAuditLoading(false);
      }
    })();

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const productById = useMemo(() => {
    const map = new Map<string, ProductSummary>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const userById = useMemo(() => {
    const map = new Map<string, AdminUser>();
    users.forEach((user) => map.set(user.id, user));
    return map;
  }, [users]);

  const complianceByUser = useMemo(() => {
    const map = new Map<
      string,
      { record: AdminComplianceRecord; state: ReturnType<typeof deriveComplianceState> }
    >();
    complianceRecords.forEach((record) => {
      if (!record.uid) {
        return;
      }
      map.set(record.uid, {
        record,
        state: deriveComplianceState(record),
      });
    });
    return map;
  }, [complianceRecords]);

  const franchiseIdIndex = useMemo(() => {
    const map = new Map<string, string>();
    franchises.forEach((franchise) => {
      if (franchise.id) {
        map.set(franchise.id.trim().toLowerCase(), franchise.id);
      }
    });
    return map;
  }, [franchises]);

  const franchiseCodeIndex = useMemo(() => {
    const map = new Map<string, string>();
    franchises.forEach((franchise) => {
      if (franchise.code) {
        map.set(franchise.code.trim().toLowerCase(), franchise.id);
      }
    });
    return map;
  }, [franchises]);

  const franchiseNameIndex = useMemo(() => {
    const map = new Map<string, string>();
    franchises.forEach((franchise) => {
      const trimmed = franchise.name.trim().toLowerCase();
      if (trimmed) {
        map.set(trimmed, franchise.id);
      }
    });
    return map;
  }, [franchises]);

  const franchiseMatchesByUser = useMemo(() => {
    const map = new Map<string, string[]>();
    users.forEach((user) => {
      if (!user?.id) {
        return;
      }
      const tokens = collectCrmFranchiseTokens(user);
      const matches = new Set<string>();
      tokens.forEach((token) => {
        const trimmed = token.trim().toLowerCase();
        if (!trimmed) return;
        const byId = franchiseIdIndex.get(trimmed);
        if (byId) {
          matches.add(byId);
        }
        const byCode = franchiseCodeIndex.get(trimmed);
        if (byCode) {
          matches.add(byCode);
        }
        const byName = franchiseNameIndex.get(trimmed);
        if (byName) {
          matches.add(byName);
        }
      });
      map.set(user.id, Array.from(matches));
    });
    return map;
  }, [users, franchiseCodeIndex, franchiseIdIndex, franchiseNameIndex]);

  const visibleUsers = useMemo(() => {
    if (franchiseFilter === 'all') {
      return users;
    }
    if (franchiseFilter === '__unassigned__') {
      return users.filter((user) => (franchiseMatchesByUser.get(user.id) ?? []).length === 0);
    }
    return users.filter((user) =>
      (franchiseMatchesByUser.get(user.id) ?? []).includes(franchiseFilter)
    );
  }, [users, franchiseFilter, franchiseMatchesByUser]);

  const prospects = useMemo(
    () =>
      visibleUsers.filter((user) =>
        CRM_PIPELINE_STATUSES.includes(normaliseCrmStatus(user.crmStatus))
      ),
    [visibleUsers]
  );

  const clients = useMemo(
    () => visibleUsers.filter((user) => normaliseCrmStatus(user.crmStatus) === 'client'),
    [visibleUsers]
  );

  const outreach = useMemo(
    () =>
      visibleUsers.filter((user) =>
        CRM_OUTREACH_STATUSES.includes(normaliseCrmStatus(user.crmStatus))
      ),
    [visibleUsers]
  );

  const filteredOutreach = useMemo(
    () =>
      outreachProductFilter
        ? outreach.filter((user) => (user.suggestedProductId || '') === outreachProductFilter)
        : outreach,
    [outreach, outreachProductFilter]
  );

  const formatAuditValue = useCallback((value: unknown): string => {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    try {
      return JSON.stringify(value);
    } catch (error) {
      console.warn('Failed to serialise audit value', error);
      return String(value);
    }
  }, []);

  const recordCrmAuditEvent = useCallback(
    async (
      record: AdminUser,
      details: {
        action: 'create' | 'status_change' | 'field_update';
        field?: string | null;
        before?: unknown;
        after?: unknown;
        note?: string | null;
      }
    ) => {
      try {
        const { db, auth: firebaseAuth } = await ensureFirebase();
        if (!db) {
          return;
        }
        const actor = firebaseAuth?.currentUser ?? null;
        const franchiseIds = franchiseMatchesByUser.get(record.id) ?? [];
        await addDoc(collection(db, 'crmAuditLogs'), {
          recordId: record.id,
          recordEmail: record.email ?? null,
          action: details.action,
          field: details.field ?? null,
          before: details.before ?? null,
          after: details.after ?? null,
          note: details.note ?? null,
          actorUid: actor?.uid ?? null,
          actorEmail: actor?.email ?? null,
          actorName: actor?.displayName ?? null,
          franchiseIds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.error('Failed to record CRM audit event', error);
      }
    },
    [franchiseMatchesByUser]
  );

  const changeStatus = async (user: AdminUser, status: CRMStatus) => {
    const previousStatus = normaliseCrmStatus(user.crmStatus);
    try {
      await adminUpdateUser({ userId: user.id, updates: { crmStatus: status } });
      const updatedRecord: AdminUser = { ...user, crmStatus: status };
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updatedRecord : u)));
      void recordCrmAuditEvent(updatedRecord, {
        action: 'status_change',
        field: 'crmStatus',
        before: previousStatus,
        after: status,
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating user');
    }
  };

  const updateDiscount = async (user: AdminUser, discount: number) => {
    const previous = typeof user.discount === 'number' ? user.discount : 0;
    try {
      await adminUpdateUser({ userId: user.id, updates: { discount } });
      const updatedRecord: AdminUser = { ...user, discount };
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updatedRecord : u)));
      void recordCrmAuditEvent(updatedRecord, {
        action: 'field_update',
        field: 'discount',
        before: previous,
        after: discount,
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating discount');
    }
  };

  const updateSuggestedProduct = async (user: AdminUser, productId: string) => {
    const value = productId || null;
    const previous = user.suggestedProductId || null;
    try {
      await adminUpdateUser({ userId: user.id, updates: { suggestedProductId: value } });
      const updatedRecord: AdminUser = { ...user, suggestedProductId: value };
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? updatedRecord : u))
      );
      void recordCrmAuditEvent(updatedRecord, {
        action: 'field_update',
        field: 'suggestedProductId',
        before: previous,
        after: value,
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating suggested product');
    }
  };

  const filteredAuditLogs = useMemo(() => {
    if (franchiseFilter === 'all') {
      return auditLogs;
    }
    if (franchiseFilter === '__unassigned__') {
      return auditLogs.filter((log) => log.franchiseIds.length === 0);
    }
    return auditLogs.filter((log) => log.franchiseIds.includes(franchiseFilter));
  }, [auditLogs, franchiseFilter]);

  const auditEntries = useMemo(() => {
    return filteredAuditLogs.map((log) => {
      const userRecord = userById.get(log.recordId);
      const displayName =
        (userRecord?.fullName && userRecord.fullName.trim()) ||
        (userRecord ? resolvePrimaryOrganisation(userRecord) : null) ||
        userRecord?.email ||
        log.recordEmail ||
        'CRM record';
      let description = `Updated ${displayName}.`;
      if (log.action === 'create') {
        description = `Created CRM record for ${displayName}.`;
      } else if ((log.field || '').toLowerCase() === 'crmstatus') {
        const beforeStatus =
          typeof log.before === 'string' ? normaliseCrmStatus(log.before) : null;
        const afterStatus =
          typeof log.after === 'string' ? normaliseCrmStatus(log.after) : null;
        const beforeLabel = beforeStatus ? CRM_STATUS_LABELS[beforeStatus] : 'Unassigned';
        const afterLabel = afterStatus ? CRM_STATUS_LABELS[afterStatus] : 'Unassigned';
        description = `Moved ${displayName} from ${beforeLabel} to ${afterLabel}.`;
      } else if (log.field) {
        const label = log.field.replace(/[_-]+/g, ' ');
        description = `Updated ${displayName}'s ${label} from ${formatAuditValue(
          log.before
        )} to ${formatAuditValue(log.after)}.`;
      }
      const actor = log.actorName || log.actorEmail || 'System';
      const timestamp = formatDateTime(log.createdAt);
      return {
        ...log,
        actor,
        description,
        timestamp,
        displayName,
      };
    });
  }, [filteredAuditLogs, formatAuditValue, userById]);

  const updateComplianceRecordLocally = (
    record: AdminComplianceRecord,
    updates: Partial<AdminComplianceRecord>
  ) => {
    setComplianceRecords((prev) =>
      prev.map((entry) =>
        entry.uid === record.uid && entry.id === record.id
          ? { ...entry, ...updates }
          : entry
      )
    );
  };

  const handleComplianceStatusChange = async (
    record: AdminComplianceRecord,
    status: 'pending' | 'approved' | 'rejected'
  ) => {
    try {
      const { db, auth: firebaseAuth } = await ensureFirebase();
      if (!db) {
        throw new Error('Firestore is unavailable.');
      }
      const reviewerUid = firebaseAuth?.currentUser?.uid || null;
      await updateDoc(doc(db, ...record.pathSegments), {
        status,
        reviewerUid,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      updateComplianceRecordLocally(record, {
        status,
        reviewerUid,
        reviewedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Failed to update compliance status', err);
      alert(err?.message || 'Failed to update compliance status');
    }
  };

  const handleComplianceNotes = async (record: AdminComplianceRecord) => {
    const currentNotes =
      typeof record.reviewNotes === 'string' ? record.reviewNotes : '';
    const next = prompt('Add HQ review notes', currentNotes);
    if (next === null) return;
    const trimmed = next.trim();

    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error('Firestore is unavailable.');
      }
      await updateDoc(doc(db, ...record.pathSegments), {
        reviewNotes: trimmed || null,
        updatedAt: serverTimestamp(),
      });
      updateComplianceRecordLocally(record, {
        reviewNotes: trimmed || null,
      });
    } catch (err: any) {
      console.error('Failed to update compliance notes', err);
      alert(err?.message || 'Failed to update notes');
    }
  };

  const renderTable = (
    list: AdminUser[],
    {
      allowedStatuses,
      showSuggestedProduct = false,
      showClientValue = false,
      showCompliance = false,
      primaryColumnLabel = 'Email',
      getPrimaryValue,
    }: {
      allowedStatuses: CRMStatus[];
      showSuggestedProduct?: boolean;
      showClientValue?: boolean;
      showCompliance?: boolean;
      primaryColumnLabel?: string;
      getPrimaryValue?: (user: AdminUser) => string | null | undefined;
    }
  ) => {
    if (list.length === 0) {
      return <p>No records.</p>;
    }

    const uniqueStatuses = Array.from(new Set(allowedStatuses));

    return (
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2">{primaryColumnLabel}</th>
            <th className="p-2">Name</th>
            <th className="p-2">Organisations</th>
            <th className="p-2">Stage</th>
            <th className="p-2">Affiliate</th>
            {showClientValue ? <th className="p-2">Client value</th> : null}
            {showCompliance ? <th className="p-2">Drone compliance</th> : null}
            <th className="p-2">Discount%</th>
            {showSuggestedProduct ? <th className="p-2">Suggested product</th> : null}
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.map((user) => {
            const stage = normaliseCrmStatus(user.crmStatus);
            const complianceEntry = showCompliance ? complianceByUser.get(user.id) : null;
            return (
              <tr key={user.id} className="border-t">
                <td className="p-2">
                  {(getPrimaryValue ? getPrimaryValue(user) : user.email) || '—'}
                </td>
                <td className="p-2">
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900">
                      {user.fullName || resolvePrimaryOrganisation(user) || '-'}
                    </span>
                    {user.position ? (
                      <span className="text-xs text-gray-500">{user.position}</span>
                    ) : null}
                  </div>
                </td>
                <td className="p-2">
                  {Array.isArray(user.memberships) && user.memberships.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {user.memberships.map((membership) => (
                        <span
                          key={`${user.id}-${membership.orgId}`}
                          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700"
                        >
                          {membership.orgName || membership.orgId || '—'}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </td>
                <td className="p-2">
                  <select
                    className="border p-1 text-sm"
                    value={stage}
                    onChange={(event) => changeStatus(user, event.target.value as CRMStatus)}
                  >
                    {uniqueStatuses.map((status) => (
                      <option key={status} value={status}>
                        {CRM_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2 text-sm text-gray-600">
                  {(() => {
                    const affiliate =
                      user.affiliate && typeof user.affiliate === 'object'
                        ? (user.affiliate as Record<string, unknown>)
                        : null;
                    if (!affiliate) {
                      return '—';
                    }
                    const label =
                      (typeof affiliate.name === 'string' && affiliate.name.trim()) ||
                      (typeof affiliate.refCode === 'string' && affiliate.refCode.trim()) ||
                      null;
                    return label ?? '—';
                  })()}
                </td>
                {showClientValue ? (
                  <td className="p-2">
                    {clientValueLoading ? (
                      <span className="text-xs text-gray-500">Loading…</span>
                    ) : clientValues.has(user.id) ? (
                      formatCurrency(clientValues.get(user.id) || 0)
                    ) : (
                      '—'
                    )}
                  </td>
                ) : null}
                {showCompliance ? (
                  <td className="p-2">
                    {complianceEntry ? (
                      <div className="flex flex-col gap-1">
                        <ComplianceBadge
                          status={complianceEntry.state.status}
                          title={complianceEntry.state.issues.join('\n')}
                        />
                        <span
                          className={`text-[0.7rem] ${
                            complianceEntry.state.licenceExpired ? 'text-red-600' : 'text-gray-500'
                          }`}
                        >
                          Licence: {complianceDateToDisplay(complianceEntry.record.licenceExpiry)}
                        </span>
                        <span
                          className={`text-[0.7rem] ${
                            complianceEntry.state.insuranceExpired ? 'text-red-600' : 'text-gray-500'
                          }`}
                        >
                          Insurance: {complianceDateToDisplay(complianceEntry.record.insuranceExpiry)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">No record</span>
                    )}
                  </td>
                ) : null}
                <td className="p-2">
                  <input
                    type="number"
                    className="border p-1 w-16"
                    value={user.discount || 0}
                    onChange={(event) => updateDiscount(user, parseFloat(event.target.value) || 0)}
                  />
                </td>
                {showSuggestedProduct ? (
                  <td className="p-2">
                    <select
                      className="border p-1 text-sm"
                      value={user.suggestedProductId || ''}
                      onChange={(event) => updateSuggestedProduct(user, event.target.value)}
                    >
                      <option value="">No suggestion</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
                <td className="p-2 flex gap-2">
                  <Link className="btn-sm" href={`/admin/users/${user.id}`}>
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const outreachSelectStatuses = useMemo<CRMStatus[]>(() => {
    const combined = [
      ...CRM_OUTREACH_STATUSES,
      ...CRM_PIPELINE_STATUSES,
      'client',
    ] as CRMStatus[];
    return Array.from(new Set(combined));
  }, []);

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view this page.</p>;

  const handleAddRecord = async (data: Record<string, unknown>) => {
    setError(null);
    try {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `crm_${Date.now()}_${Math.random().toString(16).slice(2)}`;

      const payload = { ...data, crmStatus: crmStage } as Partial<AdminUser> & Record<string, unknown>;
      if ('suggestedProductId' in payload && !payload.suggestedProductId) {
        payload.suggestedProductId = null;
      }

      const emailValue = typeof payload.email === 'string' ? payload.email.trim() : '';
      if (!emailValue) {
        throw new Error('Email is required');
      }

      payload.email = emailValue;

      const fileEntries: Array<[string, File]> = [];
      Object.entries(payload).forEach(([key, value]) => {
        if (value instanceof File) {
          fileEntries.push([key, value]);
        }
      });

      const sanitised: Partial<AdminUser> & Record<string, unknown> = {};
      Object.entries(payload).forEach(([key, value]) => {
        if (value instanceof File) {
          return;
        }
        if (typeof value === 'string') {
          sanitised[key] = value.trim();
        } else if (value !== undefined) {
          sanitised[key] = value;
        }
      });

      let defaultStage: CRMStatus = 'client';
      if (crmStage === 'prospect') {
        defaultStage = 'lead';
      } else if (crmStage === 'outreach') {
        defaultStage = 'outreach';
      }

      sanitised.crmStatus = defaultStage;
      sanitised.email = emailValue;
      const timestampIso = new Date().toISOString();
      sanitised.createdAt = timestampIso;
      sanitised.updatedAt = timestampIso;

      const { db, storage, auth: firebaseAuth } = await ensureFirebase();
      if (!db) {
        throw new Error('Firestore is unavailable.');
      }

      type OrganisationOutcome = (OrganisationSummary & { mode: 'existing' | 'created' }) | null;
      let organisationOutcome: OrganisationOutcome = null;

      const organisationInput =
        typeof sanitised.organisation === 'string' && sanitised.organisation.trim().length > 0
          ? sanitised.organisation.trim()
          : '';

      if (organisationInput) {
        const existing = await findOrganisationByName(db, organisationInput);
        if (existing) {
          const confirmationMessage = `An organisation named “${existing.name}” already exists. Connect this contact to the existing organisation?`;
          const useExisting = typeof window !== 'undefined' ? window.confirm(confirmationMessage) : true;
          if (useExisting) {
            organisationOutcome = { ...existing, mode: 'existing' };
          }
        }

        if (organisationOutcome?.mode === 'existing') {
          await maybeUpdateOrganisationDetails(db, organisationOutcome.id, {
            website: typeof sanitised.website === 'string' ? sanitised.website : null,
            location: typeof sanitised.location === 'string' ? sanitised.location : null,
            address: typeof sanitised.address === 'string' ? sanitised.address : null,
            socials: typeof sanitised.socials === 'string' ? sanitised.socials : null,
          });
          sanitised.organisation = organisationOutcome.name;
          sanitised.organisationId = organisationOutcome.id;
        } else {
          const created = await createOrganisationFromCrm(db, organisationInput, {
            contactId: id,
            contactEmail: emailValue,
            contactName: typeof sanitised.fullName === 'string' ? sanitised.fullName : null,
            website: typeof sanitised.website === 'string' ? sanitised.website : null,
            location: typeof sanitised.location === 'string' ? sanitised.location : null,
            address: typeof sanitised.address === 'string' ? sanitised.address : null,
            socials: typeof sanitised.socials === 'string' ? sanitised.socials : null,
            actorUid: firebaseAuth?.currentUser?.uid ?? null,
          });
          organisationOutcome = { ...created, mode: 'created' };
          sanitised.organisation = created.name;
          sanitised.organisationId = created.id;
        }
      }

      if (fileEntries.length > 0) {
        if (!storage || (storage as any).__isPlaceholder) {
          throw new Error('Firebase storage is unavailable.');
        }

        const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
        await Promise.all(
          fileEntries.map(async ([key, file]) => {
            const safeName = encodeURIComponent(file.name || key);
            const objectRef = ref(storage, `crm/${id}/${Date.now()}_${safeName}`);
            await uploadBytes(objectRef, file);
            const url = await getDownloadURL(objectRef);
            sanitised[key] = url;
            sanitised[`${key}Name`] = file.name;
          })
        );
      }

      await adminUpdateUser({ userId: id, updates: sanitised });

      let membershipRole: string | null = null;
      if (organisationOutcome) {
        membershipRole = await ensureOrganisationMembership(
          db,
          organisationOutcome.id,
          id,
          firebaseAuth?.currentUser?.uid ?? null
        );
      }

      const newRecord: AdminUser = {
        id,
        email: emailValue,
        ...(sanitised as Partial<AdminUser>),
        crmStatus: defaultStage,
      };

      if (organisationOutcome) {
        const membershipEntry = {
          orgId: organisationOutcome.id,
          orgName: organisationOutcome.name,
          role: membershipRole,
        };
        newRecord.organisation = organisationOutcome.name;
        newRecord.memberships = Array.isArray(newRecord.memberships)
          ? [...newRecord.memberships, membershipEntry]
          : [membershipEntry];
      }

      setUsers((prev) => [...prev, newRecord]);
      void recordCrmAuditEvent(newRecord, {
        action: 'create',
        field: 'crmStatus',
        before: null,
        after: defaultStage,
      });

      if (organisationOutcome) {
        void recordCrmAuditEvent(newRecord, {
          action: 'field_update',
          field: 'organisation',
          before: null,
          after: organisationOutcome.name,
          note:
            organisationOutcome.mode === 'existing'
              ? `Linked to existing organisation (${organisationOutcome.id}) during CRM record creation.`
              : `Created new organisation (${organisationOutcome.id}) during CRM record creation.`,
        });
      }

      setShowForm(false);
    } catch (err: any) {
      console.error(err);
      const message = err?.message || 'Error creating record';
      setError(message);
      alert(message);
    }
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">CRM</h1>
      <div className="flex gap-4 border-b">
        {[
          { id: 'crm', label: 'CRM' },
          { id: 'compliance', label: 'Compliance' },
        ].map((panel) => (
          <button
            key={panel.id}
            className={`pb-2 ${
              activePanel === panel.id ? 'border-b-2 border-orange font-medium' : ''
            }`}
            onClick={() => setActivePanel(panel.id as 'crm' | 'compliance')}
          >
            {panel.label}
          </button>
        ))}
      </div>

      {activePanel === 'crm' ? (
        <>
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
            <div className="flex gap-4">
              {(['client', 'prospect', 'outreach'] as const).map((tab) => (
                <button
                  key={tab}
                  className={`pb-2 ${crmStage === tab ? 'border-b-2 border-orange font-medium' : ''}`}
                  onClick={() => setCrmStage(tab)}
                >
                  {tab === 'client' ? 'Clients' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label className="text-gray-600" htmlFor="crm-franchise-filter">
                Franchise:
              </label>
              <select
                id="crm-franchise-filter"
                className="input input-sm min-w-[12rem]"
                value={franchiseFilter}
                onChange={(event) => setFranchiseFilter(event.target.value)}
              >
                <option value="all">All franchises</option>
                <option value="__unassigned__">Unassigned</option>
                {franchises.map((franchise) => (
                  <option key={franchise.id} value={franchise.id}>
                    {franchise.name}
                    {franchise.code ? ` (${franchise.code})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button className="btn" onClick={() => setShowForm(true)}>Add Record</button>
          </div>
          {crmStage === 'outreach' && (
            <div className="flex items-center gap-2">
              <label className="text-sm" htmlFor="outreach-product-filter">Filter by product:</label>
              <select
                id="outreach-product-filter"
                className="border p-1 text-sm"
                value={outreachProductFilter}
                onChange={(e) => setOutreachProductFilter(e.target.value)}
              >
                <option value="">All products</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {crmStage === 'client' && (
            <div className="grid gap-3">
              {clientValueError ? (
                <p className="text-sm text-red-600">{clientValueError}</p>
              ) : null}
              {renderTable(clients, {
                allowedStatuses: CRM_ALL_STATUSES,
                showClientValue: true,
                primaryColumnLabel: 'Organisation',
                getPrimaryValue: (record) => resolvePrimaryOrganisation(record) || record.email,
              })}
            </div>
          )}
          {crmStage === 'prospect' && (
            <section className="grid gap-4">
              <p className="text-sm text-gray-600">
                Progress prospects through each pipeline milestone. Drag cards between columns to
                advance opportunities or return them to earlier stages.
              </p>
              <CrmPipelineBoard
                records={prospects}
                formatCurrency={formatCurrency}
                onStatusChange={(record, status) => changeStatus(record, status)}
                getSuggestedProductName={(record) =>
                  record.suggestedProductId
                    ? productById.get(record.suggestedProductId || '')?.name || null
                    : null
                }
                getViewHref={(record) => `/admin/users/${record.id}`}
              />
            </section>
          )}
          <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Activity log</h2>
              <div className="flex items-center gap-3">
                {auditExpanded && filteredAuditLogs.length > 0 ? (
                  <span className="text-xs text-gray-500">
                    Showing {Math.min(auditEntries.length, 25)} of {filteredAuditLogs.length} updates
                  </span>
                ) : null}
                <button
                  type="button"
                  className="text-sm font-medium text-orange"
                  onClick={() => setAuditExpanded((prev) => !prev)}
                >
                  {auditExpanded ? 'Hide activity' : 'Show activity'}
                </button>
              </div>
            </div>
            {auditExpanded ? (
              <div className="mt-3 grid gap-2">
                {auditLoading ? (
                  <p className="text-sm text-gray-600">Loading recent updates…</p>
                ) : auditError ? (
                  <p className="text-sm text-red-600">{auditError}</p>
                ) : auditEntries.length === 0 ? (
                  <p className="text-sm text-gray-600">No recent activity for this view.</p>
                ) : (
                  <ul className="grid gap-2">
                    {auditEntries.slice(0, 25).map((log) => (
                      <li
                        key={log.id}
                        className="rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-gray-900">{log.description}</p>
                          <span className="text-xs text-gray-500">{log.timestamp}</span>
                        </div>
                        <p className="text-xs text-gray-500">By {log.actor}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-600">Activity log hidden. Select “Show activity” to view recent updates.</p>
            )}
          </section>
          {crmStage === 'outreach' &&
            renderTable(filteredOutreach, {
              allowedStatuses: outreachSelectStatuses,
              showSuggestedProduct: true,
            })}
          {showForm && (
            <CRMRecordForm
              status={crmStage}
              products={products}
              onSave={handleAddRecord}
              onClose={() => setShowForm(false)}
            />
          )}
        </>
      ) : (
        <section className="grid gap-4">
          {complianceError && <p className="text-red-600">{complianceError}</p>}
          {complianceLoading ? (
            <p>Loading compliance records…</p>
          ) : complianceRecords.length === 0 ? (
            <p>No compliance submissions yet.</p>
          ) : (
            <table className="w-full text-sm border">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2">Team member</th>
                  <th className="p-2">Licence expiry</th>
                  <th className="p-2">Insurance expiry</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {complianceRecords.map((record) => {
                  const user = userById.get(record.uid);
                  const state = deriveComplianceState(record);
                  return (
                    <tr key={`${record.uid}-${record.id}`} className="border-t">
                      <td className="p-2">
                        <div className="flex flex-col text-sm">
                          <span className="font-medium">{user?.fullName || user?.email || record.uid || 'Unknown user'}</span>
                          {user?.email && (
                            <span className="text-xs text-gray-500">{user.email}</span>
                          )}
                        </div>
                      </td>
                      <td className={`p-2 text-sm ${state.licenceExpired ? 'text-red-600' : 'text-gray-600'}`}>
                        {complianceDateToDisplay(record.licenceExpiry)}
                      </td>
                      <td className={`p-2 text-sm ${state.insuranceExpired ? 'text-red-600' : 'text-gray-600'}`}>
                        {complianceDateToDisplay(record.insuranceExpiry)}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col gap-1">
                          <ComplianceBadge
                            status={state.status}
                            title={state.issues.join('\n')}
                          />
                          {record.reviewNotes && (
                            <span className="text-[0.7rem] text-gray-500">Notes: {record.reviewNotes}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 flex flex-wrap gap-2">
                        <button
                          className="btn-sm"
                          onClick={() => handleComplianceStatusChange(record, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => handleComplianceStatusChange(record, 'rejected')}
                        >
                          Reject
                        </button>
                        <button
                          className="btn-sm"
                          onClick={() => handleComplianceStatusChange(record, 'pending')}
                        >
                          Reset
                        </button>
                        <button className="btn-sm" onClick={() => handleComplianceNotes(record)}>
                          Notes
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}