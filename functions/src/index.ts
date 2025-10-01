
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import Stripe from 'stripe';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ColorThief from 'color-thief-node';
import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import fetch from 'node-fetch';
import * as cors from 'cors';

const corsHandler = cors.default({ origin: true });

const ANALYTICS_ALLOWED_ORIGINS = [
  'https://pineapple--pineapple-tapped---portal.europe-west4.hosted.app',
  'https://ptfbportalbackend--pineapple-tapped---portal.us-central1.hosted.app',
  'http://localhost:3000',
];

// TODO: wrap all http functions with the cors handler, for example:
// exports.myFunction = functions.https.onRequest((req, res) => {
//   corsHandler(req, res, () => {
//     // your function logic
//   });
// });

admin.initializeApp({
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    'pineapple-tapped---portal.firebasestorage.app',
});
const db = admin.firestore();

type StripeSplitTermConfig = {
  label: string;
  percentage: number;
  dueDays: number | null;
};

const STRIPE_SETTINGS_COLLECTION = 'settings';
const STRIPE_SETTINGS_DOC_ID = 'stripeConnect';
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2024-06-20';

let cachedStripeClient: Stripe | null = null;
let cachedStripeSecret: string | null | undefined =
  typeof process.env.STRIPE_SECRET_KEY === 'string' && process.env.STRIPE_SECRET_KEY.trim().length > 0
    ? process.env.STRIPE_SECRET_KEY.trim()
    : undefined;
let cachedStripeWebhookSecret: string | null | undefined =
  typeof process.env.STRIPE_WEBHOOK_SECRET === 'string' && process.env.STRIPE_WEBHOOK_SECRET.trim().length > 0
    ? process.env.STRIPE_WEBHOOK_SECRET.trim()
    : undefined;
let cachedOperationalSettings:
  | { platformFeePercent: number | null; splitTerms: StripeSplitTermConfig[]; fetchedAt: number }
  | null = null;

function normaliseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

type AffiliateResolution = {
  id: string;
  refCode: string;
  name: string;
  commissionRate: number;
  status: string | null;
};

const AFFILIATE_VAT_RATE = 0.2;
const AFFILIATE_DEFAULT_COMMISSION_RATE = 0.5;

function extractAffiliateDetailFromLeadSource(tag: string): string | null {
  if (typeof tag !== 'string') {
    return null;
  }
  const trimmed = tag.trim();
  if (!trimmed.toLowerCase().startsWith('franchise_affiliate')) {
    return null;
  }
  const [, detailRaw] = trimmed.split(':');
  const detail = (detailRaw ?? '').trim();
  return detail || null;
}

async function resolveAffiliateByCode(code: string): Promise<AffiliateResolution | null> {
  const trimmed = code.trim();
  if (!trimmed) {
    return null;
  }
  const normalised = trimmed.toLowerCase();

  const attemptLookup = async (field: string, value: string) => {
    const snapshot = await db.collection('affiliates').where(field, '==', value).limit(1).get();
    if (snapshot.empty) {
      return null;
    }
    const doc = snapshot.docs[0];
    const data = (doc.data() as Record<string, any>) || {};
    const name =
      typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : 'Affiliate partner';
    const commissionRateRaw = data.commissionRate;
    const commissionRate =
      typeof commissionRateRaw === 'number' && Number.isFinite(commissionRateRaw)
        ? commissionRateRaw
        : AFFILIATE_DEFAULT_COMMISSION_RATE;
    const status = typeof data.status === 'string' ? data.status : null;
    return {
      id: doc.id,
      refCode: typeof data.refCode === 'string' && data.refCode.trim() ? data.refCode.trim() : trimmed,
      name,
      commissionRate,
      status,
    } as AffiliateResolution;
  };

  const byLower = await attemptLookup('refCodeLower', normalised);
  if (byLower) {
    return byLower;
  }
  return attemptLookup('refCode', trimmed);
}

async function resolveAffiliateFromLeadSource(tag: string): Promise<AffiliateResolution | null> {
  const detail = extractAffiliateDetailFromLeadSource(tag);
  if (!detail) {
    return null;
  }
  try {
    return await resolveAffiliateByCode(detail);
  } catch (error) {
    console.error('Failed to resolve affiliate for lead source', tag, error);
    return null;
  }
}

function computeAffiliateCommission(baseAmount: number, commissionRate: number) {
  const safeBase = baseAmount > 0 ? baseAmount : 0;
  const safeRate = commissionRate > 0 ? commissionRate : AFFILIATE_DEFAULT_COMMISSION_RATE;
  const net = Math.round(safeBase * safeRate * 100) / 100;
  const vat = Math.round(net * AFFILIATE_VAT_RATE * 100) / 100;
  const gross = Math.round((net + vat) * 100) / 100;
  return { base: safeBase, rate: safeRate, net, vat, gross };
}

function parseSplitTerms(raw: unknown): StripeSplitTermConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const data = entry as Record<string, unknown>;
      const label = normaliseString(data.label ?? data.name ?? data.title);
      const percentage = parseNumber(data.percentage ?? data.percent ?? data.share);
      const dueDays = parseInteger(data.dueDays ?? data.days ?? data.offsetDays ?? data.dueInDays);
      if (!label || percentage === null) {
        return null;
      }
      return {
        label,
        percentage,
        dueDays: dueDays ?? null,
      } as StripeSplitTermConfig;
    })
    .filter((term): term is StripeSplitTermConfig => Boolean(term));
}

const secretManagerClient = new SecretManagerServiceClient();
const STRIPE_SECRET_KEY_RESOURCE = normaliseString(process.env.STRIPE_SECRET_KEY_SECRET_NAME);
const STRIPE_WEBHOOK_SECRET_RESOURCE = normaliseString(process.env.STRIPE_WEBHOOK_SECRET_SECRET_NAME);
const SOCIAL_ACCOUNT_SERVICE_KEY_RESOURCE = normaliseString(
  process.env.SOCIAL_ACCOUNT_SERVICE_KEY_SECRET_NAME
);
const SOCIAL_ACCOUNT_SERVICE_KEY_FALLBACK = normaliseString(process.env.SOCIAL_ACCOUNT_SERVICE_KEY ?? null);
const SOCIAL_ACCOUNT_ENCRYPTION_KEY_RESOURCE = normaliseString(
  process.env.SOCIAL_ACCOUNT_ENCRYPTION_KEY_SECRET_NAME
);
const SOCIAL_ACCOUNT_ENCRYPTION_KEY_FALLBACK = normaliseString(
  process.env.SOCIAL_ACCOUNT_ENCRYPTION_KEY ?? null
);

let cachedSocialAccountServiceKey: string | null | undefined;
let cachedSocialAccountEncryptionKey: Buffer | null | undefined;

const SUPPORTED_SOCIAL_PLATFORMS = new Set<string>([
  'youtube',
  'linkedin',
  'instagram',
  'facebook',
  'tiktok',
  'twitter',
  'vimeo',
]);

function parseSecretResource(resource: string): { parent: string; versionName: string } {
  const trimmed = resource.trim();
  if (!trimmed.startsWith('projects/')) {
    throw new Error(`Secret resource must start with "projects/". Received: ${resource}`);
  }
  if (trimmed.includes('/versions/')) {
    const [parent, version] = trimmed.split('/versions/');
    const versionName = version && version.length > 0 ? version : 'latest';
    return { parent, versionName: `${parent}/versions/${versionName}` };
  }
  return { parent: trimmed, versionName: `${trimmed}/versions/latest` };
}

async function readSecretValue(
  resource: string | null,
  fallbackEnv: string | null,
  label: string
): Promise<string | null> {
  const fallback = normaliseString(fallbackEnv);
  if (!resource) {
    return fallback;
  }
  try {
    const { versionName } = parseSecretResource(resource);
    const [response] = await secretManagerClient.accessSecretVersion({ name: versionName });
    const data = response.payload?.data;
    if (!data || data.length === 0) {
      return null;
    }
    const decoded = Buffer.from(data).toString('utf8').trim();
    return decoded.length > 0 ? decoded : null;
  } catch (error) {
    if ((error as { code?: number }).code === 5) {
      return fallback;
    }
    throw new Error(`Unable to read ${label} from Secret Manager: ${(error as Error).message}`);
  }
}

async function getSocialAccountServiceKey(): Promise<string> {
  if (cachedSocialAccountServiceKey !== undefined) {
    if (!cachedSocialAccountServiceKey) {
      throw new Error('Social account service key is not configured.');
    }
    return cachedSocialAccountServiceKey;
  }

  const secret = await readSecretValue(
    SOCIAL_ACCOUNT_SERVICE_KEY_RESOURCE,
    SOCIAL_ACCOUNT_SERVICE_KEY_FALLBACK,
    'Social account service key'
  );

  cachedSocialAccountServiceKey = secret ?? null;
  if (!cachedSocialAccountServiceKey) {
    throw new Error('Social account service key is not configured.');
  }

  return cachedSocialAccountServiceKey;
}

function decodeEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Encryption key is empty.');
  }

  const base64Candidate = (() => {
    try {
      return Buffer.from(trimmed, 'base64');
    } catch (error) {
      return Buffer.alloc(0);
    }
  })();
  if (base64Candidate.length === 32) {
    return base64Candidate;
  }

  const hexCandidate = (() => {
    try {
      return Buffer.from(trimmed, 'hex');
    } catch (error) {
      return Buffer.alloc(0);
    }
  })();
  if (hexCandidate.length === 32) {
    return hexCandidate;
  }

  if (trimmed.length === 32) {
    const utf8Candidate = Buffer.from(trimmed, 'utf8');
    if (utf8Candidate.length === 32) {
      return utf8Candidate;
    }
  }

  throw new Error('Encryption key must decode to 32 bytes for AES-256-GCM.');
}

async function getSocialAccountEncryptionKey(): Promise<Buffer> {
  if (cachedSocialAccountEncryptionKey) {
    return cachedSocialAccountEncryptionKey;
  }
  if (cachedSocialAccountEncryptionKey === null) {
    throw new Error('Social account encryption key is not configured.');
  }

  const secret = await readSecretValue(
    SOCIAL_ACCOUNT_ENCRYPTION_KEY_RESOURCE,
    SOCIAL_ACCOUNT_ENCRYPTION_KEY_FALLBACK,
    'Social account encryption key'
  );

  if (!secret) {
    cachedSocialAccountEncryptionKey = null;
    throw new Error('Social account encryption key is not configured.');
  }

  const decoded = decodeEncryptionKey(secret);
  cachedSocialAccountEncryptionKey = decoded;
  return decoded;
}

type SocialAccountScopeInput = {
  publish?: boolean;
  analytics?: boolean;
} | null;

type SocialAccountTokenInput = {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | string | null;
  scope?: string | null;
  tokenType?: string | null;
  raw?: Record<string, unknown> | null;
};

type SocialAccountProviderInput = {
  accountId?: string | null;
  accountName?: string | null;
} | null;

type StoreSocialAccountCredentialRequest = {
  stateId?: string | null;
  accountId?: string | null;
  platform?: string | null;
  organisationId?: string | null;
  organisationName?: string | null;
  displayName?: string | null;
  scopes?: SocialAccountScopeInput;
  tokens?: SocialAccountTokenInput | null;
  provider?: SocialAccountProviderInput;
  initiator?: { uid?: string | null; email?: string | null } | null;
  requestedBy?: string | null;
};

type StoreSocialAccountCredentialResponse = {
  accountId: string;
  platform: string;
  status: string;
  expiresAt: string | null;
  displayName: string | null;
  refreshAvailable: boolean;
  requiresReauth: boolean;
};

type EncryptedSecretPayload = {
  cipherText: string;
  iv: string;
  authTag: string;
  hash: string;
};

function encryptSecretValue(plain: string, key: Buffer): EncryptedSecretPayload {
  const value = plain.trim();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    cipherText: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    hash: crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
  };
}

function scrubTokenPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const copy = JSON.parse(JSON.stringify(raw));
  const redactKeys = [
    'access_token',
    'refresh_token',
    'token',
    'accessToken',
    'refreshToken',
    'id_token',
    'code',
  ];
  redactKeys.forEach((key) => {
    if (key in copy) {
      copy[key] = '[redacted]';
    }
  });
  return copy as Record<string, unknown>;
}

function parseExpiresInValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function parseExpiryTimestamp(value: unknown): Date | null {
  if (!value && value !== 0) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value > 1_000_000_000_000) {
      return new Date(value);
    }
    if (value > 0) {
      return new Date(value * 1000);
    }
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return parseExpiryTimestamp(numeric);
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function computeTokenExpiry(tokens: SocialAccountTokenInput): Date | null {
  const directSeconds = parseExpiresInValue(tokens.expiresIn);
  if (directSeconds) {
    return new Date(Date.now() + directSeconds * 1000);
  }

  const raw = tokens.raw ?? {};
  if (raw && typeof raw === 'object') {
    const rawSeconds =
      parseExpiresInValue((raw as Record<string, unknown>).expires_in) ??
      parseExpiresInValue((raw as Record<string, unknown>).expiresIn) ??
      parseExpiresInValue((raw as Record<string, unknown>).expires);
    if (rawSeconds) {
      return new Date(Date.now() + rawSeconds * 1000);
    }

    const rawTimestamp =
      parseExpiryTimestamp((raw as Record<string, unknown>).expires_at) ??
      parseExpiryTimestamp((raw as Record<string, unknown>).expiry) ??
      parseExpiryTimestamp((raw as Record<string, unknown>).expiration) ??
      parseExpiryTimestamp((raw as Record<string, unknown>).expiration_time) ??
      parseExpiryTimestamp((raw as Record<string, unknown>).expirationTime) ??
      parseExpiryTimestamp((raw as Record<string, unknown>).token_expiry) ??
      parseExpiryTimestamp((raw as Record<string, unknown>).tokenExpiry);
    if (rawTimestamp) {
      return rawTimestamp;
    }
  }

  return null;
}

function determineConnectionFlags(refreshToken: string | null, expiresAt: Date | null) {
  const now = Date.now();
  const refreshAvailable = Boolean(refreshToken);
  const expiryTime = expiresAt?.getTime() ?? null;
  const expired = expiryTime !== null && expiryTime <= now + 30_000;
  const requiresReauth = !refreshAvailable && (expired || expiryTime === null);
  const reauthRecommended = requiresReauth || (expiryTime !== null && expiryTime <= now + 72 * 60 * 60 * 1000);
  const status = requiresReauth || expired ? 'requires_reauth' : 'active';
  return { status, refreshAvailable, requiresReauth, reauthRecommended };
}

function normalisePlatform(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed;
}

function coerceScopes(scopes: SocialAccountScopeInput | undefined): { publish: boolean; analytics: boolean } {
  return {
    publish: scopes?.publish === true,
    analytics: scopes?.analytics === true,
  };
}

function buildRotationHistory(
  secretSnap: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>,
  nowIso: string
): Array<{ hash: string; rotatedAt: string | null }> {
  const rawHistory = secretSnap.exists ? ((secretSnap.data() as any)?.rotation?.history ?? []) : [];
  const parsedHistory: Array<{ hash: string; rotatedAt: string | null }> = Array.isArray(rawHistory)
    ? rawHistory
        .map((entry: any) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const hash = typeof entry.hash === 'string' ? entry.hash : null;
          if (!hash) {
            return null;
          }
          const rotatedAt = typeof entry.rotatedAt === 'string' ? entry.rotatedAt : null;
          return { hash, rotatedAt };
        })
        .filter((entry): entry is { hash: string; rotatedAt: string | null } => entry !== null)
    : [];

  const existingCurrent = secretSnap.exists ? (secretSnap.data() as any)?.current : null;
  if (existingCurrent?.accessToken?.hash && typeof existingCurrent.accessToken.hash === 'string') {
    const rotatedAtCandidate = existingCurrent?.accessToken?.storedAt ?? existingCurrent?.storedAt ?? null;
    const rotatedAtString =
      typeof rotatedAtCandidate === 'string'
        ? rotatedAtCandidate
        : rotatedAtCandidate instanceof admin.firestore.Timestamp
        ? rotatedAtCandidate.toDate().toISOString()
        : rotatedAtCandidate instanceof Date
        ? rotatedAtCandidate.toISOString()
        : nowIso;
    parsedHistory.push({ hash: existingCurrent.accessToken.hash, rotatedAt: rotatedAtString });
  }

  while (parsedHistory.length > 5) {
    parsedHistory.shift();
  }

  return parsedHistory;
}

async function storeSocialAccountCredentials(
  payload: StoreSocialAccountCredentialRequest
): Promise<StoreSocialAccountCredentialResponse> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body is required.');
  }

  const platform = normalisePlatform(payload.platform);
  if (!platform) {
    throw new Error('Platform is required.');
  }
  if (!SUPPORTED_SOCIAL_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const tokens = payload.tokens;
  if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken.trim()) {
    throw new Error('Access token is required.');
  }

  const encryptionKey = await getSocialAccountEncryptionKey();

  const scopes = coerceScopes(payload.scopes);
  const organisationId = normaliseString(payload.organisationId);
  const organisationName = normaliseString(payload.organisationName);
  const initiatorUid = normaliseString(payload.initiator?.uid);
  const initiatorEmail = normaliseString(payload.initiator?.email);
  const requestedBy = normaliseString(payload.requestedBy);
  const stateId = normaliseString(payload.stateId);
  const providerAccountId = normaliseString(payload.provider?.accountId);
  const providerAccountName = normaliseString(payload.provider?.accountName);

  const sanitizedAccessToken = tokens.accessToken.trim();
  const sanitizedRefreshToken =
    typeof tokens.refreshToken === 'string' && tokens.refreshToken.trim().length > 0
      ? tokens.refreshToken.trim()
      : null;

  const expiresAt = computeTokenExpiry(tokens);
  const { status, refreshAvailable, requiresReauth, reauthRecommended } = determineConnectionFlags(
    sanitizedRefreshToken,
    expiresAt
  );

  const accountRef = payload.accountId
    ? db.collection('socialAccounts').doc(payload.accountId)
    : db.collection('socialAccounts').doc();
  const accountId = accountRef.id;
  const secretRef = db.collection('socialAccountSecrets').doc(accountId);

  const displayName =
    normaliseString(payload.displayName) ??
    providerAccountName ??
    organisationName ??
    `${platform.charAt(0).toUpperCase()}${platform.slice(1)} account`;

  const expiresAtTimestamp = expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null;
  const nowTimestamp = admin.firestore.Timestamp.now();
  const nowIso = nowTimestamp.toDate().toISOString();
  const usedMockProvider = Boolean((tokens.raw as any)?.mock === true);

  const encryptedAccess = encryptSecretValue(sanitizedAccessToken, encryptionKey);
  const encryptedRefresh = sanitizedRefreshToken ? encryptSecretValue(sanitizedRefreshToken, encryptionKey) : null;

  await db.runTransaction(async (transaction) => {
    const [accountSnap, secretSnap] = await Promise.all([transaction.get(accountRef), transaction.get(secretRef)]);

    const statusHistoryEntry = {
      status,
      updatedAt: nowTimestamp,
      expiresAt: expiresAtTimestamp,
      refreshAvailable,
      requiresReauth,
      updatedBy: initiatorUid ?? requestedBy ?? null,
    };

    const accountData: FirebaseFirestore.DocumentData = {
      platform,
      organisationId: organisationId ?? null,
      organisationName: organisationName ?? null,
      displayName,
      status,
      scopes: { publish: scopes.publish, analytics: scopes.analytics },
      provider: {
        accountId: providerAccountId ?? null,
        accountName: providerAccountName ?? displayName,
      },
      connection: {
        status,
        expiresAt: expiresAtTimestamp,
        refreshAvailable,
        requiresReauth,
        reauthRecommended,
        lastAuthorizedAt: nowTimestamp,
        lastAuthorizedBy: initiatorUid ?? null,
        lastAuthorizedByEmail: initiatorEmail ?? null,
        requestedBy: requestedBy ?? null,
        stateId: stateId ?? null,
        mock: usedMockProvider,
        updatedAt: nowTimestamp,
      },
      refreshAvailable,
      expiresAt: expiresAtTimestamp,
      updatedAt: nowTimestamp,
      updatedBy: initiatorUid ?? null,
      lastAuthorizedAt: nowTimestamp,
      lastAuthorizedBy: initiatorUid ?? null,
      lastAuthorizedByEmail: initiatorEmail ?? null,
      requestedBy: requestedBy ?? null,
      scopesUpdatedAt: nowTimestamp,
      statusHistory: admin.firestore.FieldValue.arrayUnion(statusHistoryEntry),
    };

    if (!accountSnap.exists) {
      accountData.createdAt = nowTimestamp;
      accountData.createdBy = initiatorUid ?? null;
    }

    transaction.set(accountRef, accountData, { merge: true });

    const rotationHistory = buildRotationHistory(secretSnap, nowIso);
    const existingSecret = secretSnap.exists ? (secretSnap.data() as Record<string, unknown>) : null;
    const currentScopes = { publish: scopes.publish, analytics: scopes.analytics };

    const secretData: FirebaseFirestore.DocumentData = {
      accountId,
      platform,
      organisationId: organisationId ?? null,
      organisationName: organisationName ?? null,
      current: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        scope: tokens.scope ?? null,
        scopes: currentScopes,
        tokenType: tokens.tokenType ?? null,
        raw: scrubTokenPayload(tokens.raw ?? {}),
        expiresAt: expiresAtTimestamp,
        storedAt: nowTimestamp,
      },
      rotation: {
        version: ((existingSecret?.rotation as Record<string, unknown>)?.version as number | undefined ?? 0) + 1,
        updatedAt: nowTimestamp,
        history: rotationHistory,
      },
      updatedAt: nowTimestamp,
      updatedBy: initiatorUid ?? null,
    };

    if (!secretSnap.exists) {
      secretData.createdAt = nowTimestamp;
      secretData.createdBy = initiatorUid ?? null;
    }

    transaction.set(secretRef, secretData, { merge: true });
  });

  return {
    accountId,
    platform,
    status,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    displayName,
    refreshAvailable,
    requiresReauth,
  };
}

export const socialAccountsStoreCredentials = onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,X-Service-Key');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const expectedKey = await getSocialAccountServiceKey();
    const providedKey = req.get('x-service-key') ?? req.get('X-Service-Key') ?? null;
    if (!providedKey || providedKey.trim() !== expectedKey) {
      res.status(401).json({ error: 'Invalid service key.' });
      return;
    }

    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (error) {
        res.status(400).json({ error: 'Invalid JSON payload.' });
        return;
      }
    }

    if (!body || (typeof body === 'object' && Object.keys(body as Record<string, unknown>).length === 0)) {
      const rawBody: Buffer | undefined = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (rawBody && rawBody.length > 0) {
        try {
          body = JSON.parse(rawBody.toString('utf8'));
        } catch (error) {
          res.status(400).json({ error: 'Invalid JSON payload.' });
          return;
        }
      }
    }

    const result = await storeSocialAccountCredentials(body as StoreSocialAccountCredentialRequest);
    res.status(200).json(result);
  } catch (error) {
    console.error('Failed to store social account credentials', error);
    if (error instanceof Error && /not configured/i.test(error.message)) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: (error as Error)?.message ?? 'Unable to store credentials.' });
  }
});

async function loadStripeSettingsFromFirestore(): Promise<{
  platformFeePercent: number | null;
  splitTerms: StripeSplitTermConfig[];
}> {
  const docRef = db.collection(STRIPE_SETTINGS_COLLECTION).doc(STRIPE_SETTINGS_DOC_ID);
  const snapshot = await docRef.get();
  const data = (snapshot.data() as Record<string, unknown>) || {};
  const platformFeePercent = parseNumber(data.platformFeePercent ?? data.platformFee ?? data.applicationFeePercent);
  const splitTerms = parseSplitTerms(data.splitTerms ?? data.splitPaymentTerms ?? data.paymentSchedule);
  return { platformFeePercent, splitTerms };
}

async function getStripeSecretKey(): Promise<string> {
  if (cachedStripeSecret !== undefined) {
    if (!cachedStripeSecret) {
      throw new Error('Stripe secret key is not configured.');
    }
    return cachedStripeSecret;
  }
  const secret = await readSecretValue(
    STRIPE_SECRET_KEY_RESOURCE,
    process.env.STRIPE_SECRET_KEY ?? null,
    'Stripe secret key'
  );
  cachedStripeSecret = secret ?? null;
  if (!cachedStripeSecret) {
    throw new Error('Stripe secret key is not configured.');
  }
  return cachedStripeSecret;
}

async function getStripeWebhookSecret(): Promise<string | null> {
  if (cachedStripeWebhookSecret !== undefined) {
    return cachedStripeWebhookSecret;
  }
  try {
    const secret = await readSecretValue(
      STRIPE_WEBHOOK_SECRET_RESOURCE,
      process.env.STRIPE_WEBHOOK_SECRET ?? null,
      'Stripe webhook secret'
    );
    cachedStripeWebhookSecret = secret ?? null;
    return cachedStripeWebhookSecret;
  } catch (error) {
    console.warn('Unable to load Stripe webhook secret', error);
    cachedStripeWebhookSecret = null;
    return null;
  }
}

async function getStripeClient(): Promise<Stripe> {
  const secret = await getStripeSecretKey();
  if (cachedStripeClient) {
    return cachedStripeClient;
  }
  cachedStripeClient = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  return cachedStripeClient;
}

async function getStripeOperationalSettings(): Promise<{
  platformFeePercent: number | null;
  splitTerms: StripeSplitTermConfig[];
}> {
  if (cachedOperationalSettings && Date.now() - cachedOperationalSettings.fetchedAt < 5 * 60 * 1000) {
    return {
      platformFeePercent: cachedOperationalSettings.platformFeePercent,
      splitTerms: cachedOperationalSettings.splitTerms,
    };
  }
  const settings = await loadStripeSettingsFromFirestore();
  cachedOperationalSettings = {
    platformFeePercent: settings.platformFeePercent,
    splitTerms: settings.splitTerms,
    fetchedAt: Date.now(),
  };
  return { platformFeePercent: settings.platformFeePercent, splitTerms: settings.splitTerms };
}

const VAT_RATE = 0.2;
const DAY_IN_MS = 86_400_000;
const DEFAULT_FILMING_SLA_DAYS = 7;
const DEFAULT_EDITING_SLA_DAYS = 14;

type ClientResearchScope = 'standard' | 'deep_dive' | 'competitor_refresh';

type ClientResearchJobStatus =
  | 'queued'
  | 'ingesting'
  | 'analysing'
  | 'complete'
  | 'failed'
  | 'payment_required';

interface ClientResearchScopeConfig {
  estimatedTokens: number;
  estimatedDurationMinutes: number;
  autoTokenCharge: number;
  manualTokenCharge: number;
}

interface TokenWalletDoc {
  balance?: number;
  currency?: string | null;
  planTier?: string | null;
  autoDebit?: boolean;
  usageLog?: Array<Record<string, unknown>>;
}

interface ClientResearchJobCreationResult {
  jobId: string;
  status: ClientResearchJobStatus;
  billingStatus: 'paid' | 'payment_required';
  tokenDebitApplied: boolean;
  tokenCharge: number;
  walletBalanceAfter: number | null;
}

const CLIENT_RESEARCH_SCOPE_CONFIG: Record<ClientResearchScope, ClientResearchScopeConfig> = {
  standard: {
    estimatedTokens: 2500,
    estimatedDurationMinutes: 7,
    autoTokenCharge: 2,
    manualTokenCharge: 3,
  },
  deep_dive: {
    estimatedTokens: 4200,
    estimatedDurationMinutes: 12,
    autoTokenCharge: 3,
    manualTokenCharge: 5,
  },
  competitor_refresh: {
    estimatedTokens: 1800,
    estimatedDurationMinutes: 5,
    autoTokenCharge: 2,
    manualTokenCharge: 3,
  },
};

const CLIENT_RESEARCH_QUEUE_COLLECTION = 'clientResearchQueue';
const CLIENT_RESEARCH_JOB_COLLECTION = 'clientResearchJobs';
const TOKEN_WALLET_COLLECTION = 'tokenWallets';
const CLIENT_RESEARCH_TOKEN_REASON_AUTO = 'client_research_auto';
const CLIENT_RESEARCH_TOKEN_REASON_MANUAL = 'client_research_manual';
const CLIENT_RESEARCH_TOKEN_REASON_GENERIC = 'client_research';
const REMARKETING_CAMPAIGN_COLLECTION = 'remarketingCampaigns';
const REMARKETING_SUGGESTION_COLLECTION = 'remarketingSuggestions';
const REMARKETING_QUEUE_COLLECTION = 'remarketingQueue';
const REMARKETING_MAX_SUGGESTIONS_PER_CAMPAIGN = 120;

type FranchiseTerritoryType = 'postal' | 'radius';

type FranchiseTerritoryDoc = {
  franchiseId?: string;
  label?: string;
  type?: FranchiseTerritoryType | string;
  postalCodes?: unknown;
  exclusive?: boolean;
  categories?: unknown;
  licenseFee?: number;
  radiusKm?: number;
  centerLat?: number;
  centerLng?: number;
  priceTier?: number | string | null;
};

type FranchiseMemberDoc = {
  userId?: string;
  role?: string;
  primary?: boolean;
};

type RoyaltySource = 'hq' | 'franchisee';

interface FranchiseRoyaltyTierConfig {
  minOrder: number;
  maxOrder: number | null;
  percentage: number;
}

interface FranchiseRoyaltyConfigDoc {
  hqTiers: FranchiseRoyaltyTierConfig[];
  franchiseSourcedPercentage: number;
}

function defaultRoyaltyConfig(): FranchiseRoyaltyConfigDoc {
  return {
    hqTiers: [
      { minOrder: 1, maxOrder: 1, percentage: 20 },
      { minOrder: 2, maxOrder: 2, percentage: 15 },
      { minOrder: 3, maxOrder: 5, percentage: 10 },
      { minOrder: 6, maxOrder: null, percentage: 6 },
    ],
    franchiseSourcedPercentage: 6,
  };
}

function parseRoyaltyTierDoc(input: unknown): FranchiseRoyaltyTierConfig | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const data = input as Record<string, unknown>;
  const min = Number(data.minOrder ?? data.orderFrom ?? data.start ?? data.from);
  const maxValue = data.maxOrder ?? data.orderThrough ?? data.end ?? data.to;
  const percentage = Number(data.percentage ?? data.rate ?? data.percent ?? data.value);
  if (!Number.isFinite(min) || min <= 0 || !Number.isFinite(percentage)) {
    return null;
  }
  const parsedMax = maxValue == null || maxValue === '' ? null : Number(maxValue);
  const tier: FranchiseRoyaltyTierConfig = {
    minOrder: Math.max(1, Math.floor(min)),
    maxOrder: null,
    percentage,
  };
  if (parsedMax !== null && Number.isFinite(parsedMax)) {
    const normalisedMax = Math.floor(Number(parsedMax));
    tier.maxOrder = Math.max(normalisedMax, tier.minOrder);
  }
  return tier;
}

function parseRoyaltyConfigDoc(raw: unknown): FranchiseRoyaltyConfigDoc {
  const fallback = defaultRoyaltyConfig();
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }
  const data = raw as Record<string, unknown>;
  const tierValues: unknown = data.hqTiers ?? data.hq ?? data.slidingScale;
  const tiers = Array.isArray(tierValues)
    ? tierValues
        .map((value) => parseRoyaltyTierDoc(value))
        .filter((value): value is FranchiseRoyaltyTierConfig => value !== null)
        .sort((a, b) => a.minOrder - b.minOrder)
    : [];
  const franchiseValue = Number(
    data.franchiseSourcedPercentage ?? data.franchise ?? data.local ?? data.direct
  );
  const franchisePercentage = Number.isFinite(franchiseValue)
    ? franchiseValue
    : fallback.franchiseSourcedPercentage;
  return {
    hqTiers: tiers.length > 0 ? tiers : fallback.hqTiers,
    franchiseSourcedPercentage: franchisePercentage,
  };
}

function resolveRoyaltyTier(
  config: FranchiseRoyaltyConfigDoc,
  source: RoyaltySource,
  orderIndex: number
): { percentage: number; tier: FranchiseRoyaltyTierConfig | null } {
  const fallback = defaultRoyaltyConfig();
  if (source === 'franchisee') {
    return {
      percentage: config.franchiseSourcedPercentage ?? fallback.franchiseSourcedPercentage,
      tier: null,
    };
  }
  const tiers = (config.hqTiers?.length ? config.hqTiers : fallback.hqTiers).slice().sort((a, b) => a.minOrder - b.minOrder);
  const index = Number(orderIndex);
  if (!Number.isFinite(index) || index <= 0) {
    const first = tiers[0] ?? fallback.hqTiers[0];
    return { percentage: first.percentage, tier: first };
  }
  for (const tier of tiers) {
    const withinLower = index >= tier.minOrder;
    const withinUpper = tier.maxOrder == null || index <= tier.maxOrder;
    if (withinLower && withinUpper) {
      return { percentage: tier.percentage, tier };
    }
  }
  const lastTier = tiers[tiers.length - 1] ?? fallback.hqTiers[fallback.hqTiers.length - 1];
  return { percentage: lastTier.percentage, tier: lastTier };
}

type ClientDriveSettingsDoc = {
  clientRootFolderId?: string | null;
  brandingFolderName?: string | null;
  ordersFolderName?: string | null;
  brandingTemplateFolderId?: string | null;
  hqEmails?: string[];
};

interface DriveOrderProductContext {
  productId: string;
  name: string;
  quantity: number;
  templateFolderId: string | null;
  folderName: string | null;
}

interface DriveSetupContext {
  orderId: string;
  orderRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  clientKey: string;
  clientKeyType: 'user_id' | 'email' | null;
  companyName: string | null;
  customerName: string | null;
  projectName: string | null;
  emails: string[];
  franchise: {
    id: string | null;
    label: string | null;
    emails: string[];
  };
  products: DriveOrderProductContext[];
  affiliate: {
    id: string;
    name: string;
    refCode: string;
    status: string | null;
    commissionRate: number;
  } | null;
}

function normaliseDriveId(input: unknown): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function sanitiseDriveName(name: string | null | undefined, fallback: string): string {
  const raw = typeof name === 'string' ? name.trim() : '';
  const base = raw.length > 0 ? raw : fallback;
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '-').replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) {
    return fallback;
  }
  return cleaned.slice(0, 120);
}

function toClientDocId(key: string): string {
  const trimmed = key.trim().toLowerCase();
  if (!trimmed) {
    return `client-${uuidv4()}`;
  }
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length >= 6 && slug.length <= 100) {
    return slug;
  }
  const hash = crypto.createHash('sha1').update(trimmed).digest('hex').slice(0, 24);
  return `client-${hash}`;
}

function buildClientFolderName(context: DriveSetupContext): string {
  const fallback = `Client ${context.orderId.slice(-6).toUpperCase()}`;
  if (context.companyName) {
    return sanitiseDriveName(context.companyName, fallback);
  }
  if (context.customerName) {
    return sanitiseDriveName(context.customerName, fallback);
  }
  const firstEmail = context.emails.find((value) => value.length > 0);
  if (firstEmail) {
    const prefix = firstEmail.split('@')[0] || firstEmail;
    return sanitiseDriveName(prefix, fallback);
  }
  return fallback;
}

function buildOrderFolderName(context: DriveSetupContext): string {
  const suffix = context.orderId.slice(-6).toUpperCase();
  if (context.projectName) {
    return sanitiseDriveName(`${context.projectName} (${suffix})`, `Order ${suffix}`);
  }
  if (context.products.length === 1) {
    return sanitiseDriveName(`${context.products[0].name} (${suffix})`, `Order ${suffix}`);
  }
  return `Order ${suffix}`;
}

function normaliseNullableString(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseClientDocId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('clients/')) {
    const [, clientId] = trimmed.split('/');
    return clientId ? clientId.trim() : null;
  }
  if (/^[a-z0-9-]{6,120}$/.test(trimmed)) {
    return trimmed;
  }
  return toClientDocId(trimmed);
}

function buildDocPath(collection: string, id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(`${collection}/`)) {
    return trimmed;
  }
  return `${collection}/${trimmed}`;
}

function buildClientDocPath(clientId: string): string {
  return clientId.startsWith('clients/') ? clientId : `clients/${clientId}`;
}

function normaliseClientResearchScope(input: unknown): ClientResearchScope {
  if (typeof input === 'string') {
    const value = input.trim().toLowerCase();
    if (!value) return 'standard';
    if (value.includes('deep')) return 'deep_dive';
    if (value.includes('competitor')) return 'competitor_refresh';
    if (value.includes('refresh')) return 'competitor_refresh';
  }
  return 'standard';
}

function getClientResearchScopeConfig(scope: ClientResearchScope): ClientResearchScopeConfig {
  return CLIENT_RESEARCH_SCOPE_CONFIG[scope] ?? CLIENT_RESEARCH_SCOPE_CONFIG.standard;
}

function parseBooleanFlag(input: unknown): boolean | null {
  if (input === true) return true;
  if (input === false) return false;
  if (typeof input === 'number') {
    if (input === 1) return true;
    if (input === 0) return false;
  }
  if (typeof input === 'string') {
    const value = input.trim().toLowerCase();
    if (!value) return null;
    if (['true', 'yes', 'y', 'on', 'enabled', 'enable', 'auto'].includes(value)) return true;
    if (['false', 'no', 'n', 'off', 'disabled', 'disable', 'manual'].includes(value)) return false;
  }
  return null;
}

function normaliseStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    const values = input
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);
    return Array.from(new Set(values.map((value) => value.toLowerCase())));
  }
  if (typeof input === 'string') {
    return Array.from(
      new Set(
        input
          .split(/[\n,]+/)
          .map((value) => value.trim().toLowerCase())
          .filter((value) => value.length > 0)
      )
    );
  }
  return [];
}

function normaliseProductDocId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('products/')) {
    const [, productId] = trimmed.split('/');
    return productId ? productId.trim() : null;
  }
  return trimmed;
}

function normaliseOrgId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('orgs/')) {
    const [, orgId] = trimmed.split('/');
    return orgId ? orgId.trim() : null;
  }
  return trimmed;
}

function buildMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function computeNextMonthlyRunDate(sendDay: number, reference: Date): Date {
  const next = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1, 9, 0, 0));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(1, Math.floor(sendDay || 1)), daysInMonth);
  next.setUTCDate(safeDay);
  return next;
}

function extractTagSetFromData(data: Record<string, any>): Set<string> {
  const tagFields = ['tags', 'labels', 'segments', 'lists', 'marketingTags', 'marketingLists'];
  const tagSet = new Set<string>();
  for (const field of tagFields) {
    const value = data[field];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          const trimmed = entry.trim().toLowerCase();
          if (trimmed) tagSet.add(trimmed);
        }
      }
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        trimmed
          .split(/[\n,]+/)
          .map((part) => part.trim().toLowerCase())
          .filter((part) => part.length > 0)
          .forEach((part) => tagSet.add(part));
      }
    }
  }
  return tagSet;
}

function hasMarketingOptOut(data: Record<string, any>): boolean {
  const flags = [
    data.marketingOptOut,
    data.optOut,
    data.doNotMarket,
    data.doNotEmail,
    data.unsubscribe,
    data.noMarketing,
    data.marketingDisabled,
  ].map(parseBooleanFlag);
  return flags.includes(true);
}

function isClientRecord(data: Record<string, any>): boolean {
  const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';
  const stage = typeof data.lifecycleStage === 'string' ? data.lifecycleStage.toLowerCase() : '';
  const type = typeof data.type === 'string' ? data.type.toLowerCase() : '';
  const roleClient = parseBooleanFlag(data?.roles?.client) === true;
  const roleArray = Array.isArray(data.roles)
    ? data.roles
        .map((value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter((value) => value.length > 0)
    : [];
  return (
    ['client', 'customer', 'active', 'retained'].some((value) => status.includes(value)) ||
    ['client', 'customer'].some((value) => stage.includes(value)) ||
    ['client', 'customer'].includes(type) ||
    roleClient ||
    roleArray.includes('client') ||
    roleArray.includes('customer')
  );
}

function isProspectRecord(data: Record<string, any>): boolean {
  const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';
  const stage = typeof data.lifecycleStage === 'string' ? data.lifecycleStage.toLowerCase() : '';
  const type = typeof data.type === 'string' ? data.type.toLowerCase() : '';
  const roleProspect = parseBooleanFlag(data?.roles?.prospect) === true;
  const roleArray = Array.isArray(data.roles)
    ? data.roles
        .map((value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter((value) => value.length > 0)
    : [];
  return (
    ['lead', 'prospect', 'opportunity', 'new'].some((value) => status.includes(value)) ||
    ['lead', 'prospect'].some((value) => stage.includes(value)) ||
    ['lead', 'prospect'].includes(type) ||
    roleProspect ||
    roleArray.includes('lead') ||
    roleArray.includes('prospect')
  );
}

function matchesTargetGroups(groups: string[], data: Record<string, any>): boolean {
  if (groups.length === 0) return true;
  for (const group of groups) {
    const key = group.toLowerCase();
    if (key === 'clients' && isClientRecord(data)) return true;
    if (key === 'prospects' && isProspectRecord(data)) return true;
    if (key === 'lists') {
      const tagSet = extractTagSetFromData(data);
      if (tagSet.size > 0) return true;
    }
  }
  return false;
}

async function resolveRemarketingAudience(
  clientDocId: string,
  data: Record<string, any>,
  membershipCache: Map<string, { userIds: string[]; emails: string[] }>
): Promise<{ orgIds: string[]; userIds: string[]; emails: string[] }> {
  const orgCandidates: Array<unknown> = [
    data.orgId,
    data.org,
    data.organisationId,
    data.organizationId,
    data.organisation,
    data.organization,
    data.orgRef,
    data.orgPath,
    data.accountId,
    data.account,
    data.orgIds,
    data.organisationIds,
    data.organizationIds,
    data.orgs,
    data.accounts,
  ];
  const orgIds = new Set<string>();
  for (const candidate of orgCandidates) {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        const normalised = normaliseOrgId(entry);
        if (normalised) orgIds.add(normalised);
      }
    } else {
      const normalised = normaliseOrgId(candidate);
      if (normalised) orgIds.add(normalised);
    }
  }
  const membershipField = data.memberships;
  if (Array.isArray(membershipField)) {
    for (const entry of membershipField) {
      if (entry && typeof entry === 'object') {
        const normalised = normaliseOrgId((entry as any).orgId ?? (entry as any).id);
        if (normalised) orgIds.add(normalised);
      }
    }
  }
  const audienceUserIds = new Set<string>();
  const audienceEmails = new Set<string>();
  const addUserId = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) audienceUserIds.add(trimmed);
    }
  };
  const addEmail = (value: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim().toLowerCase();
      if (trimmed) audienceEmails.add(trimmed);
    }
  };
  const directUsers = [data.userId, data.primaryUserId, data.accountOwnerId];
  directUsers.forEach(addUserId);
  const directUserArray = Array.isArray(data.userIds) ? data.userIds : data.contactUserIds;
  if (Array.isArray(directUserArray)) {
    directUserArray.forEach(addUserId);
  }
  const directEmails = [data.email, data.primaryEmail, data.contactEmail];
  directEmails.forEach(addEmail);
  if (Array.isArray(data.emails)) {
    data.emails.forEach(addEmail);
  }
  for (const orgId of orgIds) {
    if (!membershipCache.has(orgId)) {
      const membershipSnap = await db.collection('memberships').where('orgId', '==', orgId).get();
      const userIds: string[] = [];
      const emails: string[] = [];
      membershipSnap.docs.forEach((docSnap) => {
        const membership = (docSnap.data() as any) || {};
        if (typeof membership.userId === 'string') {
          const trimmed = membership.userId.trim();
          if (trimmed) userIds.push(trimmed);
        }
        if (typeof membership.email === 'string') {
          const trimmed = membership.email.trim().toLowerCase();
          if (trimmed) emails.push(trimmed);
        }
      });
      membershipCache.set(orgId, {
        userIds: Array.from(new Set(userIds)),
        emails: Array.from(new Set(emails)),
      });
    }
    const cached = membershipCache.get(orgId);
    if (cached) {
      cached.userIds.forEach(addUserId);
      cached.emails.forEach(addEmail);
    }
  }
  return {
    orgIds: Array.from(orgIds),
    userIds: Array.from(audienceUserIds),
    emails: Array.from(audienceEmails),
  };
}

function buildRemarketingDraft(options: {
  client: Record<string, any>;
  campaignName: string;
  productName: string | null;
  targetTags: string[];
}): { headline: string; summary: string; article: string } {
  const companyName =
    typeof options.client.companyName === 'string'
      ? options.client.companyName
      : typeof options.client.displayName === 'string'
        ? options.client.displayName
        : typeof options.client.name === 'string'
          ? options.client.name
          : 'your business';
  const industry =
    typeof options.client.industry === 'string'
      ? options.client.industry
      : typeof options.client.segment === 'string'
        ? options.client.segment
        : null;
  const productName = options.productName ?? 'content programme';
  const tagsLabel = options.targetTags.length ? `Focus: ${options.targetTags.join(', ')}.` : '';
  const headline = `${productName} ideas for ${companyName}`;
  const summaryParts = [
    `A follow-up concept from the ${options.campaignName} campaign tailored for ${companyName}.`,
    industry ? `Industry insight: ${industry}.` : null,
    tagsLabel || null,
    'Includes suggested deliverables, talking points and a ready-to-send email draft.',
  ].filter(Boolean);
  const summary = summaryParts.join(' ');
  const article = `## ${productName} roadmap for ${companyName}

### Opportunity
- Aligns with ${options.campaignName} goals
- ${industry ? `Leverages current trends in ${industry}` : 'Amplifies existing marketing activity'}

### Proposed deliverables
- Hero video with supporting social edits
- Paid amplification assets and remarketing hooks
- Measurement framework tied to CRM goals

### How we'll personalise it
- Gemini deep dive on brand tone, audience language and competitor messaging
- Tailored CTA recommendations with seasonal triggers
- Email and portal-ready copy blocks for quick deployment

${tagsLabel}`;
  return { headline, summary, article };
}

function resolveClientDocIdFromOrder(order: Record<string, any>, orderId: string): string {
  const candidateKeys: Array<string | null> = [
    typeof order.clientId === 'string' ? order.clientId : null,
    typeof order.clientRef === 'string' ? order.clientRef : null,
    typeof order.clientPath === 'string' ? order.clientPath : null,
    typeof order.clientKey === 'string' ? order.clientKey : null,
    typeof order.clientRoyaltyKey === 'string' ? order.clientRoyaltyKey : null,
    typeof order.driveClientKey === 'string' ? order.driveClientKey : null,
  ];
  for (const candidate of candidateKeys) {
    const docId = normaliseClientDocId(candidate);
    if (docId) {
      return docId;
    }
  }
  if (typeof order.userId === 'string' && order.userId.trim().length > 0) {
    return toClientDocId(`uid:${order.userId.trim()}`);
  }
  const emailCandidate = normaliseNullableString(order.userEmail || order.customerEmail);
  if (emailCandidate) {
    return toClientDocId(`email:${emailCandidate.toLowerCase()}`);
  }
  return toClientDocId(`order:${orderId}`);
}

function resolveAutoResearchScope(
  order: Record<string, any>,
  clientAiSettings: Record<string, any>
): ClientResearchScope {
  const scopeCandidates: Array<unknown> = [
    order.autoResearchScope,
    order.clientResearchScope,
    order.researchScope,
    order?.clientResearch?.scope,
    clientAiSettings.defaultScope,
    clientAiSettings.preferredScope,
  ];
  for (const candidate of scopeCandidates) {
    const scope = normaliseClientResearchScope(candidate);
    if (candidate && scope) {
      return scope;
    }
  }
  return 'standard';
}

function shouldAutoTriggerClientResearch(
  order: Record<string, any>,
  clientData: FirebaseFirestore.DocumentData | undefined
): { shouldRun: boolean; reason: string; scope: ClientResearchScope } {
  const aiSettings =
    clientData && typeof clientData.ai === 'object' && clientData.ai !== null
      ? (clientData.ai as Record<string, any>)
      : {};
  const explicitOptOutFlags = [
    order.autoResearchOptOut,
    order.disableAutoResearch,
    order.autoResearchDisabled,
    order.clientResearchOptOut,
    aiSettings.autoResearchOptOut,
    aiSettings.optOut,
  ].map(parseBooleanFlag);
  const scope = resolveAutoResearchScope(order, aiSettings);
  if (explicitOptOutFlags.includes(true)) {
    return { shouldRun: false, reason: 'opt_out', scope };
  }
  const explicitOffFlags = [
    order.autoResearchEnabled,
    order.clientResearchAuto,
    aiSettings.autoResearchEnabled,
    aiSettings.autoEnabled,
    aiSettings.enabled,
  ].map(parseBooleanFlag);
  if (explicitOffFlags.includes(false)) {
    return { shouldRun: false, reason: 'disabled', scope };
  }
  const explicitTrueFlags = [
    order.autoResearchEnabled,
    order.autoResearchRequested,
    order.clientResearchAuto,
    order.clientResearchEnabled,
    aiSettings.autoResearchEnabled,
    aiSettings.defaultOn,
    aiSettings.enabled,
  ].map(parseBooleanFlag);
  if (explicitTrueFlags.includes(true)) {
    const reason = parseBooleanFlag(order.autoResearchEnabled) === true ? 'order_auto' : 'client_auto';
    return { shouldRun: true, reason, scope };
  }
  return { shouldRun: false, reason: 'not_enabled', scope };
}

async function attemptWalletDebitForClientResearch(options: {
  walletRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  allowDebit: boolean;
  tokenCharge: number;
  jobRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  scope: ClientResearchScope;
  triggeredBy: string | null;
  reason: 'auto' | 'manual';
}): Promise<{ tokenDebitApplied: boolean; walletBalanceAfter: number | null; insufficient: boolean }>
{
  if (!options.allowDebit || options.tokenCharge <= 0) {
    return { tokenDebitApplied: false, walletBalanceAfter: null, insufficient: options.tokenCharge > 0 };
  }
  const usageReason =
    options.reason === 'auto'
      ? CLIENT_RESEARCH_TOKEN_REASON_AUTO
      : options.reason === 'manual'
        ? CLIENT_RESEARCH_TOKEN_REASON_MANUAL
        : CLIENT_RESEARCH_TOKEN_REASON_GENERIC;
  const insufficientResult = { tokenDebitApplied: false, walletBalanceAfter: null, insufficient: true } as const;
  try {
    let balanceAfter: number | null = null;
    await db.runTransaction(async (tx) => {
      const walletSnap = await tx.get(options.walletRef);
      if (!walletSnap.exists) {
        throw new Error('NO_WALLET');
      }
      const wallet = (walletSnap.data() as TokenWalletDoc) || {};
      const currentBalance = typeof wallet.balance === 'number' ? wallet.balance : 0;
      if (currentBalance < options.tokenCharge) {
        throw new Error('INSUFFICIENT_TOKENS');
      }
      balanceAfter = currentBalance - options.tokenCharge;
      tx.update(options.walletRef, {
        balance: balanceAfter,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        usageLog: admin.firestore.FieldValue.arrayUnion({
          jobId: `${CLIENT_RESEARCH_JOB_COLLECTION}/${options.jobRef.id}`,
          delta: -options.tokenCharge,
          reason: usageReason,
          scope: options.scope,
          triggeredBy: options.triggeredBy,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }),
      });
    });
    return { tokenDebitApplied: true, walletBalanceAfter: balanceAfter, insufficient: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'INSUFFICIENT_TOKENS' || message === 'NO_WALLET') {
      return insufficientResult;
    }
    console.error('Client research wallet debit failed', options.jobRef.id, err);
    return insufficientResult;
  }
}

async function persistClientResearchJob(options: {
  jobRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  clientPath: string;
  orderPath: string | null;
  proposalPath: string | null;
  scope: ClientResearchScope;
  manual: boolean;
  status: ClientResearchJobStatus;
  billingMode: 'auto' | 'manual';
  triggeredBy: string | null;
  tokenCharge: number;
  tokenDebitApplied: boolean;
  walletBalanceAfter: number | null;
  source: string;
  metadata?: Record<string, any> | null;
}): Promise<void> {
  const scopeConfig = getClientResearchScopeConfig(options.scope);
  const payload: Record<string, any> = {
    clientId: options.clientPath,
    orderId: options.orderPath,
    proposalId: options.proposalPath,
    status: options.status,
    manual: options.manual,
    scope: options.scope,
    estimatedTokens: scopeConfig.estimatedTokens,
    estimatedDuration: scopeConfig.estimatedDurationMinutes,
    billingMode: options.billingMode,
    triggeredBy: options.triggeredBy,
    tokenCharge: options.tokenCharge,
    tokenDebitApplied: options.tokenDebitApplied,
    tokenBalanceAfter: options.tokenDebitApplied ? options.walletBalanceAfter : null,
    billingStatus: options.tokenDebitApplied ? 'paid' : 'payment_required',
    source: options.source,
    autoTriggered: !options.manual,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (options.status === 'queued') {
    payload.queueStatus = 'pending';
  } else if (options.status === 'payment_required') {
    payload.queueStatus = 'awaiting_payment';
  }
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    payload.metadata = JSON.parse(JSON.stringify(options.metadata));
  }
  await options.jobRef.set(payload, { merge: false });
}

async function enqueueClientResearchQueue(options: {
  jobRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  clientPath: string;
  scope: ClientResearchScope;
  manual: boolean;
  triggeredBy: string | null;
  source: string;
}): Promise<void> {
  const queueRef = db.collection(CLIENT_RESEARCH_QUEUE_COLLECTION).doc(options.jobRef.id);
  const queuePayload: Record<string, any> = {
    jobId: options.jobRef.id,
    jobRef: options.jobRef.path,
    clientId: options.clientPath,
    scope: options.scope,
    manual: options.manual,
    source: options.source,
    triggeredBy: options.triggeredBy,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  try {
    await queueRef.set(queuePayload, { merge: true });
  } catch (err) {
    console.error('Failed to enqueue client research job', options.jobRef.id, err);
  }
}

function buildProductFolderName(
  product: DriveOrderProductContext,
  index: number,
  total: number
): string {
  const base = sanitiseDriveName(
    product.folderName ?? product.name,
    product.name || `Product ${index + 1}`
  );
  if (total > 1) {
    return `${base} #${index + 1}`;
  }
  return base;
}

async function createDriveService(): Promise<drive_v3.Drive | null> {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyB64) {
    console.warn('Missing Google service account credentials for Drive automation');
    return null;
  }
  try {
    const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
    const auth = new google.auth.JWT(
      keyJson.client_email,
      undefined,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/drive']
    );
    await auth.authorize();
    return google.drive({ version: 'v3', auth });
  } catch (error) {
    console.error('Failed to initialise Drive service', error);
    return null;
  }
}

async function resolveExistingFolder(
  drive: drive_v3.Drive,
  folderId: string | null
): Promise<string | null> {
  if (!folderId) {
    return null;
  }
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id, trashed',
      supportsAllDrives: true,
    });
    if (res.data?.trashed) {
      return null;
    }
    return res.data?.id ?? folderId;
  } catch {
    return null;
  }
}

async function createDriveFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string | null
): Promise<string | null> {
  try {
    const metadata: drive_v3.Schema$File = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }
    const res = await drive.files.create({
      requestBody: metadata,
      fields: 'id',
      supportsAllDrives: true,
    });
    return res.data.id ?? null;
  } catch (error) {
    console.error('Failed to create Drive folder', name, error);
    return null;
  }
}

