import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  getPlatformSecretTargets,
  getPlatformLabel,
  listSocialPlatforms,
  resetPlatformCredentialCache,
  type SocialPlatform,
} from '@/lib/social-platforms';
import {
  createSecretConfig,
  readSecretValue,
  writeSecretValue,
} from '@/lib/secret-manager';
import { resetCachedSocialServiceKey } from '@/lib/social-service-key-cache';
import { extractUserRoles, hasRole, type UserRoles } from '@/lib/roles';

type AdminContext = { uid: string; email: string | null; roles: UserRoles };

type SecretStatus = {
  configured: boolean;
  last4: string | null;
  managedExternally: boolean;
};

type PlatformSecretStatus = {
  platform: SocialPlatform;
  label: string;
  clientId: SecretStatus;
  clientSecret: SecretStatus;
};

type LoadedSettings = {
  serviceKey: SecretStatus;
  encryptionKey: SecretStatus;
  platforms: PlatformSecretStatus[];
  updatedAt: string | null;
  updatedBy: { uid: string | null; email: string | null } | null;
};

const SERVICE_KEY_CONFIG = createSecretConfig(
  process.env.SOCIAL_ACCOUNT_SERVICE_KEY_SECRET_NAME,
  process.env.SOCIAL_ACCOUNT_SERVICE_KEY,
  'Social account service key',
);

const ENCRYPTION_KEY_CONFIG = createSecretConfig(
  process.env.SOCIAL_ACCOUNT_ENCRYPTION_KEY_SECRET_NAME,
  process.env.SOCIAL_ACCOUNT_ENCRYPTION_KEY,
  'Social account encryption key',
);

const SUPPORTED_PLATFORMS = listSocialPlatforms();

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === 'function') {
      try {
        const result = candidate.toDate();
        return Number.isNaN(result.getTime()) ? null : result;
      } catch (error) {
        console.warn('Failed to convert Firestore timestamp to Date', error);
        return null;
      }
    }
  }
  return null;
}

function toIsoString(value: unknown): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function parseUserReference(value: unknown): { uid: string | null; email: string | null } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const uid = typeof record.uid === 'string' ? record.uid : null;
  const email = typeof record.email === 'string' ? record.email : null;
  if (!uid && !email) {
    return null;
  }
  return { uid, email };
}

async function resolveAdminContext(): Promise<AdminContext | null> {
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
    const doc = await firestore.collection('users').doc(decoded.uid).get();
    const data = doc.exists ? (doc.data() ?? {}) : {};
    const emailFromDoc = typeof data.email === 'string' ? (data.email as string) : null;
    const email = typeof decoded.email === 'string' ? decoded.email : emailFromDoc;
    const enriched = { ...data, uid: decoded.uid, email };
    const roles = extractUserRoles(enriched);
    if (!hasRole(roles, ['admin'])) {
      return null;
    }
    return { uid: decoded.uid, email, roles };
  } catch (error) {
    console.warn('Failed to verify admin session for OAuth settings', error);
    return null;
  }
}

function summariseSecretValue(value: string | null, managedExternally: boolean): SecretStatus {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return { configured: false, last4: null, managedExternally };
  }
  const last4 = trimmed.length > 4 ? trimmed.slice(-4) : trimmed;
  return { configured: true, last4, managedExternally };
}

async function resolveSecretStatus(target: ReturnType<typeof createSecretConfig>): Promise<SecretStatus> {
  const managedExternally = !target.resource;
  const value = await readSecretValue(target);
  return summariseSecretValue(value, managedExternally);
}

async function loadSettings(): Promise<LoadedSettings> {
  const firestore = getFirebaseAdminFirestore();
  const doc = await firestore.collection('settings').doc('socialOAuth').get();
  const docData = doc.exists ? doc.data() ?? {} : {};

  const [serviceKey, encryptionKey, platformStatuses] = await Promise.all([
    resolveSecretStatus(SERVICE_KEY_CONFIG),
    resolveSecretStatus(ENCRYPTION_KEY_CONFIG),
    Promise.all(
      SUPPORTED_PLATFORMS.map(async (platform) => {
        const targets = getPlatformSecretTargets(platform);
        const [clientId, clientSecret] = await Promise.all([
          resolveSecretStatus(targets.clientId),
          resolveSecretStatus(targets.clientSecret),
        ]);
        return { platform, label: targets.label, clientId, clientSecret } satisfies PlatformSecretStatus;
      }),
    ),
  ]);

  const sortedPlatforms = platformStatuses.sort((a, b) => a.label.localeCompare(b.label));

  return {
    serviceKey,
    encryptionKey,
    platforms: sortedPlatforms,
    updatedAt: toIsoString(docData.updatedAt ?? null),
    updatedBy: parseUserReference(docData.updatedBy),
  };
}

