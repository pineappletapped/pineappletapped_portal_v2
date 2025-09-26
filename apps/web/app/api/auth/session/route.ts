import { NextResponse, type NextRequest } from 'next/server';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  encodeRolesCookie,
  extractUserRoles,
  getDefaultAdminRoute,
  hasRole,
  ROLE_KEYS,
  type UserRoles,
} from '@/lib/roles';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function createUnauthorizedResponse(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function POST(req: NextRequest) {
  let idToken: unknown;
  try {
    ({ idToken } = await req.json());
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  if (typeof idToken !== 'string' || !idToken) {
    return NextResponse.json({ error: 'idToken is required' }, { status: 400 });
  }

  try {
    const auth = getFirebaseAdminAuth();
    const decoded = await auth.verifyIdToken(idToken, true);

    const firestore = getFirebaseAdminFirestore();
    const userRef = firestore.collection('users').doc(decoded.uid);
    const snapshot = await userRef.get();
    let userData = snapshot.exists ? snapshot.data() ?? {} : {};

    const decodedEmail = decoded.email ?? null;

    if (!snapshot.exists) {
      await userRef.set({ email: decodedEmail }, { merge: true });
      userData = { email: decodedEmail };
    } else if (decodedEmail && userData?.email !== decodedEmail) {
      await userRef.set({ email: decodedEmail }, { merge: true });
      userData = { ...userData, email: decodedEmail };
    }

    const enrichedUserDoc = {
      ...userData,
      id: snapshot.id || decoded.uid,
      uid: decoded.uid,
      email: decodedEmail ?? userData?.email ?? null,
    };

    const roles: UserRoles = extractUserRoles(enrichedUserDoc);
    const hasBackofficeAccess = hasRole(roles, ROLE_KEYS);
    const destination = hasBackofficeAccess ? getDefaultAdminRoute(roles) : '/dashboard';

    const response = NextResponse.json({ destination, hasBackofficeAccess });
    const secure = process.env.NODE_ENV === 'production';

    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });

    response.cookies.set({
      name: 'session',
      value: sessionCookie,
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    response.cookies.set({
      name: 'uid',
      value: decoded.uid,
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    response.cookies.set({
      name: 'roles',
      value: encodeRolesCookie(roles),
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    response.cookies.set({
      name: 'isStaff',
      value: hasBackofficeAccess ? '1' : '0',
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    console.error('Failed to establish Firebase session', error);
    if (error instanceof Error && /not configured/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return createUnauthorizedResponse();
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  ['session', 'uid', 'roles', 'isStaff'].forEach((name) => {
    response.cookies.set({
      name,
      value: '',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
  });
  return response;
}