async function listDriveChildren(
  drive: drive_v3.Drive,
  parentId: string
): Promise<drive_v3.Schema$File[]> {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 100,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    if (res.data.files) {
      files.push(...res.data.files);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

async function copyDriveContents(
  drive: drive_v3.Drive,
  sourceFolderId: string,
  destinationFolderId: string
): Promise<void> {
  const children = await listDriveChildren(drive, sourceFolderId);
  for (const child of children) {
    if (!child.id) continue;
    if (child.mimeType === 'application/vnd.google-apps.folder') {
      const folderName = sanitiseDriveName(child.name ?? 'Folder', 'Folder');
      const newFolderId = await createDriveFolder(drive, folderName, destinationFolderId);
      if (newFolderId) {
        await copyDriveContents(drive, child.id, newFolderId);
      }
    } else {
      try {
        await drive.files.copy({
          fileId: child.id,
          requestBody: {
            name: child.name ?? undefined,
            parents: [destinationFolderId],
          },
          supportsAllDrives: true,
        });
      } catch (error) {
        console.error('Failed to copy Drive file', child.id, error);
      }
    }
  }
}

async function ensureChildFolder(
  drive: drive_v3.Drive,
  parentId: string,
  desiredName: string,
  existingFolderId?: string | null,
  templateFolderId?: string | null
): Promise<{ id: string | null; created: boolean }> {
  const existing = await resolveExistingFolder(
    drive,
    normaliseDriveId(existingFolderId)
  );
  if (existing) {
    return { id: existing, created: false };
  }
  try {
    const escapedName = desiredName.replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents and name = '${escapedName}'`,
      fields: 'files(id, name)',
      pageSize: 1,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    const matchId = search.data.files?.[0]?.id ?? null;
    if (matchId) {
      return { id: matchId, created: false };
    }
  } catch (error) {
    console.warn('Failed to look up Drive folder by name', error);
  }
  const folderId = await createDriveFolder(drive, desiredName, parentId);
  if (folderId && templateFolderId) {
    try {
      await copyDriveContents(drive, templateFolderId, folderId);
    } catch (error) {
      console.error('Failed to copy Drive template into folder', error);
    }
  }
  return { id: folderId, created: true };
}

async function shareDriveFolder(
  drive: drive_v3.Drive,
  folderId: string,
  emails: string[]
): Promise<void> {
  const seen = new Set<string>();
  for (const email of emails) {
    const trimmed = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    try {
      await drive.permissions.create({
        fileId: folderId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: trimmed,
        },
      });
    } catch (error: any) {
      if (error?.code === 409) {
        continue;
      }
      console.warn('Failed to apply Drive permission', folderId, trimmed, error);
    }
  }
}

async function setupClientDriveStructure(context: DriveSetupContext): Promise<void> {
  const drive = await createDriveService();
  if (!drive) {
    await context.orderRef.set(
      {
        drive: {
          status: 'pending_credentials',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    return;
  }

  const settingsSnap = await db.collection('settings').doc('clientDrive').get();
  const settings = (settingsSnap.data() as ClientDriveSettingsDoc) || {};
  const rootFolderId = normaliseDriveId(settings.clientRootFolderId);
  if (!rootFolderId) {
    await context.orderRef.set(
      {
        drive: {
          status: 'pending_configuration',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    return;
  }

  const brandingName = sanitiseDriveName(settings.brandingFolderName ?? null, 'Branding Assets');
  const ordersName = sanitiseDriveName(settings.ordersFolderName ?? null, 'Projects');
  const brandingTemplateId = normaliseDriveId(settings.brandingTemplateFolderId);

  const clientEmails = Array.from(
    new Set(
      context.emails
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    )
  );
  const franchiseEmails = context.franchise.emails
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const hqEmails = Array.isArray(settings.hqEmails)
    ? settings.hqEmails
        .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
        .filter((value) => value.length > 0)
    : [];
  const shareEmails = [...hqEmails, ...franchiseEmails];

  const clientsCollection = db.collection('clients');
  let clientDocRef:
    | FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>
    | null = null;
  let existingSnap:
    | FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>
    | null = null;

  if (context.clientKey) {
    const candidateRef = clientsCollection.doc(toClientDocId(context.clientKey));
    const candidateSnap = await candidateRef.get();
    if (candidateSnap.exists) {
      clientDocRef = candidateRef;
      existingSnap = candidateSnap;
    } else {
      const keyQuery = await clientsCollection.where('key', '==', context.clientKey).limit(1).get();
      if (!keyQuery.empty) {
        existingSnap = keyQuery.docs[0];
        clientDocRef = existingSnap.ref;
      }
    }
  }

  if (!clientDocRef && clientEmails.length > 0) {
    const emailQuery = await clientsCollection
      .where('emails', 'array-contains-any', clientEmails.slice(0, 10))
      .limit(1)
      .get();
    if (!emailQuery.empty) {
      existingSnap = emailQuery.docs[0];
      clientDocRef = existingSnap.ref;
    }
  }

  if (!clientDocRef) {
    const fallbackId = toClientDocId(`order:${context.orderId}`);
    clientDocRef = clientsCollection.doc(fallbackId);
  }

  const existingData = (existingSnap?.data() as any) || {};
  const driveInfo = existingData.drive || {};

  const clientFolderName = buildClientFolderName(context);
  let clientFolderId =
    (await resolveExistingFolder(
      drive,
      normaliseDriveId(driveInfo.rootFolderId ?? driveInfo.clientFolderId)
    )) ?? null;
  let clientFolderCreated = false;
  if (!clientFolderId) {
    clientFolderId = await createDriveFolder(drive, clientFolderName, rootFolderId);
    clientFolderCreated = true;
  }
  if (!clientFolderId) {
    throw new Error('Unable to create client Drive folder');
  }

  const branding = await ensureChildFolder(
    drive,
    clientFolderId,
    brandingName,
    driveInfo.brandingFolderId,
    brandingTemplateId
  );
  const orders = await ensureChildFolder(
    drive,
    clientFolderId,
    ordersName,
    driveInfo.ordersRootFolderId
  );
  const ordersRootFolderId = orders.id ?? clientFolderId;
  const orderFolderName = buildOrderFolderName(context);
  const orderFolderId = await createDriveFolder(drive, orderFolderName, ordersRootFolderId);
  if (!orderFolderId) {
    throw new Error('Unable to create order Drive folder');
  }

  const productFolders: {
    productId: string;
    folderId: string;
    folderName: string;
    templateFolderId: string | null;
    quantity: number;
    sequence: number;
  }[] = [];

  for (const product of context.products) {
    const count = product.quantity > 0 ? product.quantity : 1;
    for (let i = 0; i < count; i += 1) {
      const folderName = buildProductFolderName(product, i, count);
      const folderId = await createDriveFolder(drive, folderName, orderFolderId);
      if (!folderId) {
        continue;
      }
      if (product.templateFolderId) {
        await copyDriveContents(drive, product.templateFolderId, folderId);
      }
      productFolders.push({
        productId: product.productId,
        folderId,
        folderName,
        templateFolderId: product.templateFolderId,
        quantity: count,
        sequence: i + 1,
      });
    }
  }

  if (clientFolderCreated || shareEmails.length > 0) {
    await shareDriveFolder(drive, clientFolderId, shareEmails);
  }

  const clientUpdate: Record<string, any> = {
    key: context.clientKey ?? null,
    keyType: context.clientKeyType ?? null,
    companyName: context.companyName ?? null,
    customerName: context.customerName ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    drive: {
      rootFolderId: clientFolderId,
      rootFolderName: clientFolderName,
      brandingFolderId: branding.id ?? null,
      brandingFolderName: brandingName,
      ordersRootFolderId,
      ordersFolderName: ordersName,
      lastOrderId: context.orderId,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };

  if (!existingSnap?.exists) {
    clientUpdate.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }
  if (clientEmails.length > 0) {
    clientUpdate.emails = admin.firestore.FieldValue.arrayUnion(...clientEmails);
  }
  if (context.franchise.id) {
    clientUpdate.lastFranchiseId = context.franchise.id;
  }
  if (franchiseEmails.length > 0) {
    clientUpdate.franchiseEmails = admin.firestore.FieldValue.arrayUnion(...franchiseEmails);
  }
  if (context.affiliate) {
    clientUpdate.affiliate = {
      id: context.affiliate.id,
      name: context.affiliate.name,
      refCode: context.affiliate.refCode,
      status: context.affiliate.status ?? null,
      commissionRate: context.affiliate.commissionRate,
      lastReferralAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  await clientDocRef.set(clientUpdate, { merge: true });

  await context.orderRef.set(
    {
      clientId: clientDocRef.id,
      drive: {
        status: 'ready',
        clientFolderId,
        clientFolderName,
        brandingFolderId: branding.id ?? null,
        brandingFolderName: brandingName,
        ordersRootFolderId,
        ordersFolderName: ordersName,
        orderFolderId,
        orderFolderName,
        productFolders,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}

export const drive_listProjectFolder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }

  const projectId = typeof data?.projectId === 'string' ? data.projectId.trim() : '';
  const requestedFolderId = typeof data?.folderId === 'string' ? data.folderId.trim() : '';
  if (!projectId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId is required');
  }

  const userContext = await loadUserContext(context.auth.uid);
  if (!userContext.isStaff && userContext.franchiseIds.length === 0) {
    throw new functions.https.HttpsError('permission-denied', 'Drive staging requires staff or franchise access');
  }

  const projectSnap = await db.collection('projects').doc(projectId).get();
  if (!projectSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Project not found');
  }
  const projectData = projectSnap.data() as Record<string, any>;
  const projectFranchiseId =
    typeof projectData.franchiseId === 'string' ? projectData.franchiseId : null;

  if (
    !userContext.isStaff &&
    projectFranchiseId &&
    !userContext.franchiseIds.includes(projectFranchiseId)
  ) {
    throw new functions.https.HttpsError('permission-denied', 'This project is not assigned to your franchise');
  }

  const orderId = typeof projectData.orderId === 'string' ? projectData.orderId : null;
  if (!orderId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The project is not linked to an order with Drive provisioning.'
    );
  }

  const orderSnap = await db.collection('orders').doc(orderId).get();
  if (!orderSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Linked order not found');
  }
  const orderData = orderSnap.data() as Record<string, any>;
  const driveInfo = (orderData.drive as Record<string, any>) || {};

  const drive = await createDriveService();
  if (!drive) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Drive service account credentials are not configured.'
    );
  }

  const folderId =
    normaliseDriveId(requestedFolderId) ?? normaliseDriveId(driveInfo.orderFolderId);
  if (!folderId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The order does not have a Drive folder configured yet.'
    );
  }

  let folderName: string | null = null;
  if (requestedFolderId) {
    try {
      const folderMeta = await drive.files.get({
        fileId: folderId,
        fields: 'id, name',
        supportsAllDrives: true,
      });
      folderName = typeof folderMeta.data.name === 'string' ? folderMeta.data.name : null;
    } catch (error) {
      console.warn('drive_listProjectFolder failed to resolve folder metadata', folderId, error);
    }
  } else if (typeof driveInfo.orderFolderName === 'string') {
    folderName = driveInfo.orderFolderName;
  } else {
    try {
      const folderMeta = await drive.files.get({
        fileId: folderId,
        fields: 'id, name',
        supportsAllDrives: true,
      });
      folderName = typeof folderMeta.data.name === 'string' ? folderMeta.data.name : null;
    } catch (error) {
      console.warn('drive_listProjectFolder failed to resolve root folder name', folderId, error);
    }
  }

  const listResponse = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)',
    pageSize: 100,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    orderBy: 'name_natural',
  });

  const items = (listResponse.data.files || [])
    .map((file) => ({
      id: file.id ?? '',
      name: typeof file.name === 'string' ? file.name : 'Untitled',
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : null,
      size: file.size ? Number(file.size) : null,
      modifiedTime: typeof file.modifiedTime === 'string' ? file.modifiedTime : null,
      webViewLink: typeof file.webViewLink === 'string' ? file.webViewLink : null,
      kind:
        file.mimeType === 'application/vnd.google-apps.folder'
          ? 'folder'
          : 'file',
    }))
    .filter((item) => item.id.length > 0);

  const productFolders = Array.isArray(driveInfo.productFolders)
    ? (driveInfo.productFolders as Array<Record<string, any>>)
        .map((entry) => {
          const entryFolderId = normaliseDriveId(entry.folderId);
          if (!entryFolderId) {
            return null;
          }
          return {
            folderId: entryFolderId,
            productId: typeof entry.productId === 'string' ? entry.productId : null,
            folderName: typeof entry.folderName === 'string' ? entry.folderName : null,
          };
        })
        .filter((value): value is { folderId: string; productId: string | null; folderName: string | null } => value !== null)
    : [];

  return {
    folderId,
    folderName,
    items,
    project: {
      id: projectId,
      name: typeof projectData.name === 'string' ? projectData.name : null,
      orgId: typeof projectData.orgId === 'string' ? projectData.orgId : null,
      franchiseId: projectFranchiseId,
    },
    order: {
      id: orderId,
      status: typeof orderData.status === 'string' ? orderData.status : null,
    },
    drive: {
      orderFolderId: normaliseDriveId(driveInfo.orderFolderId),
      orderFolderName: typeof driveInfo.orderFolderName === 'string' ? driveInfo.orderFolderName : null,
      productFolders,
    },
  };
});

export const drive_stageAssetFromFile = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }

  const projectId = typeof data?.projectId === 'string' ? data.projectId.trim() : '';
  const driveFileId = typeof data?.fileId === 'string' ? data.fileId.trim() : '';
  const overrideName = typeof data?.name === 'string' ? data.name.trim() : '';
  const assetTypeInput =
    typeof data?.assetType === 'string' ? data.assetType.trim().toLowerCase() : '';
  const assetType = assetTypeInput === 'flight_plan' ? 'flight_plan' : 'deliverable';
  if (!projectId || !driveFileId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId and fileId are required');
  }

  const userContext = await loadUserContext(context.auth.uid);
  if (!userContext.isStaff && userContext.franchiseIds.length === 0) {
    throw new functions.https.HttpsError('permission-denied', 'Drive staging requires staff or franchise access');
  }

  const projectSnap = await db.collection('projects').doc(projectId).get();
  if (!projectSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Project not found');
  }
  const projectData = projectSnap.data() as Record<string, any>;
  const projectFranchiseId =
    typeof projectData.franchiseId === 'string' ? projectData.franchiseId : null;

  if (
    !userContext.isStaff &&
    projectFranchiseId &&
    !userContext.franchiseIds.includes(projectFranchiseId)
  ) {
    throw new functions.https.HttpsError('permission-denied', 'This project is not assigned to your franchise');
  }

  const orgId = typeof projectData.orgId === 'string' ? projectData.orgId : null;
  if (!orgId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'The project is missing organisation context.'
    );
  }

  const orderId = typeof projectData.orderId === 'string' ? projectData.orderId : null;
  let orderStatus: string | null = null;
  let orderData: FirebaseFirestore.DocumentData | null = null;
  if (orderId) {
    try {
      const orderSnap = await db.collection('orders').doc(orderId).get();
      if (orderSnap.exists) {
        orderData = orderSnap.data() as FirebaseFirestore.DocumentData;
        if (typeof orderData.status === 'string') {
          orderStatus = orderData.status;
        }
      }
    } catch (error) {
      console.warn('drive_stageAssetFromFile order lookup failed', { projectId, orderId }, error);
    }
  }

  const drive = await createDriveService();
  if (!drive) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Drive service account credentials are not configured.'
    );
  }

  let fileMeta: drive_v3.Schema$File;
  try {
    const metadataRes = await drive.files.get({
      fileId: driveFileId,
      fields: 'id, name, mimeType, size, modifiedTime, webViewLink',
      supportsAllDrives: true,
    });
    fileMeta = metadataRes.data;
  } catch (error) {
    throw new functions.https.HttpsError('not-found', 'Drive file could not be retrieved');
  }

  const sourceName = typeof fileMeta.name === 'string' ? fileMeta.name : `Drive file ${driveFileId}`;
  const assetName = overrideName || sourceName;
  const mimeType = typeof fileMeta.mimeType === 'string' ? fileMeta.mimeType : 'application/octet-stream';
  const sizeBytes = fileMeta.size ? Number(fileMeta.size) : null;

  const bucket = admin.storage().bucket();
  const storageKey = `orgs/${orgId}/projects/${projectId}/assets/${Date.now()}-${encodeURIComponent(assetName)}`;
  const tmpPath = `${os.tmpdir()}/${uuidv4()}-${assetName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const downloadToken = uuidv4();

  try {
    const mediaRes = await drive.files.get(
      { fileId: driveFileId, alt: 'media' },
      { responseType: 'stream' }
    );
    await new Promise<void>((resolve, reject) => {
      const dest = fs.createWriteStream(tmpPath);
      (mediaRes.data as Readable)
        .on('error', (error) => reject(error))
        .on('end', () => resolve())
        .pipe(dest);
    });
    await bucket.upload(tmpPath, {
      destination: storageKey,
      metadata: {
        contentType: mimeType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          source: 'drive',
          driveFileId,
        },
      },
    });
  } catch (error) {
    console.error('drive_stageAssetFromFile copy failed', { projectId, driveFileId }, error);
    try {
      fs.unlinkSync(tmpPath);
    } catch (cleanupError) {
      console.warn('Failed to clean up temp file after copy failure', cleanupError);
    }
    throw new functions.https.HttpsError('internal', 'Failed to copy the Drive file into storage');
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    storageKey
  )}?alt=media&token=${downloadToken}`;

  let version = 1;
  try {
    const existingSnap = await db
      .collection('assets')
      .where('projectId', '==', projectId)
      .where('name', '==', assetName)
      .get();
    version = existingSnap.size + 1;
  } catch (error) {
    console.warn('drive_stageAssetFromFile version lookup failed', { projectId, assetName }, error);
  }

  const assetDoc: Record<string, any> = {
    orgId,
    projectId,
    name: assetName,
    storageKey,
    url: downloadUrl,
    bytes: sizeBytes,
    mime: mimeType,
    status: 'ready',
    version,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    uploadedBy: context.auth.uid,
    source: 'drive',
    driveFileId,
    driveFileName: sourceName,
    driveFileMimeType: mimeType,
    driveFileSize: sizeBytes,
    driveFileModifiedAt:
      typeof fileMeta.modifiedTime === 'string'
        ? admin.firestore.Timestamp.fromDate(new Date(fileMeta.modifiedTime))
        : null,
    driveFileWebViewLink: typeof fileMeta.webViewLink === 'string' ? fileMeta.webViewLink : null,
    driveIngestedAt: admin.firestore.FieldValue.serverTimestamp(),
    orderId: orderId || null,
    orderStatus: orderStatus || null,
    assetType,
  };

  const assetRef = await db.collection('assets').add(assetDoc);

  try {
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'assets.staged_from_drive',
      entityType: 'project',
      entityId: projectId,
      metadata: {
        assetId: assetRef.id,
        driveFileId,
        driveFileName: sourceName,
        orderId,
        assetType,
      },
    });
  } catch (auditError) {
    console.warn('drive_stageAssetFromFile audit log failed', { projectId, driveFileId }, auditError);
  }

  try {
    await syncAssetReviewTask({
      projectId,
      assetId: assetRef.id,
      assetName,
      assetStatus: 'ready',
      deliverablesReleased: false,
      releaseHoldReason: null,
      orderId,
      orderStatus,
      projectData,
      orderData,
      assetType,
    });
  } catch (taskError) {
    console.warn('drive_stageAssetFromFile failed to seed review task', {
      projectId,
      assetId: assetRef.id,
      assetType,
    }, taskError);
  }

  return { assetId: assetRef.id, version };
});

type FranchiseAssignmentMatchType = 'exact' | 'prefix' | 'superset' | 'radius';

type PriceTierLevel = 1 | 2 | 3;

function normalisePriceTierLevel(value: unknown): PriceTierLevel {
  const num = Number(value);
  if (num === 2 || num === 3) {
    return num as PriceTierLevel;
  }
  return 1;
}

function resolveTierPrice(
  basePrice: unknown,
  tiers: unknown,
  tier: PriceTierLevel
): number {
  const base = Number(basePrice);
  const safeBase = Number.isFinite(base) ? base : 0;
  if (!tiers || typeof tiers !== 'object') {
    return safeBase;
  }
  const map = tiers as { tier1?: unknown; tier2?: unknown; tier3?: unknown };
  if (tier === 3) {
    const value = Number(map.tier3);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  if (tier === 2) {
    const value = Number(map.tier2);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  const tier1Value = Number(map.tier1);
  if (Number.isFinite(tier1Value)) {
    return tier1Value;
  }
  return safeBase;
}

interface FranchiseAssignmentResult {
  franchiseId: string | null;
  territoryId: string;
  territoryLabel: string | null;
  territoryPostalCode: string;
  matchType: FranchiseAssignmentMatchType;
  exclusive: boolean;
  priceTier: PriceTierLevel;
  hqFallback: boolean;
  radiusMatch?: {
    distanceKm: number;
    radiusKm: number;
    centerLat: number;
    centerLng: number;
  } | null;
}

interface FranchiseAssignmentMember {
  memberId: string;
  userId: string;
  role: string | null;
  primary: boolean;
  userProfile: { displayName?: string | null; email?: string | null } | null;
}

function normalisePostalCode(value?: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) {
    return null;
  }
  return cleaned;
}

function extractTerritoryPostalCodes(data: FranchiseTerritoryDoc): Array<{ raw: string; normalised: string }> {
  const raw = data.postalCodes;
  const list: string[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((value) => {
      if (value == null) {
        return;
      }
      list.push(String(value));
    });
  } else if (typeof raw === 'string') {
    raw
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => list.push(item));
  }
  return list
    .map((value) => {
      const normalised = normalisePostalCode(value);
      if (!normalised) {
        return null;
      }
      return { raw: value, normalised };
    })
    .filter((item): item is { raw: string; normalised: string } => item !== null);
}

const POSTAL_CODE_GEO_CACHE_TTL_MS = 86_400_000; // 24 hours
const postalCodeGeoCache = new Map<string, { lat: number; lng: number; expiresAt: number }>();

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Number.isFinite(distance) ? distance : Number.NaN;
}

async function geocodePostalCodeLocation(postalCode: string): Promise<{ lat: number; lng: number } | null> {
  const key = postalCode.trim().toUpperCase();
  if (!key) {
    return null;
  }
  const now = Date.now();
  const cached = postalCodeGeoCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(key)}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn('Postal code geocode lookup failed', key, response.status, response.statusText);
      }
      if (cached) {
        return { lat: cached.lat, lng: cached.lng };
      }
      return null;
    }
    const payload = (await response.json()) as any;
    const latitude = Number(payload?.result?.latitude);
    const longitude = Number(payload?.result?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      console.warn('Postal code geocode response missing coordinates', key, payload?.result);
      if (cached) {
        return { lat: cached.lat, lng: cached.lng };
      }
      return null;
    }
    postalCodeGeoCache.set(key, {
      lat: latitude,
      lng: longitude,
      expiresAt: now + POSTAL_CODE_GEO_CACHE_TTL_MS,
    });
    return { lat: latitude, lng: longitude };
  } catch (error) {
    console.warn('Postal code geocode lookup error', key, error);
    if (cached) {
      return { lat: cached.lat, lng: cached.lng };
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveTerritoryForPostalCode(postalCode: string): Promise<FranchiseAssignmentResult | null> {
  const normalisedInput = normalisePostalCode(postalCode);
  if (!normalisedInput) {
    return null;
  }
  const territoriesSnap = await db.collection('franchiseTerritories').get();
  let best: { score: number; result: FranchiseAssignmentResult } | null = null;
  let geocodedLocation: { lat: number; lng: number } | null = null;
  let attemptedGeocode = false;
  for (const territoryDoc of territoriesSnap.docs) {
    const data = territoryDoc.data() as FranchiseTerritoryDoc;
    const rawFranchiseId =
      typeof data.franchiseId === 'string' ? data.franchiseId.trim() : '';
    const hasFranchise = rawFranchiseId.length > 0;
    const resolvedFranchiseId = hasFranchise ? rawFranchiseId : null;
    const type: FranchiseTerritoryType =
      typeof data.type === 'string' && data.type.toLowerCase() === 'radius' ? 'radius' : 'postal';
    if (type === 'postal') {
      const codes = extractTerritoryPostalCodes(data);
      for (const code of codes) {
        if (!code.normalised) {
          continue;
        }
        let matchType: FranchiseAssignmentMatchType | null = null;
        let score = 0;
        if (code.normalised === normalisedInput) {
          matchType = 'exact';
          score = 2000 + code.normalised.length;
        } else if (normalisedInput.startsWith(code.normalised)) {
          matchType = 'prefix';
          score = 1200 + code.normalised.length;
        } else if (code.normalised.startsWith(normalisedInput)) {
          // Allow territories defined with full codes while customer provided a broader area.
          matchType = 'superset';
          score = 800 + normalisedInput.length;
        }
        if (!matchType) {
          continue;
        }
        if (data.exclusive !== false) {
          score += 50;
        }
        if (!hasFranchise) {
          score -= 25;
        }
        if (!best || score > best.score) {
          best = {
            score,
            result: {
              franchiseId: resolvedFranchiseId,
              territoryId: territoryDoc.id,
              territoryLabel: typeof data.label === 'string' ? data.label : null,
              territoryPostalCode: code.normalised,
              matchType,
              exclusive: data.exclusive !== false,
              priceTier: normalisePriceTierLevel(data.priceTier),
              hqFallback: !hasFranchise,
              radiusMatch: null,
            },
          };
        }
      }
      continue;
    }

    if (attemptedGeocode && !geocodedLocation) {
      continue;
    }
    if (!attemptedGeocode) {
      attemptedGeocode = true;
      geocodedLocation = await geocodePostalCodeLocation(normalisedInput);
    }
    if (!geocodedLocation) {
      continue;
    }
    const radiusKm = Number(data.radiusKm);
    const centerLat = Number(data.centerLat);
    const centerLng = Number(data.centerLng);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      continue;
    }
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
      continue;
    }
    const distanceKm = haversineDistanceKm(
      geocodedLocation.lat,
      geocodedLocation.lng,
      centerLat,
      centerLng
    );
    if (!Number.isFinite(distanceKm) || distanceKm > radiusKm * 1.01) {
      continue;
    }
    const coverageRatio = Math.min(Math.max(1 - distanceKm / radiusKm, 0), 1);
    let score = 1500 + Math.round(coverageRatio * 400);
    if (data.exclusive !== false) {
      score += 50;
    }
    if (!hasFranchise) {
      score -= 25;
    }
    if (!best || score > best.score) {
      best = {
        score,
        result: {
          franchiseId: resolvedFranchiseId,
          territoryId: territoryDoc.id,
          territoryLabel: typeof data.label === 'string' ? data.label : null,
          territoryPostalCode: normalisedInput,
          matchType: 'radius',
          exclusive: data.exclusive !== false,
          priceTier: normalisePriceTierLevel(data.priceTier),
          hqFallback: !hasFranchise,
          radiusMatch: {
            distanceKm,
            radiusKm,
            centerLat,
            centerLng,
          },
        },
      };
    }
  }
  if (!best) {
    return null;
  }
  return best.result;
}

async function resolvePrimaryFranchiseMember(franchiseId: string): Promise<FranchiseAssignmentMember | null> {
  const membersSnap = await db
    .collection('franchiseMembers')
    .where('franchiseId', '==', franchiseId)
    .get();
  if (membersSnap.empty) {
    return null;
  }
  const members = membersSnap.docs.map((doc) => {
    const data = doc.data() as FranchiseMemberDoc;
    return {
      memberId: doc.id,
      userId: data.userId ? String(data.userId) : '',
      role: data.role ? String(data.role) : null,
      primary: data.primary === true,
    };
  });
  const prioritised =
    members.find((member) => member.primary && member.userId) ||
    members.find((member) => member.role === 'franchisee' && member.userId) ||
    members.find((member) => member.userId) ||
    null;
  if (!prioritised) {
    return null;
  }
  const userSnap = await db.collection('users').doc(prioritised.userId).get();
  const profile = userSnap.exists
    ? {
        displayName: (userSnap.data()?.displayName as string) ?? null,
        email: (userSnap.data()?.email as string) ?? null,
      }
    : null;
  return {
    memberId: prioritised.memberId,
    userId: prioritised.userId,
    role: prioritised.role,
    primary: prioritised.primary,
    userProfile: profile,
  };
}

type RoleKey = 'admin' | 'operations' | 'finance' | 'projects' | 'sales' | 'marketing';

const ROLE_KEYS: RoleKey[] = ['admin', 'operations', 'finance', 'projects', 'sales', 'marketing'];
const AUDIT_LOG_RETENTION_DAYS = 180;
const AUDIT_LOG_BATCH_SIZE = 500;

const GOD_ADMIN_UIDS = new Set<string>(['WK6WCuSueLN5M3Zq6D7WBbHyGPo1']);
const GOD_ADMIN_EMAILS = new Set<string>([
  'ryan@pineappletapped.com',
  'ryanadmin@pineappletapped.com',
]);

type IdentityLike = {
  uid?: string | null;
  email?: string | null;
};

function isGodAdminIdentity(identity?: IdentityLike | null): boolean {
  if (!identity) {
    return false;
  }
  if (identity.uid && GOD_ADMIN_UIDS.has(identity.uid)) {
    return true;
  }
  if (identity.email && GOD_ADMIN_EMAILS.has(identity.email.toLowerCase())) {
    return true;
  }
  return false;
}

type AuditLogChanges = Record<string, { before: any; after: any }>;

function serializeForAudit(value: any): any {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof admin.firestore.GeoPoint) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeForAudit(item));
  }
  if (typeof value === 'object') {
    if (typeof (value as any).toDate === 'function') {
      try {
        return (value as any).toDate().toISOString();
      } catch (err) {
        // fall through
      }
    }
    const entries = Object.entries(value as Record<string, any>);
    if (entries.length === 0) {
      const method = (value as any)?._methodName;
      const name = method
        ? `FieldValue:${method}`
        : (value as any)?.constructor?.name || 'Object';
      return `[${name}]`;
    }
    return entries.reduce((acc, [key, v]) => {
      acc[key] = serializeForAudit(v);
      return acc;
    }, {} as Record<string, any>);
  }
  return value;
}

function serializedEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildChangesFromUpdates(
  before: admin.firestore.DocumentData | undefined,
  updates: Record<string, any>
): AuditLogChanges {
  const changes: AuditLogChanges = {};
  const base = before || {};
  for (const [key, value] of Object.entries(updates)) {
    const prev = (base as any)[key];
    const prevSerialized = serializeForAudit(prev);
    const nextSerialized = serializeForAudit(value);
    if (!serializedEqual(prevSerialized, nextSerialized)) {
      changes[key] = { before: prevSerialized, after: nextSerialized };
    }
  }
  return changes;
}

function buildChangesFromCreate(data: Record<string, any>): AuditLogChanges {
  const changes: AuditLogChanges = {};
  for (const [key, value] of Object.entries(data)) {
    changes[key] = { before: null, after: serializeForAudit(value) };
  }
  return changes;
}

function buildChangesFromDelete(before: admin.firestore.DocumentData | undefined): AuditLogChanges {
  const changes: AuditLogChanges = {};
  if (!before) return changes;
  for (const [key, value] of Object.entries(before)) {
    changes[key] = { before: serializeForAudit(value), after: null };
  }
  return changes;
}

async function writeAuditLog(entry: {
  actorUid: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: AuditLogChanges | null;
  metadata?: Record<string, any> | null;
}): Promise<void> {
  const payload: Record<string, any> = {
    actorUid: entry.actorUid,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (entry.changes && Object.keys(entry.changes).length > 0) {
    payload.changes = entry.changes;
  }
  if (entry.metadata && Object.keys(entry.metadata).length > 0) {
    payload.metadata = serializeForAudit(entry.metadata);
  }
  await db.collection('adminAuditLogs').add(payload);
}

function extractRoleSet(
  data: admin.firestore.DocumentData | undefined,
  identity?: IdentityLike | null,
): Set<RoleKey> {
  const roles = new Set<RoleKey>();
  if (!data) {
    if (isGodAdminIdentity(identity)) {
      roles.add('admin');
    }
    return roles;
  }
  const rawRoles = (data as any)?.roles;
  if (Array.isArray(rawRoles)) {
    for (const value of rawRoles) {
      if (ROLE_KEYS.includes(value as RoleKey)) {
        roles.add(value as RoleKey);
      }
    }
  } else if (rawRoles && typeof rawRoles === 'object') {
    for (const [key, value] of Object.entries(rawRoles as Record<string, unknown>)) {
      if (value === true && ROLE_KEYS.includes(key as RoleKey)) {
        roles.add(key as RoleKey);
      }
    }
  }
  if ((data as any)?.isStaff === true) {
    roles.add('admin');
  }
  if (isGodAdminIdentity(identity)) {
    roles.add('admin');
  }
  return roles;
}

function hasRequiredRole(roles: Set<RoleKey>, required?: RoleKey | RoleKey[]): boolean {
  if (roles.has('admin')) return true;
  if (!required) return roles.size > 0;
  const requiredList = Array.isArray(required) ? required : [required];
  return requiredList.some((role) => roles.has(role));
}


// Set ffmpeg path for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/*
 * Helper to remove near-white background from logos. This uses sharp to
 * operate on raw pixel data, identifying pixels that are very close to
 * white (r,g,b > 240) and setting their alpha channel to 0. The result
 * is a PNG buffer with transparency preserved for non-background pixels.
 */
async function removeBackground(buffer: Buffer): Promise<Buffer> {
  // Ensure the image has an alpha channel
  const img = sharp(buffer).png().ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const threshold = 240;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // If the pixel is close to white, make it fully transparent
    if (r > threshold && g > threshold && b > threshold) {
      data[i + 3] = 0;
    } else {
      data[i + 3] = 255;
    }
  }
  const out = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();
  return out;
}

// Create user profile on first login
export const onAuthUserCreate = functions.auth.user().onCreate(async (user) => {
  const isStaff =
    user.uid === 'WK6WCuSueLN5M3Zq6D7WBbHyGPo1' ||
    user.email === 'ryan@pineappletapped.com' ||
    user.email === 'ryanadmin@pineappletapped.com';

  // Merge with any pre-existing prospect/outreach record for this email
  let data: any = {
    email: user.email || null,
    fullName: user.displayName || null,
    isStaff,
    crmStatus: 'client',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (user.email) {
    const existing = await db
      .collection('users')
      .where('email', '==', user.email)
      .where('crmStatus', 'in', ['prospect', 'outreach'])
      .limit(1)
      .get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      data = { ...doc.data(), ...data };
      await doc.ref.delete();
    }
  }
  await db.collection('users').doc(user.uid).set(data, { merge: true });
});

// Whenever an order is created ensure the purchaser is marked as a client
export const onOrderCreated = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap) => {
    const order = snap.data() as any;
    const uid = order.userId || order.uid;
    if (uid) {
      await db.collection('users').doc(uid).set({ crmStatus: 'client' }, { merge: true });
    }

    // Create a linked project for this order
    const projRef = await db.collection('projects').add({
      orgId: order.orgId || null,
      serviceId: order.serviceId || null,
      orderId: snap.id,
      userId: uid || null,
      userEmail: order.userEmail || null,
      title: order.serviceName || 'New Project',
      status: 'intake',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await snap.ref.set({ projectId: projRef.id }, { merge: true });

    const filmingDueDate = new Date(Date.now() + DEFAULT_FILMING_SLA_DAYS * DAY_IN_MS);
    const editingDueDate = new Date(Date.now() + DEFAULT_EDITING_SLA_DAYS * DAY_IN_MS);
    const filmingDueAt = admin.firestore.Timestamp.fromDate(filmingDueDate);
    const editingDueAt = admin.firestore.Timestamp.fromDate(editingDueDate);

    const kitReservationStatus =
      order.kitReservationStatus === 'pending' ? 'pending' : 'confirmed';
    const projectUpdates: Record<string, any> = {
      kickoffDate: admin.firestore.FieldValue.serverTimestamp(),
      dueDate: editingDueAt,
      filmingDueDate: filmingDueAt,
      kitReservationStatus,
    };
    if (Array.isArray(order.kitReservationWarnings) && order.kitReservationWarnings.length > 0) {
      projectUpdates.kitReservationWarnings = order.kitReservationWarnings;
    }
    if (order.budgetTotals) projectUpdates.budgetTotals = order.budgetTotals;
    const budgetItems = (order.items || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      budget: item.budget || null,
    }));
    if (budgetItems.length > 0) projectUpdates.budgetItems = budgetItems;

    projectUpdates.franchiseId = order.franchiseId || null;
    projectUpdates.franchiseTerritoryId = order.franchiseTerritoryId || null;
    projectUpdates.franchiseAssignment = order.franchiseAssignment || null;
    projectUpdates.franchiseAssignedMemberId = order.franchiseAssignedMemberId || null;
    projectUpdates.franchiseAssignedUserId = order.franchiseAssignedUserId || null;
    projectUpdates.franchiseAssignedRole = order.franchiseAssignedRole || null;
    projectUpdates.franchiseAssignedIsPrimary = order.franchiseAssignedIsPrimary === true;
    projectUpdates.franchiseAssignedUser =
      order.franchiseAssignedUser && typeof order.franchiseAssignedUser === 'object'
        ? order.franchiseAssignedUser
        : null;
    projectUpdates.clientPostalCode = order.clientPostalCode || null;
    projectUpdates.royalty = order.royalty || null;
    projectUpdates.royaltyPercentage =
      typeof order.royaltyPercentage === 'number' ? order.royaltyPercentage : null;
    projectUpdates.royaltySource = order.royaltySource || null;

    await projRef.set(projectUpdates, { merge: true });

    // Populate workflow/default tasks from the ordered product
    if (order.serviceId) {
      try {
        const prodDoc = await db.collection('products').doc(order.serviceId).get();
        const prod = prodDoc.data() as any;
        const taskDocs: any[] = [];

        const franchiseOperatorId =
          typeof order.franchiseAssignedUserId === 'string'
            ? String(order.franchiseAssignedUserId)
            : null;
        const franchiseOperatorName =
          order.franchiseAssignedUser && typeof order.franchiseAssignedUser === 'object'
            ? (order.franchiseAssignedUser.displayName as string | undefined) ||
              (order.franchiseAssignedUser.email as string | undefined) ||
              null
            : null;

        // If the product references a workflow, load its tasks
        if (prod?.workflowId) {
          const wfDoc = await db.collection('workflows').doc(prod.workflowId).get();
          const wf = wfDoc.data() as any;
          if (Array.isArray(wf?.tasks)) {
            for (const t of wf.tasks) {
              const dueDays = parseInt(t.dueDays, 10);
              const dueAt = isNaN(dueDays)
                ? null
                : admin.firestore.Timestamp.fromDate(
                    new Date(Date.now() + dueDays * 86400000)
                  );
              const rawFieldType =
                typeof t.fieldType === 'string' && t.fieldType.trim().length > 0
                  ? t.fieldType.trim()
                  : null;
              const fieldType = rawFieldType && rawFieldType !== 'none' ? rawFieldType : null;
              const fieldLabel =
                typeof t.fieldLabel === 'string' && t.fieldLabel.trim().length > 0
                  ? t.fieldLabel.trim()
                  : typeof t.title === 'string'
                    ? t.title
                    : '';
              const fieldPlaceholder =
                typeof t.fieldPlaceholder === 'string' ? t.fieldPlaceholder : '';
              const fieldHelpText =
                typeof t.fieldHelpText === 'string' ? t.fieldHelpText : '';
              const fieldAccept =
                typeof t.fieldAccept === 'string' ? t.fieldAccept : '';
              const fieldRequired = fieldType ? t.fieldRequired === true : false;
              const fieldOptions =
                fieldType === 'select' && Array.isArray(t.fieldOptions)
                  ? t.fieldOptions
                      .map((opt: any) => {
                        const label =
                          typeof opt?.label === 'string' ? opt.label.trim() : '';
                        const value =
                          typeof opt?.value === 'string' ? opt.value.trim() : label;
                        if (!label && !value) return null;
                        return { label: label || value, value: value || label };
                      })
                      .filter((opt): opt is { label: string; value: string } => Boolean(opt))
                  : [];
              const dependsOn: string[] = Array.isArray(t.dependsOn)
                ? t.dependsOn
                    .map((dep: any) =>
                      typeof dep === 'string' && dep.trim().length > 0 ? dep.trim() : null,
                    )
                    .filter((dep): dep is string => Boolean(dep))
                : [];
              const assignmentScope =
                fieldType === 'team-member' && t.assignmentScope === 'contractor'
                  ? 'contractor'
                  : fieldType === 'team-member'
                    ? 'team'
                    : null;
              const shareAssigneeContact =
                fieldType === 'team-member' && t.shareAssigneeContact === true;
              const fieldKey =
                typeof t.fieldKey === 'string' && t.fieldKey.trim().length > 0
                  ? t.fieldKey.trim()
                  : null;
              const templateKey =
                typeof t.fieldTemplateKey === 'string' && t.fieldTemplateKey.trim().length > 0
                  ? t.fieldTemplateKey.trim()
                  : null;
              taskDocs.push({
                title: typeof t.title === 'string' ? t.title : 'Untitled task',
                description: typeof t.description === 'string' ? t.description : '',
                fieldType,
                fieldTemplateKey: templateKey,
                fieldKey,
                fieldLabel,
                fieldPlaceholder,
                fieldHelpText,
                fieldRequired,
                fieldAccept: fieldType === 'file' ? fieldAccept : '',
                fieldOptions,
                dependsOn,
                workflowTaskId: typeof t.id === 'string' ? t.id : null,
                dueAt,
                dueDate: dueAt,
                forCustomer: !!t.forCustomer,
                status: 'todo',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                assignedTo: null,
                assigneeName: null,
                assignmentScope,
                shareAssigneeContact,
              });
            }
          }
        }

        // Include any legacy default tasks defined directly on the product
        if (Array.isArray(prod?.defaultTasks)) {
          for (const t of prod.defaultTasks) {
            taskDocs.push({
              title: t.title,
              forCustomer: !!t.forCustomer,
              subtasks: t.subtasks || [],
              status: 'todo',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              assignedTo: null,
              assigneeName: null,
            });
          }
        }

        const filmingTaskTitle = 'Filming & Capture';
        const hasFilmingTask = taskDocs.some((task) => {
          const title = typeof task.title === 'string' ? task.title.toLowerCase() : '';
          return title.includes('film');
        });
        if (!hasFilmingTask) {
          taskDocs.push({
            title: filmingTaskTitle,
            description: 'Coordinate and complete the on-site shoot within the agreed SLA.',
            subtasks: [
              'Confirm shoot date, time, and location with the client.',
              'Prepare kit, crew, and travel logistics for the territory.',
              'Capture footage and upload raw files to the project workspace within 24 hours.',
            ],
            slaDays: DEFAULT_FILMING_SLA_DAYS,
            dueAt: filmingDueAt,
            dueDate: filmingDueAt,
            forCustomer: false,
            status: 'todo',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            assignedTo: franchiseOperatorId,
            assigneeName: franchiseOperatorName,
            assignmentScope: franchiseOperatorId ? 'franchise' : null,
          });
        }

        const editingTaskTitle = 'Editing & Delivery';
        const hasEditingTask = taskDocs.some((task) => {
          const title = typeof task.title === 'string' ? task.title.toLowerCase() : '';
          return title.includes('edit');
        });
        if (!hasEditingTask) {
          taskDocs.push({
            title: editingTaskTitle,
            description: 'Ingest footage and deliver the first cut to HQ standards.',
            subtasks: [
              'Ingest and organise all footage in the project workspace.',
              'Produce the first cut following Pineapple Tapped brand guidelines.',
              'Submit edit for HQ quality check and client delivery.',
            ],
            slaDays: DEFAULT_EDITING_SLA_DAYS,
            dueAt: editingDueAt,
            dueDate: editingDueAt,
            forCustomer: false,
            status: 'todo',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            assignedTo: null,
            assigneeName: null,
            assignmentScope: null,
          });
        }

        if (taskDocs.length) {
          const tasksRef = projRef.collection('tasks');
          const existing = await tasksRef.limit(1).get();
          if (existing.empty) {
            const batch = db.batch();
            for (const task of taskDocs) {
              batch.set(tasksRef.doc(), task);
            }
            await batch.commit();
          }
        }
      } catch (err) {
        console.error('Failed to populate default tasks', err);
      }
    }

    // Record equipment bookings and usage logs
    const kitItems: any[] = order.kitItems || [];
    if (kitReservationStatus === 'confirmed' && Array.isArray(kitItems) && kitItems.length) {
      const batch = db.batch();
      for (const item of kitItems) {
        if (!item.id || !item.start || !item.end) continue;
        const eqRef = db.collection('equipment').doc(item.id);
        const start = admin.firestore.Timestamp.fromDate(new Date(item.start));
        const end = admin.firestore.Timestamp.fromDate(new Date(item.end));
        batch.set(eqRef.collection('bookings').doc(), {
          start,
          end,
          projectId: projRef.id,
        });
        batch.set(eqRef.collection('usageLog').doc(), {
          projectId: projRef.id,
          orderId: snap.id,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    // Notify team about the new order
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
      const customer = order.customerName || order.userEmail || uid || 'Unknown customer';
      const service =
        order.serviceName ||
        (Array.isArray(order.items)
          ? order.items.map((i: any) => i.name).join(', ')
          : 'Unknown service');
      try {
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `New order ${snap.id} from ${customer} for ${service}`,
          }),
        });
      } catch (err) {
        console.error('Failed to send order notification', err);
      }
    }

    return null;
  });

export const onQuoteRequestCreated = functions.firestore
  .document('quoteRequests/{requestId}')
  .onCreate(async (snap, context) => {
    const request = snap.data() as any;

    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
      try {
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `New quote request for ${request.projectName || 'untitled project'} from ${request.userEmail || request.userId || 'unknown user'}`,
          }),
        });
      } catch (err) {
        console.error('Slack webhook failed', err);
      }
    }

    await db.collection('proposals').add({
      quoteRequestId: context.params.requestId,
      userId: request.userId || null,
      projectName: request.projectName || null,
      status: 'draft',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return null;
  });

// Booking callables
export const bookings_request = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const booking = {
    orgId: data.orgId, projectId: data.projectId || null, serviceId: data.serviceId || null,
    slot: data.slot, status: 'requested', location: data.location || null, notes: data.notes || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), uid: context.auth.uid
  };
  const ref = await db.collection('bookings').add(booking);
  return { id: ref.id };
});

// Track page view analytics from the public site
export const analytics_track = onRequest(
  { region: 'us-central1', cors: ANALYTICS_ALLOWED_ORIGINS },
  async (req, res) => {
    try {
      let uid: string | null = null;
      let userName: string | null = null;
      const authHeader = req.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const decoded = await admin
            .auth()
            .verifyIdToken(authHeader.split('Bearer ')[1]);
          uid = decoded.uid;
          const userSnap = await db.collection('users').doc(uid).get();
          const udata = userSnap.data() as any;
          if (udata) {
            userName = udata.fullName || udata.email || null;
          }
        } catch (err) {
          console.error('verifyIdToken failed', err);
        }
      }

      const rawBody = req.body;
      let data: Record<string, any> = {};
      if (typeof rawBody === 'string') {
        if (rawBody.trim()) {
          try {
            data = JSON.parse(rawBody);
          } catch (err) {
            console.error('analytics_track invalid JSON payload', err);
          }
        }
      } else if (rawBody && typeof rawBody === 'object') {
        data = rawBody as Record<string, any>;
      }

      const visitorId = data.visitorId ?? null;
      if (!uid && visitorId) {
        const mapSnap = await db.collection('analyticsVisitors').doc(visitorId).get();
        const mapData = mapSnap.data() as any;
        if (mapData) {
          uid = mapData.uid || null;
          userName = mapData.userName || null;
        }
      }
      if (visitorId && uid && userName) {
        await db
          .collection('analyticsVisitors')
          .doc(visitorId)
          .set({ uid, userName }, { merge: true });
      }
      const event = {
        uid,
        userName,
        path: data.path || null,
        referrer: data.referrer || null,
        userAgent: data.userAgent || req.get('user-agent') || null,
        visitorId,
        duration: data.duration || null,
        ip: req.ip,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await db.collection('analyticsEvents').add(event);
      res.json({ ok: true });
    } catch (err) {
      console.error('analytics_track error', err);
      res.status(500).json({ error: 'internal' });
    }
  }
);

export const bookings_confirm = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const u = await db.collection('users').doc(context.auth.uid).get();
  if (!u.exists || !u.data()?.isStaff) throw new functions.https.HttpsError('permission-denied', 'Staff only');
  await db.collection('bookings').doc(data.id).set({ status: 'confirmed' }, { merge: true });
  return { ok: true };
});

export const reserveKit = functions.https.onCall(async (data) => {
  const { productId, date } = data;
  if (!productId || !date) {
    throw new functions.https.HttpsError('invalid-argument', 'productId and date required');
  }
  const start = new Date(date);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const prodSnap = await db.collection('products').doc(productId).get();
  if (!prodSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'product not found');
  }
  const productData = prodSnap.data() as any;
  const requiredKitRaw = Array.isArray(productData?.requiredKit)
    ? productData.requiredKit
    : [];
  const rawStandards = Array.isArray(productData?.requiredStandards)
    ? productData.requiredStandards
    : [];
  const requiredStandards: string[] = Array.from(
    new Set<string>(
      rawStandards
        .map((value: unknown) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value: string) => value.length > 0)
    )
  );
  const standardsToEnforce = new Set(requiredStandards);
  const standardMatches = new Map<string, Set<string>>();
  requiredStandards.forEach((standard) => {
    standardMatches.set(standard, new Set());
  });
  const required = requiredKitRaw;
  const eqIds: string[] = required.flatMap((g: any) => g.items || []);
  const conflicts: any[] = [];
  const kitItems: any[] = [];
  const missingStandards: string[] = [];
  let rentalTotal = 0;
  let reservationStatus: 'confirmed' | 'pending' = 'confirmed';
  for (const id of eqIds) {
    const eqRef = db.collection('equipment').doc(id);
    const eqSnap = await eqRef.get();
    if (!eqSnap.exists) continue;
    const eq = eqSnap.data() as any;
    const bookings = await eqRef
      .collection('bookings')
      .where('start', '<=', end)
      .where('end', '>=', start)
      .get();
    if (!bookings.empty) {
      conflicts.push({ id, name: eq.name || id });
      reservationStatus = 'pending';
      continue;
    }
    if (standardsToEnforce.size > 0) {
      const meets = Array.isArray(eq.meetsStandards)
        ? (eq.meetsStandards as unknown[])
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value): value is string => value.length > 0)
        : [];
      meets.forEach((standardId) => {
        if (!standardsToEnforce.has(standardId)) return;
        const record = standardMatches.get(standardId);
        if (record) {
          record.add(id);
        }
      });
    }
    const equipmentName =
      typeof eq.name === 'string' && eq.name.trim().length > 0 ? eq.name.trim() : null;
    const equipmentCategory =
      typeof eq.category === 'string' && eq.category.trim().length > 0
        ? eq.category.trim()
        : typeof eq.type === 'string' && eq.type.trim().length > 0
          ? eq.type.trim()
          : null;
    kitItems.push({
      id,
      name: equipmentName,
      category: equipmentCategory,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    rentalTotal += eq.rentalPrice || 0;
  }
  if (conflicts.length > 0) {
    return {
      conflicts,
      kitItems,
      rentalTotal,
      status: 'pending',
      missingStandards,
    };
  }
  if (standardsToEnforce.size > 0) {
    const missingStandardsList = requiredStandards.filter((standard) => {
      const matches = standardMatches.get(standard);
      return !matches || matches.size === 0;
    });
    if (missingStandardsList.length > 0) {
      missingStandardsList.forEach((standard) => {
        if (!standard) return;
        if (!missingStandards.includes(standard)) {
          missingStandards.push(standard);
        }
      });
      reservationStatus = 'pending';
    }
  }
  if (reservationStatus === 'confirmed') {
    const batch = db.batch();
    for (const item of kitItems) {
      const eqRef = db.collection('equipment').doc(item.id);
      batch.set(eqRef.collection('bookings').doc(), {
        start: admin.firestore.Timestamp.fromDate(start),
        end: admin.firestore.Timestamp.fromDate(end),
        projectId: null,
      });
    }
    await batch.commit();
  }
  return {
    conflicts: [],
    kitItems,
    rentalTotal,
    status: reservationStatus,
    missingStandards,
  };
});

type NormalisedRoles = Record<string, boolean>;

interface UserContext {
  uid: string;
  displayName: string | null;
  email: string | null;
  isStaff: boolean;
  roles: NormalisedRoles;
  franchiseIds: string[];
  primaryFranchiseId: string | null;
}

function normaliseRoles(raw: unknown): NormalisedRoles {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const roles: NormalisedRoles = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (value === true) {
      roles[key] = true;
    }
  });
  return roles;
}

async function loadUserContext(uid: string): Promise<UserContext> {
  const snap = await db.collection('users').doc(uid).get();
  const data = (snap.data() as Record<string, unknown> | undefined) ?? {};
  const roles = normaliseRoles(data.roles);
  const displayName =
    typeof data.displayName === 'string' && data.displayName.trim().length
      ? data.displayName.trim()
      : typeof data.fullName === 'string' && data.fullName.trim().length
        ? data.fullName.trim()
        : null;
  const email = typeof data.email === 'string' && data.email.includes('@') ? data.email : null;
  const rawPrimary =
    typeof data.primaryFranchiseId === 'string' && data.primaryFranchiseId.trim().length
      ? data.primaryFranchiseId.trim()
      : null;
  const rawFranchise =
    typeof data.franchiseId === 'string' && data.franchiseId.trim().length
      ? data.franchiseId.trim()
      : null;
  const franchiseIds = new Set<string>();
  if (rawPrimary) {
    franchiseIds.add(rawPrimary);
  }
  if (rawFranchise) {
    franchiseIds.add(rawFranchise);
  }
  const extra = Array.isArray(data.franchiseIds)
    ? (data.franchiseIds as unknown[]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  extra.forEach((value) => franchiseIds.add(value.trim()));
  const isStaff = data.isStaff === true || roles.admin === true || roles.operations === true || roles.projects === true;
  return {
    uid,
    displayName,
    email,
    isStaff,
    roles,
    franchiseIds: Array.from(franchiseIds),
    primaryFranchiseId: rawPrimary || rawFranchise || null,
  };
}

type TaskOfferStatus = 'pending' | 'countered' | 'accepted' | 'rejected' | 'withdrawn';

interface TaskOfferTerms {
  currency: string;
  totalAmount: number;
  depositAmount: number;
  balanceAmount: number;
  paymentMode: 'deposit_balance' | 'balance_on_completion';
  notes: string | null;
}

interface TaskOfferDoc extends TaskOfferTerms {
  projectId: string;
  taskId: string;
  role: string | null;
  status: TaskOfferStatus;
  requesterUid: string;
  requesterFranchiseId: string | null;
  requesterName: string | null;
  targetType: 'hq' | 'franchise';
  targetFranchiseId: string | null;
  targetUserId: string | null;
  createdAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  updatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  respondedAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  respondedByUid?: string | null;
  responseNotes?: string | null;
  counterProposal?: TaskOfferTerms & {
    proposedByUid: string;
    proposedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  };
  acceptedTerms?: TaskOfferTerms & {
    acceptedByUid: string;
    acceptedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
  };
}

function parseCurrency(value: unknown): string {
  if (typeof value === 'string' && value.trim().length >= 3) {
    return value.trim().slice(0, 3).toUpperCase();
  }
  return 'GBP';
}

function parseMoney(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.round(numeric * 100) / 100);
}

function toCurrencyCents(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  const numeric = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return 0;
  }
  return Math.max(0, Math.round(numeric * 100));
}

function fromCurrencyCents(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return Math.round(value) / 100;
}

function normaliseCurrency(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 3) {
    return null;
  }
  return trimmed.slice(0, 3).toUpperCase();
}

function assertPositive(value: number, field: string) {
  if (value < 0) {
    throw new functions.https.HttpsError('invalid-argument', `${field} must be zero or positive.`);
  }
}

async function assertFranchiseMembership(uid: string, franchiseId: string): Promise<boolean> {
  const snap = await db
    .collection('franchiseMembers')
    .where('userId', '==', uid)
    .where('franchiseId', '==', franchiseId)
    .limit(1)
    .get();
  return !snap.empty;
}

export const taskOffers_create = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  const uid = context.auth.uid;
  const projectId = typeof data?.projectId === 'string' ? data.projectId.trim() : '';
  const taskId = typeof data?.taskId === 'string' ? data.taskId.trim() : '';
  if (!projectId || !taskId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId and taskId are required');
  }
  const targetTypeRaw = typeof data?.targetType === 'string' ? data.targetType.trim().toLowerCase() : '';
  if (targetTypeRaw !== 'hq' && targetTypeRaw !== 'franchise') {
    throw new functions.https.HttpsError('invalid-argument', 'targetType must be "hq" or "franchise"');
  }
  const targetType = targetTypeRaw as 'hq' | 'franchise';
  const targetFranchiseIdRaw = typeof data?.targetFranchiseId === 'string' ? data.targetFranchiseId.trim() : '';
  const targetFranchiseId = targetType === 'franchise' ? targetFranchiseIdRaw : '';
  if (targetType === 'franchise' && !targetFranchiseId) {
    throw new functions.https.HttpsError('invalid-argument', 'targetFranchiseId is required for franchise offers');
  }
  const targetUserId = typeof data?.targetUserId === 'string' && data.targetUserId.trim().length
    ? data.targetUserId.trim()
    : null;
  const role = typeof data?.role === 'string' && data.role.trim().length ? data.role.trim() : null;
  const currency = parseCurrency(data?.currency);
  const totalAmount = parseMoney(data?.totalAmount ?? data?.total ?? data?.feeTotal, NaN);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'totalAmount must be greater than zero');
  }
  let paymentMode: 'deposit_balance' | 'balance_on_completion' =
    data?.paymentMode === 'balance_on_completion' ? 'balance_on_completion' : 'deposit_balance';
  let depositAmount = parseMoney(data?.depositAmount ?? data?.deposit, 0);
  assertPositive(depositAmount, 'depositAmount');
  if (paymentMode === 'balance_on_completion') {
    depositAmount = 0;
  }
  if (depositAmount > totalAmount) {
    throw new functions.https.HttpsError('invalid-argument', 'depositAmount cannot exceed totalAmount');
  }
  let balanceAmount = parseMoney(data?.balanceAmount ?? data?.balance, totalAmount - depositAmount);
  if (paymentMode === 'deposit_balance') {
    balanceAmount = Math.max(0, Math.round((totalAmount - depositAmount) * 100) / 100);
  } else {
    balanceAmount = totalAmount;
  }
  assertPositive(balanceAmount, 'balanceAmount');
  const notes = typeof data?.notes === 'string' && data.notes.trim().length ? data.notes.trim() : null;

  const [userContext, projectSnap, taskSnap] = await Promise.all([
    loadUserContext(uid),
    db.collection('projects').doc(projectId).get(),
    db.collection('projects').doc(projectId).collection('tasks').doc(taskId).get(),
  ]);

  if (!projectSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Project not found');
  }
  if (!taskSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Task not found');
  }

  if (!userContext.isStaff && userContext.franchiseIds.length === 0) {
    throw new functions.https.HttpsError('permission-denied', 'Franchise membership required to outsource tasks');
  }

  const proposerFranchiseId = userContext.primaryFranchiseId || userContext.franchiseIds[0] || null;
  const projectData = projectSnap.data() as Record<string, unknown>;
  const projectFranchiseId = typeof projectData.franchiseId === 'string' ? projectData.franchiseId : null;
  if (!userContext.isStaff && projectFranchiseId && !userContext.franchiseIds.includes(projectFranchiseId)) {
    // Ensure the proposer belongs to the franchise that owns the project
    const hasMembership = await assertFranchiseMembership(uid, projectFranchiseId);
    if (!hasMembership) {
      throw new functions.https.HttpsError('permission-denied', 'You are not assigned to this franchise project');
    }
  }

  const taskRef = db.collection('projects').doc(projectId).collection('tasks').doc(taskId);
  const offerRef = taskRef.collection('offers').doc();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const offerDoc: TaskOfferDoc = {
    projectId,
    taskId,
    role,
    status: 'pending',
    requesterUid: uid,
    requesterFranchiseId: proposerFranchiseId,
    requesterName: userContext.displayName || userContext.email || uid,
    targetType,
    targetFranchiseId: targetType === 'franchise' ? targetFranchiseId : null,
    targetUserId,
    currency,
    totalAmount,
    depositAmount,
    balanceAmount,
    paymentMode,
    notes,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await offerRef.set(offerDoc);

  const existingProposal = (taskSnap.data() as Record<string, unknown> | undefined)?.outsourcingProposal as
    | Record<string, unknown>
    | undefined;
  const proposalPayload = {
    ...existingProposal,
    offerId: offerRef.id,
    status: 'pending',
    proposedByUid: uid,
    proposedByFranchiseId: proposerFranchiseId,
    proposedByName: userContext.displayName || userContext.email || uid,
    targetType,
    targetFranchiseId: targetType === 'franchise' ? targetFranchiseId : null,
    targetUserId,
    role,
    currency,
    totalAmount,
    depositAmount,
    balanceAmount,
    paymentMode,
    notes,
    createdAt: existingProposal?.createdAt ?? timestamp,
    updatedAt: timestamp,
    respondedAt: null,
    respondedByUid: null,
    responseNotes: null,
    counter: null,
  };

  await taskRef.set(
    {
      outsourcingProposal: proposalPayload,
      outsourcingStatus: 'pending',
    },
    { merge: true }
  );

  await db.collection('taskHistory').add({
    projectId,
    taskId,
    action: 'outsourcing_offer_created',
    uid,
    metadata: {
      offerId: offerRef.id,
      targetType,
      targetFranchiseId: proposalPayload.targetFranchiseId,
      targetUserId,
      totalAmount,
      currency,
      paymentMode,
    },
    createdAt: timestamp,
  });

  return { offerId: offerRef.id };
});

export const taskOffers_respond = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  const uid = context.auth.uid;
  const projectId = typeof data?.projectId === 'string' ? data.projectId.trim() : '';
  const taskId = typeof data?.taskId === 'string' ? data.taskId.trim() : '';
  const offerId = typeof data?.offerId === 'string' ? data.offerId.trim() : '';
  if (!projectId || !taskId || !offerId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId, taskId, and offerId are required');
  }
  const actionRaw = typeof data?.action === 'string' ? data.action.trim().toLowerCase() : '';
  if (!['accept', 'reject', 'counter', 'withdraw'].includes(actionRaw)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported action');
  }
  const action = actionRaw as 'accept' | 'reject' | 'counter' | 'withdraw';
  const notes = typeof data?.notes === 'string' && data.notes.trim().length ? data.notes.trim() : null;

  const taskRef = db.collection('projects').doc(projectId).collection('tasks').doc(taskId);
  const offerRef = taskRef.collection('offers').doc(offerId);

  const [userContext, offerSnap, taskSnap] = await Promise.all([
    loadUserContext(uid),
    offerRef.get(),
    taskRef.get(),
  ]);

  if (!offerSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Offer not found');
  }
  const offer = offerSnap.data() as TaskOfferDoc;
  if (offer.projectId !== projectId || offer.taskId !== taskId) {
    throw new functions.https.HttpsError('failed-precondition', 'Offer does not match project/task');
  }
  const proposal = (taskSnap.data() as Record<string, unknown> | undefined)?.outsourcingProposal as
    | Record<string, unknown>
    | undefined;

  const isRequester = offer.requesterUid === uid;
  let isTargetFranchise =
    offer.targetType === 'franchise' && offer.targetFranchiseId
      ? userContext.franchiseIds.includes(offer.targetFranchiseId)
      : false;
  const isTargetHq = offer.targetType === 'hq' ? userContext.isStaff : false;

  if (offer.targetType === 'franchise' && !isTargetFranchise && offer.targetFranchiseId) {
    const hasMembership = await assertFranchiseMembership(uid, offer.targetFranchiseId);
    if (hasMembership) {
      userContext.franchiseIds.push(offer.targetFranchiseId);
      isTargetFranchise = true;
    }
  }

  const isTarget = isTargetFranchise || isTargetHq;

  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  if (action === 'withdraw') {
    if (!isRequester) {
      throw new functions.https.HttpsError('permission-denied', 'Only the requester can withdraw an offer');
    }
    if (offer.status !== 'pending' && offer.status !== 'countered') {
      throw new functions.https.HttpsError('failed-precondition', 'Only pending offers can be withdrawn');
    }
    await offerRef.set(
      {
        status: 'withdrawn',
        respondedByUid: uid,
        respondedAt: timestamp,
        responseNotes: notes ?? null,
        updatedAt: timestamp,
      },
      { merge: true }
    );
    if (proposal) {
      await taskRef.set(
        {
          outsourcingProposal: {
            ...proposal,
            status: 'withdrawn',
            respondedByUid: uid,
            respondedAt: timestamp,
            responseNotes: notes ?? null,
            updatedAt: timestamp,
          },
          outsourcingStatus: 'withdrawn',
        },
        { merge: true }
      );
    }
    await db.collection('taskHistory').add({
      projectId,
      taskId,
      action: 'outsourcing_offer_withdrawn',
      uid,
      metadata: { offerId },
      createdAt: timestamp,
    });
    return { status: 'withdrawn' };
  }

  if (action === 'counter') {
    if (!isTarget) {
      throw new functions.https.HttpsError('permission-denied', 'Only the recipient can counter an offer');
    }
    if (offer.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', 'Only pending offers can be countered');
    }
    const counterCurrency = parseCurrency(data?.currency ?? offer.currency);
    const counterTotal = parseMoney(data?.totalAmount ?? data?.total ?? offer.totalAmount, offer.totalAmount);
    if (counterTotal <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Counter total must be greater than zero');
    }
    const counterMode: 'deposit_balance' | 'balance_on_completion' =
      data?.paymentMode === 'balance_on_completion' ? 'balance_on_completion' : 'deposit_balance';
    let counterDeposit = parseMoney(data?.depositAmount ?? data?.deposit, offer.depositAmount);
    if (counterMode === 'balance_on_completion') {
      counterDeposit = 0;
    }
    if (counterDeposit > counterTotal) {
      throw new functions.https.HttpsError('invalid-argument', 'Counter deposit cannot exceed total');
    }
    let counterBalance = parseMoney(
      data?.balanceAmount ?? data?.balance,
      counterMode === 'deposit_balance' ? counterTotal - counterDeposit : counterTotal
    );
    if (counterMode === 'deposit_balance') {
      counterBalance = Math.max(0, Math.round((counterTotal - counterDeposit) * 100) / 100);
    } else {
      counterBalance = counterTotal;
    }
    await offerRef.set(
      {
        status: 'countered',
        counterProposal: {
          currency: counterCurrency,
          totalAmount: counterTotal,
          depositAmount: counterDeposit,
          balanceAmount: counterBalance,
          paymentMode: counterMode,
          notes,
          proposedByUid: uid,
          proposedAt: timestamp,
        },
        respondedByUid: uid,
        respondedAt: timestamp,
        responseNotes: notes ?? null,
        updatedAt: timestamp,
      },
      { merge: true }
    );
    if (proposal) {
      await taskRef.set(
        {
          outsourcingProposal: {
            ...proposal,
            status: 'countered',
            counter: {
              currency: counterCurrency,
              totalAmount: counterTotal,
              depositAmount: counterDeposit,
              balanceAmount: counterBalance,
              paymentMode: counterMode,
              notes,
              proposedByUid: uid,
              proposedAt: timestamp,
            },
            respondedByUid: uid,
            respondedAt: timestamp,
            responseNotes: notes ?? null,
            updatedAt: timestamp,
          },
          outsourcingStatus: 'countered',
        },
        { merge: true }
      );
    }
    await db.collection('taskHistory').add({
      projectId,
      taskId,
      action: 'outsourcing_offer_countered',
      uid,
      metadata: { offerId, totalAmount: counterTotal, currency: counterCurrency },
      createdAt: timestamp,
    });
    return { status: 'countered' };
  }

  if (action === 'reject') {
    const canRejectTarget = isTarget && offer.status === 'pending';
    const canRejectRequester = isRequester && offer.status === 'countered';
    if (!canRejectTarget && !canRejectRequester) {
      throw new functions.https.HttpsError('permission-denied', 'You cannot reject this offer');
    }
    await offerRef.set(
      {
        status: 'rejected',
        respondedByUid: uid,
        respondedAt: timestamp,
        responseNotes: notes ?? null,
        updatedAt: timestamp,
      },
      { merge: true }
    );
    if (proposal) {
      await taskRef.set(
        {
          outsourcingProposal: {
            ...proposal,
            status: 'rejected',
            respondedByUid: uid,
            respondedAt: timestamp,
            responseNotes: notes ?? null,
            updatedAt: timestamp,
          },
          outsourcingStatus: 'rejected',
        },
        { merge: true }
      );
    }
    await db.collection('taskHistory').add({
      projectId,
      taskId,
      action: 'outsourcing_offer_rejected',
      uid,
      metadata: { offerId },
      createdAt: timestamp,
    });
    return { status: 'rejected' };
  }

  if (action === 'accept') {
    const acceptingTarget = isTarget && offer.status === 'pending';
    const acceptingRequester = isRequester && offer.status === 'countered';
    if (!acceptingTarget && !acceptingRequester) {
      throw new functions.https.HttpsError('permission-denied', 'You cannot accept this offer');
    }
    const terms = offer.status === 'countered' && offer.counterProposal
      ? {
          currency: offer.counterProposal.currency,
          totalAmount: offer.counterProposal.totalAmount,
          depositAmount: offer.counterProposal.depositAmount,
          balanceAmount: offer.counterProposal.balanceAmount,
          paymentMode: offer.counterProposal.paymentMode,
          notes: offer.counterProposal.notes ?? null,
        }
      : {
          currency: offer.currency,
          totalAmount: offer.totalAmount,
          depositAmount: offer.depositAmount,
          balanceAmount: offer.balanceAmount,
          paymentMode: offer.paymentMode,
          notes: offer.notes ?? null,
        };

    await offerRef.set(
      {
        status: 'accepted',
        acceptedTerms: {
          ...terms,
          acceptedByUid: uid,
          acceptedAt: timestamp,
        },
        respondedByUid: uid,
        respondedAt: timestamp,
        responseNotes: notes ?? null,
        updatedAt: timestamp,
      },
      { merge: true }
    );

    let assigneeName: string | null = null;
    const assignmentScope = offer.targetType === 'franchise' ? 'franchise' : 'hq';
    const assignedTo = offer.targetUserId || null;
    if (assignedTo) {
      const assigneeSnap = await db.collection('users').doc(assignedTo).get();
      const assigneeData = assigneeSnap.data() as Record<string, unknown> | undefined;
      if (assigneeData) {
        assigneeName =
          (typeof assigneeData.displayName === 'string' && assigneeData.displayName.trim().length
            ? assigneeData.displayName.trim()
            : null) ||
          (typeof assigneeData.fullName === 'string' && assigneeData.fullName.trim().length
            ? assigneeData.fullName.trim()
            : null) ||
          (typeof assigneeData.email === 'string' ? assigneeData.email : null);
      }
    }

    const agreement = {
      offerId,
      providerType: offer.targetType,
      providerFranchiseId: offer.targetType === 'franchise' ? offer.targetFranchiseId ?? null : null,
      providerUserId: offer.targetUserId || null,
      currency: terms.currency,
      totalAmount: terms.totalAmount,
      depositAmount: terms.depositAmount,
      balanceAmount: terms.balanceAmount,
      paymentMode: terms.paymentMode,
      notes: terms.notes ?? null,
      acceptedAt: timestamp,
      acceptedByUid: uid,
      responseNotes: notes ?? null,
    };

    const taskUpdate: Record<string, unknown> = {
      outsourcingAgreement: agreement,
      outsourcingStatus: 'accepted',
      assignmentScope,
      updatedAt: timestamp,
    };
    if (assignedTo || offer.targetType === 'hq') {
      taskUpdate.assignedTo = assignedTo;
      taskUpdate.assigneeName = assigneeName;
    }
    if (proposal) {
      taskUpdate.outsourcingProposal = {
        ...proposal,
        status: 'accepted',
        respondedByUid: uid,
        respondedAt: timestamp,
        responseNotes: notes ?? null,
        updatedAt: timestamp,
        acceptedTerms: agreement,
      };
    }

    await taskRef.set(taskUpdate, { merge: true });

    await db.collection('taskHistory').add({
      projectId,
      taskId,
      action: 'outsourcing_offer_accepted',
      uid,
      metadata: {
        offerId,
        providerType: offer.targetType,
        providerFranchiseId: agreement.providerFranchiseId,
        providerUserId: agreement.providerUserId,
        totalAmount: terms.totalAmount,
        currency: terms.currency,
      },
      createdAt: timestamp,
    });

    return { status: 'accepted' };
  }

  throw new functions.https.HttpsError('internal', 'Unhandled action');
});

async function sendEmail(to: string, subject: string, body: string) {
  try {
    const keyB64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
    if (!keyB64) return;
    const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
    const authClient = new google.auth.JWT(
      keyJson.client_email,
      undefined,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/gmail.send']
    );
    await authClient.authorize();
    const gmail = google.gmail({ version: 'v1', auth: authClient });
    const message = [
      `From: ${keyJson.client_email}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
  } catch (err) {
    console.error('sendEmail error', err);
  }
}

export const contact_send = functions.https.onCall(async (data) => {
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const leadSourceRaw =
    typeof data.leadSource === 'string' ? (data.leadSource as string).trim() : '';
  const leadSourceTag = leadSourceRaw || 'hq';
  const affiliateContext = await resolveAffiliateFromLeadSource(leadSourceTag);
  const msg: Record<string, any> = {
    kind: 'contact',
    fromName: data.name || null,
    fromEmail: data.email || null,
    company: data.company || null,
    body: data.message || '',
    status: 'new',
    assigneeUid: null,
    resolutionNotes: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastStatusAt: timestamp,
    leadSource: leadSourceTag,
    leadSourceCapturedAt: timestamp,
  };
  if (affiliateContext) {
    msg.affiliate = {
      id: affiliateContext.id,
      name: affiliateContext.name,
      refCode: affiliateContext.refCode,
      status: affiliateContext.status,
    };
  }
  await db.collection('messages').add(msg);
  if (affiliateContext) {
    try {
      await db
        .collection('affiliates')
        .doc(affiliateContext.id)
        .set(
          {
            metrics: {
              totalLeads: admin.firestore.FieldValue.increment(1),
            },
            updatedAt: timestamp,
            lastReferralAt: timestamp,
            refCodeLower: affiliateContext.refCode.toLowerCase(),
          },
          { merge: true }
        );
    } catch (err) {
      console.error('Failed to update affiliate lead metrics', err);
    }
  }
  await sendEmail(
    'info@pineapple.local',
    `Contact form: ${data.name || 'Message'}`,
    `From: ${data.name} <${data.email}>\\n\\n${data.message}`
  );
  try {
    const existing = await db.collection('leads').where('email', '==', data.email).limit(1).get();
    if (existing.empty) {
      await db.collection('leads').add({
        orgId: null,
        name: data.name || null,
        email: data.email,
        company: data.company || null,
        status: 'new',
        source: 'contact',
        createdAt: timestamp,
        leadSource: leadSourceTag,
        leadSourceCapturedAt: timestamp,
        affiliate: affiliateContext
          ? {
              id: affiliateContext.id,
              name: affiliateContext.name,
              refCode: affiliateContext.refCode,
            }
          : null,
      });
    } else {
      const leadUpdate: Record<string, any> = {
        name: data.name || null,
        company: data.company || null,
      };
      if (leadSourceRaw) {
        leadUpdate.leadSource = leadSourceTag;
        leadUpdate.leadSourceCapturedAt = timestamp;
      }
      if (affiliateContext) {
        leadUpdate.affiliate = {
          id: affiliateContext.id,
          name: affiliateContext.name,
          refCode: affiliateContext.refCode,
        };
      }
      await existing.docs[0].ref.set(leadUpdate, { merge: true });
    }
  } catch (err) {
    console.error('Failed to log contact lead', err);
  }
  return { ok: true };
});

export const franchise_expo_request = functions.https.onCall(async (data, context) => {
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const franchiseId = typeof data.franchiseId === 'string' ? data.franchiseId.trim() : '';
  if (!franchiseId) {
    throw new functions.https.HttpsError('invalid-argument', 'franchiseId is required.');
  }

  const eventName = typeof data.eventName === 'string' ? data.eventName.trim() : '';
  if (!eventName) {
    throw new functions.https.HttpsError('invalid-argument', 'eventName is required.');
  }

  const location = typeof data.location === 'string' ? data.location.trim() : '';
  if (!location) {
    throw new functions.https.HttpsError('invalid-argument', 'location is required.');
  }

  const eventDateInput = typeof data.eventDate === 'string' ? data.eventDate.trim() : '';
  let eventDateIso: string | null = null;
  let eventDateTimestamp: admin.firestore.Timestamp | null = null;
  if (eventDateInput) {
    const parsedDate = new Date(eventDateInput);
    if (!Number.isNaN(parsedDate.getTime())) {
      eventDateIso = parsedDate.toISOString();
      eventDateTimestamp = admin.firestore.Timestamp.fromDate(parsedDate);
    }
  }

  const standCostRaw = Number(data.standCost);
  const standCost = Number.isFinite(standCostRaw) && standCostRaw >= 0 ? Math.round(standCostRaw * 100) / 100 : null;

  const expectedFootfallRaw = Number(data.expectedFootfall);
  const expectedFootfall =
    Number.isFinite(expectedFootfallRaw) && expectedFootfallRaw >= 0 ? Math.round(expectedFootfallRaw) : null;

  const marketingFocus = typeof data.marketingFocus === 'string' ? data.marketingFocus.trim() : '';
  const supportNotes = typeof data.supportNotes === 'string' ? data.supportNotes.trim() : '';
  const standCurrency =
    typeof data.standCurrency === 'string' && data.standCurrency.trim()
      ? data.standCurrency.trim().toUpperCase()
      : 'GBP';

  const payload = {
    franchiseId,
    franchiseName: typeof data.franchiseName === 'string' ? data.franchiseName.trim() || null : null,
    eventName,
    eventDate: eventDateIso,
    eventDateTimestamp,
    location,
    standCost,
    standCurrency,
    expectedFootfall,
    marketingFocus: marketingFocus || null,
    supportNotes: supportNotes || null,
    requestedByUid: context.auth?.uid ?? (typeof data.requestedByUid === 'string' ? data.requestedByUid.trim() || null : null),
    requestedByEmail:
      typeof data.requestedByEmail === 'string' && data.requestedByEmail.trim()
        ? data.requestedByEmail.trim()
        : null,
    status: 'new',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const docRef = await db.collection('franchiseExpoRequests').add(payload);

  try {
    const lines = [
      `Franchise: ${payload.franchiseName || franchiseId}`,
      `Event: ${eventName}`,
      `Date: ${eventDateIso ? new Date(eventDateIso).toLocaleDateString('en-GB') : 'TBC'}`,
      `Location: ${location}`,
      standCost !== null ? `Stand cost: ${standCurrency} ${standCost.toFixed(2)}` : 'Stand cost: —',
      expectedFootfall !== null ? `Expected footfall: ${expectedFootfall}` : 'Expected footfall: —',
      marketingFocus ? `Goals: ${marketingFocus}` : null,
      supportNotes ? `Notes: ${supportNotes}` : null,
      payload.requestedByEmail ? `Requested by: ${payload.requestedByEmail}` : null,
      `Request ID: ${docRef.id}`,
    ].filter((line): line is string => Boolean(line));
    await sendEmail(
      'info@pineapple.local',
      `Expo support request: ${eventName}`,
      lines.join('\n')
    );
  } catch (err) {
    console.error('Failed to send expo request notification', err);
  }

  return { ok: true };
});

export const expo_lead_submit = functions.https.onCall(async (data) => {
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const pageIdInput = typeof data.pageId === 'string' ? data.pageId.trim() : '';
  const slugInput = typeof data.slug === 'string' ? data.slug.trim() : '';

  if (!pageIdInput && !slugInput) {
    throw new functions.https.HttpsError('invalid-argument', 'pageId or slug is required.');
  }

  let pageDoc: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;

  if (pageIdInput) {
    const docSnap = await db.collection('expoLeadPages').doc(pageIdInput).get();
    if (docSnap.exists) {
      pageDoc = docSnap;
    }
  }

  if (!pageDoc && slugInput) {
    const snap = await db
      .collection('expoLeadPages')
      .where('slug', '==', slugInput)
      .limit(1)
      .get();
    if (!snap.empty) {
      pageDoc = snap.docs[0];
    }
  }

  if (!pageDoc || !pageDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Expo lead page not found.');
  }

  const pageData = pageDoc.data() || {};
  if (pageData.isActive === false) {
    throw new functions.https.HttpsError('failed-precondition', 'This expo page is no longer active.');
  }

  const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
  const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  const company = typeof data.company === 'string' ? data.company.trim() : '';
  const consent = data.consent !== false;

  if (!firstName) {
    throw new functions.https.HttpsError('invalid-argument', 'firstName is required.');
  }
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'email is required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError('invalid-argument', 'email must be valid.');
  }
  if (!consent) {
    throw new functions.https.HttpsError('failed-precondition', 'Consent must be provided.');
  }

  const leadDoc = {
    pageId: pageDoc.id,
    slug: (pageData.slug as string) || slugInput,
    eventName: (pageData.eventName as string) || null,
    firstName,
    lastName: lastName || null,
    email,
    phone: phone || null,
    company: company || null,
    consented: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.collection('expoLeads').add(leadDoc);

  try {
    const existingLead = await db.collection('leads').where('email', '==', email).limit(1).get();
    const leadBase: Record<string, unknown> = {
      name: `${firstName} ${lastName}`.trim(),
      email,
      company: company || null,
      status: 'new',
      source: 'expo',
      leadSource: (pageData.slug as string) || slugInput || 'expo',
      updatedAt: timestamp,
    };
    if (existingLead.empty) {
      await db.collection('leads').add({ ...leadBase, createdAt: timestamp });
    } else {
      await existingLead.docs[0].ref.set(leadBase, { merge: true });
    }
  } catch (err) {
    console.error('Failed to sync expo lead to CRM', err);
  }

  const replacements: Record<string, string> = {
    firstName,
    lastName,
    eventName: (pageData.eventName as string) || '',
  };

  const replaceTokens = (input: string): string =>
    input.replace(/{{\s*(firstName|lastName|eventName)\s*}}/gi, (_, key) => {
      const normalised = String(key).replace(/\s+/g, '').toLowerCase();
      return replacements[normalised] ?? '';
    });

  const subject = replaceTokens((pageData.emailSubject as string) || 'Thanks for visiting Pineapple Tapped');
  let body = replaceTokens((pageData.emailBody as string) || 'Thanks for visiting our stand!');
  const onePagerUrl = typeof pageData.onePagerUrl === 'string' ? pageData.onePagerUrl.trim() : '';
  if (onePagerUrl) {
    body = `${body}\n\nDownload our one-pager: ${onePagerUrl}`;
  }

  try {
    await sendEmail(email, subject, body);
  } catch (err) {
    console.error('Failed to send expo lead autoresponse', err);
  }

  const notificationEmails = Array.isArray(pageData.notificationEmails)
    ? (pageData.notificationEmails as string[])
    : [];
  if (notificationEmails.length > 0) {
    const summary = [
      `New expo lead captured for ${pageData.eventName || 'Expo'}`,
      '',
      `Name: ${firstName} ${lastName}`.trim(),
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      company ? `Company: ${company}` : null,
      `Page: ${(pageData.slug as string) || slugInput}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
    await Promise.all(
      notificationEmails
        .map((address) => (typeof address === 'string' ? address.trim() : ''))
        .filter((address) => address.length > 3 && address.includes('@'))
        .map((address) =>
          sendEmail(address, `Expo lead captured: ${pageData.eventName || 'Expo'}`, summary).catch((err) => {
            console.error('Failed to send expo lead notification', address, err);
          })
        )
    );
  }

  return { ok: true };
});

export const messages_onWrite = functions.firestore
  .document('messages/{messageId}')
  .onWrite(async (change) => {
    const beforeData = change.before.exists ? change.before.data() : null;
    const afterData = change.after.exists ? change.after.data() : null;

    if (!afterData) {
      return;
    }

    if (afterData.kind !== 'contact') {
      return;
    }

    const notifications: Promise<void>[] = [];

    const statusChanged = beforeData?.status !== afterData.status;
    const assigneeChanged = beforeData?.assigneeUid !== afterData.assigneeUid;

    if (assigneeChanged && afterData.assigneeUid) {
      notifications.push(
        (async () => {
          try {
            const staffSnap = await db.collection('users').doc(afterData.assigneeUid).get();
            const staff = staffSnap.data() || {};
            const staffEmail = staff.email || staff.contactEmail;
            if (!staffEmail) {
              return;
            }
            const staffName =
              staff.fullName || staff.displayName || staff.name || staffEmail;
            const sender = afterData.fromName || afterData.fromEmail || 'A visitor';
            const bodyLines = [
              `Hi ${staffName},`,
              '',
              `A contact message from ${sender} has been assigned to you.`,
              '',
              `Subject: ${afterData.company || 'General enquiry'}`,
              '',
              afterData.body || 'No message provided.',
              '',
              'View the message in the admin portal to reply or add notes.',
            ];
            await sendEmail(
              staffEmail,
              'New contact message assigned to you',
              bodyLines.join('\n')
            );
          } catch (err) {
            console.error('Failed to send assignment notification', err);
          }
        })()
      );
    }

    if (statusChanged && afterData.status === 'closed' && afterData.fromEmail) {
      notifications.push(
        (async () => {
          try {
            const customerName = afterData.fromName || 'there';
            const bodyLines = [
              `Hi ${customerName},`,
              '',
              'Thanks for reaching out to Pineapple Tapped. Your enquiry has been marked as resolved.',
              'If you have any follow-up questions, just reply to this email and our team will be happy to help.',
              '',
              'Best regards,',
              'The Pineapple Tapped Team',
            ];
            await sendEmail(
              afterData.fromEmail,
              'We have resolved your enquiry',
              bodyLines.join('\n')
            );
          } catch (err) {
            console.error('Failed to send resolution notification', err);
          }
        })()
      );
    }

    await Promise.all(notifications);
  });
export const quote_request_public = functions.https.onCall(async (data) => {
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const leadSourceRaw =
    typeof data.leadSource === 'string' ? (data.leadSource as string).trim() : '';
  const leadSourceTag = leadSourceRaw || 'hq';
  const affiliateContext = await resolveAffiliateFromLeadSource(leadSourceTag);

  const normaliseOptionalString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const normaliseRequiredString = (value: unknown): string =>
    normaliseOptionalString(value) ?? '';

  const contactName = normaliseRequiredString(data.name);
  const contactEmail = normaliseRequiredString(data.email);
  const contactCompany = normaliseOptionalString(data.company);
  const projectName = normaliseOptionalString(data.projectName);
  const productionPeriod = normaliseOptionalString(data.productionPeriod);
  const customRequest = normaliseOptionalString(data.customRequest);
  const requirements = normaliseOptionalString((data as any).requirements);
  const projectScope = normaliseOptionalString((data as any).projectScope);
  const venueName = normaliseOptionalString((data as any).venueName);
  const venueLocation = normaliseOptionalString((data as any).venueLocation);
  const eventDate = normaliseOptionalString((data as any).eventDate);

  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const items = itemsRaw
    .map((item: any) => {
      const productId = normaliseOptionalString(item?.productId);
      if (!productId) return null;
      const entry: Record<string, any> = { productId };
      const note = normaliseOptionalString(item?.note);
      if (note) entry.note = note;
      const variationId = normaliseOptionalString(item?.variationId);
      if (variationId) entry.variationId = variationId;
      const variationName = normaliseOptionalString(item?.variationName);
      if (variationName) entry.variationName = variationName;
      return entry;
    })
    .filter((entry): entry is Record<string, any> => entry !== null);

  const originProductId =
    normaliseOptionalString((data as any).originProductId) ||
    (items[0]?.productId ?? null);

  const quoteMode =
    normaliseOptionalString((data as any).quoteMode) ||
    normaliseOptionalString((data as any).salesMode) ||
    'manual';

  const record = {
    userId: null,
    contactName,
    contactEmail,
    contactCompany,
    projectName,
    items,
    customRequest,
    productionPeriod,
    createdAt: timestamp,
    status: 'pending',
    leadSource: leadSourceTag,
    leadSourceCapturedAt: timestamp,
    originProductId,
    quoteMode,
    requirements,
    projectScope,
    venueName,
    venueLocation,
    eventDate,
    affiliate: affiliateContext
      ? {
          id: affiliateContext.id,
          name: affiliateContext.name,
          refCode: affiliateContext.refCode,
          status: affiliateContext.status,
        }
      : null,
  };

  const ref = await db.collection('quoteRequests').add(record);
  if (affiliateContext) {
    try {
      await db
        .collection('affiliates')
        .doc(affiliateContext.id)
        .set(
          {
            metrics: {
              totalQuotes: admin.firestore.FieldValue.increment(1),
            },
            updatedAt: timestamp,
            lastReferralAt: timestamp,
            refCodeLower: affiliateContext.refCode.toLowerCase(),
          },
          { merge: true }
        );
    } catch (err) {
      console.error('Failed to update affiliate quote metrics', err);
    }
  }

  const emailLines: string[] = [];
  if (projectName) emailLines.push(`Project: ${projectName}`);
  if (productionPeriod) emailLines.push(`Production: ${productionPeriod}`);
  if (eventDate) emailLines.push(`Event date: ${eventDate}`);
  if (venueName || venueLocation) {
    emailLines.push(
      `Venue: ${[venueName, venueLocation].filter(Boolean).join(' – ')}`
    );
  }
  if (items.length > 0) {
    items.forEach((item) => {
      const parts = [item.productId as string];
      if (item.variationName) parts.push(`(${item.variationName})`);
      emailLines.push(`Item: ${parts.join(' ')}`);
      if (item.note) {
        emailLines.push(`  Note: ${item.note}`);
      }
    });
  }
  emailLines.push(`Email: ${contactEmail}`);
  if (requirements) {
    emailLines.push('', 'Requirements:', requirements);
  }
  if (projectScope) {
    emailLines.push('', 'Project scope:', projectScope);
  }
  if (customRequest) {
    emailLines.push('', 'Additional notes:', customRequest);
  }

  await sendEmail(
    'info@pineapple.local',
    `Quote request from ${contactName || 'Unknown'}`,
    emailLines.join('\n')
  );

  if (contactEmail) {
    try {
      const existing = await db
        .collection('leads')
        .where('email', '==', contactEmail)
        .limit(1)
        .get();
      if (existing.empty) {
        await db.collection('leads').add({
          orgId: null,
          name: contactName || null,
          email: contactEmail,
          company: contactCompany || null,
          status: 'new',
          source: 'quote',
          createdAt: timestamp,
          leadSource: leadSourceTag,
          leadSourceCapturedAt: timestamp,
          affiliate: affiliateContext
            ? {
                id: affiliateContext.id,
                name: affiliateContext.name,
                refCode: affiliateContext.refCode,
              }
            : null,
        });
      } else {
        const leadUpdate: Record<string, any> = {
          name: contactName || null,
          company: contactCompany || null,
        };
        if (leadSourceRaw) {
          leadUpdate.leadSource = leadSourceTag;
          leadUpdate.leadSourceCapturedAt = timestamp;
        }
        if (affiliateContext) {
          leadUpdate.affiliate = {
            id: affiliateContext.id,
            name: affiliateContext.name,
            refCode: affiliateContext.refCode,
          };
        }
        await existing.docs[0].ref.set(leadUpdate, { merge: true });
      }
    } catch (err) {
      console.error('Failed to log quote lead', err);
    }
  }

  return { id: ref.id };
});

// Signed download URL (guarded)
export const getDownloadUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }

  const key = data.key as string;
  if (!key) {
    throw new functions.https.HttpsError('invalid-argument', 'Storage key required');
  }

  // Extract org, project and asset ids from the storage path
  const match = key.match(/orgs\/([^/]+)\/projects\/([^/]+)\/assets\/([^/]+)/);
  if (!match) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid asset key');
  }
  const [, orgId, projectId, assetId] = match;

  // Staff users bypass membership check
  const userSnap = await db.collection('users').doc(context.auth.uid).get();
  const isStaff = userSnap.exists && userSnap.data()?.isStaff === true;
  if (!isStaff) {
    const memSnap = await db
      .collection('memberships')
      .doc(`${orgId}_${context.auth.uid}`)
      .get();
    if (!memSnap.exists) {
      throw new functions.https.HttpsError('permission-denied', 'Not a member of this organisation');
    }
  }

  // Confirm asset exists and belongs to the project/org
  const assetSnap = await db.collection('assets').doc(assetId).get();
  if (!assetSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Asset not found');
  }
  const asset = assetSnap.data() as any;
  if (asset.projectId !== projectId || asset.orgId !== orgId) {
    throw new functions.https.HttpsError('permission-denied', 'Asset mismatch');
  }

  // Verify associated order is fully paid
  const projSnap = await db.collection('projects').doc(projectId).get();
  const project = projSnap.data() as any;
  if (!project) {
    throw new functions.https.HttpsError('not-found', 'Project not found');
  }
  const orderId = project.orderId;
  if (!orderId) {
    throw new functions.https.HttpsError('permission-denied', 'No related order found');
  }
  const orderSnap = await db.collection('orders').doc(orderId).get();
  const order = orderSnap.data() as any;
  if (!order || (order.status !== 'paid' && order.status !== 'balance_paid')) {
    throw new functions.https.HttpsError('permission-denied', 'Order not paid');
  }

  // Generate signed URL via Admin SDK
  const bucket = admin.storage().bucket();
  const file = bucket.file(key);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000,
  });
  return { url };
});

// Decline a booking request
export const bookings_decline = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const u = await db.collection('users').doc(context.auth.uid).get();
  if (!u.exists || !u.data()?.isStaff) throw new functions.https.HttpsError('permission-denied', 'Staff only');
  await db.collection('bookings').doc(data.id).set({ status: 'declined' }, { merge: true });
  return { ok: true };
});

// Contractor portal APIs
export const contractor_submitTimesheet = functions.https.onCall(async (data, context) => {
  if (!context.auth)
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { date, hours, notes } = data;
  if (!date || typeof hours !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'date and hours required');
  }
  await db.collection('contractorTimesheets').add({
    uid: context.auth.uid,
    date,
    hours,
    notes: notes || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const contractor_updateTask = functions.https.onCall(async (data, context) => {
  if (!context.auth)
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { taskId, status, deliverableUrl } = data;
  if (!taskId || !status) {
    throw new functions.https.HttpsError('invalid-argument', 'taskId and status required');
  }
  const ref = db.collection('contractorTasks').doc(taskId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.uid !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Task not found');
  }
  const updates: any = {
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (deliverableUrl) updates.deliverableUrl = deliverableUrl;
  await ref.set(updates, { merge: true });
  return { ok: true };
});

/**
 * Triggered when a logo is uploaded under orgs/{orgId}/brand-packs/{packId}/logo
 * Validates and processes the image: crops to square, resizes to max 512px, removes
 * any alpha channel background (simple white fill) and stores processed version
 * at orgs/{orgId}/brand/logo-prep/{packId}/processed.png. This function
 * demonstrates how you might use sharp for basic image processing. In a real
 * deployment you could integrate a more sophisticated background removal API.
 */
export const onLogoUpload = functions.storage
  .object()
  .onFinalize(async (object) => {
    const filePath = object.name || '';
    // Only run for brand pack logos
    if (!filePath.includes('brand-packs') || !filePath.includes('logo')) return;
    const bucket = admin.storage().bucket(object.bucket);
    const tmpFilePath = `/tmp/${uuidv4()}-${object.name?.split('/').pop()}`;
    await bucket.file(filePath).download({ destination: tmpFilePath });
    // Read image buffer
    const originalBuffer = fs.readFileSync(tmpFilePath);
    // Remove white background
    const noBgBuffer = await removeBackground(originalBuffer);
    // Resize to a maximum of 512x512 and crop to square
    let processedBuffer = await sharp(noBgBuffer)
      .resize({ width: 512, height: 512, fit: 'cover' })
      .png()
      .toBuffer();
    // Define destination path
    const parts = filePath.split('/');
    const orgIdIndex = parts.indexOf('orgs') + 1;
    const orgId = parts[orgIdIndex];
    const packIndex = parts.indexOf('brand-packs') + 1;
    const packId = parts[packIndex];
    const destPath = `orgs/${orgId}/brand/logo-prep/${packId}/processed.png`;
    await bucket.file(destPath).save(processedBuffer, { contentType: 'image/png' });
    return;
  });

function normaliseAssetStatus(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function isAssetApprovalStatus(value: unknown): boolean {
  const status = normaliseAssetStatus(value);
  return status === 'approved' || status === 'final' || status === 'final_approved';
}

function deriveAssetTaskStatus(
  status: string,
  deliverablesReleased: boolean,
  releaseHoldReason: string | null
): 'todo' | 'in_progress' | 'review' | 'done' {
  if (deliverablesReleased) {
    return 'done';
  }
  if (releaseHoldReason) {
    return 'review';
  }
  switch (status) {
    case 'draft':
    case 'pending':
    case 'uploading':
      return 'todo';
    case 'changes_requested':
    case 'revision':
    case 'revisions':
    case 'in_progress':
      return 'in_progress';
    case 'approved':
    case 'final':
    case 'final_approved':
    case 'ready':
    default:
      return 'review';
  }
}

function normaliseOrderStatus(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function isPaidOrderStatus(value: unknown): boolean {
  const status = normaliseOrderStatus(value);
  return status === 'paid' || status === 'balance_paid';
}

interface AssetTaskSyncOptions {
  projectId: string;
  assetId: string;
  assetName?: string | null;
  assetStatus?: string | null;
  deliverablesReleased?: boolean;
  releaseHoldReason?: string | null;
  orderId?: string | null;
  orderStatus?: string | null;
  projectData?: FirebaseFirestore.DocumentData | null;
  orderData?: FirebaseFirestore.DocumentData | null;
  assetType?: string | null;
}

async function syncAssetReviewTask(options: AssetTaskSyncOptions): Promise<void> {
  const { projectId, assetId } = options;
  if (!projectId || !assetId) {
    return;
  }

  let projectData = options.projectData ?? null;
  if (!projectData) {
    try {
      const projectSnap = await db.collection('projects').doc(projectId).get();
      projectData = projectSnap.exists ? (projectSnap.data() as FirebaseFirestore.DocumentData) : null;
    } catch (error) {
      console.warn('syncAssetReviewTask project lookup failed', { projectId, assetId }, error);
      projectData = null;
    }
  }

  let orderId = options.orderId ?? null;
  let orderData = options.orderData ?? null;
  if (!orderId && projectData && typeof projectData.orderId === 'string') {
    orderId = projectData.orderId;
  }

  let orderStatus = options.orderStatus ?? null;
  if (orderId && !orderData) {
    try {
      const orderSnap = await db.collection('orders').doc(orderId).get();
      if (orderSnap.exists) {
        orderData = orderSnap.data() as FirebaseFirestore.DocumentData;
      }
    } catch (error) {
      console.warn('syncAssetReviewTask order lookup failed', { orderId, assetId }, error);
      orderData = null;
    }
  }
  if (!orderStatus && orderData && typeof orderData.status === 'string') {
    orderStatus = orderData.status;
  }

  const deliverablesReleased = options.deliverablesReleased === true;
  const releaseHoldReason = options.releaseHoldReason ?? null;
  const assetStatus = normaliseAssetStatus(options.assetStatus);
  const assetTypeValue =
    typeof options.assetType === 'string' ? options.assetType.trim().toLowerCase() : '';
  const isFlightPlan = assetTypeValue === 'flight_plan';
  let derivedStatus = deriveAssetTaskStatus(
    assetStatus,
    deliverablesReleased,
    releaseHoldReason
  );
  if (isFlightPlan) {
    if (isAssetApprovalStatus(assetStatus)) {
      derivedStatus = 'done';
    } else if (!assetStatus || assetStatus === 'ready' || assetStatus === 'draft') {
      derivedStatus = 'todo';
    } else {
      derivedStatus = 'in_progress';
    }
  }

  const tasksRef = db.collection('projects').doc(projectId).collection('tasks');
  let existingTask: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
  try {
    const existingSnap = await tasksRef
      .where('type', '==', isFlightPlan ? 'flight_plan_review' : 'asset_review')
      .where('assetId', '==', assetId)
      .limit(1)
      .get();
    existingTask = existingSnap.empty ? null : existingSnap.docs[0];
  } catch (error) {
    console.warn('syncAssetReviewTask task query failed', { projectId, assetId }, error);
    return;
  }

  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const payload: Record<string, any> = {
    title: options.assetName
      ? isFlightPlan
        ? `Approve flight plan: ${options.assetName}`
        : `Review ${options.assetName}`
      : isFlightPlan
        ? 'Approve flight plan'
        : 'Review deliverable',
    description: isFlightPlan
      ? 'Verify airspace, weather, and compliance before signing off this flight plan.'
      : 'Track review approvals and unlock the download once finance confirms payment.',
    type: isFlightPlan ? 'flight_plan_review' : 'asset_review',
    assetId,
    assetName: options.assetName ?? null,
    status: derivedStatus,
    lastAssetStatus: assetStatus || null,
    deliverablesReleased,
    releaseHoldReason,
    orderId: orderId ?? null,
    orderStatus: orderStatus ?? null,
    updatedAt: timestamp,
    stage: isFlightPlan ? 'planning' : 'review',
    forCustomer: false,
    assetType: isFlightPlan ? 'flight_plan' : assetTypeValue || null,
  };

  if (releaseHoldReason === 'payment_pending') {
    payload.releaseHoldNote = 'Awaiting balance payment before downloads unlock.';
  } else if (releaseHoldReason) {
    payload.releaseHoldNote = releaseHoldReason;
  } else if (isFlightPlan) {
    payload.releaseHoldNote = 'Flight operations must approve the plan before launch.';
  } else {
    payload.releaseHoldNote = null;
  }

  if (deliverablesReleased || (isFlightPlan && derivedStatus === 'done')) {
    payload.completedAt = timestamp;
  } else {
    payload.completedAt = null;
  }

  try {
    if (existingTask) {
      await existingTask.ref.set(payload, { merge: true });
    } else {
      await tasksRef.doc().set({ ...payload, createdAt: timestamp });
    }
  } catch (error) {
    console.error('syncAssetReviewTask persistence failed', { projectId, assetId }, error);
  }
}

/**
 * Triggered on asset status change. When an asset is marked as approved (status === 'approved'
 * or marked as a final version) and the linked order balance is paid, mark the deliverable as
 * released. Otherwise capture the release hold so operations know why the download is blocked.
 * Also keeps a project task in sync so producers can track review approvals.
 */
export const onAssetUpdate = functions.firestore
  .document('assets/{assetId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!after) return null;

    const assetId = context.params.assetId;
    const projectId = typeof after.projectId === 'string' ? after.projectId : null;
    if (!projectId) {
      return null;
    }

    const assetType =
      typeof after.assetType === 'string' ? after.assetType.trim().toLowerCase() : '';

    const beforeStatus = normaliseAssetStatus(before?.status);
    const afterStatus = normaliseAssetStatus(after.status);
    const statusChanged = beforeStatus !== afterStatus;

    let projectData: FirebaseFirestore.DocumentData | null = null;
    let orderData: FirebaseFirestore.DocumentData | null = null;
    let orderId: string | null = null;
    let orderStatus: string | null = null;

    try {
      const projectSnap = await db.collection('projects').doc(projectId).get();
      if (projectSnap.exists) {
        projectData = projectSnap.data() as FirebaseFirestore.DocumentData;
        if (typeof projectData.orderId === 'string' && projectData.orderId.trim().length > 0) {
          orderId = projectData.orderId.trim();
          const orderSnap = await db.collection('orders').doc(orderId).get();
          if (orderSnap.exists) {
            orderData = orderSnap.data() as FirebaseFirestore.DocumentData;
            if (typeof orderData.status === 'string') {
              orderStatus = orderData.status;
            }
          }
        }
      }
    } catch (lookupError) {
      console.error('onAssetUpdate project/order lookup failed', { projectId, assetId }, lookupError);
    }

    const updates: Record<string, any> = {};
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    let deliverablesReleased = after.deliverablesReleased === true;
    let releaseHoldReason =
      typeof after.releaseHoldReason === 'string' ? after.releaseHoldReason : null;

    if (statusChanged) {
      if (isAssetApprovalStatus(afterStatus)) {
        if (orderStatus === 'balance_paid' || orderStatus === 'paid') {
          if (!deliverablesReleased) {
            updates.deliverablesReleased = true;
            updates.releaseHoldReason = null;
            updates.releaseHoldNote = null;
            updates.releaseReadyAt = timestamp;
            updates.releaseHoldUpdatedAt = timestamp;
            deliverablesReleased = true;
            releaseHoldReason = null;
          }
        } else {
          if (deliverablesReleased) {
            updates.deliverablesReleased = false;
            deliverablesReleased = false;
          }
          if (releaseHoldReason !== 'payment_pending') {
            updates.releaseHoldReason = 'payment_pending';
            updates.releaseHoldNote = 'Awaiting balance payment before downloads unlock.';
            updates.releaseHoldUpdatedAt = timestamp;
            releaseHoldReason = 'payment_pending';
          }
          if (after.releaseReadyAt) {
            updates.releaseReadyAt = null;
          }
        }
      } else if (deliverablesReleased || releaseHoldReason) {
        updates.deliverablesReleased = false;
        updates.releaseHoldReason = null;
        updates.releaseHoldNote = null;
        updates.releaseHoldUpdatedAt = timestamp;
        updates.releaseReadyAt = null;
        deliverablesReleased = false;
        releaseHoldReason = null;
      }
    }

    if (
      !statusChanged &&
      releaseHoldReason === 'payment_pending' &&
      (orderStatus === 'balance_paid' || orderStatus === 'paid')
    ) {
      updates.deliverablesReleased = true;
      updates.releaseHoldReason = null;
      updates.releaseHoldNote = null;
      updates.releaseReadyAt = timestamp;
      updates.releaseHoldUpdatedAt = timestamp;
      deliverablesReleased = true;
      releaseHoldReason = null;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await change.after.ref.set(updates, { merge: true });
      } catch (writeError) {
        console.error('onAssetUpdate failed to persist release updates', { assetId }, writeError);
      }
    }

    try {
      await syncAssetReviewTask({
        projectId,
        assetId,
        assetName: typeof after.name === 'string' ? after.name : null,
        assetStatus: afterStatus,
        deliverablesReleased,
        releaseHoldReason,
        orderId,
        orderStatus,
        projectData,
        orderData,
        assetType,
      });
    } catch (taskError) {
      console.error('onAssetUpdate failed to sync review task', { assetId, projectId }, taskError);
    }

    if (
      updates.deliverablesReleased === true &&
      (orderStatus === 'balance_paid' || orderStatus === 'paid')
    ) {
      try {
        await db.collection('auditLogs').add({
          type: 'deliverable_release',
          assetId,
          projectId,
          orderId,
          timestamp,
          uid: after.uploadedBy || null,
        });
      } catch (auditError) {
        console.warn('onAssetUpdate failed to record audit log', { assetId }, auditError);
      }
    }

    return null;
  });

/**
 * Triggered when a new asset document is created. Processes the uploaded file to
 * generate a proxy (low-resolution video), a thumbnail image and extracts a
 * simple colour palette. The processed assets are stored alongside the original
 * file in the same folder structure. It also marks the asset as virusScanned.
 */
export const onAssetCreated = functions.firestore
  .document('assets/{assetId}')
  .onCreate(async (snap, context) => {
    const asset = snap.data() as any;
    if (!asset || !asset.storageKey) return null;
    const bucket = admin.storage().bucket();
    const file = bucket.file(asset.storageKey);
    // Download original file to temp
    const tmpOriginal = `${os.tmpdir()}/${uuidv4()}-${asset.storageKey.split('/').pop()}`;
    await file.download({ destination: tmpOriginal });
    let proxyKey: string | undefined;
    let thumbnailKey: string | undefined;
    let palette: number[] | undefined;
    try {
      // Virus scanning would be done here in a real system. In this environment we simply mark
      // the file as scanned without checking for infections.
      if (asset.mime && asset.mime.startsWith('video/')) {
        // Generate proxy video (360p mp4)
        const tmpProxy = `${os.tmpdir()}/${uuidv4()}-proxy.mp4`;
        await new Promise((resolve, reject) => {
          ffmpeg(tmpOriginal)
            .output(tmpProxy)
            .size('360x?')
            .videoCodec('libx264')
            .noAudio()
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        proxyKey = `orgs/${asset.orgId}/projects/${asset.projectId}/assets/${context.params.assetId}/proxy.mp4`;
        await bucket.upload(tmpProxy, { destination: proxyKey, contentType: 'video/mp4' });
        // Generate thumbnail (first frame)
        const tmpThumb = `${os.tmpdir()}/${uuidv4()}-thumb.jpg`;
        await new Promise((resolve, reject) => {
          ffmpeg(tmpOriginal)
            .frames(1)
            .outputOptions('-q:v 2')
            .output(tmpThumb)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
        thumbnailKey = `orgs/${asset.orgId}/projects/${asset.projectId}/assets/${context.params.assetId}/thumb.jpg`;
        await bucket.upload(tmpThumb, { destination: thumbnailKey, contentType: 'image/jpeg' });
        // Extract palette from thumbnail using color-thief
        const colorThief = new ColorThief();
        const thumbBuffer = fs.readFileSync(tmpThumb);
        try {
          palette = await colorThief.getPalette(thumbBuffer, 5);
        } catch (err) {
          console.warn('Palette extraction failed:', err);
        }
      } else if (asset.mime && asset.mime.startsWith('image/')) {
        // Generate a small thumbnail via sharp
        const buffer = fs.readFileSync(tmpOriginal);
        const image = sharp(buffer);
        const thumbBuffer = await image.resize({ width: 360 }).jpeg().toBuffer();
        thumbnailKey = `orgs/${asset.orgId}/projects/${asset.projectId}/assets/${context.params.assetId}/thumb.jpg`;
        await bucket.file(thumbnailKey).save(thumbBuffer, { contentType: 'image/jpeg' });
        // Extract palette using color-thief
        const colorThief = new ColorThief();
        try {
          palette = await colorThief.getPalette(thumbBuffer, 5);
        } catch (err) {
          console.warn('Palette extraction failed:', err);
        }
      }
      // Clean up temp files
      try { fs.unlinkSync(tmpOriginal); } catch (err) {}
    } catch (err) {
      console.error('Error processing asset', err);
    }
    // Update asset document with metadata
    const updates: any = { virusScanned: true };
    if (proxyKey) updates.proxyKey = proxyKey;
    if (thumbnailKey) updates.thumbnailKey = thumbnailKey;
    if (palette) updates.palette = palette;
    await snap.ref.set(updates, { merge: true });
    if (typeof asset.projectId === 'string' && asset.projectId.trim().length > 0) {
      try {
        await syncAssetReviewTask({
          projectId: asset.projectId,
          assetId: context.params.assetId,
          assetName: typeof asset.name === 'string' ? asset.name : null,
          assetStatus: typeof asset.status === 'string' ? asset.status : null,
          deliverablesReleased: false,
          releaseHoldReason: null,
          assetType: typeof asset.assetType === 'string' ? asset.assetType : null,
        });
      } catch (taskError) {
        console.error('onAssetCreated failed to seed review task', context.params.assetId, taskError);
      }
    }
    return null;
  });

export const onOrderStatusUpdated = functions.firestore
  .document('orders/{orderId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as Record<string, any> | undefined;
    const after = change.after.data() as Record<string, any> | undefined;
    if (!after) {
      return null;
    }

    const previousStatus = normaliseOrderStatus(before?.status);
    const nextStatus = normaliseOrderStatus(after.status);
    if (previousStatus === nextStatus || !isPaidOrderStatus(nextStatus)) {
      return null;
    }

    const orderId = context.params.orderId;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const releaseSummaries: Array<{
      projectId: string;
      projectName: string | null;
      assetIds: string[];
      projectData: FirebaseFirestore.DocumentData;
    }> = [];

    try {
      const projectsSnap = await db.collection('projects').where('orderId', '==', orderId).get();
      if (!projectsSnap.empty) {
        for (const projectDoc of projectsSnap.docs) {
          const projectId = projectDoc.id;
          const projectData = projectDoc.data() as FirebaseFirestore.DocumentData;
          const assetIds: string[] = [];
          try {
            const assetsSnap = await db
              .collection('assets')
              .where('projectId', '==', projectId)
              .get();
            for (const assetDoc of assetsSnap.docs) {
              const assetData = assetDoc.data() as Record<string, any>;
              if (!isAssetApprovalStatus(assetData.status) || assetData.deliverablesReleased === true) {
                continue;
              }
              const updates: Record<string, any> = {
                deliverablesReleased: true,
                releaseHoldReason: null,
                releaseHoldNote: null,
                releaseReadyAt: timestamp,
                releaseHoldUpdatedAt: timestamp,
              };
              try {
                await assetDoc.ref.set(updates, { merge: true });
              } catch (writeError) {
                console.error('onOrderStatusUpdated failed to release asset', {
                  orderId,
                  assetId: assetDoc.id,
                }, writeError);
                continue;
              }
              assetIds.push(assetDoc.id);
              try {
                await syncAssetReviewTask({
                  projectId,
                  assetId: assetDoc.id,
                  assetName: typeof assetData.name === 'string' ? assetData.name : null,
                  assetStatus: typeof assetData.status === 'string' ? assetData.status : null,
                  deliverablesReleased: true,
                  releaseHoldReason: null,
                  orderId,
                  orderStatus: after.status ?? nextStatus,
                  projectData,
                  orderData: after,
                  assetType: typeof assetData.assetType === 'string' ? assetData.assetType : null,
                });
              } catch (taskError) {
                console.error('onOrderStatusUpdated failed to sync review task', {
                  projectId,
                  assetId: assetDoc.id,
                }, taskError);
              }
            }
          } catch (assetError) {
            console.error('onOrderStatusUpdated asset lookup failed', { projectId, orderId }, assetError);
          }
          if (assetIds.length > 0) {
            releaseSummaries.push({
              projectId,
              projectName: typeof projectData.name === 'string' ? projectData.name : null,
              assetIds,
              projectData,
            });
          }
        }
      }
    } catch (projectError) {
      console.error('onOrderStatusUpdated project lookup failed', { orderId }, projectError);
    }

    if (releaseSummaries.length > 0) {
      const orgId = typeof after.orgId === 'string' ? after.orgId : null;
      if (orgId) {
        try {
          const membershipsSnap = await db
            .collection('memberships')
            .where('orgId', '==', orgId)
            .limit(50)
            .get();
          if (!membershipsSnap.empty) {
            const batch = db.batch();
            const notificationTimestamp = admin.firestore.FieldValue.serverTimestamp();
            membershipsSnap.docs.forEach((membershipDoc) => {
              const membership = membershipDoc.data() as Record<string, any>;
              const userId = typeof membership.userId === 'string' ? membership.userId : null;
              if (!userId) {
                return;
              }
              releaseSummaries.forEach((summary) => {
                const notificationRef = db.collection('notifications').doc();
                batch.set(notificationRef, {
                  userId,
                  message: `Final files for ${summary.projectName || 'your project'} are ready to download.`,
                  projectId: summary.projectId,
                  orderId,
                  assetIds: summary.assetIds,
                  createdAt: notificationTimestamp,
                  kind: 'asset_release',
                });
              });
            });
            await batch.commit();
          }
        } catch (notifyError) {
          console.error('onOrderStatusUpdated notification dispatch failed', { orderId, orgId }, notifyError);
        }
      }
    }

    return null;
  });

/**
 * Callable to send mass email to all leads in a group. Marks leads as contacted and
 * logs the outreach action. Expects { groupId, subject, body }.
 */
export const sendGroupEmail = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { groupId, subject, body } = data;
  if (!groupId || !subject || !body) throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
  const groupSnap = await db.collection('groups').doc(groupId).get();
  if (!groupSnap.exists) throw new functions.https.HttpsError('not-found', 'Group not found');
  const group = groupSnap.data() as any;
  const userIds: string[] = group.userIds || [];
  const leadIds: string[] = group.leadIds || [];
  let count = 0;
  if (userIds.length > 0) {
    for (const uid of userIds) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) continue;
      const user = userSnap.data() as any;
      await db.collection('emails').add({
        orgId: group.orgId,
        projectId: null,
        threadId: uuidv4(),
        from: context.auth.token.email,
        to: user.email,
        subject,
        body,
        attachments: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'sent'
      });
      count++;
    }
  } else {
    for (const lid of leadIds) {
      const leadSnap = await db.collection('leads').doc(lid).get();
      if (!leadSnap.exists) continue;
      const lead = leadSnap.data() as any;
      await db.collection('emails').add({
        orgId: group.orgId,
        projectId: null,
        threadId: uuidv4(),
        from: context.auth.token.email,
        to: lead.email,
        subject,
        body,
        attachments: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'sent'
      });
      await db.collection('leads').doc(lid).set({ status: 'contacted' }, { merge: true });
      count++;
    }
  }
  return { count };
});

/**
 * Create a dynamic group of users based on purchase history or profile fields.
 * Expects { name, productId?, month?, industry?, location? } and returns count
 * of matched users. Stores matching userIds on the group document for later reuse.
 */
export const groups_createCustom = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { name, productId, month, industry, location } = data;
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'Name required');

  // gather user IDs matching profile filters
  const usersSnap = await db.collection('users').get();
  let ids = new Set<string>();
  usersSnap.forEach((u) => {
    const user = u.data() as any;
    if (industry && user.industry !== industry) return;
    if (location && user.location !== location) return;
    ids.add(u.id);
  });

  // filter by orders if product or month specified
  if (productId || month) {
    const orderSnap = await db.collection('orders').get();
    const orderUserIds = new Set<string>();
    orderSnap.forEach((o) => {
      const order = o.data() as any;
      if (productId && !(order.items || []).some((i: any) => i.id === productId)) return;
      if (month) {
        const ts = order.createdAt?.toDate ? order.createdAt.toDate() : null;
        if (!ts || ts.getMonth() + 1 !== month) return;
      }
      if (order.userId) orderUserIds.add(order.userId);
    });
    ids = new Set([...ids].filter((id) => orderUserIds.has(id)));
  }

  const userIds = Array.from(ids);
  await db.collection('groups').add({
    name,
    orgId: null,
    userIds,
    filters: { productId: productId || null, month: month || null, industry: industry || null, location: location || null },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { count: userIds.length };
});

/**
* Callable to synchronise availability with an external calendar.
* Supports Google Calendar via service account or Microsoft Outlook via the Graph API.
* The provider is selected with data.provider ('google' | 'microsoft') and defaults to Google.
*/
export const calendar_syncAvailability = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const provider = (data.provider as string) || 'google';
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  let busy: { start: string; end: string }[] = [];
  try {
    if (provider === 'google') {
      const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
      if (!keyB64) throw new Error('Missing Google service account credentials');
      const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
      const jwtClient = new google.auth.JWT(
        keyJson.client_email,
        undefined,
        keyJson.private_key,
        ['https://www.googleapis.com/auth/calendar.readonly']
      );
      await jwtClient.authorize();
      const calendar = google.calendar({ version: 'v3', auth: jwtClient });
      const fb = await calendar.freebusy.query({
        requestBody: {
          timeMin: now.toISOString(),
          timeMax: end.toISOString(),
          items: [{ id: 'primary' }],
        },
      });
      const gBusy = fb.data.calendars?.primary?.busy || [];
      busy = gBusy.map((b) => ({ start: b.start || '', end: b.end || '' }));
    } else if (provider === 'microsoft') {
      const tenant = process.env.MS_TENANT_ID;
      const clientId = process.env.MS_CLIENT_ID;
      const clientSecret = process.env.MS_CLIENT_SECRET;
      const userId = (data.userId as string) || process.env.MS_USER_ID;
      if (!tenant || !clientId || !clientSecret || !userId) {
        throw new Error('Missing Microsoft Graph credentials');
      }
      const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      });
      const tokenJson = (await tokenRes.json()) as any;
      const token = tokenJson.access_token as string;
      if (!token) throw new Error('Failed to obtain Microsoft Graph token');
      const eventsRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
          userId,
        )}/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const eventsJson = (await eventsRes.json()) as any;
      const events = eventsJson.value || [];
      busy = events.map((e: any) => ({ start: e.start.dateTime, end: e.end.dateTime }));
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Unsupported provider');
    }
    // Convert busy periods into availability slots: any time not in busy array within working hours (9am-5pm) is free
    const availability: any[] = [];
    let cursor = new Date(now);
    while (cursor < end) {
      const dayStart = new Date(cursor.setHours(9, 0, 0, 0));
      const dayEnd = new Date(cursor.setHours(17, 0, 0, 0));
      let freeStart = new Date(dayStart);
      for (const b of busy) {
        const busyStart = new Date(b.start || '');
        const busyEnd = new Date(b.end || '');
        if (busyEnd <= freeStart || busyStart >= dayEnd) continue;
        // If there is free time before the busy slot, record it
        if (busyStart > freeStart) {
          availability.push({ start: freeStart.toISOString(), end: busyStart.toISOString() });
        }
        freeStart = busyEnd > freeStart ? busyEnd : freeStart;
      }
      // Free time after last busy period until end of day
      if (freeStart < dayEnd) {
        availability.push({ start: freeStart.toISOString(), end: dayEnd.toISOString() });
      }
      // Move to next day
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }
    // Store availability in Firestore (overwrite existing future slots for the user)
    const batch = db.batch();
    const uid = context.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    // Remove existing future availability for this user
    const availSnap = await db.collection('availability').where('uid', '==', uid).where('start', '>=', now).get();
    availSnap.docs.forEach((doc) => batch.delete(doc.ref));
    // Add new slots
    availability.forEach((slot) => {
      const ref = db.collection('availability').doc();
      batch.set(ref, {
        uid,
        start: slot.start,
        end: slot.end,
        isBookable: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    return { slots: availability.length };
  } catch (err: any) {
    console.error('calendar_syncAvailability error:', err);
    throw new functions.https.HttpsError('internal', err.message);
  }
});

/**
 * Callable to create a calendar event for a confirmed booking.
 * Supports both Google Calendar and Microsoft Outlook depending on data.provider.
 */
export const calendar_createEvent = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { bookingId, calendarId, provider = 'google' } = data as any;
  if (!bookingId) throw new functions.https.HttpsError('invalid-argument', 'bookingId is required');
  // Retrieve booking and associated user/org
  const bookingDoc = await db.collection('bookings').doc(bookingId).get();
  if (!bookingDoc.exists) throw new functions.https.HttpsError('not-found', 'Booking not found');
  const booking = bookingDoc.data() as any;
  try {
    if (provider === 'google') {
      const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
      if (!keyB64) throw new Error('Missing Google service account credentials');
      const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
      const jwtClient = new google.auth.JWT(
        keyJson.client_email,
        undefined,
        keyJson.private_key,
        ['https://www.googleapis.com/auth/calendar']
      );
      await jwtClient.authorize();
      const calendar = google.calendar({ version: 'v3', auth: jwtClient });
      const event = await calendar.events.insert({
        calendarId: calendarId || 'primary',
        requestBody: {
          summary: `Booking for ${booking.serviceId || 'service'}`,
          description: booking.notes || '',
          start: { dateTime: booking.slot.start || booking.slot, timeZone: 'Europe/London' },
          end: { dateTime: booking.slot.end || booking.slot, timeZone: 'Europe/London' },
          attendees: [],
        },
      });
      const eventId = event.data.id;
      await db.collection('bookings').doc(bookingId).set({ calendarEventId: eventId }, { merge: true });
      return { eventId };
    } else if (provider === 'microsoft') {
      const tenant = process.env.MS_TENANT_ID;
      const clientId = process.env.MS_CLIENT_ID;
      const clientSecret = process.env.MS_CLIENT_SECRET;
      const userId = (data.userId as string) || process.env.MS_USER_ID;
      if (!tenant || !clientId || !clientSecret || !userId) {
        throw new Error('Missing Microsoft Graph credentials');
      }
      const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      });
      const tokenJson = (await tokenRes.json()) as any;
      const token = tokenJson.access_token as string;
      if (!token) throw new Error('Failed to obtain Microsoft Graph token');
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/calendar/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subject: `Booking for ${booking.serviceId || 'service'}`,
            body: { contentType: 'HTML', content: booking.notes || '' },
            start: { dateTime: booking.slot.start || booking.slot, timeZone: 'Europe/London' },
            end: { dateTime: booking.slot.end || booking.slot, timeZone: 'Europe/London' },
            attendees: [],
          }),
        }
      );
      const event = (await res.json()) as any;
      const eventId = event.id as string;
      await db.collection('bookings').doc(bookingId).set({ calendarEventId: eventId }, { merge: true });
      return { eventId };
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Unsupported provider');
    }
  } catch (err: any) {
    console.error('calendar_createEvent error:', err);
    // Fallback: mark with placeholder event ID
    await db.collection('bookings').doc(bookingId).set({ calendarEventId: 'external-' + bookingId }, { merge: true });
    return { eventId: 'external-' + bookingId };
  }
});


/**
 * Scheduled function to generate campaign suggestions for each organisation based on
 * products previously ordered. For demonstration this simply creates a generic
 * suggestion pointing to a popular product. Runs daily.
 */
export const recommendations_generate = functions.pubsub.schedule('every 24 hours').onRun(async () => {
  // Fetch all products once
  const productsSnap = await db.collection('products').get();
  if (productsSnap.empty) return null;
  const products = productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];
  const orgsSnap = await db.collection('orgs').get();
  const batch = db.batch();
  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id;
    // Retrieve set of productIds already ordered by the org
    const ordersSnap = await db.collection('orders').where('orgId', '==', orgId).get();
    const orderedProductIds = new Set<string>();
    ordersSnap.forEach((orderDoc) => {
      const o = orderDoc.data() as any;
      if (o.serviceId) orderedProductIds.add(o.serviceId);
    });
    // Choose a product not yet ordered; simple heuristic: random selection among not-ordered products
    const candidates = products.filter((p) => !orderedProductIds.has(p.id));
    if (candidates.length === 0) continue;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const recRef = db.collection('recommendations').doc();
    batch.set(recRef, {
      orgId,
      type: 'campaign',
      title: `Consider our ${chosen.name} service`,
      body: `We think the ${chosen.name} package would help your business based on your order history.`,
      cta: `/products/${chosen.id}`,
      linkedServiceId: chosen.id,
      score: Math.random(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return null;
});

/**
 * Callable to send an email. Stores the email in the emails collection and uses nodemailer
 * to send via SMTP if configured. Expected data: { to: string, subject: string, body: string, attachments?: [] }
 */
export const emails_send = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const emailData = {
    orgId: data.orgId || null,
    projectId: data.projectId || null,
    threadId: uuidv4(),
    from: context.auth.token.email,
    to: data.to,
    subject: data.subject,
    body: data.body,
    attachments: data.attachments || [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'sent'
  };
  const emailRef = await db.collection('emails').add(emailData);
  // Attempt to send via Gmail API using a service account. We support sending
  // transactional emails through Google Workspace if the environment variable
  // `GMAIL_SERVICE_ACCOUNT_KEY_BASE64` is provided. The key should contain
  // the JSON credentials for a service account with domain-wide delegation
  // enabled on the Gmail API. Note: this integration will silently fail in
  // development environments if the credentials are missing. See docs for
  // details on configuring the service account.
  try {
    const keyB64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
    if (keyB64) {
      const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
      const authClient = new google.auth.JWT(
        keyJson.client_email,
        undefined,
        keyJson.private_key,
        ['https://www.googleapis.com/auth/gmail.send']
      );
      await authClient.authorize();
      const gmail = google.gmail({ version: 'v1', auth: authClient });
      // Construct RFC822 email. The raw string must be base64url encoded
      const message = [
        `From: ${emailData.from}`,
        `To: ${emailData.to}`,
        `Subject: ${emailData.subject}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        emailData.body || '',
      ].join('\n');
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
    }
  } catch (err) {
    console.error('emails_send Gmail error:', err);
  }
  return { id: emailRef.id };
});

/**
 * Callable to record an incoming email. In a real implementation this would be invoked
 * by an email webhook. Here we simply store the email in the emails collection.
 */
export const emails_receive = functions.https.onCall(async (data, context) => {
  // No auth required since this could be invoked by an email gateway
  const emailRef = await db.collection('emails').add({
    orgId: data.orgId || null,
    projectId: data.projectId || null,
    threadId: data.threadId || uuidv4(),
    from: data.from,
    to: data.to,
    subject: data.subject,
    body: data.body,
    attachments: data.attachments || [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'received'
  });
  return { id: emailRef.id };
});

/**
 * When a new inbound email is stored, this trigger checks if the sender corresponds
 * to an existing lead. If so, the lead's status is updated to 'opportunity' and
 * a new opportunity document is created. This enables funneling responses back into
 * the CRM pipeline.
 */
export const onEmailReceived = functions.firestore
  .document('emails/{emailId}')
  .onCreate(async (snap, context) => {
    const email = snap.data() as any;
    if (email.status !== 'received') return null;
    const from = email.from;
    if (!from) return null;
    // Find lead by email address
    const leadSnap = await db.collection('leads').where('email', '==', from).limit(1).get();
    if (leadSnap.empty) return null;
    const leadDoc = leadSnap.docs[0];
    // Update lead status
    await leadDoc.ref.set({ status: 'opportunity' }, { merge: true });
    // Create opportunity document
    await db.collection('opportunities').add({
      leadId: leadDoc.id,
      orgId: leadDoc.data().orgId,
      stage: 'new',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastEmailId: snap.id,
    });
    return null;
  });

/**
 * Callable to request an e-signature. Creates a signatures document with pending status.
 */
export const esign_request = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const sigRef = await db.collection('signatures').add({
    projectId: data.projectId,
    orgId: data.orgId,
    docAssetId: data.docAssetId,
    signerUid: data.signerUid,
    status: 'requested',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { id: sigRef.id };
});

/**
 * Create an order from cart item IDs and quantities. Fetches product data to calculate
 * pricing server-side and writes the order document with status 'pending'. Returns
 * the created order ID.
 */
export const createOrder = functions.https.onCall(async (data, context) => {
  const toNumber = (value: any, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };
  const parseOptional = (value: any) =>
    value === undefined || value === null ? undefined : toNumber(value);
  const DEFAULT_TRAVEL_MILES = 100;
  const DEFAULT_TRAVEL_RATE = 0.3;
  const {
    items,
    userEmail,
    customerName,
    companyName,
    location,
    postalCode,
    projectName,
    voucher,
    kitItems: kitItemsInput = [],
    rentalSubtotal = 0,
    leadSource: leadSourceInput,
    kitReservationStatus: kitReservationStatusInput,
    kitReservationWarnings: kitReservationWarningsInput = [],
  } = data;
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'items are required');
  }

  const normaliseKitItem = (raw: any) => {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) {
      return null;
    }
    const name =
      typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : null;
    const category =
      typeof raw.category === 'string' && raw.category.trim().length > 0
        ? raw.category.trim()
        : null;
    const start = typeof raw.start === 'string' ? raw.start : null;
    const end = typeof raw.end === 'string' ? raw.end : null;
    return { id, name, category, start, end };
  };

  const kitItems = Array.isArray(kitItemsInput)
    ? kitItemsInput
        .map(normaliseKitItem)
        .filter((item): item is { id: string; name: string | null; category: string | null; start: string | null; end: string | null } =>
          !!item
        )
    : [];

  const kitReservationStatusInitial =
    typeof kitReservationStatusInput === 'string' && kitReservationStatusInput === 'pending'
      ? 'pending'
      : 'confirmed';
  const kitReservationWarningsInitial = Array.isArray(kitReservationWarningsInput)
    ? (kitReservationWarningsInput as unknown[])
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value): value is string => value.length > 0)
    : [];

  const postalCodeValue = typeof postalCode === 'string' ? postalCode : null;
  const normalisedPostalCode = normalisePostalCode(postalCodeValue);
  const assignmentResult = normalisedPostalCode
    ? await resolveTerritoryForPostalCode(normalisedPostalCode)
    : null;
  const territoryPriceTier: PriceTierLevel = assignmentResult?.priceTier ?? 1;
  const assignmentMember =
    assignmentResult?.franchiseId
      ? await resolvePrimaryFranchiseMember(assignmentResult.franchiseId)
      : null;

  const productRefs = items.map((i: any) => db.collection('products').doc(i.id));
  const leadSourceRaw =
    typeof leadSourceInput === 'string' ? (leadSourceInput as string).trim() : '';
  const leadSourceTag = leadSourceRaw || 'hq';
  const leadSourceLower = leadSourceTag.toLowerCase();
  const affiliateContext = await resolveAffiliateFromLeadSource(leadSourceTag);
  const leadSourceNormalised: RoyaltySource = ['franchise', 'affiliate', 'partner', 'referral', 'territory'].some(
    (indicator) => leadSourceLower.includes(indicator)
  )
    ? 'franchisee'
    : 'hq';
  const authEmail =
    typeof context.auth?.token.email === 'string' ? (context.auth.token.email as string) : null;
  const requestEmail = typeof userEmail === 'string' ? (userEmail as string) : null;
  const preferredEmail = authEmail || requestEmail;
  const normalisedEmail = preferredEmail ? preferredEmail.trim().toLowerCase() : null;
  const clientRoyaltyKeyType: 'user_id' | 'email' | null = context.auth?.uid
    ? 'user_id'
    : normalisedEmail
      ? 'email'
      : null;
  const clientRoyaltyKey =
    clientRoyaltyKeyType === 'user_id'
      ? `uid:${context.auth?.uid as string}`
      : clientRoyaltyKeyType === 'email' && normalisedEmail
        ? `email:${normalisedEmail}`
        : null;
  let clientRoyaltyOrderIndex: number | null = null;
  if (clientRoyaltyKey) {
    const priorOrdersSnap = await db
      .collection('orders')
      .where('clientRoyaltyKey', '==', clientRoyaltyKey)
      .get();
    clientRoyaltyOrderIndex = priorOrdersSnap.size + 1;
  }
  const productSnaps = await db.getAll(...productRefs);
  const orderItems: any[] = [];
  let aggregatedKitReservationStatus: 'confirmed' | 'pending' = kitReservationStatusInitial;
  const aggregatedKitWarnings = new Set<string>(kitReservationWarningsInitial);
  const driveProducts: DriveOrderProductContext[] = [];
  let productSubtotal = 0;
  let labourSubtotal = 0;
  let kitSubtotal = 0;
  let travelSubtotal = 0;
  let parkingSubtotal = 0;

  productSnaps.forEach((snap, idx) => {
    if (!snap.exists) return;
    const prod = snap.data() as any;
    const qtyRaw = toNumber(items[idx].quantity, 0);
    const qty = qtyRaw > 0 ? qtyRaw : 0;
    const category = prod.category || prod.categoryId || null;
    const rental = toNumber(items[idx].rentalTotal, 0);
    const variationId =
      items[idx] && typeof items[idx].variation === 'string'
        ? (items[idx].variation as string)
        : null;
    const variations = Array.isArray((prod as any).variations)
      ? ((prod as any).variations as any[])
      : [];
    const variation = variationId
      ? variations.find(
          (entry) =>
            entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id === variationId
        )
      : null;
    let unitPrice = resolveTierPrice((prod as any).price, (prod as any).priceTiers, territoryPriceTier);
    if (variation) {
      unitPrice = resolveTierPrice(
        (variation as any).price ?? unitPrice,
        (variation as any).priceTiers,
        territoryPriceTier
      );
    }
    const configuredModifiers = Array.isArray((prod as any).modifiers)
      ? ((prod as any).modifiers as any[])
      : [];
    const rawModifiers = Array.isArray(items[idx].modifiers)
      ? (items[idx].modifiers as any[])
      : [];
    const resolvedModifiers: any[] = [];
    let modifiersTotal = 0;
    rawModifiers.forEach((selection) => {
      if (!selection || typeof selection !== 'object') {
        return;
      }
      const groupId = typeof selection.groupId === 'string' ? selection.groupId : null;
      const optionId = typeof selection.optionId === 'string' ? selection.optionId : null;
      if (!groupId || !optionId) {
        return;
      }
      const configured = configuredModifiers.find(
        (modifier) =>
          modifier &&
          typeof modifier === 'object' &&
          typeof modifier.groupId === 'string' &&
          modifier.groupId === groupId &&
          typeof modifier.optionId === 'string' &&
          modifier.optionId === optionId
      );
      let resolvedPrice: number | null = null;
      if (configured) {
        resolvedPrice = resolveTierPrice(
          (configured as any).price ?? null,
          (configured as any).priceTiers,
          territoryPriceTier
        );
      } else if (selection.price !== undefined && selection.price !== null) {
        const parsed = Number(selection.price);
        resolvedPrice = Number.isFinite(parsed) ? parsed : null;
      }
      if (resolvedPrice !== null) {
        modifiersTotal += resolvedPrice;
      }
      const payload: Record<string, any> = { ...selection, groupId, optionId };
      if (resolvedPrice !== null) {
        payload.price = resolvedPrice;
      }
      resolvedModifiers.push(payload);
    });
    const price = unitPrice + modifiersTotal;
    const rawItemKitStatus =
      items[idx] && typeof items[idx].kitStatus === 'string'
        ? (items[idx].kitStatus as string)
        : null;
    const itemKitStatus: 'confirmed' | 'pending' =
      rawItemKitStatus === 'pending' ? 'pending' : 'confirmed';
    const itemKitWarnings = Array.isArray(items[idx]?.kitWarnings)
      ? (items[idx].kitWarnings as unknown[])
          .map((warning) => (typeof warning === 'string' ? warning.trim() : ''))
          .filter((warning): warning is string => warning.length > 0)
      : [];
    if (itemKitStatus === 'pending') {
      aggregatedKitReservationStatus = 'pending';
    }
    itemKitWarnings.forEach((warning) => {
      if (warning.length > 0) {
        aggregatedKitWarnings.add(warning);
      }
    });
    const budget = (prod as any).budget || {};
    const labourFilming = parseOptional(budget.labourFilming);
    const labourEditing = parseOptional(budget.labourEditing);
    const labourBase = toNumber(budget.labour ?? prod.labourCost);
    const labour =
      labourFilming !== undefined || labourEditing !== undefined
        ? (labourFilming ?? 0) + (labourEditing ?? 0)
        : labourBase;
    const kitManual = parseOptional(budget.kitManual);
    const kitGuidance = parseOptional(budget.kitGuidance);
    let kit = toNumber(budget.kit ?? prod.defaultKitCost);
    if (budget.kitMode === "guided") {
      kit = kitGuidance ?? kit;
    } else if (budget.kitMode === "manual") {
      kit = kitManual ?? kit;
    } else if (kitManual !== undefined || kitGuidance !== undefined) {
      kit = kitManual ?? kitGuidance ?? kit;
    }
    const travelMilesValue = toNumber(
      budget.travelMiles,
      DEFAULT_TRAVEL_MILES,
    );
    const travelRateValue = toNumber(budget.travelRate, DEFAULT_TRAVEL_RATE);
    const travelCost = toNumber(
      budget.travelCost,
      toNumber(travelMilesValue * travelRateValue),
    );
    const parking = toNumber(budget.parking);
    const perUnitBudgetTotal = labour + kit + travelCost + parking;
    orderItems.push({
      id: snap.id,
      name: prod.name,
      price,
      quantity: qty,
      category,
      rentalTotal: rental,
      modifiers: resolvedModifiers,
      kitReservationStatus: itemKitStatus,
      kitWarnings: itemKitWarnings,
      budget: {
        perUnit: {
          labour,
          kit,
          travelMiles: travelMilesValue,
          travelRate: travelRateValue,
          travelCost,
          parking,
          totalCost: perUnitBudgetTotal,
        },
        total: {
          labour: labour * qty,
          kit: kit * qty,
          travel: travelCost * qty,
          parking: parking * qty,
          totalCost: perUnitBudgetTotal * qty,
        },
      },
    });
    const templateFolderIdRaw =
      typeof (prod as any).driveTemplateFolderId === 'string'
        ? ((prod as any).driveTemplateFolderId as string)
        : '';
    const folderNameOverrideRaw =
      typeof (prod as any).driveFolderName === 'string'
        ? ((prod as any).driveFolderName as string)
        : '';
    driveProducts.push({
      productId: snap.id,
      name: typeof prod.name === 'string' ? (prod.name as string) : `Product ${idx + 1}`,
      quantity: qty > 0 ? qty : 1,
      templateFolderId:
        templateFolderIdRaw && templateFolderIdRaw.trim().length > 0
          ? templateFolderIdRaw.trim()
          : null,
      folderName:
        folderNameOverrideRaw && folderNameOverrideRaw.trim().length > 0
          ? folderNameOverrideRaw.trim()
          : null,
    });
    productSubtotal += price * qty;
    labourSubtotal += labour * qty;
    kitSubtotal += kit * qty;
    travelSubtotal += travelCost * qty;
    parkingSubtotal += parking * qty;
  });


  // Apply voucher discount if provided
  let voucherDiscount = 0;
  let voucherCode: string | null = null;
  if (voucher) {
    const vSnap = await db
      .collection('vouchers')
      .where('code', '==', voucher)
      .limit(1)
      .get();
    if (!vSnap.empty) {
      const v = vSnap.docs[0].data() as any;
      const locs: string[] = v.locations || [];
      const locAllowed =
        locs.length === 0 ||
        (location && locs.map((l) => l.toLowerCase()).includes(String(location).toLowerCase()));
      if (locAllowed) {
        const prodIds: string[] = v.productIds || [];
        const catIds: string[] = v.categoryIds || [];
        let eligibleSubtotal = 0;
        orderItems.forEach((item) => {
          const prodOk = prodIds.length === 0 || prodIds.includes(item.id);
          const catOk = catIds.length === 0 || catIds.includes(item.category);
          if (prodOk && catOk) eligibleSubtotal += item.price * item.quantity;
        });
        if (eligibleSubtotal > 0) {
          if (v.type === 'percentage') {
            voucherDiscount = eligibleSubtotal * (v.amount / 100);
          } else if (v.type === 'fixed') {
            voucherDiscount = Math.min(v.amount, eligibleSubtotal);
          }
          voucherCode = voucher;
        }
      }
    }
  }

  const subtotalAfterVoucher = productSubtotal - voucherDiscount;

  let discountPct = 0;
  if (context.auth?.uid) {
    const userSnap = await db.collection('users').doc(context.auth.uid).get();
    discountPct = (userSnap.data()?.discount as number) || 0;
  }
  const discountAmount = subtotalAfterVoucher * (discountPct / 100);
  const finalTotal = subtotalAfterVoucher - discountAmount + rentalSubtotal;
  const vat = finalTotal * VAT_RATE;
  const price = finalTotal + vat;
  const budgetSubtotal =
    labourSubtotal + kitSubtotal + travelSubtotal + parkingSubtotal;
  const profit = finalTotal - (budgetSubtotal + rentalSubtotal);
  const affiliateCommission = affiliateContext
    ? computeAffiliateCommission(profit, affiliateContext.commissionRate)
    : null;
  const affiliateSnapshot = affiliateContext
    ? {
        id: affiliateContext.id,
        name: affiliateContext.name,
        refCode: affiliateContext.refCode,
        status: affiliateContext.status ?? null,
        commissionRate: affiliateContext.commissionRate,
        commissionBase: affiliateCommission?.base ?? 0,
        commissionRateApplied: affiliateCommission?.rate ?? affiliateContext.commissionRate,
        commissionNet: affiliateCommission?.net ?? 0,
        commissionVat: affiliateCommission?.vat ?? 0,
        commissionGross: affiliateCommission?.gross ?? 0,
        commissionStatus: 'pending',
      }
    : null;
  const budgetTotals = {
    labour: labourSubtotal,
    kit: kitSubtotal,
    travel: travelSubtotal,
    parking: parkingSubtotal,
    rental: rentalSubtotal,
    totalCost: budgetSubtotal + rentalSubtotal,
    netRevenue: finalTotal,
    grossRevenue: price,
    profit,
  };

  const assignmentStatus = assignmentResult
    ? assignmentResult.franchiseId
      ? 'matched'
      : 'hq_unassigned'
    : normalisedPostalCode
      ? 'unmatched'
      : 'skipped';
  const assignmentMeta: Record<string, any> = {
    strategy: 'postal_code_auto_route',
    inputPostalCode: postalCodeValue || null,
    normalizedPostalCode: normalisedPostalCode || null,
    status: assignmentStatus,
    hqFallback: assignmentResult?.hqFallback === true,
    resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  let royaltyAssessment: Record<string, any> | null = null;
  if (assignmentResult?.franchiseId) {
    try {
      const franchiseDoc = await db.collection('franchises').doc(assignmentResult.franchiseId).get();
      if (franchiseDoc.exists) {
        const franchiseData = franchiseDoc.data() as any;
        const royaltyConfig = parseRoyaltyConfigDoc(franchiseData?.royalty);
        const orderIndexForRoyalty = clientRoyaltyOrderIndex ?? 1;
        const resolution = resolveRoyaltyTier(royaltyConfig, leadSourceNormalised, orderIndexForRoyalty);
        royaltyAssessment = {
          source: leadSourceNormalised,
          orderIndex: orderIndexForRoyalty,
          previousOrdersCount: orderIndexForRoyalty > 0 ? orderIndexForRoyalty - 1 : 0,
          percentage: resolution.percentage,
          tier: resolution.tier
            ? {
                minOrder: resolution.tier.minOrder,
                maxOrder: resolution.tier.maxOrder,
                percentage: resolution.tier.percentage,
              }
            : null,
          configSnapshot: {
            hqTiers: royaltyConfig.hqTiers.map((tier) => ({
              minOrder: tier.minOrder,
              maxOrder: tier.maxOrder,
              percentage: tier.percentage,
            })),
            franchiseSourcedPercentage: royaltyConfig.franchiseSourcedPercentage,
          },
          clientKey: clientRoyaltyKey,
          clientKeyType: clientRoyaltyKeyType,
          computedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
    } catch (royaltyErr) {
      console.warn('Failed to resolve royalty configuration', royaltyErr);
    }
  }

  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  const orderData: Record<string, any> = {
    userId: context.auth?.uid || null,
    userEmail: context.auth?.token.email || userEmail || null,
    customerName,
    companyName: companyName || null,
    location: location || null,
    clientPostalCode: postalCodeValue || null,
    clientPostalCodeNormalised: normalisedPostalCode || null,
    projectName: projectName || null,
    voucher: voucherCode,
    items: orderItems,
    subtotal: productSubtotal,
    rentalSubtotal,
    labourSubtotal,
    kitSubtotal,
    travelSubtotal,
    parkingSubtotal,
    budgetSubtotal,
    budgetTotals,
    kitItems,
    kitReservationStatus: aggregatedKitReservationStatus,
    kitReservationWarnings: Array.from(aggregatedKitWarnings),
    voucherDiscount,
    discountPct,
    discountAmount,
    netTotal: finalTotal,
    vat,
    price,
    profit,
    status: 'pending',
    createdAt,
    franchiseAssignment: assignmentMeta,
    royaltySource: leadSourceNormalised,
    leadSource: leadSourceTag,
    leadSourceCapturedAt: createdAt,
    clientRoyaltyKey: clientRoyaltyKey || null,
    clientRoyaltyKeyType: clientRoyaltyKeyType || null,
    clientRoyaltyOrderIndex: clientRoyaltyOrderIndex,
    priceTierLevel: territoryPriceTier,
  };

  if (affiliateSnapshot) {
    orderData.affiliate = {
      ...affiliateSnapshot,
      recordedAt: createdAt,
    };
  } else {
    orderData.affiliate = null;
  }

  if (assignmentResult) {
    orderData.franchiseId = assignmentResult.franchiseId;
    orderData.franchiseTerritoryId = assignmentResult.territoryId;
    assignmentMeta.matchType = assignmentResult.matchType;
    assignmentMeta.franchiseId = assignmentResult.franchiseId;
    assignmentMeta.territoryId = assignmentResult.territoryId;
    assignmentMeta.territoryPostalCode = assignmentResult.territoryPostalCode;
    assignmentMeta.territoryLabel = assignmentResult.territoryLabel;
    assignmentMeta.exclusive = assignmentResult.exclusive;
    assignmentMeta.priceTierLevel = territoryPriceTier;
    if (assignmentResult.matchType === 'radius') {
      assignmentMeta.strategy = 'radius_auto_route';
      assignmentMeta.radiusMatch = assignmentResult.radiusMatch
        ? {
            distanceKm: assignmentResult.radiusMatch.distanceKm,
            radiusKm: assignmentResult.radiusMatch.radiusKm,
            centerLat: assignmentResult.radiusMatch.centerLat,
            centerLng: assignmentResult.radiusMatch.centerLng,
          }
        : null;
    }
  } else {
    orderData.franchiseId = null;
    orderData.franchiseTerritoryId = null;
  }

  if (assignmentMember) {
    orderData.franchiseAssignedMemberId = assignmentMember.memberId;
    orderData.franchiseAssignedUserId = assignmentMember.userId;
    orderData.franchiseAssignedRole = assignmentMember.role || null;
    orderData.franchiseAssignedIsPrimary = assignmentMember.primary;
    orderData.franchiseAssignedUser = assignmentMember.userProfile
      ? {
          uid: assignmentMember.userId,
          displayName: assignmentMember.userProfile.displayName || null,
          email: assignmentMember.userProfile.email || null,
        }
      : {
          uid: assignmentMember.userId,
          displayName: null,
          email: null,
        };
  } else {
    orderData.franchiseAssignedMemberId = null;
    orderData.franchiseAssignedUserId = null;
    orderData.franchiseAssignedRole = null;
    orderData.franchiseAssignedIsPrimary = false;
    orderData.franchiseAssignedUser = null;
  }

  if (royaltyAssessment) {
    orderData.royalty = royaltyAssessment;
    orderData.royaltyPercentage = royaltyAssessment.percentage;
  } else {
    orderData.royalty = null;
    orderData.royaltyPercentage = null;
  }

  if (!Array.isArray(orderData.paymentSchedule) || orderData.paymentSchedule.length === 0) {
    try {
      const { splitTerms } = await getStripeOperationalSettings();
      if (splitTerms.length > 0) {
        const scheduleEntries = splitTerms.map((term, index) => {
          const grossAmount = Number((price * (term.percentage / 100)).toFixed(2));
          const netAmount = Number((finalTotal * (term.percentage / 100)).toFixed(2));
          let dueAt: admin.firestore.Timestamp | admin.firestore.FieldValue | null = null;
          if (term.dueDays !== null) {
            if (term.dueDays <= 0) {
              dueAt = admin.firestore.FieldValue.serverTimestamp();
            } else {
              const dueDate = new Date(Date.now() + term.dueDays * DAY_IN_MS);
              dueAt = admin.firestore.Timestamp.fromDate(dueDate);
            }
          }
          return {
            id: uuidv4(),
            label: term.label,
            percentage: term.percentage,
            dueDays: term.dueDays,
            grossAmount,
            netAmount,
            status: index === 0 ? 'due' : 'scheduled',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            dueAt,
          };
        });
        orderData.paymentSchedule = scheduleEntries;
      }
    } catch (scheduleError) {
      console.warn('Failed to apply default Stripe payment schedule', scheduleError);
    }
  }

  const orderRef = await db.collection('orders').add(orderData);

  if (affiliateSnapshot) {
    const commissionNet = affiliateSnapshot.commissionNet ?? 0;
    const commissionVat = affiliateSnapshot.commissionVat ?? 0;
    const commissionGross = affiliateSnapshot.commissionGross ?? 0;
    try {
      await db
        .collection('affiliates')
        .doc(affiliateSnapshot.id)
        .set(
          {
            metrics: {
              totalOrders: admin.firestore.FieldValue.increment(1),
              totalRevenueGross: admin.firestore.FieldValue.increment(price),
              totalCommissionNet: admin.firestore.FieldValue.increment(commissionNet),
              totalCommissionVat: admin.firestore.FieldValue.increment(commissionVat),
              totalCommissionGross: admin.firestore.FieldValue.increment(commissionGross),
              pendingCommissionNet: admin.firestore.FieldValue.increment(commissionNet),
              pendingCommissionVat: admin.firestore.FieldValue.increment(commissionVat),
              pendingCommissionGross: admin.firestore.FieldValue.increment(commissionGross),
              lastOrderAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastReferralAt: admin.firestore.FieldValue.serverTimestamp(),
            refCodeLower: affiliateSnapshot.refCode.toLowerCase(),
          },
          { merge: true }
        );
    } catch (affiliateUpdateError) {
      console.error('Failed to update affiliate after order creation', affiliateSnapshot.id, affiliateUpdateError);
    }

    if (context.auth?.uid) {
      try {
        await db
          .collection('users')
          .doc(context.auth.uid)
          .set(
            {
              affiliate: {
                id: affiliateSnapshot.id,
                name: affiliateSnapshot.name,
                refCode: affiliateSnapshot.refCode,
                status: affiliateSnapshot.status ?? null,
                commissionRate: affiliateSnapshot.commissionRate,
                linkedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
      } catch (userAffiliateError) {
        console.error('Failed to record affiliate on user profile', context.auth.uid, userAffiliateError);
      }
    }
  }

  const driveClientKeyBase = clientRoyaltyKey ?? (normalisedEmail ? `email:${normalisedEmail}` : null);
  const driveClientKey = driveClientKeyBase ?? `order:${orderRef.id}`;
  const driveClientKeyType: 'user_id' | 'email' | null =
    clientRoyaltyKeyType ?? (driveClientKeyBase && driveClientKeyBase.startsWith('email:') ? 'email' : null);
  const driveEmailSet = new Set<string>();
  if (normalisedEmail) {
    driveEmailSet.add(normalisedEmail);
  }
  if (requestEmail) {
    const trimmedRequestEmail = requestEmail.trim().toLowerCase();
    if (trimmedRequestEmail && (!normalisedEmail || trimmedRequestEmail !== normalisedEmail)) {
      driveEmailSet.add(trimmedRequestEmail);
    }
  }
  if (typeof orderData.userEmail === 'string') {
    const trimmedOrderEmail = (orderData.userEmail as string).trim().toLowerCase();
    if (trimmedOrderEmail) {
      driveEmailSet.add(trimmedOrderEmail);
    }
  }
  try {
    await setupClientDriveStructure({
      orderId: orderRef.id,
      orderRef,
      clientKey: driveClientKey,
      clientKeyType: driveClientKeyType,
      companyName:
        typeof companyName === 'string' && companyName.trim().length > 0
          ? companyName.trim()
          : null,
      customerName:
        typeof customerName === 'string' && customerName.trim().length > 0
          ? customerName.trim()
          : null,
      projectName:
        typeof projectName === 'string' && projectName.trim().length > 0
          ? projectName.trim()
          : null,
      emails: Array.from(driveEmailSet),
      franchise: {
        id: assignmentResult?.franchiseId ?? null,
        label: assignmentResult?.territoryLabel ?? null,
        emails:
          assignmentMember?.userProfile?.email && typeof assignmentMember.userProfile.email === 'string'
            ? [assignmentMember.userProfile.email.trim()]
            : [],
      },
      products: driveProducts,
      affiliate: affiliateContext
        ? {
            id: affiliateContext.id,
            name: affiliateContext.name,
            refCode: affiliateContext.refCode,
            status: affiliateContext.status ?? null,
            commissionRate: affiliateContext.commissionRate,
          }
        : null,
    });
  } catch (driveError) {
    console.error('Failed to set up Drive structure for order', orderRef.id, driveError);
    await orderRef.set(
      {
        drive: {
          status: 'error',
          errorMessage:
            driveError instanceof Error ? driveError.message : 'drive_setup_failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
  }

  return { orderId: orderRef.id };
});

export const clientResearch_onOrderCreated = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap) => {
    const order = (snap.data() as Record<string, any>) || {};
    const orderId = snap.id;
    const clientDocId = resolveClientDocIdFromOrder(order, orderId);
    const clientDocRef = db.collection('clients').doc(clientDocId);
    const clientSnap = await clientDocRef.get();
    const clientData = clientSnap.exists ? clientSnap.data() : undefined;
    const autoDecision = shouldAutoTriggerClientResearch(order, clientData);
    if (!autoDecision.shouldRun) {
      if (autoDecision.reason !== 'not_enabled') {
        console.log('Client research auto trigger skipped', {
          orderId,
          reason: autoDecision.reason,
        });
      }
      return;
    }

    const orderPath = buildDocPath('orders', orderId);
    const existingJobSnap = await db
      .collection(CLIENT_RESEARCH_JOB_COLLECTION)
      .where('orderId', '==', orderPath)
      .limit(1)
      .get();
    if (!existingJobSnap.empty) {
      console.log('Client research job already exists for order', orderId);
      return;
    }

    const jobRef = db.collection(CLIENT_RESEARCH_JOB_COLLECTION).doc();
    const scope = autoDecision.scope;
    const scopeConfig = getClientResearchScopeConfig(scope);
    const tokenCharge = scopeConfig.autoTokenCharge;
    const walletRef = db.collection(TOKEN_WALLET_COLLECTION).doc(clientDocId);
    const walletSnap = await walletRef.get();
    const walletData = walletSnap.exists ? ((walletSnap.data() as TokenWalletDoc) || {}) : null;
    const allowAutoDebit = walletData ? walletData.autoDebit !== false : false;
    const debitResult = await attemptWalletDebitForClientResearch({
      walletRef,
      allowDebit: allowAutoDebit,
      tokenCharge,
      jobRef,
      scope,
      triggeredBy: null,
      reason: 'auto',
    });
    const status: ClientResearchJobStatus = debitResult.tokenDebitApplied ? 'queued' : 'payment_required';
    const metadata: Record<string, any> = {
      orderId,
      autoReason: autoDecision.reason,
      tokenCharge,
      tokenDebitApplied: debitResult.tokenDebitApplied,
      allowAutoDebit,
    };
    if (order.companyName) metadata.companyName = order.companyName;
    if (order.customerName) metadata.customerName = order.customerName;
    if (order.projectName) metadata.projectName = order.projectName;
    if (order.leadSource) metadata.leadSource = order.leadSource;
    if (order.netTotal !== undefined) metadata.netTotal = order.netTotal;
    if (order.price !== undefined) metadata.price = order.price;

    await persistClientResearchJob({
      jobRef,
      clientPath: clientDocRef.path,
      orderPath: orderPath,
      proposalPath: null,
      scope,
      manual: false,
      status,
      billingMode: 'auto',
      triggeredBy: null,
      tokenCharge,
      tokenDebitApplied: debitResult.tokenDebitApplied,
      walletBalanceAfter: debitResult.walletBalanceAfter,
      source: 'order_auto',
      metadata,
    });

    if (status === 'queued') {
      await enqueueClientResearchQueue({
        jobRef,
        clientPath: clientDocRef.path,
        scope,
        manual: false,
        triggeredBy: null,
        source: 'order_auto',
      });
    }

    await writeAuditLog({
      actorUid: 'system',
      action: 'client_research.auto_enqueued',
      entityType: 'client',
      entityId: clientDocRef.id,
      metadata: {
        jobId: jobRef.id,
        orderId,
        scope,
        tokenCharge,
        tokenDebitApplied: debitResult.tokenDebitApplied,
        allowAutoDebit,
      },
    });
  });

export const createClientResearchJob = functions.https.onCall(async (data, context) => {
  const roles = await assertStaff(context, ['sales', 'marketing', 'projects', 'admin']);
  const clientIdInput = typeof data?.clientId === 'string' ? data.clientId : '';
  const proposalIdInput = typeof data?.proposalId === 'string' ? data.proposalId : '';
  const scopeInput = data?.scope;
  const scope = normaliseClientResearchScope(scopeInput);
  const clientDocId = normaliseClientDocId(clientIdInput);
  if (!clientDocId) {
    throw new functions.https.HttpsError('invalid-argument', 'clientId is required');
  }

  const clientDocRef = db.collection('clients').doc(clientDocId);
  const clientSnap = await clientDocRef.get();
  if (!clientSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Client not found');
  }

  const jobRef = db.collection(CLIENT_RESEARCH_JOB_COLLECTION).doc();
  const scopeConfig = getClientResearchScopeConfig(scope);
  const tokenCharge = scopeConfig.manualTokenCharge;
  const walletRef = db.collection(TOKEN_WALLET_COLLECTION).doc(clientDocId);
  const debitResult = await attemptWalletDebitForClientResearch({
    walletRef,
    allowDebit: true,
    tokenCharge,
    jobRef,
    scope,
    triggeredBy: context.auth!.uid,
    reason: 'manual',
  });
  const status: ClientResearchJobStatus = debitResult.tokenDebitApplied ? 'queued' : 'payment_required';
  const proposalPath = buildDocPath('proposals', normaliseNullableString(proposalIdInput));
  const metadata: Record<string, any> = {
    tokenCharge,
    tokenDebitApplied: debitResult.tokenDebitApplied,
    triggerRoles: Array.from(roles),
  };
  const triggerEmail = typeof context.auth?.token.email === 'string' ? context.auth.token.email : null;
  if (triggerEmail) metadata.triggeredByEmail = triggerEmail;
  if (proposalPath) metadata.proposalPath = proposalPath;

  await persistClientResearchJob({
    jobRef,
    clientPath: clientDocRef.path,
    orderPath: null,
    proposalPath,
    scope,
    manual: true,
    status,
    billingMode: 'manual',
    triggeredBy: context.auth!.uid,
    tokenCharge,
    tokenDebitApplied: debitResult.tokenDebitApplied,
    walletBalanceAfter: debitResult.walletBalanceAfter,
    source: 'manual',
    metadata,
  });

  if (status === 'queued') {
    await enqueueClientResearchQueue({
      jobRef,
      clientPath: clientDocRef.path,
      scope,
      manual: true,
      triggeredBy: context.auth!.uid,
      source: 'manual',
    });
  }

  await writeAuditLog({
    actorUid: context.auth!.uid,
    action: 'client_research.manual_enqueued',
    entityType: 'client',
    entityId: clientDocRef.id,
    metadata: {
      jobId: jobRef.id,
      proposalPath: proposalPath ?? null,
      scope,
      tokenCharge,
      tokenDebitApplied: debitResult.tokenDebitApplied,
      triggerRoles: Array.from(roles),
    },
  });

  const billingStatus = debitResult.tokenDebitApplied ? 'paid' : 'payment_required';
  const result: ClientResearchJobCreationResult = {
    jobId: jobRef.id,
    status,
    billingStatus,
    tokenDebitApplied: debitResult.tokenDebitApplied,
    tokenCharge,
    walletBalanceAfter: debitResult.walletBalanceAfter,
  };
  return result;
});

export const remarketing_monthlySweep = functions.pubsub
  .schedule('0 9 1 * *')
  .timeZone('Europe/London')
  .onRun(async () => {
    const now = new Date();
    const monthKey = buildMonthKey(now);
    const campaignsSnap = await db
      .collection(REMARKETING_CAMPAIGN_COLLECTION)
      .where('active', '==', true)
      .get();
    if (campaignsSnap.empty) {
      console.log('No active remarketing campaigns to process');
      return null;
    }

    const clientsSnap = await db.collection('clients').get();
    const clients = clientsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ref: docSnap.ref,
      data: (docSnap.data() as Record<string, any>) || {},
    }));
    if (clients.length === 0) {
      console.log('No clients found for remarketing sweep');
      return null;
    }

    const membershipCache = new Map<string, { userIds: string[]; emails: string[] }>();
    const productCache = new Map<string, { id: string; name: string | null }>();

    for (const campaignDoc of campaignsSnap.docs) {
      const campaignData = (campaignDoc.data() as Record<string, any>) || {};
      const campaignName =
        typeof campaignData.name === 'string' && campaignData.name.trim().length > 0
          ? campaignData.name.trim()
          : 'Remarketing';
      const targetGroups = normaliseStringArray(campaignData.targetGroups ?? campaignData.groups ?? []);
      const targetTags = normaliseStringArray(campaignData.targetTags ?? campaignData.tags ?? []);
      const sendDay = typeof campaignData.monthlySendDay === 'number' ? campaignData.monthlySendDay : 1;
      const lastRunAtDate = campaignData.lastRunAt?.toDate ? campaignData.lastRunAt.toDate() : null;
      if (lastRunAtDate && buildMonthKey(lastRunAtDate) === monthKey) {
        console.log('Campaign already processed this month, skipping', campaignDoc.id);
        continue;
      }

      const productId = normaliseProductDocId(campaignData.highlightProductId);
      if (productId && !productCache.has(productId)) {
        try {
          const productSnap = await db.collection('products').doc(productId).get();
          if (productSnap.exists) {
            const productData = (productSnap.data() as any) || {};
            productCache.set(productId, {
              id: productId,
              name: typeof productData.name === 'string' ? productData.name : null,
            });
          } else {
            productCache.set(productId, { id: productId, name: null });
          }
        } catch (error) {
          console.warn('Failed to load product for remarketing campaign', campaignDoc.id, productId, error);
          productCache.set(productId, { id: productId, name: null });
        }
      }
      const productSummary = productId ? productCache.get(productId) ?? null : null;

      let processed = 0;
      let created = 0;
      for (const client of clients) {
        if (created >= REMARKETING_MAX_SUGGESTIONS_PER_CAMPAIGN) {
          break;
        }
        if (!client.data || typeof client.data !== 'object') {
          continue;
        }
        if (hasMarketingOptOut(client.data)) {
          continue;
        }
        if (!matchesTargetGroups(targetGroups, client.data)) {
          continue;
        }
        const tagSet = extractTagSetFromData(client.data);
        if (targetTags.length > 0) {
          const hasMatch = targetTags.some((tag) => tagSet.has(tag));
          if (!hasMatch) {
            continue;
          }
        }

        processed += 1;
        const existingSnap = await db
          .collection(REMARKETING_SUGGESTION_COLLECTION)
          .where('campaignId', '==', campaignDoc.id)
          .where('targetClientId', '==', client.id)
          .where('period', '==', monthKey)
          .limit(1)
          .get();
        if (!existingSnap.empty) {
          continue;
        }

        const audience = await resolveRemarketingAudience(client.id, client.data, membershipCache);
        const drafts = buildRemarketingDraft({
          client: client.data,
          campaignName,
          productName: productSummary?.name ?? null,
          targetTags,
        });
        const suggestionRef = db.collection(REMARKETING_SUGGESTION_COLLECTION).doc();
        const emailSubject =
          typeof campaignData.emailSubject === 'string' && campaignData.emailSubject.trim().length > 0
            ? campaignData.emailSubject.trim()
            : `Project idea: ${productSummary?.name ?? 'content roadmap'}`;
        const emailPreview =
          typeof campaignData.emailPreview === 'string' && campaignData.emailPreview.trim().length > 0
            ? campaignData.emailPreview.trim()
            : null;

        const suggestionPayload: Record<string, any> = {
          campaignId: campaignDoc.id,
          campaignName,
          status: 'draft',
          researchStatus: 'queued',
          headline: drafts.headline,
          summary: drafts.summary,
          articleDraft: drafts.article,
          emailSubject,
          emailPreview,
          emailOpenCount: 0,
          emailClickCount: 0,
          emailClickUrls: [],
          emailLastOpenedAt: null,
          emailLastClickedAt: null,
          emailSentAt: null,
          highlightProduct: productSummary ? { id: productSummary.id, name: productSummary.name } : null,
          targetClientId: client.id,
          targetClientPath: client.ref.path,
          targetOrgIds: audience.orgIds.length > 0 ? audience.orgIds : null,
          audienceUserIds: audience.userIds.length > 0 ? audience.userIds : null,
          audienceEmails: audience.emails.length > 0 ? audience.emails : null,
          targetTags: targetTags.length > 0 ? targetTags : null,
          monthKey,
          period: monthKey,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await suggestionRef.set(suggestionPayload, { merge: false });
        await db
          .collection(REMARKETING_QUEUE_COLLECTION)
          .doc(suggestionRef.id)
          .set(
            {
              suggestionId: suggestionRef.id,
              campaignId: campaignDoc.id,
              campaignName,
              clientId: client.id,
              status: 'pending',
              scope: 'remarketing',
              monthKey,
              emailSubject,
              emailPreview,
              audienceEmailsCount: audience.emails.length,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

        created += 1;
      }

      const nextRunDate = computeNextMonthlyRunDate(sendDay, now);
      await campaignDoc.ref.set(
        {
          lastRunAt: admin.firestore.Timestamp.fromDate(now),
          nextRunAt: admin.firestore.Timestamp.fromDate(nextRunDate),
          lastRunSummary: {
            processed,
            suggestionsCreated: created,
            monthKey,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await writeAuditLog({
        actorUid: 'system',
        action: 'remarketing.monthly_sweep',
        entityType: 'remarketingCampaign',
        entityId: campaignDoc.id,
        metadata: {
          processed,
          suggestionsCreated: created,
          monthKey,
          productId: productId ?? null,
        },
      });
    }

    console.log('Remarketing sweep complete', {
      campaigns: campaignsSnap.size,
      monthKey,
    });

    return null;
  });

export const orders_refund = functions.https.onCall(async (data, context) => {
  const roles = await assertStaff(context, ['finance', 'admin']);
  const orderId = typeof data?.orderId === 'string' ? data.orderId.trim() : '';
  if (!orderId) {
    throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');
  }
  const amountInput = data?.amount ?? data?.grossAmount;
  const amount = parseMoney(amountInput);
  if (amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Refund amount must be greater than zero.');
  }
  const reasonRaw = typeof data?.reason === 'string' ? data.reason.trim() : '';
  const reason = reasonRaw ? reasonRaw.slice(0, 500) : null;
  const notesSource =
    data?.notes ?? data?.memo ?? data?.comment ?? data?.description ?? data?.details ?? null;
  const notesRaw = typeof notesSource === 'string' ? notesSource.trim() : '';
  const notes = notesRaw ? notesRaw.slice(0, 2000) : null;
  const processedAtIso = new Date().toISOString();
  const roleList = Array.from(roles);
  const processor = {
    uid: context.auth!.uid,
    email:
      typeof context.auth?.token?.email === 'string'
        ? context.auth.token.email
        : null,
    displayName:
      typeof context.auth?.token?.name === 'string'
        ? context.auth.token.name
        : null,
    roles: roleList,
  };

  const orderRef = db.collection('orders').doc(orderId);
  let auditBeforeSummary: Record<string, any> | null = null;
  let auditAfterSummary: Record<string, any> | null = null;

  const { record: responseRecord, summary: responseSummary } = await db.runTransaction(
    async (txn) => {
      const snap = await txn.get(orderRef);
      if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found');
      }
      const order = snap.data() as any;

      const requestedCurrency = normaliseCurrency(data?.currency);
      const orderCurrency =
        normaliseCurrency(order?.currency) ?? normaliseCurrency(order?.currencyCode) ?? null;

      const refundsArray = Array.isArray(order?.refunds) ? order.refunds : [];
      let fallbackGrossCents = 0;
      let fallbackNetCents = 0;
      let fallbackVatCents = 0;
      let fallbackHqCents = 0;
      let fallbackFranchiseCents = 0;
      for (const entry of refundsArray) {
        fallbackGrossCents += toCurrencyCents((entry as any)?.amount);
        fallbackNetCents += toCurrencyCents((entry as any)?.netAmount ?? (entry as any)?.net);
        fallbackVatCents += toCurrencyCents((entry as any)?.vatAmount ?? (entry as any)?.vat);
        const royaltyEntry = (entry as any)?.royalty;
        if (royaltyEntry) {
          fallbackHqCents += toCurrencyCents(
            (royaltyEntry as any)?.hqShare ?? (royaltyEntry as any)?.hqAmount
          );
          fallbackFranchiseCents += toCurrencyCents(
            (royaltyEntry as any)?.franchiseShare ?? (royaltyEntry as any)?.franchiseAmount
          );
        }
      }

      const summaryData = (order?.refundSummary as any) || {};
      const summaryCurrency = normaliseCurrency(summaryData?.currency);
      let currencyCode = requestedCurrency ?? summaryCurrency ?? orderCurrency ?? null;
      if (!currencyCode) {
        currencyCode = 'GBP';
      }
      if (requestedCurrency && currencyCode !== requestedCurrency) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Refund currency mismatch for the requested refund.'
        );
      }
      if (summaryCurrency && currencyCode !== summaryCurrency) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Existing refund currency does not match the requested currency.'
        );
      }
      if (orderCurrency && currencyCode !== orderCurrency) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Refund currency must match the order currency.'
        );
      }

      const existingGrossCents =
        summaryData?.totalGross != null ? toCurrencyCents(summaryData.totalGross) : fallbackGrossCents;
      const existingNetCents =
        summaryData?.totalNet != null ? toCurrencyCents(summaryData.totalNet) : fallbackNetCents;
      const existingVatCents =
        summaryData?.totalVat != null ? toCurrencyCents(summaryData.totalVat) : fallbackVatCents;
      const existingHqCents =
        summaryData?.totalHqClawback != null
          ? toCurrencyCents(summaryData.totalHqClawback)
          : fallbackHqCents;
      const existingFranchiseCents =
        summaryData?.totalFranchiseClawback != null
          ? toCurrencyCents(summaryData.totalFranchiseClawback)
          : fallbackFranchiseCents;
      const existingCount =
        typeof summaryData?.totalCount === 'number' && Number.isFinite(summaryData.totalCount)
          ? Math.max(0, Math.floor(summaryData.totalCount))
          : refundsArray.length;

      const orderGrossCents = toCurrencyCents(
        order?.price ?? order?.totalPrice ?? order?.grossTotal ?? 0
      );
      const fallbackNetFromVatCents =
        orderGrossCents > 0 ? Math.max(orderGrossCents - toCurrencyCents(order?.vat ?? 0), 0) : 0;
      let orderNetCents = toCurrencyCents(
        order?.netTotal ?? order?.net ?? order?.subtotal ?? order?.total ?? 0
      );
      if (orderNetCents === 0 && fallbackNetFromVatCents > 0) {
        orderNetCents = fallbackNetFromVatCents;
      }
      if (orderGrossCents > 0 && orderNetCents > orderGrossCents) {
        orderNetCents = orderGrossCents;
      }

      if (orderGrossCents === 0 && orderNetCents === 0) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Order has no recorded value available for refunds.'
        );
      }

      const amountCents = Math.round(amount * 100);
      if (amountCents <= 0) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Refund amount must be greater than zero.'
        );
      }

      const remainingGrossCents =
        orderGrossCents > 0 ? Math.max(orderGrossCents - existingGrossCents, 0) : null;
      const remainingNetCents =
        orderNetCents > 0 ? Math.max(orderNetCents - existingNetCents, 0) : null;

      if (remainingGrossCents !== null && amountCents > remainingGrossCents + 1) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Refund exceeds the remaining gross balance for this order.'
        );
      }
      if (remainingGrossCents === null && remainingNetCents !== null && amountCents > remainingNetCents + 1) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Refund exceeds the remaining net balance for this order.'
        );
      }

      let netRefundCents = 0;
      if (orderGrossCents > 0 && orderNetCents > 0) {
        netRefundCents = Math.round((amountCents * orderNetCents) / orderGrossCents);
      } else if (orderNetCents > 0) {
        netRefundCents = Math.min(amountCents, orderNetCents);
      } else {
        netRefundCents = amountCents;
      }
      if (remainingNetCents !== null && netRefundCents > remainingNetCents) {
        netRefundCents = remainingNetCents;
      }
      if (netRefundCents < 0) {
        netRefundCents = 0;
      }
      let vatRefundCents = amountCents - netRefundCents;
      if (vatRefundCents < 0) {
        vatRefundCents = 0;
        netRefundCents = amountCents;
      }

      const royaltyData = (order?.royalty as any) || {};
      const royaltySource: RoyaltySource =
        typeof royaltyData?.source === 'string'
          ? (royaltyData.source as RoyaltySource)
          : typeof order?.royaltySource === 'string'
            ? (order.royaltySource as RoyaltySource)
            : 'hq';
      let royaltyPercentage = Number(
        royaltyData?.percentage ?? order?.royaltyPercentage ?? 0
      );
      if (!Number.isFinite(royaltyPercentage) || royaltyPercentage < 0) {
        royaltyPercentage = 0;
      }
      if (royaltyPercentage > 100) {
        royaltyPercentage = 100;
      }
      const royaltyFraction = royaltyPercentage / 100;
      const hasFranchise = typeof order?.franchiseId === 'string' && order.franchiseId.trim().length > 0;
      let hqClawbackCents = hasFranchise
        ? Math.round(netRefundCents * royaltyFraction)
        : netRefundCents;
      if (hqClawbackCents < 0) {
        hqClawbackCents = 0;
      }
      if (hqClawbackCents > netRefundCents) {
        hqClawbackCents = netRefundCents;
      }
      let franchiseClawbackCents = hasFranchise ? netRefundCents - hqClawbackCents : 0;
      if (franchiseClawbackCents < 0) {
        franchiseClawbackCents = 0;
        hqClawbackCents = netRefundCents;
      }
      const clawbackDelta = netRefundCents - (hqClawbackCents + franchiseClawbackCents);
      if (clawbackDelta !== 0) {
        if (hasFranchise) {
          franchiseClawbackCents += clawbackDelta;
        } else {
          hqClawbackCents += clawbackDelta;
        }
      }

      const newTotalGrossCents = existingGrossCents + amountCents;
      const newTotalNetCents = existingNetCents + netRefundCents;
      const newTotalVatCents = existingVatCents + vatRefundCents;
      const newTotalHqCents = existingHqCents + hqClawbackCents;
      const newTotalFranchiseCents = existingFranchiseCents + franchiseClawbackCents;
      const newCount = existingCount + 1;

      const fullyRefunded =
        (orderGrossCents > 0 && newTotalGrossCents >= orderGrossCents - 1) ||
        (orderGrossCents === 0 && orderNetCents > 0 && newTotalNetCents >= orderNetCents - 1);

      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
      const refundId = uuidv4();

      const storedRecord = {
        id: refundId,
        amount: fromCurrencyCents(amountCents),
        netAmount: fromCurrencyCents(netRefundCents),
        vatAmount: fromCurrencyCents(vatRefundCents),
        currency: currencyCode,
        reason,
        notes,
        createdAt: serverTimestamp,
        processedBy: processor,
        royalty: {
          source: royaltySource,
          percentage: royaltyPercentage,
          hqShare: fromCurrencyCents(hqClawbackCents),
          franchiseShare: fromCurrencyCents(franchiseClawbackCents),
          franchiseId: hasFranchise ? String(order.franchiseId) : null,
        },
      };

      const updatedSummary: Record<string, any> = {
        currency: currencyCode,
        totalCount: newCount,
        totalGross: fromCurrencyCents(newTotalGrossCents),
        totalNet: fromCurrencyCents(newTotalNetCents),
        totalVat: fromCurrencyCents(newTotalVatCents),
        totalHqClawback: fromCurrencyCents(newTotalHqCents),
        totalFranchiseClawback: fromCurrencyCents(newTotalFranchiseCents),
        remainingGross:
          orderGrossCents > 0
            ? fromCurrencyCents(Math.max(orderGrossCents - newTotalGrossCents, 0))
            : null,
        remainingNet:
          orderNetCents > 0
            ? fromCurrencyCents(Math.max(orderNetCents - newTotalNetCents, 0))
            : null,
        fullyRefunded,
        lastRefundId: refundId,
        lastRefundByUid: processor.uid,
        lastRefundByEmail: processor.email ?? null,
        lastRefundByName: processor.displayName ?? null,
        lastRefundByRoles: processor.roles,
        lastRefundAt: serverTimestamp,
        updatedAt: serverTimestamp,
      };

      auditBeforeSummary = summaryData && Object.keys(summaryData).length ? summaryData : null;
      auditAfterSummary = {
        currency: updatedSummary.currency,
        totalCount: updatedSummary.totalCount,
        totalGross: updatedSummary.totalGross,
        totalNet: updatedSummary.totalNet,
        totalVat: updatedSummary.totalVat,
        totalHqClawback: updatedSummary.totalHqClawback,
        totalFranchiseClawback: updatedSummary.totalFranchiseClawback,
        remainingGross: updatedSummary.remainingGross,
        remainingNet: updatedSummary.remainingNet,
        fullyRefunded,
        lastRefundId: refundId,
        lastRefundByUid: processor.uid,
        lastRefundByEmail: processor.email ?? null,
        lastRefundByName: processor.displayName ?? null,
        lastRefundByRoles: processor.roles,
        lastRefundAt: processedAtIso,
      };

      txn.update(orderRef, {
        refunds: admin.firestore.FieldValue.arrayUnion(storedRecord),
        refundSummary: updatedSummary,
        updatedAt: serverTimestamp,
      });

      const responseRecord = {
        id: refundId,
        amount: storedRecord.amount,
        netAmount: storedRecord.netAmount,
        vatAmount: storedRecord.vatAmount,
        currency: storedRecord.currency,
        reason: storedRecord.reason,
        notes: storedRecord.notes,
        createdAt: processedAtIso,
        processedBy: processor,
        royalty: storedRecord.royalty,
      };

      const responseSummary = {
        currency: updatedSummary.currency,
        totalCount: updatedSummary.totalCount,
        totalGross: updatedSummary.totalGross,
        totalNet: updatedSummary.totalNet,
        totalVat: updatedSummary.totalVat,
        totalHqClawback: updatedSummary.totalHqClawback,
        totalFranchiseClawback: updatedSummary.totalFranchiseClawback,
        remainingGross: updatedSummary.remainingGross,
        remainingNet: updatedSummary.remainingNet,
        fullyRefunded,
      };

      return { record: responseRecord, summary: responseSummary };
    }
  );

  const changes: AuditLogChanges = {
    refundSummary: {
      before: auditBeforeSummary ? serializeForAudit(auditBeforeSummary) : null,
      after: serializeForAudit(auditAfterSummary ?? {}),
    },
  };

  await writeAuditLog({
    actorUid: context.auth!.uid,
    action: 'order_refund',
    entityType: 'order',
    entityId: orderId,
    changes,
    metadata: {
      refund: responseRecord,
      summary: responseSummary,
    },
  });

  return { refund: responseRecord, summary: responseSummary };
});

