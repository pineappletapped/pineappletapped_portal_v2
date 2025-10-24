import { createHash, randomBytes, randomUUID } from 'crypto';

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { resolveAppOrigin } from '@/lib/origin';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getPlatformLabel,
  type RequestedScopes,
  type SocialPlatform,
  type TokenExchangeResult,
} from '@/lib/social-platforms';
import { createSecretConfig, readSecretValue } from '@/lib/secret-manager';
import {
  getCachedSocialServiceKey,
  setCachedSocialServiceKey,
} from '@/lib/social-service-key-cache';

const FUNCTIONS_BASE_URL =
  process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL ||
  'https://europe-west2-pineapple-tapped---portal.cloudfunctions.net';

const SERVICE_KEY_CONFIG = createSecretConfig(
  process.env.SOCIAL_ACCOUNT_SERVICE_KEY_SECRET_NAME,
  process.env.SOCIAL_ACCOUNT_SERVICE_KEY,
  'Social account service key'
);

const STATE_SECRET_BYTE_LENGTH = 32;

const SUPPORTED_PLATFORMS: SocialPlatform[] = [
  'youtube',
  'linkedin',
  'instagram',
  'facebook',
  'tiktok',
  'twitter',
  'vimeo',
];

function getRequestOrigin(request: NextRequest): string {
  return (
    resolveAppOrigin({
      request: {
        headers: request.headers,
        nextUrl: { origin: request.nextUrl.origin },
        url: request.url,
      },
    }) ?? request.nextUrl.origin
  );
}

interface AuthStateDoc {
  platform: SocialPlatform;
  organisationId: string | null;
  organisationName: string | null;
  displayName: string | null;
  redirectUri: string;
  scopes?: RequestedScopes;
  hqManaged?: boolean | null;
  createdAt?: Timestamp | Date | FieldValue | null;
  createdBy?: string | null;
  accountId?: string | null;
  status?: 'pending' | 'completed' | 'error';
  errorCode?: string | null;
  errorMessage?: string | null;
  expiresAt?: Timestamp | Date | null;
  completedAt?: Timestamp | Date | FieldValue | null;
  stateSecretHash?: string | null;
}

interface StoreCredentialPayload {
  stateId: string;
  accountId: string | null;
  platform: SocialPlatform;
  organisationId: string | null;
  organisationName: string | null;
  displayName: string | null;
  scopes: RequestedScopes;
  hqManaged: boolean;
  stateSecret: string | null;
  tokens: {
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number | null;
    scope: string | null;
    tokenType: string | null;
    raw: Record<string, unknown>;
  };
  provider: {
    accountId: string | null;
    accountName: string | null;
  } | null;
  initiator: {
    uid: string;
    email: string | null;
  };
  requestedBy: string | null;
}

interface StoreCredentialResponse {
  accountId: string;
  status: string;
  expiresAt: string | null;
  displayName: string | null;
  refreshAvailable: boolean;
  requiresReauth: boolean;
  platform: SocialPlatform;
}

interface AuthenticatedUser {
  uid: string;
  email: string | null;
}

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseScopesParam(value: string | null): RequestedScopes {
  if (!value) {
    return { publish: true, analytics: true };
  }
  const entries = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  return {
    publish: entries.includes('publish'),
    analytics: entries.includes('analytics'),
  };
}

function parseBooleanFlag(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === 'true' || normalised === '1' || normalised === 'yes';
}

function generateStateSecret(): string {
  return randomBytes(STATE_SECRET_BYTE_LENGTH).toString('hex');
}

function hashStateSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function encodeStateValue(id: string, secret: string): string {
  try {
    return Buffer.from(JSON.stringify({ id, secret }), 'utf8').toString('base64url');
  } catch (error) {
    console.warn('Failed to encode OAuth state payload, falling back to raw ID', error);
    return id;
  }
}

function parseStateValue(value: string): { id: string; secret: string | null } {
  if (!value) {
    return { id: '', secret: null };
  }

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as { id?: unknown; secret?: unknown };
    const id = typeof parsed.id === 'string' ? parsed.id : '';
    const secret = typeof parsed.secret === 'string' ? parsed.secret : null;
    if (id) {
      return { id, secret };
    }
  } catch (error) {
    // Not an encoded payload, fall through to treating the value as the ID.
  }

  return { id: value, secret: null };
}