function parseSecretInput(value: unknown, label: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string or null.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateEncryptionKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Encryption key cannot be empty.');
  }

  const base64Candidate = (() => {
    try {
      return Buffer.from(trimmed, 'base64');
    } catch (error) {
      return Buffer.alloc(0);
    }
  })();
  if (base64Candidate.length === 32) {
    return trimmed;
  }

  const hexCandidate = (() => {
    try {
      return Buffer.from(trimmed, 'hex');
    } catch (error) {
      return Buffer.alloc(0);
    }
  })();
  if (hexCandidate.length === 32) {
    return trimmed;
  }

  if (trimmed.length === 32) {
    const utf8Candidate = Buffer.from(trimmed, 'utf8');
    if (utf8Candidate.length === 32) {
      return trimmed;
    }
  }

  throw new Error('Encryption key must decode to 32 bytes (base64, hex, or 32-character string).');
}

function detectSecretManagerError(message: string): boolean {
  return /Secret Manager|infrastructure|permission/i.test(message);
}

export async function GET() {
  const context = await resolveAdminContext();
  if (!context) {
    return unauthorized();
  }

  try {
    const settings = await loadSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to load social OAuth settings', error);
    return NextResponse.json({ error: 'Failed to load OAuth settings.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const context = await resolveAdminContext();
  if (!context) {
    return unauthorized();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    console.error('Invalid OAuth settings payload', error);
    return badRequest('Invalid request payload.');
  }

  let serviceKeyInput: string | null | undefined;
  let encryptionKeyInput: string | null | undefined;

  try {
    serviceKeyInput = parseSecretInput(body.serviceKey, 'Service key');
    encryptionKeyInput = parseSecretInput(body.encryptionKey, 'Encryption key');
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : 'Invalid secret payload.');
  }

  const platformUpdates: Partial<Record<SocialPlatform, { clientId?: string | null; clientSecret?: string | null }>> = {};
  if (body.platforms !== undefined) {
    const rawPlatforms = body.platforms;
    if (!rawPlatforms || typeof rawPlatforms !== 'object' || Array.isArray(rawPlatforms)) {
      return badRequest('Platform payload must be an object keyed by platform.');
    }

    for (const [rawKey, rawValue] of Object.entries(rawPlatforms)) {
      if (!SUPPORTED_PLATFORMS.includes(rawKey as SocialPlatform)) {
        return badRequest(`Unsupported platform: ${rawKey}`);
      }
      if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        return badRequest(`Platform ${rawKey} payload must be an object.`);
      }

      const payload = rawValue as Record<string, unknown>;
      try {
        const clientId = parseSecretInput(payload.clientId, `${getPlatformLabel(rawKey as SocialPlatform)} client ID`);
        const clientSecret = parseSecretInput(
          payload.clientSecret,
          `${getPlatformLabel(rawKey as SocialPlatform)} client secret`,
        );
        if (clientId !== undefined || clientSecret !== undefined) {
          platformUpdates[rawKey as SocialPlatform] = {};
          if (clientId !== undefined) {
            platformUpdates[rawKey as SocialPlatform]!.clientId = clientId;
          }
          if (clientSecret !== undefined) {
            platformUpdates[rawKey as SocialPlatform]!.clientSecret = clientSecret;
          }
        }
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : 'Invalid platform secret payload.');
      }
    }
  }

  const changesProvided =
    serviceKeyInput !== undefined ||
    encryptionKeyInput !== undefined ||
    Object.keys(platformUpdates).length > 0;

  if (!changesProvided) {
    return badRequest('No changes provided.');
  }

  const firestore = getFirebaseAdminFirestore();
  const docRef = firestore.collection('settings').doc('socialOAuth');

  const docUpdates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: { uid: context.uid, email: context.email },
  };

  if (serviceKeyInput !== undefined) {
    if (!SERVICE_KEY_CONFIG.resource) {
      return forbidden('Service key is managed via environment variables.');
    }
    try {
      if (serviceKeyInput) {
        await writeSecretValue(SERVICE_KEY_CONFIG, serviceKeyInput);
        docUpdates.serviceKeyLast4 = serviceKeyInput.slice(-4);
      } else {
        await writeSecretValue(SERVICE_KEY_CONFIG, null);
        docUpdates.serviceKeyLast4 = null;
      }
      resetCachedSocialServiceKey();
    } catch (error) {
      console.error('Failed to persist social service key', error);
      const message = error instanceof Error ? error.message : 'Failed to store social service key.';
      const status = detectSecretManagerError(message) ? 500 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  if (encryptionKeyInput !== undefined) {
    if (!ENCRYPTION_KEY_CONFIG.resource) {
      return forbidden('Encryption key is managed via environment variables.');
    }
    try {
      if (encryptionKeyInput) {
        const validated = validateEncryptionKey(encryptionKeyInput);
        await writeSecretValue(ENCRYPTION_KEY_CONFIG, validated);
        docUpdates.encryptionKeyLast4 = validated.slice(-4);
      } else {
        await writeSecretValue(ENCRYPTION_KEY_CONFIG, null);
        docUpdates.encryptionKeyLast4 = null;
      }
    } catch (error) {
      console.error('Failed to persist social encryption key', error);
      const message = error instanceof Error ? error.message : 'Failed to store social encryption key.';
      const status = detectSecretManagerError(message) ? 500 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const platformDocUpdates: Record<string, { clientIdLast4?: string | null; clientSecretLast4?: string | null }> = {};

  for (const [platform, secrets] of Object.entries(platformUpdates) as [SocialPlatform, {
    clientId?: string | null;
    clientSecret?: string | null;
  }][]) {
    const targets = getPlatformSecretTargets(platform);
    const next: { clientIdLast4?: string | null; clientSecretLast4?: string | null } = {};

    if (secrets.clientId !== undefined) {
      if (!targets.clientId.resource) {
        return forbidden(`${targets.label} client ID is managed via environment variables.`);
      }
      try {
        if (secrets.clientId) {
          await writeSecretValue(targets.clientId, secrets.clientId);
          next.clientIdLast4 = secrets.clientId.slice(-4);
        } else {
          await writeSecretValue(targets.clientId, null);
          next.clientIdLast4 = null;
        }
      } catch (error) {
        console.error(`Failed to store ${targets.label} client ID`, error);
        const message = error instanceof Error ? error.message : `Failed to store ${targets.label} client ID.`;
        const status = detectSecretManagerError(message) ? 500 : 400;
        return NextResponse.json({ error: message }, { status });
      }
    }

    if (secrets.clientSecret !== undefined) {
      if (!targets.clientSecret.resource) {
        return forbidden(`${targets.label} client secret is managed via environment variables.`);
      }
      try {
        if (secrets.clientSecret) {
          await writeSecretValue(targets.clientSecret, secrets.clientSecret);
          next.clientSecretLast4 = secrets.clientSecret.slice(-4);
        } else {
          await writeSecretValue(targets.clientSecret, null);
          next.clientSecretLast4 = null;
        }
      } catch (error) {
        console.error(`Failed to store ${targets.label} client secret`, error);
        const message = error instanceof Error ? error.message : `Failed to store ${targets.label} client secret.`;
        const status = detectSecretManagerError(message) ? 500 : 400;
        return NextResponse.json({ error: message }, { status });
      }
    }

    if (Object.keys(next).length > 0) {
      platformDocUpdates[platform] = next;
      resetPlatformCredentialCache(platform);
    }
  }

  if (Object.keys(platformDocUpdates).length > 0) {
    docUpdates.platforms = platformDocUpdates;
  }

  try {
    await docRef.set(docUpdates, { merge: true });
  } catch (error) {
    console.error('Failed to persist OAuth settings metadata', error);
    return NextResponse.json({ error: 'Failed to store OAuth settings metadata.' }, { status: 500 });
  }

  try {
    const settings = await loadSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Failed to reload OAuth settings after update', error);
    return NextResponse.json({ error: 'Settings updated but failed to refresh status.' }, { status: 500 });
  }
}