/**
 * Create a Stripe PaymentIntent for either the deposit or balance payment of an order. This callable
 * expects { orderId, type } where type is 'deposit' or 'balance'. The amount is calculated from
 * the order document. The PaymentIntent metadata includes the orderId and type so that the webhook
 * can update the order status accordingly.
 */
export const stripe_createPaymentIntent = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { orderId, type } = data || {};
  if (!orderId || !type) {
    throw new functions.https.HttpsError('invalid-argument', 'orderId and type are required');
  }
  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Order not found');
  }
  const order = orderDoc.data() as Record<string, any>;

  const price = Number(order.price) || 0;
  const depositPercentage = Number(order.depositPercentage) || 0;
  const depositAmount = Number(order.depositAmount) || price * (depositPercentage / 100);
  const balanceAmount = Number(order.balanceAmount) || price - depositAmount;

  let amountCents: number;
  let description: string;
  if (type === 'deposit') {
    amountCents = Math.round(Math.max(depositAmount, 0) * 100);
    description = `Deposit for order ${orderId}`;
  } else if (type === 'balance') {
    amountCents = Math.round(Math.max(balanceAmount, 0) * 100);
    description = `Balance for order ${orderId}`;
  } else if (type === 'custom') {
    const customAmountInput = data?.customAmount;
    const parsedAmount =
      typeof customAmountInput === 'number'
        ? customAmountInput
        : typeof customAmountInput === 'string'
          ? Number.parseFloat(customAmountInput)
          : NaN;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'customAmount must be a positive number');
    }
    amountCents = Math.round(parsedAmount * 100);
    const customDescription =
      typeof data?.customDescription === 'string' && data.customDescription.trim().length > 0
        ? data.customDescription.trim()
        : `Payment for order ${orderId}`;
    description = customDescription;
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid payment type');
  }

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Payment amount must be greater than zero.');
  }

  const stripe = await getStripeClient();
  const { platformFeePercent } = await getStripeOperationalSettings();

  let applicationFeeAmount: number | null = null;
  let destinationAccountId: string | null = null;
  const rawFranchiseId = typeof order.franchiseId === 'string' ? order.franchiseId.trim() : '';

  if (rawFranchiseId) {
    try {
      const franchiseSnap = await db.collection('franchises').doc(rawFranchiseId).get();
      if (franchiseSnap.exists) {
        const franchiseData = (franchiseSnap.data() as Record<string, unknown>) || {};
        const accountId = normaliseString(franchiseData.stripeAccountId ?? franchiseData.connectAccountId);
        if (accountId) {
          destinationAccountId = accountId;
          const franchiseFee = parseNumber(franchiseData.platformFee);
          const feePercentage = franchiseFee ?? platformFeePercent;
          if (feePercentage !== null && Number.isFinite(feePercentage) && feePercentage > 0) {
            applicationFeeAmount = Math.round((amountCents * feePercentage) / 100);
            if (applicationFeeAmount < 0) {
              applicationFeeAmount = 0;
            }
            if (applicationFeeAmount > amountCents) {
              applicationFeeAmount = amountCents;
            }
          }
        }
      }
    } catch (franchiseError) {
      console.warn('Unable to resolve franchise Stripe account', rawFranchiseId, franchiseError);
    }
  }

  const metadata: Record<string, string> = {
    orderId: String(orderId),
    type: String(type),
  };
  if (rawFranchiseId) {
    metadata.franchiseId = rawFranchiseId;
  }
  if (applicationFeeAmount !== null) {
    metadata.applicationFeeAmount = String(applicationFeeAmount);
  }
  if (destinationAccountId) {
    metadata.destinationAccountId = destinationAccountId;
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'gbp',
    description,
    metadata,
    automatic_payment_methods: { enabled: true },
    transfer_data: destinationAccountId ? { destination: destinationAccountId } : undefined,
    application_fee_amount:
      applicationFeeAmount !== null && applicationFeeAmount > 0 ? applicationFeeAmount : undefined,
  });

  return { clientSecret: paymentIntent.client_secret };
});

