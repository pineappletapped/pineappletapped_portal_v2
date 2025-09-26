import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { z } from 'zod';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  getStripeConnectSettings,
  getStripeSecretKey,
  invalidateStripeSettingsCache,
  resetStripeClientCache,
  resetStripeSecretCache,
} from '@/lib/stripe-config';
import { createSecretConfig, writeSecretValue } from '@/lib/secret-manager';
import { extractUserRoles, hasRole, type UserRoles } from '@/lib/roles';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2024-04-10';

const SECRET_KEY_CONFIG = createSecretConfig(
  process.env.STRIPE_SECRET_KEY_SECRET_NAME,
  process.env.STRIPE_SECRET_KEY,
  'Stripe secret key'
);
const WEBHOOK_SECRET_CONFIG = createSecretConfig(
  process.env.STRIPE_WEBHOOK_SECRET_SECRET_NAME,
  process.env.STRIPE_WEBHOOK_SECRET,
  'Stripe webhook secret'
);

type AdminContext = { uid: string; email: string | null; roles: UserRoles };

function formatStripeError(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError && error.message) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Unknown Stripe error';
}

async function verifySecretKey(secret: string): Promise<string> {
  const trimmed = secret.trim();
  if (!/^sk_(live|test)_/i.test(trimmed)) {
    throw new Error('Stripe secret keys must begin with sk_live_ or sk_test_.');
  }
  const client = new Stripe(trimmed, { apiVersion: STRIPE_API_VERSION });
  try {
    await client.accounts.retrieve();
  } catch (error) {
    throw new Error(`Stripe rejected the secret key: ${formatStripeError(error)}.`);
  }
  return trimmed;
}

async function verifyWebhookSecret(secret: string, stripeClient: Stripe): Promise<string> {
  const trimmed = secret.trim();
  if (!/^whsec_[A-Za-z0-9]{16,}$/i.test(trimmed)) {
    throw new Error('Webhook signing secrets must begin with whsec_ and contain at least 16 characters.');
  }
  try {
    const endpoints = await stripeClient.webhookEndpoints.list({ limit: 100 });
    if (!Array.isArray(endpoints.data) || endpoints.data.length === 0) {
      throw new Error('No webhook endpoints are configured for this Stripe account.');
    }
  } catch (error) {
    throw new Error(`Unable to confirm webhook secret against Stripe endpoints: ${formatStripeError(error)}.`);
  }
  return trimmed;
}

const SPLIT_TERM_SCHEMA = z
  .object({
    label: z
      .union([z.string(), z.null()])
      .transform((value) => (typeof value === 'string' ? value.trim() : ''))
      .pipe(z.string().min(1, 'Split term label is required.')),
    percentage: z
      .union([z.number(), z.string()])
      .transform((value) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === 'string') {
          const parsed = Number.parseFloat(value.trim());
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
        throw new Error('Invalid percentage value.');
      }),
    dueDays: z
      .union([z.number(), z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (value === null || value === undefined || value === '') {
          return null;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          return Math.trunc(value);
        }
        if (typeof value === 'string') {
          const parsed = Number.parseInt(value.trim(), 10);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
        throw new Error('Invalid due days value.');
      })
      .nullable(),
  })
  .transform((term) => ({
    label: term.label,
    percentage: term.percentage,
    dueDays: term.dueDays,
  }));

const SETTINGS_SCHEMA = z.object({
  publishableKey: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === 'string' ? value.trim() : value)),
  secretKey: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === 'string' ? value.trim() : value)),
  webhookSecret: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (typeof value === 'string' ? value.trim() : value)),
  platformFeePercent: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value.trim());
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      throw new Error('Platform fee must be a number.');
    })
    .nullable(),
  defaultPayoutScheduleDays: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
      }
      if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isFinite(parsed)) {
          return Math.max(0, parsed);
        }
      }
      throw new Error('Payout schedule must be an integer.');
    })
    .nullable(),
  splitTerms: z
    .union([z.array(SPLIT_TERM_SCHEMA), z.null(), z.undefined()])
    .transform((value) => (Array.isArray(value) ? value : [])),
}).superRefine((value, ctx) => {
  const terms = Array.isArray(value.splitTerms) ? value.splitTerms : [];
  const seenLabels = new Set<string>();
  let runningTotal = 0;
  let previousDue: number | null = null;

  terms.forEach((term, index) => {
    const normalisedLabel = term.label.trim().toLowerCase();
    if (seenLabels.has(normalisedLabel)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Split term labels must be unique.',
        path: ['splitTerms', index, 'label'],
      });
    } else {
      seenLabels.add(normalisedLabel);
    }

    if (!Number.isFinite(term.percentage) || term.percentage < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Split term percentage must be a non-negative number.',
        path: ['splitTerms', index, 'percentage'],
      });
    } else {
      runningTotal += term.percentage;
    }

    const dueComparable = term.dueDays ?? 0;
    if (term.dueDays !== null && term.dueDays < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Due days must be zero or positive.',
        path: ['splitTerms', index, 'dueDays'],
      });
    }
    if (previousDue !== null && dueComparable < previousDue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Split term due days must be non-decreasing.',
        path: ['splitTerms', index, 'dueDays'],
      });
    }
    previousDue = dueComparable;
  });

  if (runningTotal > 100.0001) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Split term percentages cannot exceed 100%.',
      path: ['splitTerms'],
    });
  }
});

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
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
    if (!hasRole(roles, ['admin', 'finance'])) {
      return null;
    }
    return { uid: decoded.uid, email, roles };
  } catch (error) {
    console.warn('Failed to verify admin session', error);
    return null;
  }
}

