import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { extractUserRoles, hasRole, type RoleKey, type UserRoles } from '@/lib/roles';

interface SchedulerFlagDoc {
  globalEnabled?: boolean;
  exportOnlyMode?: boolean;
  analyticsEnabled?: boolean;
  notes?: string | null;
  updatedBy?: string | null;
  updatedAt?: AdminTimestamp | Date | null;
}

interface StaffContext {
  uid: string;
  roles: UserRoles;
}

interface SchedulerScopeDoc {
  enabled?: boolean;
  exportOnlyMode?: boolean;
  analyticsEnabled?: boolean;
  notes?: string | null;
  updatedBy?: string | null;
  updatedAt?: AdminTimestamp | Date | null;
}

interface SchedulerScopeResponse {
  id: string;
  name: string;
  enabled: boolean;
  exportOnlyMode: boolean;
  analyticsEnabled: boolean;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

const STAFF_ROLES: RoleKey[] = ['admin', 'marketing', 'projects'];

type AdminDb = ReturnType<typeof getFirebaseAdminFirestore>;

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function resolveStaffContext(requiredRoles: RoleKey[] = STAFF_ROLES): Promise<StaffContext | null> {
  const cookieStore = cookies();
  const sessionCookie =
    cookieStore.get('session')?.value ??
    cookieStore.get('__session')?.value ??
    cookieStore.get('firebase-session')?.value ??
    null;

  if (!sessionCookie) {
    return null;
  }

  try {
    const auth = getFirebaseAdminAuth();
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    const firestore = getFirebaseAdminFirestore();
    const userSnap = await firestore.collection('users').doc(decoded.uid).get();
    const userDoc = userSnap.exists ? userSnap.data() ?? {} : {};
    const roles = extractUserRoles({ ...userDoc, uid: decoded.uid });

    if (!hasRole(roles, requiredRoles)) {
      return null;
    }

    return { uid: decoded.uid, roles };
  } catch (error) {
    console.warn('Failed to resolve staff context for scheduler flags', error);
    return null;
  }
}

function serialiseTimestamp(value: any): string | null {
  const updatedAtRaw = value as any;
  let updatedAt: string | null = null;
  if (updatedAtRaw?.toDate) {
    try {
      updatedAt = updatedAtRaw.toDate().toISOString();
    } catch (error) {
      updatedAt = null;
    }
  } else if (updatedAtRaw instanceof Date) {
    updatedAt = updatedAtRaw.toISOString();
  } else if (typeof updatedAtRaw === 'string') {
    updatedAt = updatedAtRaw;
  }

  return updatedAt;
}

function serialiseFlagDoc(doc: SchedulerFlagDoc) {
  const updatedAt = serialiseTimestamp(doc.updatedAt);

  return {
    globalEnabled: doc.globalEnabled === true,
    exportOnlyMode: doc.exportOnlyMode === true,
    analyticsEnabled: doc.analyticsEnabled !== false,
    notes: doc.notes ?? null,
    updatedBy: doc.updatedBy ?? null,
    updatedAt,
  };
}

function serialiseScopeDoc(id: string, name: string, doc?: SchedulerScopeDoc | null): SchedulerScopeResponse {
  const updatedAt = serialiseTimestamp(doc?.updatedAt);

  return {
    id,
    name,
    enabled: doc?.enabled === true,
    exportOnlyMode: doc?.exportOnlyMode === true,
    analyticsEnabled: doc?.analyticsEnabled !== false,
    notes: typeof doc?.notes === 'string' && doc.notes.trim() ? doc.notes.trim() : null,
    updatedBy: doc?.updatedBy ?? null,
    updatedAt,
  } satisfies SchedulerScopeResponse;
}

async function loadScopeOverrides(
  firestore: AdminDb,
  collectionName: 'franchises' | 'orgs',
  fallbackLabel: string
): Promise<SchedulerScopeResponse[]> {
  const snapshot = await firestore.collection(collectionName).limit(200).get();
  const entries = await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const rawName = typeof data.name === 'string' ? data.name.trim() : '';
      const name = rawName || `${fallbackLabel} ${docSnap.id}`;
      try {
        const flagSnap = await docSnap.ref.collection('featureFlags').doc('socialScheduler').get();
        const flagData = flagSnap.exists ? ((flagSnap.data() ?? {}) as SchedulerScopeDoc) : {};
        return serialiseScopeDoc(docSnap.id, name, flagData);
      } catch (error) {
        console.warn(`Failed to load scheduler flags for ${collectionName}/${docSnap.id}`, error);
        return serialiseScopeDoc(docSnap.id, name, null);
      }
    })
  );
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  const context = await resolveStaffContext();
  if (!context) {
    return unauthorized();
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const docSnap = await firestore.collection('config').doc('socialScheduler').get();
    const data = docSnap.exists ? ((docSnap.data() ?? {}) as SchedulerFlagDoc) : {};
    const [franchiseOverrides, organisationOverrides] = await Promise.all([
      loadScopeOverrides(firestore, 'franchises', 'Franchise').catch(() => []),
      loadScopeOverrides(firestore, 'orgs', 'Organisation').catch(() => []),
    ]);

    const global = serialiseFlagDoc(data);

    return NextResponse.json({
      ...global,
      global,
      franchiseOverrides,
      organisationOverrides,
    });
  } catch (error) {
    console.error('Failed to load scheduler flags', error);
    return NextResponse.json({ error: 'Unable to load scheduler flags.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch (error) {
    return badRequest('Invalid request payload.');
  }

  if (!payload || typeof payload !== 'object') {
    return badRequest('Invalid request payload.');
  }

  const scopeTypeRaw = typeof payload.scopeType === 'string' ? payload.scopeType.toLowerCase() : 'global';
  const scopeType: 'global' | 'franchise' | 'organisation' =
    scopeTypeRaw === 'franchise' || scopeTypeRaw === 'organisation' ? scopeTypeRaw : 'global';
  const scopeIdRaw = typeof payload.scopeId === 'string' ? payload.scopeId.trim() : '';

  const context = await resolveStaffContext(scopeType === 'global' ? ['admin'] : STAFF_ROLES);
  if (!context) {
    return forbidden();
  }

  const enabledRaw = payload.enabled ?? payload.globalEnabled;
  const exportOnlyRaw = payload.exportOnlyMode;
  const analyticsRaw = payload.analyticsEnabled;
  const notesRaw = payload.notes;

  const parsedNotes = typeof notesRaw === 'string' ? notesRaw.trim() : '';

  try {
    const firestore = getFirebaseAdminFirestore();
    if (scopeType === 'global') {
      const docRef = firestore.collection('config').doc('socialScheduler');
      const currentSnap = await docRef.get();
      const current = currentSnap.exists ? ((currentSnap.data() ?? {}) as SchedulerFlagDoc) : {};

      const nextFlags = {
        globalEnabled: enabledRaw === true,
        exportOnlyMode: exportOnlyRaw === true,
        analyticsEnabled: analyticsRaw !== false,
        notes: parsedNotes || null,
      } satisfies SchedulerFlagDoc;

      const updates = {
        ...nextFlags,
        updatedBy: context.uid,
        updatedAt: FieldValue.serverTimestamp(),
      } satisfies SchedulerFlagDoc;

      await docRef.set(updates, { merge: true });

      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if ((current.globalEnabled ?? false) !== nextFlags.globalEnabled) {
        changes.globalEnabled = { before: current.globalEnabled ?? false, after: nextFlags.globalEnabled ?? false };
      }
      if ((current.exportOnlyMode ?? false) !== nextFlags.exportOnlyMode) {
        changes.exportOnlyMode = { before: current.exportOnlyMode ?? false, after: nextFlags.exportOnlyMode ?? false };
      }
      if ((current.analyticsEnabled ?? true) !== nextFlags.analyticsEnabled) {
        changes.analyticsEnabled = { before: current.analyticsEnabled ?? true, after: nextFlags.analyticsEnabled ?? true };
      }
      if ((current.notes ?? '') !== (nextFlags.notes ?? '')) {
        changes.notes = { before: current.notes ?? '', after: nextFlags.notes ?? '' };
      }

      const auditPayload: Record<string, unknown> = {
        actorUid: context.uid,
        action: 'update_social_scheduler_flags',
        entityType: 'featureFlags',
        entityId: 'socialScheduler',
        scopeType,
        createdAt: FieldValue.serverTimestamp(),
      };
      if (Object.keys(changes).length > 0) {
        auditPayload.changes = changes;
      }
      if (parsedNotes) {
        auditPayload.metadata = { notes: parsedNotes };
      }
      await firestore.collection('adminAuditLogs').add(auditPayload);

      const refreshed = await docRef.get();
      const data = refreshed.exists ? ((refreshed.data() ?? {}) as SchedulerFlagDoc) : {};
      return NextResponse.json({ scopeType, global: serialiseFlagDoc(data) });
    }

    if (!scopeIdRaw) {
      return badRequest('Missing scope identifier.');
    }

    const trimmedScopeId = scopeIdRaw;
    const baseCollection = scopeType === 'franchise' ? 'franchises' : 'orgs';
    const docRef = firestore.collection(baseCollection).doc(trimmedScopeId);
    const entitySnap = await docRef.get();
    if (!entitySnap.exists) {
      return badRequest('Scope not found.');
    }

    const flagsRef = docRef.collection('featureFlags').doc('socialScheduler');
    const currentSnap = await flagsRef.get();
    const current = currentSnap.exists ? ((currentSnap.data() ?? {}) as SchedulerScopeDoc) : {};

    const nextFlags: SchedulerScopeDoc = {
      enabled: enabledRaw === true,
      exportOnlyMode: exportOnlyRaw === true,
      analyticsEnabled: analyticsRaw !== false,
      notes: parsedNotes || null,
    };

    const updates: SchedulerScopeDoc = {
      ...nextFlags,
      updatedBy: context.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await flagsRef.set(updates, { merge: true });

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if ((current.enabled ?? false) !== (nextFlags.enabled ?? false)) {
      changes.enabled = { before: current.enabled ?? false, after: nextFlags.enabled ?? false };
    }
    if ((current.exportOnlyMode ?? false) !== (nextFlags.exportOnlyMode ?? false)) {
      changes.exportOnlyMode = {
        before: current.exportOnlyMode ?? false,
        after: nextFlags.exportOnlyMode ?? false,
      };
    }
    if ((current.analyticsEnabled ?? true) !== (nextFlags.analyticsEnabled ?? true)) {
      changes.analyticsEnabled = {
        before: current.analyticsEnabled ?? true,
        after: nextFlags.analyticsEnabled ?? true,
      };
    }
    if ((current.notes ?? '') !== (nextFlags.notes ?? '')) {
      changes.notes = { before: current.notes ?? '', after: nextFlags.notes ?? '' };
    }

    const auditPayload: Record<string, unknown> = {
      actorUid: context.uid,
      action: 'update_social_scheduler_flags',
      entityType: 'featureFlags',
      entityId: `${scopeType}:${trimmedScopeId}`,
      scopeType,
      scopeId: trimmedScopeId,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (Object.keys(changes).length > 0) {
      auditPayload.changes = changes;
    }
    if (parsedNotes) {
      auditPayload.metadata = { notes: parsedNotes };
    }
    await firestore.collection('adminAuditLogs').add(auditPayload);

    const refreshed = await flagsRef.get();
    const scopeDoc = refreshed.exists ? ((refreshed.data() ?? {}) as SchedulerScopeDoc) : {};
    const entityData = (entitySnap.data() ?? {}) as Record<string, unknown>;
    const rawName = typeof entityData.name === 'string' ? entityData.name.trim() : '';
    const name = rawName || `${scopeType === 'franchise' ? 'Franchise' : 'Organisation'} ${trimmedScopeId}`;

    return NextResponse.json({
      scopeType,
      scope: serialiseScopeDoc(trimmedScopeId, name, scopeDoc),
    });
  } catch (error) {
    console.error('Failed to update scheduler flags', error);
    return NextResponse.json({ error: 'Unable to update scheduler flags.' }, { status: 500 });
  }
}