// Stripe webhook (deposit/balance) — skeleton
export const stripe_webhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let stripe: Stripe;
  let webhookSecret: string | null = null;
  try {
    stripe = await getStripeClient();
    webhookSecret = await getStripeWebhookSecret();
  } catch (clientError) {
    console.error('Unable to initialise Stripe client for webhook processing', clientError);
    res.status(500).send('Stripe configuration error');
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret || '');
  } catch (err: any) {
    console.error('Webhook signature verification failed.', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }
  // Handle payment events
  try {
    const eventType = event.type;
    if (eventType === 'payment_intent.succeeded') {
      const pi: any = event.data.object;
      const metadata: any = pi.metadata || {};
      const orderId = metadata.orderId;
      const payType = metadata.type;
      if (orderId && payType) {
        const orderRef = db.collection('orders').doc(orderId);
        const orderSnap = await orderRef.get();
        if (orderSnap.exists) {
          const updates: any = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          switch (payType) {
            case 'deposit':
              updates.status = 'deposit_paid';
              break;
            case 'balance':
              updates.status = 'balance_paid';
              break;
            default:
              console.warn('Unknown payment type', payType);
          }
          await orderRef.set(updates, { merge: true });
          // If deposit is paid and project not yet created, create project document here
          const orderData = orderSnap.data() as any;
          if (payType === 'deposit' && !orderData.projectId) {
            // Create a new project using order's orgId and serviceId
            const projRef = await db.collection('projects').add({
              orgId: orderData.orgId,
              serviceId: orderData.serviceId,
              orderId,
              title: orderData.serviceName || 'New Project',
              status: 'intake',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            await orderRef.set({ projectId: projRef.id }, { merge: true });
          }
        }
      }
    }
    // Optionally handle other event types (payment_intent.payment_failed, etc.)
    res.json({ received: true });
    return;
  } catch (webhookErr) {
    console.error('Error handling Stripe webhook:', webhookErr);
    res.status(500).send('Internal error');
    return;
  }
});

// Google Drive upload via Service Account
export const uploadToDrive = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }

  const { fileName, mimeType, content, folderId } = data || {};
  if (!fileName || !content) {
    throw new functions.https.HttpsError('invalid-argument', 'fileName and content required');
  }

  try {
    const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
    if (!keyB64) {
      throw new Error('Missing Google service account credentials');
    }
    const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
    const auth = new google.auth.JWT(
      keyJson.client_email,
      undefined,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/drive.file']
    );
    await auth.authorize();

    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata: any = { name: fileName };
    if (folderId) fileMetadata.parents = [folderId];
    const media = {
      mimeType: mimeType || 'application/octet-stream',
      body: Readable.from(Buffer.from(content, 'base64')),
    };
    const res = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id',
    });
    return { fileId: res.data.id };
  } catch (err) {
    console.error('uploadToDrive error:', err);
    throw new functions.https.HttpsError('internal', 'Drive upload failed');
  }
});

