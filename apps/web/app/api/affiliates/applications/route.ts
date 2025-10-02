import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { extractUserRoles, hasRole, type RoleKey, type UserRoles } from '@/lib/roles';

const STAFF_ROLES: RoleKey[] = ['admin', 'marketing', 'sales'];

type ReviewAction = 'approve' | 'reject' | 'request_info';

interface ActionConfig {
  status: string;
  stage: string;
}

const ACTION_CONFIG: Record<ReviewAction, ActionConfig> = {
  approve: { status: 'approved', stage: 'approved' },
  reject: { status: 'rejected', stage: 'rejected' },
  request_info: { status: 'info_requested', stage: 'info_requested' },
};

interface StaffContext {
  uid: string;
  email: string | null;
  name: string | null;
  roles: UserRoles;
}

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAction(value: unknown): ReviewAction | null {
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
}

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
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
    const userDoc = userSnap.exists ? (userSnap.data() ?? {}) : {};
    const roles = extractUserRoles({ ...userDoc, uid: decoded.uid });

    if (!hasRole(roles, requiredRoles)) {
      return null;
    }

    const name =
      parseString(userDoc.fullName) ??
      parseString(userDoc.displayName) ??
      parseString(userDoc.name) ??
      null;
    const email = parseString(userDoc.email) ?? parseString((decoded as any)?.email) ?? null;

    return { uid: decoded.uid, roles, name, email } satisfies StaffContext;
  } catch (error) {
    console.warn('Failed to resolve staff context for affiliate applications', error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch (error) {
    return badRequest('Invalid request payload.');
  }

  const id = parseString(payload?.id);
  const action = parseAction(payload?.action);
  const notes = parseString(payload?.notes);

  if (!id) {
    return badRequest('Application id is required.');
  }
  if (!action) {
    return badRequest('Unsupported review action.');
  }
  if (action === 'request_info' && !notes) {
    return badRequest('Please include reviewer notes when requesting more information.');
  }

  const staff = await resolveStaffContext();
  if (!staff) {
    return unauthorized();
  }

  const firestore = getFirebaseAdminFirestore();
  const applicationRef = firestore.collection('affiliateApplications').doc(id);
  const config = ACTION_CONFIG[action];
  const reviewerName = staff.name ?? staff.email ?? staff.uid;

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(applicationRef);
      if (!snapshot.exists) {
        throw new Error('not-found');
      }
      const data = (snapshot.data() ?? {}) as Record<string, any>;
      const previousStatus = parseString(data.status);
      const previousStage = parseString(data.stage);

      const timestamp = FieldValue.serverTimestamp();
      const historyEntry = {
        action,
        status: config.status,
        stage: config.stage,
        notes: notes ?? null,
        reviewerUid: staff.uid,
        reviewerName,
        reviewerEmail: staff.email ?? null,
        decidedAt: timestamp,
      };

      const updates: Record<string, any> = {
        status: config.status,
        stage: config.stage,
        updatedAt: timestamp,
        review: {
          lastAction: action,
          lastStatus: config.status,
          lastStage: config.stage,
          notes: notes ?? null,
          reviewerUid: staff.uid,
          reviewerName,
          reviewerEmail: staff.email ?? null,
          decidedAt: timestamp,
        },
        reviewHistory: FieldValue.arrayUnion(historyEntry),
        decision: {
          action,
          status: config.status,
          stage: config.stage,
          notes: notes ?? null,
          decidedAt: timestamp,
          decidedByUid: staff.uid,
        },
        decisionAt: timestamp,
        decisionByUid: staff.uid,
      };

      if (!data.firstReviewedAt) {
        updates.firstReviewedAt = timestamp;
      }
      if (!data.firstReviewedByUid) {
        updates.firstReviewedByUid = staff.uid;
      }

      transaction.update(applicationRef, updates);

      return { previousStatus, previousStage };
    });

    const auditPayload: Record<string, any> = {
      actorUid: staff.uid,
      action: 'affiliateApplication.review',
      entityType: 'affiliateApplication',
      entityId: id,
      createdAt: FieldValue.serverTimestamp(),
      changes: {
        status: { before: result.previousStatus ?? null, after: config.status },
        stage: { before: result.previousStage ?? null, after: config.stage },
      },
      metadata: {
        action,
        status: config.status,
        stage: config.stage,
      },
    };

    if (notes) {
      auditPayload.metadata.notes = notes;
    }

    if (staff.email || staff.name) {
      auditPayload.metadata.reviewer = staff.name ?? staff.email;
    }

    await firestore.collection('adminAuditLogs').add(auditPayload);

    return NextResponse.json({ ok: true, status: config.status, stage: config.stage });
  } catch (error: any) {
    if (error?.message === 'not-found') {
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    }
    console.error('Failed to update affiliate application review state', error);
    return NextResponse.json({ error: 'Unable to update application.' }, { status: 500 });
  }
}