function sanitiseRedirect(origin: string, candidate: string | null): string {
  const defaultUrl = new URL('/admin/tools/social-scheduler', origin);
  defaultUrl.searchParams.set('tab', 'accounts');

  if (!candidate) {
    return defaultUrl.toString();
  }

  try {
    const resolved = new URL(candidate, origin);
    if (resolved.origin !== origin) {
      return defaultUrl.toString();
    }
    if (!resolved.searchParams.has('tab')) {
      resolved.searchParams.set('tab', 'accounts');
    }
    return resolved.toString();
  } catch (error) {
    console.warn('Invalid redirect URI provided for social account OAuth flow', candidate, error);
    return defaultUrl.toString();
  }
}

async function resolveAuthenticatedUser(): Promise<AuthenticatedUser | null> {
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
    return { uid: decoded.uid, email: decoded.email ?? null } satisfies AuthenticatedUser;
  } catch (error) {
    console.warn('Failed to verify session cookie for social account OAuth flow', error);
    return null;
  }
}

async function getServiceKey(requireKey = true): Promise<string | null> {
  const cachedValue = getCachedSocialServiceKey();
  if (cachedValue !== undefined) {
    if (!cachedValue) {
      if (requireKey) {
        throw new Error('Social account service key is not configured.');
      }
      return null;
    }
    return cachedValue;
  }

  const value = await readSecretValue(SERVICE_KEY_CONFIG);
  setCachedSocialServiceKey(value ?? null);
  if (!value) {
    if (requireKey) {
      throw new Error('Social account service key is not configured.');
    }
    return null;
  }
  return value;
}

function buildErrorRedirect(origin: string, redirectUri: string, message: string, code?: string | null) {
  const target = new URL(redirectUri || sanitiseRedirect(origin, null));
  target.searchParams.set('socialConnection', 'error');
  target.searchParams.set('message', message);
  if (code) {
    target.searchParams.set('errorCode', code);
  }
  return NextResponse.redirect(target);
}

async function callStoreCredentials(payload: StoreCredentialPayload): Promise<StoreCredentialResponse> {
  const serviceKey = await getServiceKey(false);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (serviceKey) {
    headers['X-Service-Key'] = serviceKey;
  } else {
    console.warn('Proceeding with social credential storage without a service key.');
  }

  const response = await fetch(`${FUNCTIONS_BASE_URL}/socialAccountsStoreCredentials`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(text || `Cloud Function responded with ${response.status}`);
  }

  const result = (await response.json().catch(() => null)) as StoreCredentialResponse | null;
  if (!result || typeof result.accountId !== 'string') {
    throw new Error('Cloud Function returned an unexpected payload.');
  }
  return result;
}

function ensureSupportedPlatform(platform: string): SocialPlatform {
  if ((SUPPORTED_PLATFORMS as string[]).includes(platform)) {
    return platform as SocialPlatform;
  }
  throw new Error(`Unsupported social platform: ${platform}`);
}

function getCallbackUri(request: NextRequest, platform: SocialPlatform): string {
  const origin = getRequestOrigin(request);
  return `${origin}/api/social-accounts/${platform}`;
}

function resolveStateExpiry(): Timestamp {
  return Timestamp.fromDate(new Date(Date.now() + 15 * 60 * 1000));
}

