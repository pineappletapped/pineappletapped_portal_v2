import 'server-only';

import Stripe from 'stripe';

import { getFirebaseAdminFirestore } from './firebase-admin';

type FirestoreTimestamp = { toMillis(): number } | { seconds: number; nanoseconds: number };

export interface StripeSplitTerm {
  label: string;
  percentage: number;
  dueDays: number | null;
}

export interface StripeConnectSettings {
  publishableKey: string | null;
  secretKey: string | null;
  secretKeyLast4: string | null;
  webhookSecret: string | null;
  webhookSecretLast4: string | null;
  platformFeePercent: number | null;
  defaultPayoutScheduleDays: number | null;
  splitTerms: StripeSplitTerm[];
  updatedAt: Date | null;
  updatedBy: { uid: string | null; email: string | null } | null;
}

const SETTINGS_COLLECTION = 'settings';
const SETTINGS_DOC_ID = 'stripeConnect';
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2024-04-10';

function createEmptySettings(): StripeConnectSettings {
  return {
    publishableKey: null,
    secretKey: null,
    secretKeyLast4: null,
    webhookSecret: null,
    webhookSecretLast4: null,
    platformFeePercent: null,
    defaultPayoutScheduleDays: null,
    splitTerms: [],
    updatedAt: null,
    updatedBy: null,
  };
}

let cachedSettings:
  | {
      data: StripeConnectSettings;
      versionKey: string | null;
    }
  | null = null;
let cachedStripeClient: { instance: Stripe; secret: string } | null = null;

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object') {
    const ts = value as FirestoreTimestamp;
    if (typeof (ts as any).toDate === 'function') {
      try {
        return (ts as any).toDate();
      } catch (error) {
        console.warn('Failed to convert Firestore timestamp via toDate()', error);
      }
    }
    if ('toMillis' in ts && typeof ts.toMillis === 'function') {
      return new Date(ts.toMillis());
    }
    if (typeof (ts as any).seconds === 'number' && typeof (ts as any).nanoseconds === 'number') {
      const millis = (ts as any).seconds * 1000 + Math.floor((ts as any).nanoseconds / 1_000_000);
      return new Date(millis);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }
  return null;
}

function normaliseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePercentage(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseSplitTerms(value: unknown): StripeSplitTerm[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const data = entry as Record<string, unknown>;
      const label = normaliseString(data.label ?? data.name ?? data.title);
      const percentage = parsePercentage(data.percentage ?? data.percent ?? data.share);
      const dueDays = parseInteger(data.dueDays ?? data.days ?? data.offsetDays ?? data.dueInDays);
      if (!label || percentage === null) {
        return null;
      }
      return {
        label,
        percentage,
        dueDays: dueDays ?? null,
      } satisfies StripeSplitTerm;
    })
    .filter((term): term is StripeSplitTerm => Boolean(term));
}

function buildVersionKey(snapshot: FirebaseFirestore.DocumentSnapshot): string | null {
  const updateTime = snapshot.updateTime ?? (snapshot as any)._updateTime ?? null;
  if (!updateTime) {
    return null;
  }
  if (typeof (updateTime as any).toMillis === 'function') {
    return String((updateTime as any).toMillis());
  }
  if (typeof (updateTime as any).seconds === 'number') {
    return `${(updateTime as any).seconds}:${(updateTime as any).nanoseconds ?? 0}`;
  }
  return null;
}

export async function getStripeConnectSettings(options?: { forceRefresh?: boolean }): Promise<StripeConnectSettings> {
  if (!options?.forceRefresh && cachedSettings) {
    return cachedSettings.data;
  }

  let snapshot: FirebaseFirestore.DocumentSnapshot;
  try {
    const firestore = getFirebaseAdminFirestore();
    const docRef = firestore.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID);
    snapshot = await docRef.get();
  } catch (error) {
    console.warn('Failed to load Stripe configuration', error);
    const fallback = createEmptySettings();
    cachedSettings = { data: fallback, versionKey: null };
    return fallback;
  }

  const raw = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : {};

  const publishableKey = normaliseString(raw.publishableKey ?? raw.publicKey);
  const secretKey = normaliseString(raw.secretKey ?? raw.privateKey ?? raw.secret);
  const secretKeyLast4 = normaliseString(raw.secretKeyLast4 ?? raw.secretLast4 ?? raw.secretSuffix);
  const webhookSecret = normaliseString(raw.webhookSecret ?? raw.webhookSigningSecret);
  const webhookSecretLast4 = normaliseString(raw.webhookSecretLast4 ?? raw.webhookSuffix);
  const platformFeePercent = parsePercentage(raw.platformFeePercent ?? raw.applicationFeePercent ?? raw.platformFee);
  const defaultPayoutScheduleDays = parseInteger(raw.defaultPayoutScheduleDays ?? raw.payoutScheduleDays);
  const splitTerms = parseSplitTerms(raw.splitTerms ?? raw.splitPaymentTerms ?? raw.paymentSchedule);
  const updatedAt = toDate(raw.updatedAt ?? raw.lastUpdatedAt ?? raw.syncedAt);
  const updatedByRaw = raw.updatedBy;
  const updatedBy =
    updatedByRaw && typeof updatedByRaw === 'object'
      ? {
          uid: normaliseString((updatedByRaw as Record<string, unknown>).uid) || null,
          email: normaliseString((updatedByRaw as Record<string, unknown>).email) || null,
        }
      : null;

  const settings: StripeConnectSettings = {
    publishableKey,
    secretKey,
    secretKeyLast4,
    webhookSecret,
    webhookSecretLast4,
    platformFeePercent,
    defaultPayoutScheduleDays,
    splitTerms,
    updatedAt,
    updatedBy,
  };

  cachedSettings = {
    data: settings,
    versionKey: buildVersionKey(snapshot),
  };

  return settings;
}

export function invalidateStripeSettingsCache() {
  cachedSettings = null;
}

export async function getStripeSecretKey(): Promise<string | null> {
  const envSecret = normaliseString(process.env.STRIPE_SECRET_KEY);
  if (envSecret) {
    return envSecret;
  }
  const settings = await getStripeConnectSettings();
  return settings.secretKey;
}

export async function getStripeWebhookSecret(): Promise<string | null> {
  const envSecret = normaliseString(process.env.STRIPE_WEBHOOK_SECRET);
  if (envSecret) {
    return envSecret;
  }
  const settings = await getStripeConnectSettings();
  return settings.webhookSecret;
}

export async function getStripeClient(): Promise<Stripe | null> {
  const secret = await getStripeSecretKey();
  if (!secret) {
    return null;
  }
  if (cachedStripeClient && cachedStripeClient.secret === secret) {
    return cachedStripeClient.instance;
  }
  const instance = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  cachedStripeClient = { instance, secret };
  return instance;
}

export function resetStripeClientCache() {
  cachedStripeClient = null;
}

export function summariseSecret(secret: string | null | undefined): { masked: string; last4: string | null } {
  if (!secret) {
    return { masked: 'Not configured', last4: null };
  }
  const last4 = secret.slice(-4);
  return {
    masked: `•••• ${last4}`,
    last4,
  };
}