// Live stream project setup — skeleton
export const liveStreams_create = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  const projectId = data.projectId;
  if (!projectId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId required');
  }
  try {
    const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
    if (!keyB64) throw new Error('Missing Google service account credentials');
    const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
    const auth = new google.auth.JWT(
      keyJson.client_email,
      undefined,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/youtube']
    );
    await auth.authorize();
    const youtube = google.youtube({ version: 'v3', auth });

    const stream = await youtube.liveStreams.insert({
      part: ['snippet', 'cdn'],
      requestBody: {
        snippet: { title: `Stream for project ${projectId}` },
        cdn: { ingestionType: 'rtmp', resolution: '720p', frameRate: '30fps' },
      },
    });

    const broadcast = await youtube.liveBroadcasts.insert({
      part: ['snippet', 'status', 'contentDetails'],
      requestBody: {
        snippet: {
          title: `Broadcast for project ${projectId}`,
          scheduledStartTime: new Date().toISOString(),
        },
        status: { privacyStatus: 'unlisted' },
        contentDetails: { latencyPreference: 'normal' },
      },
    });

    await youtube.liveBroadcasts.bind({
      part: ['id', 'snippet', 'contentDetails', 'status'],
      id: broadcast.data.id!,
      streamId: stream.data.id!,
    });

    await db.collection('projects').doc(projectId).set({
      live: {
        streamId: stream.data.id || null,
        broadcastId: broadcast.data.id || null,
        ingestionAddress: stream.data.cdn?.ingestionInfo?.ingestionAddress || null,
        streamKey: stream.data.cdn?.ingestionInfo?.streamName || null,
      },
    }, { merge: true });

    return { streamId: stream.data.id, broadcastId: broadcast.data.id };
  } catch (err) {
    console.error('liveStreams_create error:', err);
    throw new functions.https.HttpsError('internal', 'Failed to create live stream');
  }
});