async function handleInitiation(request: NextRequest, platform: SocialPlatform) {
  const user = await resolveAuthenticatedUser();
  const origin = getRequestOrigin(request);
  if (!user) {
    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const params = request.nextUrl.searchParams;
  const organisationId = parseString(params.get('organisationId'));
  const organisationName = parseString(params.get('organisationName'));
  const displayName = parseString(params.get('displayName'));
  const redirectCandidate = parseString(params.get('redirect'));
  const accountId = parseString(params.get('accountId'));
  const scopes = parseScopesParam(params.get('scopes'));
  const hqManaged = parseBooleanFlag(params.get('hqManaged'));

  if (!organisationId && !organisationName) {
    return NextResponse.json(
      { error: 'An organisation must be selected before connecting a social account.' },
      { status: 400 }
    );
  }

  const firestore = getFirebaseAdminFirestore();
  const stateId = randomUUID();
  const stateSecret = generateStateSecret();
  const stateSecretHash = hashStateSecret(stateSecret);
  const callbackUri = getCallbackUri(request, platform);
  const redirectUri = sanitiseRedirect(origin, redirectCandidate);

  const stateRef = firestore.collection('socialAccountAuthStates').doc(stateId);
  await stateRef.set(
    {
      platform,
      organisationId: organisationId ?? null,
      organisationName: organisationName ?? null,
      displayName: displayName ?? organisationName ?? null,
      redirectUri,
      scopes,
      hqManaged,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: user.uid,
      accountId: accountId ?? null,
      status: 'pending',
      expiresAt: resolveStateExpiry(),
      stateSecretHash,
    } satisfies AuthStateDoc,
    { merge: true }
  );

  const authorization = await buildAuthorizationUrl(
    platform,
    callbackUri,
    encodeStateValue(stateId, stateSecret),
    scopes
  );
  return NextResponse.redirect(authorization.url);
}

function extractTimestamp(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Timestamp) {
    try {
      return value.toDate();
    } catch (error) {
      return null;
    }
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch (error) {
      return null;
    }
  }
  return null;
}

