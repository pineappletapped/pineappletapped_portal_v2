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

const STAFF_ROLES: RoleKey[] = ['admin', 'marketing', 'projects'];

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

function serialiseFlagDoc(doc: SchedulerFlagDoc) {
  const updatedAtRaw = doc.updatedAt as any;
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

  return {
    globalEnabled: doc.globalEnabled === true,
    exportOnlyMode: doc.exportOnlyMode === true,
    analyticsEnabled: doc.analyticsEnabled !== false,
    notes: doc.notes ?? null,
    updatedBy: doc.updatedBy ?? null,
    updatedAt,
  };
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

    return NextResponse.json(serialiseFlagDoc(data));
  } catch (error) {
    console.error('Failed to load scheduler flags', error);
    return NextResponse.json({ error: 'Unable to load scheduler flags.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const context = await resolveStaffContext(['admin']);
  if (!context) {
    return forbidden();
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (error) {
    return badRequest('Invalid request payload.');
  }

  if (!payload || typeof payload !== 'object') {
    return badRequest('Invalid request payload.');
  }

  const { globalEnabled, exportOnlyMode, analyticsEnabled, notes } = payload as {
    globalEnabled?: unknown;
    exportOnlyMode?: unknown;
    analyticsEnabled?: unknown;
    notes?: unknown;
  };

  const parsedNotes = typeof notes === 'string' ? notes.trim() : '';

  const nextFlags = {
    globalEnabled: globalEnabled === true,
    exportOnlyMode: exportOnlyMode === true,
    analyticsEnabled: analyticsEnabled !== false,
    notes: parsedNotes || null,
  } satisfies SchedulerFlagDoc;

  try {
    const firestore = getFirebaseAdminFirestore();
    const docRef = firestore.collection('config').doc('socialScheduler');
    const currentSnap = await docRef.get();
    const current = currentSnap.exists ? ((currentSnap.data() ?? {}) as SchedulerFlagDoc) : {};

    const updates = {
      ...nextFlags,
      updatedBy: context.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

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
    return NextResponse.json(serialiseFlagDoc(data));
  } catch (error) {
    console.error('Failed to update scheduler flags', error);
    return NextResponse.json({ error: 'Unable to update scheduler flags.' }, { status: 500 });
  }
}