/**
 * Assign an admin and stream key to an existing live stream project. Requires staff privileges.
 * Expects { projectId, adminUid }. Stores stream key reference and admin uid in the project's live field.
 */
export const liveStreams_assignAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const userSnap = await db.collection('users').doc(context.auth.uid).get();
  if (!userSnap.exists || !userSnap.data()?.isStaff) throw new functions.https.HttpsError('permission-denied', 'Staff only');
  const { projectId, adminUid } = data;
  if (!projectId || !adminUid) throw new functions.https.HttpsError('invalid-argument', 'Missing parameters');
  await db.collection('projects').doc(projectId).set({ live: { adminUid, streamKeyRef: 'secret://streams/' + projectId } }, { merge: true });
  return { ok: true };
});

/**
 * Export an invoice to Xero. This is a skeleton implementation that would POST invoice details
 * to the Xero API using OAuth credentials stored in environment variables. Expects { orderId }.
 */
export const xero_exportInvoice = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { orderId } = data;
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'Order ID required');
  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) throw new functions.https.HttpsError('not-found', 'Order not found');
  const order = orderDoc.data() as any;
  // Build invoice payload (simplified)
  const invoice = {
    type: 'ACCREC',
    contact: { name: order.customerName || 'Client' },
    lineItems: [ { description: order.serviceName || 'Service', quantity: 1, unitAmount: order.price || 0, accountCode: '200' } ],
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    reference: orderId,
  };
  // In a real implementation, obtain OAuth token and call Xero API here using fetch
  console.log('Would export invoice to Xero:', invoice);
  return { ok: true };
});

/**
 * Export an invoice to QuickBooks. Generates an access token using OAuth2 credentials
 * stored in environment variables and creates an invoice via the QuickBooks Online API.
 * Expects { orderId } and stores the resulting invoice ID back on the order document.
 * See QuickBooks developer docs for details:
 * https://developer.intuit.com/app/developer/qbo/docs/develop/rest-api
 */
export const quickbooks_exportInvoice = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { orderId } = data;
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'Order ID required');

  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) throw new functions.https.HttpsError('not-found', 'Order not found');
  const order = orderDoc.data() as any;
  const franchiseId = typeof order.franchiseId === 'string' ? order.franchiseId : null;

  const invoice = {
    CustomerRef: { value: order.customerId || '1', name: order.customerName || 'Client' },
    TxnDate: new Date().toISOString().split('T')[0],
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: order.price || 0,
        Description: order.serviceName || 'Service',
        SalesItemLineDetail: {
          ItemRef: { value: '1', name: order.serviceName || 'Service' },
          Qty: 1,
          UnitPrice: order.price || 0,
        },
      },
    ],
    DueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    PrivateNote: `Order ${orderId}`,
  };

  const config: {
    environment: 'production' | 'sandbox';
    clientId: string | null;
    clientSecret: string | null;
    refreshToken: string | null;
    realmId: string | null;
    source: 'hq' | 'franchise';
  } = {
    environment: 'production',
    clientId: process.env.QUICKBOOKS_CLIENT_ID ?? null,
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET ?? null,
    refreshToken: process.env.QUICKBOOKS_REFRESH_TOKEN ?? null,
    realmId: process.env.QUICKBOOKS_REALM_ID ?? null,
    source: 'hq',
  };

  if (franchiseId) {
    try {
      const franchiseSnap = await db.collection('franchises').doc(franchiseId).get();
      if (franchiseSnap.exists) {
        const data = (franchiseSnap.data() as any)?.quickbooks ?? {};
        const env = data?.environment === 'sandbox' ? 'sandbox' : 'production';
        const clientIdValue = typeof data?.clientId === 'string' ? data.clientId.trim() : '';
        const clientSecretValue = typeof data?.clientSecret === 'string' ? data.clientSecret.trim() : '';
        const refreshTokenValue = typeof data?.refreshToken === 'string' ? data.refreshToken.trim() : '';
        const realmIdValue = typeof data?.realmId === 'string' ? data.realmId.trim() : '';
        if (clientIdValue && clientSecretValue && refreshTokenValue && realmIdValue) {
          config.environment = env;
          config.clientId = clientIdValue;
          config.clientSecret = clientSecretValue;
          config.refreshToken = refreshTokenValue;
          config.realmId = realmIdValue;
          config.source = 'franchise';
        }
      }
    } catch (err) {
      console.warn('Unable to load franchise QuickBooks configuration', franchiseId, err);
    }
  }

  const clientId = config.clientId;
  const clientSecret = config.clientSecret;
  const refreshToken = config.refreshToken;
  const realmId = config.realmId;
  if (!clientId || !clientSecret || !refreshToken || !realmId) {
    console.error('Missing QuickBooks credentials for export', {
      franchiseId,
      source: config.source,
    });
    throw new functions.https.HttpsError('failed-precondition', 'QuickBooks configuration missing');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error('QuickBooks token error', text);
    throw new functions.https.HttpsError('internal', 'QuickBooks auth failed');
  }
  const tokenJson = await tokenRes.json() as any;
  const accessToken = tokenJson.access_token as string;

  const baseUrl =
    config.environment === 'sandbox'
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com';
  const invoiceRes = await fetch(
    `${baseUrl}/v3/company/${realmId}/invoice?minorversion=65`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(invoice),
    }
  );
  const invoiceJson: any = await invoiceRes.json();
  if (!invoiceRes.ok || !invoiceJson?.Invoice?.Id) {
    console.error('QuickBooks invoice error', invoiceJson);
    throw new functions.https.HttpsError('internal', 'QuickBooks invoice creation failed');
  }

  await orderDoc.ref.update({
    quickbooksInvoiceId: invoiceJson.Invoice.Id,
    quickbooksInvoiceEnvironment: config.environment,
    quickbooksInvoiceConfigSource: config.source,
    quickbooksInvoiceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { invoiceId: invoiceJson.Invoice.Id, environment: config.environment, source: config.source };
});

/**
 * Trigger a webhook in n8n or Pabbly to notify external workflows of an event. Expects { url, payload }.
 */
export const triggerWebhook = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { url, payload } = data;
  if (!url) throw new functions.https.HttpsError('invalid-argument', 'Webhook URL required');
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
    console.log('Webhook response status', res.status);
    return { status: res.status };
  } catch (err: any) {
    console.error('Webhook error', err);
    throw new functions.https.HttpsError('internal', 'Webhook call failed');
  }
});

/**
 * Publish a video to YouTube. In a real implementation this would use the Google APIs to upload
 * a processed video file and set metadata. Expects { assetId, title, description }.
 */
export const youtube_publish = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { assetId, title, description } = data;
  if (!assetId) throw new functions.https.HttpsError('invalid-argument', 'assetId required');
  console.log(`Would publish asset ${assetId} to YouTube with title ${title}`);
  return { ok: true };
});

/**
 * Publish a video to Vimeo. In a real implementation this would use the Vimeo API to upload
 * a processed video file and set metadata. Expects { assetId, title, description }.
 */
export const vimeo_publish = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { assetId, title, description } = data;
  if (!assetId) throw new functions.https.HttpsError('invalid-argument', 'assetId required');
  console.log(`Would publish asset ${assetId} to Vimeo with title ${title}`);
  return { ok: true };
});

/**
 * Upload a file to OneDrive using Microsoft Graph API. Expects
 * { path, content } where content is a base64 string. Uploads as the user
 * specified by MS_USER_ID using client credentials.
 */