async function handleCallback(request: NextRequest, platform: SocialPlatform) {
  const origin = getRequestOrigin(request);
  const params = request.nextUrl.searchParams;
  const stateParam = parseString(params.get('state'));
  const code = parseString(params.get('code'));
  const providerError = parseString(params.get('error'));

  if (!stateParam) {
    return NextResponse.json({ error: 'Missing OAuth state parameter.' }, { status: 400 });
  }

  const { id: stateId, secret: stateSecret } = parseStateValue(stateParam);
  if (!stateId) {
    return NextResponse.json({ error: 'Invalid OAuth session.' }, { status: 400 });
  }

  const firestore = getFirebaseAdminFirestore();
  const stateRef = firestore.collection('socialAccountAuthStates').doc(stateId);
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) {
    return NextResponse.json({ error: 'Invalid or expired OAuth session.' }, { status: 400 });
  }

  const stateData = (stateSnap.data() ?? {}) as AuthStateDoc;
  const redirectUri = sanitiseRedirect(origin, stateData.redirectUri ?? null);

  const expectedSecretHash = stateData.stateSecretHash?.trim() ?? null;
  if (expectedSecretHash) {
    if (!stateSecret) {
      await stateRef.set(
        {
          status: 'error',
          errorCode: 'state_verification_failed',
          errorMessage: 'OAuth verification secret missing from provider response.',
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return buildErrorRedirect(
        origin,
        redirectUri,
        `We were unable to verify the ${getPlatformLabel(platform)} response. Please try again.`,
        'state_verification_failed'
      );
    }
    const providedHash = hashStateSecret(stateSecret);
    if (providedHash !== expectedSecretHash) {
      await stateRef.set(
        {
          status: 'error',
          errorCode: 'state_verification_failed',
          errorMessage: 'OAuth verification secret did not match.',
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return buildErrorRedirect(
        origin,
        redirectUri,
        `We were unable to verify the ${getPlatformLabel(platform)} response. Please try again.`,
        'state_verification_failed'
      );
    }
  }

  if (providerError) {
    await stateRef.set(
      {
        status: 'error',
        errorCode: providerError,
        errorMessage: 'Authorization was cancelled or denied by the provider.',
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return buildErrorRedirect(
      origin,
      redirectUri,
      `The ${getPlatformLabel(platform)} connection was not authorised. Please try again.`,
      providerError
    );
  }

  if (!code) {
    await stateRef.set(
      {
        status: 'error',
        errorMessage: 'No authorization code was returned by the provider.',
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return buildErrorRedirect(
      origin,
      redirectUri,
      `We could not complete the ${getPlatformLabel(platform)} connection. No authorization code was received.`
    );
  }

  const expiresAt = extractTimestamp(stateData.expiresAt);
  if (expiresAt && expiresAt.getTime() < Date.now() - 60 * 1000) {
    await stateRef.set(
      {
        status: 'error',
        errorCode: 'expired',
        errorMessage: 'Authorization window expired before completion.',
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return buildErrorRedirect(
      origin,
      redirectUri,
      `The ${getPlatformLabel(platform)} connection expired. Please start again.`,
      'expired'
    );
  }

  const user = await resolveAuthenticatedUser();
  if (!user) {
    return buildErrorRedirect(origin, redirectUri, 'You must be signed in to complete the connection.', 'unauthenticated');
  }

  let tokenResult: TokenExchangeResult;
  try {
    tokenResult = await exchangeAuthorizationCode(platform, code, getCallbackUri(request, platform));
  } catch (error) {
    console.error('Failed to exchange authorization code for social account', error);
    await stateRef.set(
      {
        status: 'error',
        errorCode: 'token_exchange_failed',
        errorMessage: (error as Error)?.message ?? 'Authorization code exchange failed.',
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return buildErrorRedirect(
      origin,
      redirectUri,
      `We could not verify the ${getPlatformLabel(platform)} permissions. ${(error as Error)?.message ?? ''}`.trim(),
      'token_exchange_failed'
    );
  }

  try {
    const storeResult = await callStoreCredentials({
      stateId,
      accountId: stateData.accountId ?? null,
      platform,
      organisationId: stateData.organisationId ?? null,
      organisationName: stateData.organisationName ?? null,
      displayName: stateData.displayName ?? stateData.organisationName ?? null,
      scopes: stateData.scopes ?? { publish: true, analytics: true },
      hqManaged: stateData.hqManaged === true,
      stateSecret,
      tokens: {
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
        expiresIn: tokenResult.expiresIn,
        scope: tokenResult.scope,
        tokenType: tokenResult.tokenType,
        raw: tokenResult.raw,
      },
      provider: {
        accountId: tokenResult.platformAccountId ?? null,
        accountName: tokenResult.platformAccountName ?? null,
      },
      initiator: { uid: user.uid, email: user.email ?? null },
      requestedBy: stateData.createdBy ?? null,
    });

    await stateRef.set(
      {
        status: 'completed',
        errorCode: null,
        errorMessage: null,
        accountId: storeResult.accountId,
        completedAt: FieldValue.serverTimestamp(),
        stateSecretHash: FieldValue.delete(),
      },
      { merge: true }
    );

    const successUrl = new URL(redirectUri);
    successUrl.searchParams.set('socialConnection', 'success');
    successUrl.searchParams.set('platform', platform);
    successUrl.searchParams.set('accountId', storeResult.accountId);
    if (storeResult.displayName) {
      successUrl.searchParams.set('accountName', storeResult.displayName);
    }
    if (storeResult.expiresAt) {
      successUrl.searchParams.set('expiresAt', storeResult.expiresAt);
    }
    if (storeResult.requiresReauth) {
      successUrl.searchParams.set('reauth', '1');
    }
    const message = `Connected ${
      storeResult.displayName || stateData.displayName || getPlatformLabel(platform)
    } to the scheduler.`;
    successUrl.searchParams.set('message', message);

    return NextResponse.redirect(successUrl);
  } catch (error) {
    console.error('Failed to persist social account credentials', error);
    await stateRef.set(
      {
        status: 'error',
        errorCode: 'storage_failed',
        errorMessage: (error as Error)?.message ?? 'Unable to save credentials.',
        completedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return buildErrorRedirect(
      origin,
      redirectUri,
      `We connected to ${getPlatformLabel(platform)} but could not store the credentials securely. Please try again.`,
      'storage_failed'
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: { platform: string } }) {
  let platform: SocialPlatform;
  try {
    platform = ensureSupportedPlatform(params.platform.toLowerCase());
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  const hasCode = Boolean(request.nextUrl.searchParams.get('code') || request.nextUrl.searchParams.get('error'));
  if (hasCode) {
    return handleCallback(request, platform);
  }
  return handleInitiation(request, platform);
}
