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

const DEFAULT_UNAUTHORIZED_MESSAGE =
  'We could not validate your sign-in credentials. Please try signing in again.';
const DEFAULT_SERVER_ERROR_MESSAGE =
  'Unable to establish a secure session. Please try again later.';

function createUnauthorizedResponse(message = DEFAULT_UNAUTHORIZED_MESSAGE) {
  return NextResponse.json({ error: message }, { status: 401 });
}

type SessionErrorResolution = { status: number; message: string };

const UNAUTHORIZED_ERROR_CODES = new Set([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-claims',
  'auth/invalid-id-token',
  'auth/invalid-session-cookie',
  'auth/session-cookie-expired',
  'auth/session-cookie-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
]);

function resolveSessionFailure(error: unknown): SessionErrorResolution {
  if (!error || typeof error !== 'object') {
    return { status: 500, message: DEFAULT_SERVER_ERROR_MESSAGE };
  }

  const codeRaw = (error as { code?: unknown }).code;
  const code = typeof codeRaw === 'string' ? codeRaw.trim().toLowerCase() : '';
  const messageRaw = (error as { message?: unknown }).message;
  const message = typeof messageRaw === 'string' ? messageRaw.trim() : '';

  if (code) {
    if (UNAUTHORIZED_ERROR_CODES.has(code)) {
      return { status: 401, message: DEFAULT_UNAUTHORIZED_MESSAGE };
    }

    if (code.startsWith('auth/')) {
      return { status: 500, message: DEFAULT_SERVER_ERROR_MESSAGE };
    }
  }

  if (message) {
    const normalizedMessage = message.toLowerCase();
    if (/\b(token|session)\b/.test(normalizedMessage) && normalizedMessage.includes('revoked')) {
      return { status: 401, message: DEFAULT_UNAUTHORIZED_MESSAGE };
    }

    if (/not configured/i.test(message) || /credential implementation provided/i.test(message)) {
      return { status: 500, message };
    }
  }

  return { status: 500, message: DEFAULT_SERVER_ERROR_MESSAGE };
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

function shouldRetryWithoutRevocationCheck(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return true;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    const normalisedCode = code.toLowerCase();
    if (normalisedCode === 'auth/id-token-revoked') {
      return false;
    }
    if (normalisedCode.startsWith('auth/')) {
      return true;
    }
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string') {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('revoked')) {
      return false;
    }
  }

  return true;
}

async function attemptVerification(
  idToken: string,
  projectOverride: string | null
): Promise<VerifiedSessionContext> {
  const auth = getFirebaseAdminAuth(projectOverride);
  try {
    const decoded = await auth.verifyIdToken(idToken, true);
    return { decoded, auth, projectOverride };
  } catch (error) {
    if (shouldRetryWithoutRevocationCheck(error)) {
      console.warn('Retrying Firebase session verification without revocation check after error', error);
      const decoded = await auth.verifyIdToken(idToken, false);
      return { decoded, auth, projectOverride };
    }
    throw error;
  }
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

    const decodedEmail = decoded.email ?? null;
    type EnrichedUserDoc = Record<string, unknown> & {
      id: string;
      uid: string;
      email: string | null;
    };

    let enrichedUserDoc: EnrichedUserDoc = {
      id: decoded.uid,
      uid: decoded.uid,
      email: decodedEmail,
    };

    try {
      const firestore = getFirebaseAdminFirestore(projectOverride);
      const userRef = firestore.collection('users').doc(decoded.uid);
      const snapshot = await userRef.get();
      let userData = snapshot.exists ? snapshot.data() ?? {} : {};

      if (!snapshot.exists) {
        await userRef.set({ email: decodedEmail }, { merge: true });
        userData = { email: decodedEmail };
      } else if (decodedEmail && userData?.email !== decodedEmail) {
        await userRef.set({ email: decodedEmail }, { merge: true });
        userData = { ...userData, email: decodedEmail };
      }

      enrichedUserDoc = {
        ...userData,
        id: snapshot.id || decoded.uid,
        uid: decoded.uid,
        email: decodedEmail ?? userData?.email ?? null,
      };
    } catch (firestoreError) {
      console.error('Failed to synchronise user profile during session creation', firestoreError);
    }

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
    const { status, message } = resolveSessionFailure(error);
    return NextResponse.json({ error: message }, { status });
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