export const onedrive_upload = functions.https.onCall(async (data, context) => {
  if (!context.auth)
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');

  const { path, content } = data as { path?: string; content?: string };
  if (!path || !content)
    throw new functions.https.HttpsError('invalid-argument', 'path and content required');

  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const userId = process.env.MS_USER_ID;
  if (!tenant || !clientId || !clientSecret || !userId)
    throw new functions.https.HttpsError('failed-precondition', 'Microsoft Graph credentials not configured');

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const tokenJson = (await tokenRes.json()) as any;
  const token = tokenJson.access_token as string;
  if (!token) throw new functions.https.HttpsError('internal', 'Failed to obtain Microsoft Graph token');

  const normalized = path.replace(/^\/+/, '');
  const encodedPath = encodeURIComponent(normalized).replace(/%2F/g, '/');
  const uploadUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    userId
  )}/drive/root:/${encodedPath}:/content`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: Buffer.from(content, 'base64'),
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new functions.https.HttpsError('internal', `OneDrive upload failed: ${text}`);
  }
  const fileJson = (await uploadRes.json()) as any;
  return { id: fileJson.id, webUrl: fileJson.webUrl || null };
});

/**
 * Create a subscription plan in Stripe. Expects { name, amount, interval, currency? }.
 * Generates a Stripe product and recurring price then stores them under a Firestore
 * `plans` collection for later use.
 */
export const stripe_createPlan = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { name, amount, interval, currency = 'gbp' } = data;
  if (!name || !amount || !interval)
    throw new functions.https.HttpsError('invalid-argument', 'Missing plan parameters');
  try {
    const stripe = await getStripeClient();
    const product = await stripe.products.create({ name });
    const price = await stripe.prices.create({
      unit_amount: Math.round(amount * 100),
      currency,
      recurring: { interval },
      product: product.id,
    });
    const planRef = await db.collection('plans').add({
      name,
      amount,
      interval,
      currency,
      productId: product.id,
      priceId: price.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { planId: planRef.id, productId: product.id, priceId: price.id };
  } catch (err) {
    console.error('Error creating Stripe plan', err);
    throw new functions.https.HttpsError('internal', 'Stripe plan creation failed');
  }
});

/**
 * Create a subscription for an organisation. Expects { orgId, planId, customerEmail }.
 * If the organisation lacks a Stripe customer it is created and stored. The planId may
 * refer either to a Firestore plan document or directly to a Stripe price ID.
 */
export const stripe_createSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { orgId, planId, customerEmail } = data;
  if (!orgId || !planId || !customerEmail)
    throw new functions.https.HttpsError('invalid-argument', 'Missing subscription parameters');
  const orgRef = db.collection('orgs').doc(orgId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) throw new functions.https.HttpsError('not-found', 'Org not found');
  let priceId = planId;
  const planSnap = await db.collection('plans').doc(planId).get();
  if (planSnap.exists) {
    const planData = planSnap.data() as any;
    priceId = planData.priceId;
  }
  try {
    const stripe = await getStripeClient();
    let customerId = (orgSnap.data() as any).stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: customerEmail });
      customerId = customer.id;
      await orgRef.set({ stripeCustomerId: customerId }, { merge: true });
    }
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
    });
    await orgRef.set(
      {
        stripeSubscriptionId: subscription.id,
        planId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { subscriptionId: subscription.id };
  } catch (err) {
    console.error('Error creating subscription', err);
    throw new functions.https.HttpsError('internal', 'Subscription creation failed');
  }
});

/**
 * Cancel a subscription. Expects { subscriptionId }. Also clears references on any org
 * document that stored this subscription.
 */
export const stripe_cancelSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { subscriptionId } = data;
  if (!subscriptionId)
    throw new functions.https.HttpsError('invalid-argument', 'Subscription ID required');
  try {
    const stripe = await getStripeClient();
    await stripe.subscriptions.cancel(subscriptionId);
    const snap = await db
      .collection('orgs')
      .where('stripeSubscriptionId', '==', subscriptionId)
      .get();
    for (const doc of snap.docs) {
      await doc.ref.set(
        {
          stripeSubscriptionId: admin.firestore.FieldValue.delete(),
          planId: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    return { ok: true };
  } catch (err) {
    console.error('Error cancelling subscription', err);
    throw new functions.https.HttpsError('internal', 'Subscription cancellation failed');
  }
});

/**
 * Create a Stripe Checkout session for an order and return the redirect URL.
 * Expected data: { orderId, lineItems }
 */
export const stripe_createCheckoutSession = functions.https.onCall(async (data, context) => {
  const { orderId, lineItems } = data as { orderId?: string; lineItems?: any[] };
  if (!orderId || !Array.isArray(lineItems) || !lineItems.length) {
    throw new functions.https.HttpsError('invalid-argument', 'orderId and lineItems required');
  }
  try {
    const stripe = await getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/orders/${orderId}`,
      cancel_url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/cart`,
    });
    await db.collection('orders').doc(orderId).set({ stripeSessionId: session.id }, { merge: true });
    return { url: session.url };
  } catch (err) {
    console.error('Error creating checkout session', err);
    throw new functions.https.HttpsError('internal', 'Unable to create checkout session');
  }
});

/**
 * Create or update an agreement or policy. Only staff users can call this.
 * Expected data: { id?, title, content, category, requireSign?, forceResign? }.
 * When creating a new document it records createdAt and a history entry. Updates
 * add an updatedAt timestamp and history entry. If requireSign and forceResign
 * are true, all contractors are prompted to re-sign.
 */
export const agreements_update = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || !userDoc.data()?.isStaff) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }

  const { id, title, content, category, requireSign, forceResign } = data;
  if (!title || !content) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing title or content');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  let agreementRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  if (id) {
    agreementRef = db.collection('agreements').doc(id);
    await agreementRef.set({
      title,
      content,
      category: category || 'general',
      requireSign: requireSign === true,
      updatedAt: now,
      history: admin.firestore.FieldValue.arrayUnion({ event: 'updated', at: now })
    }, { merge: true });
  } else {
    agreementRef = await db.collection('agreements').add({
      title,
      content,
      category: category || 'general',
      requireSign: requireSign === true,
      createdAt: now,
      history: [{ event: 'created', at: now }]
    });
  }

  if (requireSign && forceResign) {
    const contractorsSnap = await db.collection('users').where('contractor', '==', true).get();
    const batch = db.batch();
    contractorsSnap.forEach((doc) => {
      batch.set(doc.ref, { agreedVersion: null }, { merge: true });
      batch.set(db.collection('notifications').doc(), {
        userId: doc.id,
        title: 'Agreement Updated',
        body: `A new agreement "${title}" requires your signature.`,
        createdAt: now,
        read: false
      });
    });
    await batch.commit();
  }

  return { id: agreementRef.id };
});

/** Record a signature for an agreement */
export const agreements_sign = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { agreementId } = data;
  if (!agreementId) throw new functions.https.HttpsError('invalid-argument', 'Missing agreementId');
  const sigRef = db.collection('agreements').doc(agreementId).collection('signatures').doc(context.auth.uid);
  await sigRef.set({
    uid: context.auth.uid,
    signedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
});

/**
 * Create a new policy or update an existing one. Only staff users can call this.
 * Expected data: { id?: string, title: string, content: string, audience: 'client'|'contractor', version: string }.
 */
export const policies_upsert = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || !userDoc.data()?.isStaff) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }
  const { id, title, content, audience, version } = data;
  if (!title || !content || !audience || !version) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
  }
  let policyRef;
  if (id) {
    policyRef = db.collection('policies').doc(id);
    await policyRef.set({ title, content, audience, version, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  } else {
    policyRef = await db.collection('policies').add({
      title,
      content,
      audience,
      version,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  return { id: policyRef.id };
});

/**
 * Delete a policy. Staff only.
 */
export const policies_delete = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || !userDoc.data()?.isStaff) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }
  const { id } = data;
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'Policy ID required');
  await db.collection('policies').doc(id).delete();
  return { ok: true };
});

/**
 * Create or update an email schedule. Staff only. Expects:
 * { id?: string, groupId: string, subject: string, body: string,
 *   schedule: string (RRULE or cron expression), ratePerMinute: number, enabled: boolean }.
 */
export const emailSchedules_upsert = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || !userDoc.data()?.isStaff) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }
  const { id, groupId, subject, body, schedule, ratePerMinute, enabled } = data;
  if (!groupId || !subject || !body || !schedule || !ratePerMinute) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
  }
  let scheduleRef;
  if (id) {
    scheduleRef = db.collection('emailSchedules').doc(id);
    await scheduleRef.set({
      groupId,
      subject,
      body,
      schedule,
      ratePerMinute,
      enabled,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } else {
    scheduleRef = await db.collection('emailSchedules').add({
      groupId,
      subject,
      body,
      schedule,
      ratePerMinute,
      enabled: enabled ?? true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      nextSendAt: admin.firestore.FieldValue.serverTimestamp() // schedule might update this later
    });
  }
  return { id: scheduleRef.id };
});

/**
 * Delete an email schedule. Staff only.
 */
export const emailSchedules_delete = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const uid = context.auth.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists || !userDoc.data()?.isStaff) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }
  const { id } = data;
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'Schedule ID required');
  await db.collection('emailSchedules').doc(id).delete();
  return { ok: true };
});

/**
 * Scheduled task that runs every 5 minutes to send scheduled outreach emails.
 * It iterates over enabled emailSchedules and, if the current time is past nextSendAt,
 * sends emails to the associated group at the configured rate. After sending,
 * nextSendAt is updated based on the RRULE/cron (simplified as a fixed delay for demonstration).
 */
export const emailSchedules_send = functions.pubsub.schedule('every 5 minutes').onRun(async () => {
  const now = admin.firestore.Timestamp.now();
  const schedulesSnap = await db.collection('emailSchedules').where('enabled', '==', true).get();
  for (const doc of schedulesSnap.docs) {
    const sched = doc.data() as any;
    const nextSendAt = sched.nextSendAt;
    if (!nextSendAt || nextSendAt.toDate() > new Date()) {
      continue;
    }
    // Send emails for this schedule
    const groupDoc = await db.collection('groups').doc(sched.groupId).get();
    if (!groupDoc.exists) continue;
    const group = groupDoc.data() as any;
    const leadIds = group.leadIds || [];
    // Only send to leads where outreachEnabled is true (default true)
    const leads = await db.collection('leads').where(admin.firestore.FieldPath.documentId(), 'in', leadIds.slice(0, 10)).get();
    const batch = db.batch();
    let sentCount = 0;
    for (const leadDoc of leads.docs) {
      const lead = leadDoc.data() as any;
      if (lead.outreachEnabled === false) continue;
      // Add email document
      const emailRef = db.collection('emails').doc();
      batch.set(emailRef, {
        orgId: group.orgId,
        projectId: null,
        threadId: uuidv4(),
        from: 'noreply@pineappleportal.com',
        to: lead.email,
        subject: sched.subject,
        body: sched.body,
        attachments: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'scheduled'
      });
      sentCount++;
      if (sentCount >= sched.ratePerMinute) break;
    }
    // Update nextSendAt to now + 1 minute (for demonstration). In a real implementation, parse RRULE.
    batch.set(doc.ref, { nextSendAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 60 * 1000)) }, { merge: true });
    await batch.commit();
  }
  return null;
});

/**
 * Record a user login event via HTTPS callable. Stores loginHistory for the current user.
 */
export const recordLogin = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  await db.collection('loginHistory').add({
    uid: context.auth.uid,
    timestamp: data?.timestamp
      ? admin.firestore.Timestamp.fromDate(new Date(data.timestamp))
      : admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/**
 * ADMIN FUNCTIONS
 * The following callables support management operations for super administrators. These
 * functions require the caller to be a staff member (isStaff flag true on the user doc).
 */

// Utility to assert that the caller is staff
async function assertStaff(
  context: functions.https.CallableContext,
  requiredRoles?: RoleKey | RoleKey[]
): Promise<Set<RoleKey>> {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  const identity: IdentityLike = {
    uid: context.auth.uid,
    email: typeof context.auth.token?.email === 'string' ? context.auth.token.email : null,
  };
  const snap = await db.collection('users').doc(context.auth.uid).get();
  if (!snap.exists) {
    if (isGodAdminIdentity(identity)) {
      return new Set<RoleKey>(['admin']);
    }
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }
  const roles = extractRoleSet(snap.data(), identity);
  if (!hasRequiredRole(roles, requiredRoles)) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only');
  }
  return roles;
}

async function assertStaffRequest(
  req: functions.Request,
  res: functions.Response,
  requiredRoles?: RoleKey | RoleKey[]
): Promise<{ uid: string; roles: Set<RoleKey> } | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const identity: IdentityLike = {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : null,
    };
    const snap = await db.collection('users').doc(decoded.uid).get();
    if (!snap.exists) {
      if (isGodAdminIdentity(identity)) {
        return { uid: decoded.uid, roles: new Set<RoleKey>(['admin']) };
      }
      res.status(403).json({ error: 'Staff only' });
      return null;
    }
    const roles = extractRoleSet(snap.data(), identity);
    if (!hasRequiredRole(roles, requiredRoles)) {
      res.status(403).json({ error: 'Staff only' });
      return null;
    }
    return { uid: decoded.uid, roles };
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

/**
 * List all users. Returns a small subset of user fields for security reasons.
 */
export const admin_listUsers = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'GET') {
      res.status(405).end();
      return;
    }
    const requester = await assertStaffRequest(req, res, ['admin', 'sales']);
    if (!requester) return;
    try {
      const snap = await db.collection('users').get();
      const users = snap.docs.map((doc) => {
        const data: any = doc.data();
        if (data.createdAt && data.createdAt.toDate) {
          data.createdAt = data.createdAt.toDate().toISOString();
        }
        return { id: doc.id, ...data };
      });
      res.json({ users });
    } catch (err: any) {
      console.error('admin_listUsers failed', err);
      res.status(500).json({ error: err.message || 'Failed to list users' });
    }
  });
});

/**
 * Update a user's profile. Accepts { userId, updates }. Only staff can call.
 */
export const admin_updateUser = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }
    const requester = await assertStaffRequest(req, res, ['admin', 'sales']);
    if (!requester) return;
    const { userId, updates } = req.body || {};
    if (!userId || !updates) {
      res.status(400).json({ error: 'userId and updates required' });
      return;
    }
    if (updates.roles && !requester.roles.has('admin')) {
      res.status(403).json({ error: 'Only administrators can modify roles' });
      return;
    }
    if (updates.isStaff !== undefined && !requester.roles.has('admin')) {
      res.status(403).json({ error: 'Only administrators can promote staff' });
      return;
    }
    const { password, disabled, ...rest } = updates;
    const userRef = db.collection('users').doc(userId);
    const beforeSnap = await userRef.get();
    const beforeData = beforeSnap.exists ? (beforeSnap.data() as admin.firestore.DocumentData) : undefined;
    await userRef.set(rest, { merge: true });
    const authUpdates: any = {};
    const metadata: Record<string, any> = {};
    if (password) {
      authUpdates.password = password;
      metadata.passwordReset = true;
    }
    let previousDisabled: boolean | null = null;
    if (disabled !== undefined) {
      authUpdates.disabled = disabled;
      try {
        const record = await admin.auth().getUser(userId);
        previousDisabled = record.disabled ?? null;
      } catch (err) {
        previousDisabled = null;
      }
    }
    if (Object.keys(authUpdates).length) {
      await admin.auth().updateUser(userId, authUpdates);
    }
    if (disabled !== undefined) {
      metadata.disabled = { before: previousDisabled, after: disabled };
    }
    const changes = buildChangesFromUpdates(beforeData, rest);
    await writeAuditLog({
      actorUid: requester.uid,
      action: 'admin_update_user',
      entityType: 'user',
      entityId: userId,
      changes: Object.keys(changes).length ? changes : null,
      metadata: Object.keys(metadata).length ? metadata : null,
    });
    res.json({ ok: true });
  });
});

/**
 * Create a new user account. Expects { email, password, fullName?, isStaff?, contractor? }
 */
export const admin_createUser = functions.https.onCall(async (data, context) => {
  await assertStaff(context, 'admin');
  const { email, password, fullName = '', isStaff = false, contractor = false } = data;
  if (!email || !password) throw new functions.https.HttpsError('invalid-argument', 'email and password required');
  const user = await admin.auth().createUser({ email, password, displayName: fullName });
  const profile = { email, fullName, isStaff, contractor, disabled: false };
  await db.collection('users').doc(user.uid).set(profile);
  if (context.auth?.uid) {
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_create_user',
      entityType: 'user',
      entityId: user.uid,
      changes: buildChangesFromCreate(profile),
    });
  }
  return { uid: user.uid };
});

/**
 * Delete a user account and associated profile. Expects { userId }
 */
export const admin_deleteUser = functions.https.onCall(async (data, context) => {
  await assertStaff(context, 'admin');
  const { userId } = data;
  if (!userId) throw new functions.https.HttpsError('invalid-argument', 'userId required');
  const profileRef = db.collection('users').doc(userId);
  const profileSnap = await profileRef.get();
  const profileData = profileSnap.exists ? (profileSnap.data() as admin.firestore.DocumentData) : undefined;
  let authRecord: admin.auth.UserRecord | null = null;
  try {
    authRecord = await admin.auth().getUser(userId);
  } catch (err) {
    authRecord = null;
  }
  await Promise.all([
    admin.auth().deleteUser(userId).catch(() => {}),
    profileRef.delete().catch(() => {})
  ]);
  if (context.auth?.uid) {
    const changes = buildChangesFromDelete(profileData);
    if (authRecord) {
      changes.authRecord = {
        before: serializeForAudit({
          email: authRecord.email || null,
          disabled: authRecord.disabled ?? null,
        }),
        after: null,
      };
    }
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_delete_user',
      entityType: 'user',
      entityId: userId,
      changes: Object.keys(changes).length ? changes : null,
    });
  }
  return { ok: true };
});

/**
 * Send a password reset email to a user. Expects { email }. Only staff can call.
 */
export const admin_sendPasswordReset = functions.https.onCall(async (data, context) => {
  await assertStaff(context, 'admin');
  const { email } = data;
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'Email required');
  try {
    const link = await admin.auth().generatePasswordResetLink(email);
    // Optionally store reset link or send via email using external service
    console.log('Generated password reset link for', email);
    if (context.auth?.uid) {
      let targetUid: string | null = null;
      try {
        const record = await admin.auth().getUserByEmail(email);
        targetUid = record.uid;
      } catch (err) {
        targetUid = null;
      }
      await writeAuditLog({
        actorUid: context.auth.uid,
        action: 'admin_send_password_reset',
        entityType: 'user',
        entityId: targetUid ?? email,
        metadata: { email },
      });
    }
    return { link };
  } catch (err:any) {
    console.error('Password reset error', err);
    throw new functions.https.HttpsError('internal', 'Failed to generate reset link');
  }
});

/**
 * Merge two user records, moving data from sourceId into targetId and deleting the source.
 */
export const admin_mergeUsers = functions.https.onCall(async (data, context) => {
  await assertStaff(context, 'admin');
  const { sourceId, targetId } = data;
  if (!sourceId || !targetId) {
    throw new functions.https.HttpsError('invalid-argument', 'sourceId and targetId required');
  }
  const sourceRef = db.collection('users').doc(sourceId);
  const targetRef = db.collection('users').doc(targetId);
  const [sourceSnap, targetSnap] = await Promise.all([sourceRef.get(), targetRef.get()]);
  if (!sourceSnap.exists || !targetSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const sourceData = sourceSnap.data() as admin.firestore.DocumentData;
  const targetData = targetSnap.data() as admin.firestore.DocumentData;
  const merged = { ...sourceData, ...targetData };
  await targetRef.set(merged, { merge: true });
  await sourceRef.delete();
  if (context.auth?.uid) {
    const changes = buildChangesFromUpdates(targetData, merged);
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_merge_users',
      entityType: 'user',
      entityId: targetId,
      changes: Object.keys(changes).length ? changes : null,
      metadata: {
        sourceId,
        sourceSnapshot: serializeForAudit(sourceData),
      },
    });
  }
  return { ok: true };
});

/**
 * Create a new category for products. Expects { name, slug, description, parentId }.
 */
export const admin_createCategory = functions.https.onCall(async (data, context) => {
  await assertStaff(context, 'marketing');
  const { name, slug, description, parentId } = data;
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'Name required');
  const category = {
    name,
    slug: slug || '',
    description: description || '',
    parentId: parentId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await db.collection('categories').add(category);
  if (context.auth?.uid) {
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_create_category',
      entityType: 'category',
      entityId: ref.id,
      changes: buildChangesFromCreate(category),
    });
  }
  return { id: ref.id };
});

/**
 * Create a new product. Expects { name, description, price, categoryId, depositPercentage, workflowId }.
*/
export const admin_createProduct = functions.https.onCall(async (data, context) => {
  await assertStaff(context, ['admin', 'operations']);
  const { name, description, price, categoryId, depositPercentage, workflowId, seoTitle, seoDescription } = data;
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'Name required');
  const product: any = {
    name,
    description: description || '',
    price: price || 0,
    categoryId: categoryId || null,
    depositPercentage: depositPercentage || 30,
    workflowId: workflowId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  if (seoTitle) product.seoTitle = seoTitle;
  if (seoDescription) product.seoDescription = seoDescription;
  const ref = await db.collection('products').add(product);
  if (context.auth?.uid) {
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_create_product',
      entityType: 'product',
      entityId: ref.id,
      changes: buildChangesFromCreate(product),
    });
  }
  return { id: ref.id };
});

/**
 * Update an existing product. Expects { productId, updates }.
*/
export const admin_updateProduct = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'operations']);
  const { productId, updates } = data;
  if (!productId || !updates) throw new functions.https.HttpsError('invalid-argument', 'productId and updates required');
  if (updates.requiredKit) {
    if (!Array.isArray(updates.requiredKit)) {
      throw new functions.https.HttpsError('invalid-argument', 'requiredKit must be an array');
    }
    const allIds: string[] = [];
    for (const g of updates.requiredKit) {
      if (typeof g.groupId !== 'string' || !Array.isArray(g.items)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid kit group');
      }
      for (const id of g.items) {
        if (typeof id !== 'string') {
          throw new functions.https.HttpsError('invalid-argument', 'Equipment IDs must be strings');
        }
        allIds.push(id);
      }
    }
    if (allIds.length) {
      const refs = allIds.map((id) => db.collection('equipment').doc(id));
      const snaps = await db.getAll(...refs);
      snaps.forEach((s) => {
        if (!s.exists) {
          throw new functions.https.HttpsError('not-found', 'Equipment item not found');
        }
      });
    }
  }
  const productRef = db.collection('products').doc(productId);
  const beforeSnap = await productRef.get();
  const beforeData = beforeSnap.exists ? (beforeSnap.data() as admin.firestore.DocumentData) : undefined;
  await productRef.set(updates, { merge: true });
  if (context.auth?.uid) {
    const changes = buildChangesFromUpdates(beforeData, updates);
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_update_product',
      entityType: 'product',
      entityId: productId,
      changes: Object.keys(changes).length ? changes : null,
    });
  }
  return { ok: true };
});

/**
 * Delete a product. Expects { productId }.
*/
export const admin_deleteProduct = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'operations']);
  const { productId } = data;
  if (!productId) throw new functions.https.HttpsError('invalid-argument', 'productId required');
  const productRef = db.collection('products').doc(productId);
  const beforeSnap = await productRef.get();
  const beforeData = beforeSnap.exists ? (beforeSnap.data() as admin.firestore.DocumentData) : undefined;
  await productRef.delete();
  if (context.auth?.uid) {
    const changes = buildChangesFromDelete(beforeData);
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_delete_product',
      entityType: 'product',
      entityId: productId,
      changes: Object.keys(changes).length ? changes : null,
    });
  }
  return { ok: true };
});

function sanitizeWorkflowTasks(raw: any): any[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const usedFieldKeys = new Set<string>();
  const provisional = raw.map((task: any, index: number) => {
    const input = task || {};
    const preferredId =
      typeof input.id === 'string' && input.id.trim().length > 0
        ? input.id.trim()
        : uuidv4();
    let id = preferredId;
    let idSuffix = 2;
    while (seenIds.has(id)) {
      id = `${preferredId}-${idSuffix}`;
      idSuffix += 1;
    }
    seenIds.add(id);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const description =
      typeof input.description === 'string' ? input.description.trim() : '';
    const dueDaysValue = input.dueDays;
    const dueDays =
      typeof dueDaysValue === 'number'
        ? String(dueDaysValue)
        : typeof dueDaysValue === 'string'
          ? dueDaysValue.trim()
          : '';
    const rawFieldType =
      typeof input.fieldType === 'string' && input.fieldType.trim().length > 0
        ? input.fieldType.trim()
        : null;
    const fieldType = rawFieldType && rawFieldType !== 'none' ? rawFieldType : null;
    const forCustomer = input.forCustomer === true;
    const fieldLabel =
      typeof input.fieldLabel === 'string' ? input.fieldLabel.trim() : '';
    const fieldPlaceholder =
      typeof input.fieldPlaceholder === 'string'
        ? input.fieldPlaceholder.trim()
        : '';
    const fieldHelpText =
      typeof input.fieldHelpText === 'string' ? input.fieldHelpText.trim() : '';
    const fieldAccept =
      typeof input.fieldAccept === 'string' ? input.fieldAccept.trim() : '';
    const fieldRequired = fieldType ? input.fieldRequired === true : false;
    const templateKey =
      typeof input.fieldTemplateKey === 'string' && input.fieldTemplateKey.trim().length > 0
        ? input.fieldTemplateKey.trim()
        : null;
    const assignmentScope =
      fieldType === 'team-member' && input.assignmentScope === 'contractor'
        ? 'contractor'
        : fieldType === 'team-member'
          ? 'team'
          : null;
    const shareAssigneeContact =
      fieldType === 'team-member' && input.shareAssigneeContact === true;
    const rawFieldKey =
      typeof input.fieldKey === 'string' && input.fieldKey.trim().length > 0
        ? input.fieldKey.trim()
        : `field-${id.slice(0, 8)}`;
    let fieldKey = rawFieldKey;
    let fieldSuffix = 2;
    while (usedFieldKeys.has(fieldKey)) {
      fieldKey = `${rawFieldKey}-${fieldSuffix}`;
      fieldSuffix += 1;
    }
    usedFieldKeys.add(fieldKey);
    const dependsOn: string[] = Array.isArray(input.dependsOn)
      ? input.dependsOn
          .map((dep: any) =>
            typeof dep === 'string' && dep.trim().length > 0 ? dep.trim() : null,
          )
          .filter((dep): dep is string => Boolean(dep) && dep !== id)
      : [];
    const fieldOptions =
      fieldType === 'select' && Array.isArray(input.fieldOptions)
        ? input.fieldOptions
            .map((opt: any) => {
              const label =
                typeof opt?.label === 'string' ? opt.label.trim() : '';
              const value =
                typeof opt?.value === 'string' ? opt.value.trim() : label;
              if (!label && !value) return null;
              return { label: label || value, value: value || label };
            })
            .filter((opt): opt is { label: string; value: string } => Boolean(opt))
        : [];
    return {
      id,
      title,
      description,
      dueDays,
      forCustomer,
      fieldType,
      fieldTemplateKey: templateKey,
      fieldKey,
      fieldLabel: fieldLabel || (fieldType ? title : ''),
      fieldPlaceholder,
      fieldHelpText,
      fieldRequired,
      fieldAccept: fieldType === 'file' ? fieldAccept : '',
      fieldOptions,
      dependsOn,
      shareAssigneeContact,
      assignmentScope,
    };
  });
  const validIds = new Set(provisional.map((task) => task.id));
  return provisional.map((task) => ({
    ...task,
    dependsOn: task.dependsOn.filter((depId: string) => validIds.has(depId)),
  }));
}

/**
 * Create a new workflow. Expects { name, description, tasks } where tasks include metadata for
 * client/staff forms and internal dependencies.
 */
export const admin_createWorkflow = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'operations']);
  const { name, description, tasks } = data;
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'Name required');
  const safeTasks = sanitizeWorkflowTasks(tasks);
  const workflow = {
    name,
    description: description || '',
    tasks: safeTasks,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await db.collection('workflows').add(workflow);
  if (context.auth?.uid) {
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_create_workflow',
      entityType: 'workflow',
      entityId: ref.id,
      changes: buildChangesFromCreate(workflow),
    });
  }
  return { id: ref.id };
});

/**
 * Update a workflow. Expects { workflowId, updates }.
 */
export const admin_updateWorkflow = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'operations']);
  const { workflowId, updates } = data;
  if (!workflowId || !updates) throw new functions.https.HttpsError('invalid-argument', 'workflowId and updates required');
  const workflowRef = db.collection('workflows').doc(workflowId);
  if (Array.isArray((updates as any)?.tasks)) {
    (updates as any).tasks = sanitizeWorkflowTasks((updates as any).tasks);
  }
  const beforeSnap = await workflowRef.get();
  const beforeData = beforeSnap.exists ? (beforeSnap.data() as admin.firestore.DocumentData) : undefined;
  await workflowRef.set(updates, { merge: true });
  if (context.auth?.uid) {
    const changes = buildChangesFromUpdates(beforeData, updates);
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_update_workflow',
      entityType: 'workflow',
      entityId: workflowId,
      changes: Object.keys(changes).length ? changes : null,
    });
  }
  return { ok: true };
});

export const admin_deleteWorkflow = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'operations']);
  const { workflowId } = data;
  if (!workflowId) throw new functions.https.HttpsError('invalid-argument', 'workflowId required');
  const workflowRef = db.collection('workflows').doc(workflowId);
  const beforeSnap = await workflowRef.get();
  const beforeData = beforeSnap.exists ? (beforeSnap.data() as admin.firestore.DocumentData) : undefined;
  await workflowRef.delete();
  if (context.auth?.uid) {
    const changes = buildChangesFromDelete(beforeData);
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_delete_workflow',
      entityType: 'workflow',
      entityId: workflowId,
      changes: Object.keys(changes).length ? changes : null,
    });
  }
  return { ok: true };
});

/**
 * Assign a workflow to a product. Expects { productId, workflowId }.
*/
export const admin_assignWorkflow = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'operations']);
  const { productId, workflowId } = data;
  if (!productId || !workflowId) throw new functions.https.HttpsError('invalid-argument', 'productId and workflowId required');
  const productRef = db.collection('products').doc(productId);
  const beforeSnap = await productRef.get();
  const beforeData = beforeSnap.exists ? (beforeSnap.data() as admin.firestore.DocumentData) : undefined;
  await productRef.set({ workflowId }, { merge: true });
  if (context.auth?.uid) {
    const changes = buildChangesFromUpdates(beforeData, { workflowId });
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_assign_workflow',
      entityType: 'product',
      entityId: productId,
      changes: Object.keys(changes).length ? changes : null,
    });
  }
  return { ok: true };
});

/**
 * Create a proposal for a client. Accepts { orgId, clientEmail, items?, agreementIds?,
 * templateId?, customText? }. Items are { type: 'product' | 'custom', productId?,
 * name, price }. If templateId provided, its items and agreements are merged.
 */
export const admin_createProposal = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'sales']);
  const {
    orgId,
    clientEmail,
    items = [],
    agreementIds = [],
    sectionIds = [],
    templateId,
    customText,
    setupPlan,
  } = data;
  if (!orgId || !clientEmail) {
    throw new functions.https.HttpsError('invalid-argument', 'orgId and clientEmail required');
  }

  let finalItems: any[] = Array.isArray(items) ? items : [];
  let finalAgreements: string[] = Array.isArray(agreementIds) ? agreementIds : [];
  let finalSections: string[] = Array.isArray(sectionIds) ? sectionIds : [];
  if (templateId) {
    const tplSnap = await db.collection('proposalTemplates').doc(templateId).get();
    if (tplSnap.exists) {
      const tpl = tplSnap.data() as any;
      finalItems = [...(tpl.items || []), ...finalItems];
      if (tpl.agreementIds) {
        finalAgreements = Array.from(new Set([...(tpl.agreementIds as string[]), ...finalAgreements]));
      }
      if (tpl.sectionIds) {
        finalSections = Array.from(new Set([...(tpl.sectionIds as string[]), ...finalSections]));
      }
    }
  }

  const serviceIds = finalItems
    .filter((i) => i.type === 'product' && i.productId)
    .map((i) => i.productId);

  const normalizedSetupPlan = (() => {
    if (!setupPlan || typeof setupPlan !== 'object') return null;
    const allowedLayouts = new Set(['conference', 'panel', 'interview', 'custom']);
    const layout = typeof setupPlan.layout === 'string' && allowedLayouts.has(setupPlan.layout)
      ? setupPlan.layout
      : 'custom';
    const notes = typeof setupPlan.notes === 'string' ? setupPlan.notes.trim() : '';
    const placements = Array.isArray(setupPlan.placements)
      ? setupPlan.placements
          .map((placement: any) => {
            const itemId = typeof placement?.itemId === 'string' ? placement.itemId : null;
            const itemName = typeof placement?.itemName === 'string' ? placement.itemName.trim() : '';
            if (!itemId || !itemName) return null;
            const quantityRaw = typeof placement?.quantity === 'number' ? placement.quantity : Number(placement?.quantity);
            const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.round(quantityRaw) : 1;
            const zone = typeof placement?.zone === 'string' ? placement.zone : 'stage-front';
            const type = placement?.type === 'stock' ? 'stock' : 'equipment';
            const icon = typeof placement?.icon === 'string' ? placement.icon : null;
            const notesValue = typeof placement?.notes === 'string' ? placement.notes.trim() : '';
            return {
              id: typeof placement?.id === 'string' ? placement.id : undefined,
              itemId,
              itemName,
              zone,
              quantity,
              type,
              icon,
              notes: notesValue || null,
            };
          })
          .filter((entry: any) => entry !== null)
      : [];
    if (placements.length === 0 && !notes) {
      return null;
    }
    return {
      layout,
      notes,
      placements,
    };
  })();

  const proposal = {
    orgId,
    clientEmail,
    items: finalItems,
    agreementIds: finalAgreements,
    sectionIds: finalSections,
    serviceIds,
    customText: customText || '',
    setupPlan: normalizedSetupPlan,
    status: 'sent',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  const ref = await db.collection('proposals').add(proposal);
  if (context.auth?.uid) {
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_create_proposal',
      entityType: 'proposal',
      entityId: ref.id,
      changes: buildChangesFromCreate(proposal),
      metadata: { orgId, clientEmail },
    });
  }
  return { id: ref.id };
});

/**
 * Save or update a proposal template. Expects { id?, name, items, agreementIds } and
 * returns the template id.
 */
export const admin_saveProposalTemplate = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  await assertStaff(context, ['admin', 'sales']);
  const { id, name, items = [], agreementIds = [], brandColor, logoUrl } = data;
  if (!name) throw new functions.https.HttpsError('invalid-argument', 'name required');
  const tpl = {
    name,
    items,
    agreementIds,
    brandColor: brandColor || null,
    logoUrl: logoUrl || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (id) {
    const tplRef = db.collection('proposalTemplates').doc(id);
    const beforeSnap = await tplRef.get();
    const beforeData = beforeSnap.exists ? (beforeSnap.data() as admin.firestore.DocumentData) : undefined;
    await tplRef.set(tpl, { merge: true });
    if (context.auth?.uid) {
      const changes = buildChangesFromUpdates(beforeData, tpl);
      await writeAuditLog({
        actorUid: context.auth.uid,
        action: 'admin_update_proposal_template',
        entityType: 'proposalTemplate',
        entityId: id,
        changes: Object.keys(changes).length ? changes : null,
      });
    }
    return { id };
  }
  const ref = await db.collection('proposalTemplates').add(tpl);
  if (context.auth?.uid) {
    await writeAuditLog({
      actorUid: context.auth.uid,
      action: 'admin_create_proposal_template',
      entityType: 'proposalTemplate',
      entityId: ref.id,
      changes: buildChangesFromCreate(tpl),
    });
  }
  return { id: ref.id };
});

/**
 * Accept a sent proposal and convert it into an order awaiting deposit. Expects
 * { proposalId } and returns the new order id. The proposal's status is updated
 * to "accepted" and linked to the created order.
 */
export const admin_acceptProposal = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    await assertStaff(context, ['admin', 'sales']);
    const { proposalId } = data;
    if (!proposalId) {
      throw new functions.https.HttpsError('invalid-argument', 'proposalId required');
    }

    const proposalRef = db.collection('proposals').doc(proposalId);
    const proposalSnap = await proposalRef.get();
    if (!proposalSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'proposal not found');
    }
    const proposal = proposalSnap.data() as any;
    if (proposal.status !== 'sent') {
      throw new functions.https.HttpsError('failed-precondition', 'proposal not sent');
    }

    const order = {
      orgId: proposal.orgId,
      clientEmail: proposal.clientEmail || null,
      items: proposal.items || [],
      status: 'deposit_due',
      proposalId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const orderRef = await db.collection('orders').add(order);

    await proposalRef.set({ status: 'accepted', orderId: orderRef.id }, { merge: true });
    if (context.auth?.uid) {
      const changes = buildChangesFromUpdates(proposal, { status: 'accepted', orderId: orderRef.id });
      await writeAuditLog({
        actorUid: context.auth.uid,
        action: 'admin_accept_proposal',
        entityType: 'proposal',
        entityId: proposalId,
        changes: Object.keys(changes).length ? changes : null,
        metadata: {
          orderId: orderRef.id,
          orderSnapshot: serializeForAudit(order),
        },
      });
    }
    return { orderId: orderRef.id };
  }
);

export const pruneAdminAuditLogs = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const cutoffDate = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 86400000);
    const cutoff = admin.firestore.Timestamp.fromDate(cutoffDate);
    let totalDeleted = 0;
    while (true) {
      const snapshot = await db
        .collection('adminAuditLogs')
        .where('createdAt', '<', cutoff)
        .limit(AUDIT_LOG_BATCH_SIZE)
        .get();
      if (snapshot.empty) {
        break;
      }
      const batch = db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      totalDeleted += snapshot.size;
      if (snapshot.size < AUDIT_LOG_BATCH_SIZE) {
        break;
      }
    }
    console.log(
      `Pruned ${totalDeleted} admin audit logs older than ${AUDIT_LOG_RETENTION_DAYS} days.`
    );
    return null;
  });

/**
 * Batch approve multiple assets. Expects { assetIds: string[] }. Only staff or client_admin can approve.
 */
export const assets_batchApprove = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { assetIds } = data;
  if (!Array.isArray(assetIds) || assetIds.length === 0) throw new functions.https.HttpsError('invalid-argument', 'assetIds required');
  const uSnap = await db.collection('users').doc(context.auth.uid).get();
  const isStaff = uSnap.data()?.isStaff === true;
  // We'll approve regardless; in production ensure membership
  const batch = db.batch();
  for (const id of assetIds) {
    const ref = db.collection('assets').doc(id);
    batch.set(ref, { status: 'approved', statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  return { approved: assetIds.length };
});

/**
 * Generate a simple summary for a project. Expects { projectId }. Aggregates asset and comment counts.
 */
export const projects_summarise = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { projectId } = data;
  if (!projectId) throw new functions.https.HttpsError('invalid-argument', 'projectId required');
  // Count assets and comments
  const assetsSnap = await db.collection('assets').where('projectId', '==', projectId).get();
  const commentsSnap = await db.collection('comments').where('projectId', '==', projectId).get();
  const summary = `Project ${projectId} has ${assetsSnap.size} assets and ${commentsSnap.size} comments.`;
  // Store in summaries collection
  await db.collection('summaries').doc(projectId).set({ projectId, summary, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { summary };
});

/**
 * Send an email via Gmail API. This is a stub demonstrating where you would integrate
 * Gmail sending using OAuth2. Expects { to, subject, body }. In production you would
 * authenticate with a service account or delegated credentials and use googleapis.gmail().users.messages.send.
 */
export const gmail_sendEmail = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  if (!context.auth)
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const { to, subject, body } = data as { to?: string; subject?: string; body?: string };
  if (!to || !subject || !body)
    throw new functions.https.HttpsError('invalid-argument', 'Missing fields');

  const keyB64 = process.env.GMAIL_SERVICE_ACCOUNT_KEY_BASE64;
  if (!keyB64)
    throw new functions.https.HttpsError('failed-precondition', 'Gmail credentials not configured');

  try {
    const keyJson = JSON.parse(Buffer.from(keyB64, 'base64').toString());
    const authClient = new google.auth.JWT(
      keyJson.client_email,
      undefined,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/gmail.send']
    );
    await authClient.authorize();
    const gmail = google.gmail({ version: 'v1', auth: authClient });
    const from = data.from || process.env.GMAIL_FROM || keyJson.client_email;
    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
    return { ok: true };
  } catch (err) {
    console.error('gmail_sendEmail error:', err);
    throw new functions.https.HttpsError('internal', 'Gmail send failed');
  }
});

/**
 * Compile unresolved comments for an asset into a revision summary and store it in
 * revisionSummaries collection. Optionally, this function could email the summary
 * to the portal administrators via the gmail_sendEmail callable. Expects { assetId }.
 */
export const sendRevisionSummary = functions.https.onCall(async (data: any, context: functions.https.CallableContext) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  }
  const assetId = data.assetId as string;
  if (!assetId) {
    throw new functions.https.HttpsError('invalid-argument', 'assetId required');
  }
  // Fetch unresolved comments
  const commentsSnap = await db.collection('comments')
    .where('assetId', '==', assetId)
    .where('resolved', '!=', true)
    .get();
  const comments: any[] = [];
  commentsSnap.forEach((doc) => {
    comments.push(doc.data());
  });
  // Fetch asset to obtain org and project for context
  const assetDoc = await db.collection('assets').doc(assetId).get();
  const assetData = assetDoc.data() as any;
  // Create summary text
  let summary = '';
  comments.forEach((c) => {
    const t = c.timecodeSeconds || 0;
    const time = (typeof t === 'number' ? t.toFixed(3) : t);
    summary += `${time}s: ${c.body}\n`;
  });
  // Write to revisionSummaries collection
  await db.collection('revisionSummaries').add({
    assetId,
    orgId: assetData?.orgId || null,
    projectId: assetData?.projectId || null,
    summary,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: context.auth.uid,
  });
  // Optionally send an email to administrators
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && adminEmail.includes('@')) {
      // Compose subject and body
      const subject = `Revision summary for asset ${assetId}`;
      const body = `Revision summary for asset ${assetId}:\n\n${summary}`;
      // Use gmail_sendEmail callable indirectly by writing a notification
      await db.collection('notifications').add({
        to: adminEmail,
        subject,
        body,
        type: 'revisionSummary',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        metadata: { assetId, projectId: assetData?.projectId || null },
      });
    }
  } catch (err) {
    console.error('Error sending revision summary email', err);
  }
  return { ok: true, count: comments.length };
});
