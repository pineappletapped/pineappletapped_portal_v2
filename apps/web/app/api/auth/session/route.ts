import { NextResponse, type NextRequest } from 'next/server';

import type { Auth, DecodedIdToken } from 'firebase-admin/auth';

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

function extractProjectIdFromIdToken(idToken: string): string | null {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as {
      aud?: unknown;
      iss?: unknown;
      firebase?: { project_id?: unknown };
    };

    const firebaseProject = payload?.firebase?.project_id;
    if (typeof firebaseProject === 'string' && firebaseProject.trim()) {
      return firebaseProject.trim();
    }

    if (typeof payload.aud === 'string' && payload.aud.trim()) {
      return payload.aud.trim();
    }

    if (typeof payload.iss === 'string') {
      const match = payload.iss.match(/securetoken\.google\.com\/([^/]+)/i);
      if (match?.[1]) {
        return match[1];
      }
    }
  } catch (error) {
    console.warn('Failed to decode Firebase ID token payload for project extraction', error);
  }

  return null;
}

function shouldRetryWithProjectOverride(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('incorrect "aud"') ||
    message.includes('project mismatch') ||
    message.includes('make sure the id token comes from the same firebase project') ||
    message.includes('ensure the id token comes from the same firebase project')
  );
}

type VerifiedSessionContext = {
  decoded: DecodedIdToken;
  auth: Auth;
  projectOverride: string | null;
};

async function attemptVerification(
  idToken: string,
  projectOverride: string | null
): Promise<VerifiedSessionContext> {
  const auth = getFirebaseAdminAuth(projectOverride);
  const decoded = await auth.verifyIdToken(idToken, true);
  return { decoded, auth, projectOverride };
}

async function verifyIdTokenWithFallback(idToken: string): Promise<VerifiedSessionContext> {
  const attempted = new Set<string>();
  const errors: unknown[] = [];
  const fallbackProjectId = extractProjectIdFromIdToken(idToken);
  const candidateProjects: (string | null)[] = [];

  if (fallbackProjectId) {
    candidateProjects.push(fallbackProjectId);
  }
  candidateProjects.push(null);

  for (const project of candidateProjects) {
    const cacheKey = project ?? '__default__';
    if (attempted.has(cacheKey)) {
      continue;
    }
    attempted.add(cacheKey);

    try {
      if (project) {
        console.warn(
          'Attempting Firebase session verification with token project override',
          project
        );
      }
      return await attemptVerification(idToken, project);
    } catch (error) {
      errors.push(error);

      if (!project) {
        throw error;
      }

      const shouldRetry = shouldRetryWithProjectOverride(error);
      if (!shouldRetry) {
        console.error(
          'Firebase session verification failed for override project',
          project,
          error
        );
        continue;
      }

      console.warn(
        'Retrying Firebase session verification with default project after override failure',
        project,
        error
      );
    }
  }

  const finalError = errors[errors.length - 1];
  if (finalError instanceof Error) {
    throw finalError;
  }
  throw new Error('Unable to verify Firebase ID token.');
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
    const { decoded, auth, projectOverride } = await verifyIdTokenWithFallback(idToken);

    const firestore = getFirebaseAdminFirestore(projectOverride);
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
    if (
      error instanceof Error &&
      (/not configured/i.test(error.message) ||
        /credential implementation provided/i.test(error.message))
    ) {
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
