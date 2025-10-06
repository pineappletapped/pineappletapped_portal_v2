import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { extractUserRoles, hasRole, type RoleKey, type UserRoles } from '@/lib/roles';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

const STAFF_ROLES: RoleKey[] = ['admin', 'sales'];

interface StaffContext {
  uid: string;
  email: string | null;
  roles: UserRoles;
}

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serialiseValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serialiseValue(entry));
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date.toISOString();
    } catch (error) {
      console.warn('Failed to serialise Firestore timestamp value', error);
      return value;
    }
  }

  const proto = Object.getPrototypeOf(value);
  if (!proto || proto === Object.prototype) {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      result[key] = serialiseValue(entry);
    });
    return result;
  }

  return value;
}

function serialiseUserDoc(doc: QueryDocumentSnapshot): Record<string, unknown> {
  const data = doc.data() ?? {};
  const result: Record<string, unknown> = { id: doc.id };

  Object.entries(data).forEach(([key, value]) => {
    result[key] = serialiseValue(value);
  });

  return result;
}

async function resolveStaffContext(): Promise<StaffContext | null> {
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
    const snapshot = await firestore.collection('users').doc(decoded.uid).get();
    const data = snapshot.exists ? snapshot.data() ?? {} : {};
    const emailFromStore = typeof data?.email === 'string' ? (data.email as string) : null;
    const email = typeof decoded.email === 'string' ? decoded.email : emailFromStore;
    const enrichedDoc = {
      ...data,
      id: snapshot.id || decoded.uid,
      uid: decoded.uid,
      email,
    };
    const roles = extractUserRoles(enrichedDoc);

    if (!hasRole(roles, STAFF_ROLES)) {
      return null;
    }

    return { uid: decoded.uid, email, roles };
  } catch (error) {
    console.warn('Failed to verify staff session for admin users API', error);
    return null;
  }
}

export async function GET() {
  const context = await resolveStaffContext();
  if (!context) {
    return unauthorized();
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const snapshot = await firestore.collection('users').get();
    const userDocs = snapshot.docs;
    const users = userDocs.map((doc) => serialiseUserDoc(doc));

    const membershipByUser = new Map<string, Array<{ orgId: string; role: string | null }>>();
    const orgIds = new Set<string>();
    const userIds = userDocs.map((doc) => doc.id);

    const chunkSize = 10;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      if (chunk.length === 0) {
        continue;
      }
      const membershipSnap = await firestore
        .collection('memberships')
        .where('userId', 'in', chunk)
        .get();

      membershipSnap.docs.forEach((membershipDoc) => {
        const data = membershipDoc.data() ?? {};
        const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
        const orgId = typeof data.orgId === 'string' ? data.orgId.trim() : '';
        const role = typeof data.role === 'string' ? data.role : null;
        if (!userId || !orgId) {
          return;
        }
        if (!membershipByUser.has(userId)) {
          membershipByUser.set(userId, []);
        }
        membershipByUser.get(userId)!.push({ orgId, role });
        orgIds.add(orgId);
      });
    }

    const orgNameById = new Map<string, string>();
    if (orgIds.size > 0) {
      const orgRefs = Array.from(orgIds).map((orgId) => firestore.collection('orgs').doc(orgId));
      const orgSnaps = await firestore.getAll(...orgRefs);
      orgSnaps.forEach((orgSnap) => {
        if (!orgSnap.exists) {
          return;
        }
        const data = orgSnap.data() ?? {};
        const name = typeof data.name === 'string' ? data.name : 'Untitled organisation';
        orgNameById.set(orgSnap.id, name);
      });
    }

    const enrichedUsers = users.map((user) => {
      const base = user as Record<string, any>;
      const userId = typeof base.id === 'string' ? base.id : null;
      if (!userId) {
        return base;
      }
      const entries = membershipByUser.get(userId) || [];
      const memberships = entries.map((entry) => ({
        orgId: entry.orgId,
        role: entry.role,
        orgName: orgNameById.get(entry.orgId) ?? null,
      }));

      if (!base.organisation && memberships.length > 0) {
        base.organisation = memberships[0].orgName;
      }

      return { ...base, memberships };
    });

    return NextResponse.json({ users: enrichedUsers });
  } catch (error) {
    console.error('Failed to list admin users', error);
    return NextResponse.json({ error: 'Failed to load users.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const context = await resolveStaffContext();
  if (!context) {
    return unauthorized();
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch (error) {
    return badRequest('Invalid request payload.');
  }

  if (!payload || typeof payload !== 'object') {
    return badRequest('Invalid request payload.');
  }

  const { userId, updates } = payload as {
    userId?: unknown;
    updates?: unknown;
  };

  if (typeof userId !== 'string' || !userId.trim()) {
    return badRequest('userId is required.');
  }

  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return badRequest('updates must be an object.');
  }

  if ('roles' in updates && !hasRole(context.roles, 'admin')) {
    return forbidden('Only administrators can modify roles.');
  }

  if ('isStaff' in updates && !hasRole(context.roles, 'admin')) {
    return forbidden('Only administrators can modify staff status.');
  }

  const { password, disabled, ...rest } = updates as Record<string, unknown>;

  const sanitisedUpdates: Record<string, unknown> = {};
  Object.entries(rest).forEach(([key, value]) => {
    if (value !== undefined) {
      sanitisedUpdates[key] = value;
    }
  });

  try {
    const firestore = getFirebaseAdminFirestore();
    const auth = getFirebaseAdminAuth();
    const userRef = firestore.collection('users').doc(userId.trim());

    if (Object.keys(sanitisedUpdates).length > 0) {
      await userRef.set(sanitisedUpdates, { merge: true });
    }

    const authUpdates: Record<string, unknown> = {};
    if (typeof password === 'string' && password) {
      authUpdates.password = password;
    }

    if (typeof disabled === 'boolean') {
      authUpdates.disabled = disabled;
    }

    if (Object.keys(authUpdates).length > 0) {
      await auth.updateUser(userId.trim(), authUpdates);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to update admin user', error);
    return NextResponse.json({ error: 'Failed to update user.' }, { status: 500 });
  }
}