export async function GET() {
  const context = await resolveAdminContext();
  if (!context) {
    return unauthorized();
  }
  try {
    const settings = await getStripeConnectSettings();
    return NextResponse.json({
      publishableKey: settings.publishableKey,
      platformFeePercent: settings.platformFeePercent,
      defaultPayoutScheduleDays: settings.defaultPayoutScheduleDays,
      splitTerms: settings.splitTerms,
      secretKey: {
        configured: Boolean(settings.secretKeyLast4),
        last4: settings.secretKeyLast4,
      },
      webhookSecret: {
        configured: Boolean(settings.webhookSecretLast4),
        last4: settings.webhookSecretLast4,
      },
      updatedAt: settings.updatedAt ? settings.updatedAt.toISOString() : null,
      updatedBy: settings.updatedBy,
    });
  } catch (error) {
    console.error('Failed to load Stripe settings', error);
    return NextResponse.json({ error: 'Failed to load Stripe settings.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const context = await resolveAdminContext();
  if (!context) {
    return unauthorized();
  }

  let parsedBody: z.infer<typeof SETTINGS_SCHEMA>;
  try {
    const json = await req.json();
    parsedBody = SETTINGS_SCHEMA.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const firstIssue = error.issues[0];
      return badRequest(firstIssue?.message ?? 'Invalid payload.');
    }
    console.error('Invalid Stripe settings payload', error);
    return badRequest('Invalid request payload.');
  }

  const firestore = getFirebaseAdminFirestore();
  const docRef = firestore.collection('settings').doc('stripeConnect');

  const updates: Record<string, unknown> = {
    publishableKey:
      typeof parsedBody.publishableKey === 'string' && parsedBody.publishableKey.length > 0
        ? parsedBody.publishableKey
        : null,
    platformFeePercent:
      parsedBody.platformFeePercent !== null && Number.isFinite(parsedBody.platformFeePercent)
        ? parsedBody.platformFeePercent
        : null,
    defaultPayoutScheduleDays: parsedBody.defaultPayoutScheduleDays,
    splitTerms: parsedBody.splitTerms,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: {
      uid: context.uid,
      email: context.email,
    },
    secretKey: FieldValue.delete(),
    webhookSecret: FieldValue.delete(),
  };

  let latestSecretKey: string | null | undefined;
  if (parsedBody.secretKey !== undefined) {
    try {
      if (parsedBody.secretKey) {
        latestSecretKey = await verifySecretKey(parsedBody.secretKey);
        await writeSecretValue(SECRET_KEY_CONFIG, latestSecretKey);
        updates.secretKeyLast4 = latestSecretKey.slice(-4);
      } else {
        latestSecretKey = null;
        await writeSecretValue(SECRET_KEY_CONFIG, null);
        updates.secretKeyLast4 = null;
      }
      resetStripeSecretCache();
      resetStripeClientCache();
    } catch (error) {
      console.error('Failed to persist Stripe secret key', error);
      const message = error instanceof Error ? error.message : 'Failed to store Stripe secret key.';
      const status = /Secret Manager|infrastructure/i.test(message) ? 500 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  const getStripeClientForWebhookValidation = async (): Promise<Stripe> => {
    const secret = latestSecretKey ?? (await getStripeSecretKey());
    if (!secret) {
      throw new Error('Configure a Stripe secret key before saving a webhook secret.');
    }
    return new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  };

  if (parsedBody.webhookSecret !== undefined) {
    try {
      if (parsedBody.webhookSecret) {
        const stripeClient = await getStripeClientForWebhookValidation();
        const verifiedWebhookSecret = await verifyWebhookSecret(parsedBody.webhookSecret, stripeClient);
        await writeSecretValue(WEBHOOK_SECRET_CONFIG, verifiedWebhookSecret);
        updates.webhookSecretLast4 = verifiedWebhookSecret.slice(-4);
      } else {
        await writeSecretValue(WEBHOOK_SECRET_CONFIG, null);
        updates.webhookSecretLast4 = null;
      }
      resetStripeSecretCache();
    } catch (error) {
      console.error('Failed to persist Stripe webhook secret', error);
      const message = error instanceof Error ? error.message : 'Failed to store Stripe webhook secret.';
      const status = /Secret Manager|infrastructure/i.test(message) ? 500 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  }

  try {
    await docRef.set(updates, { merge: true });
    invalidateStripeSettingsCache();
    resetStripeClientCache();
    const settings = await getStripeConnectSettings({ forceRefresh: true });
    return NextResponse.json({
      success: true,
      settings: {
        publishableKey: settings.publishableKey,
        platformFeePercent: settings.platformFeePercent,
        defaultPayoutScheduleDays: settings.defaultPayoutScheduleDays,
        splitTerms: settings.splitTerms,
        secretKey: {
          configured: Boolean(settings.secretKeyLast4),
          last4: settings.secretKeyLast4,
        },
        webhookSecret: {
          configured: Boolean(settings.webhookSecretLast4),
          last4: settings.webhookSecretLast4,
        },
        updatedAt: settings.updatedAt ? settings.updatedAt.toISOString() : null,
        updatedBy: settings.updatedBy,
      },
    });
  } catch (error) {
    console.error('Failed to save Stripe settings', error);
    return NextResponse.json({ error: 'Failed to save Stripe settings.' }, { status: 500 });
  }
}
