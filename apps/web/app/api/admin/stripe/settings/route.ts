import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  getStripeConnectSettings,
  invalidateStripeSettingsCache,
  resetStripeClientCache,
} from '@/lib/stripe-config';
import { decodeRolesCookie } from '@/lib/roles';

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

async function resolveAdminContext(loadUserDoc = false) {
  const cookieStore = cookies();
  const uid = cookieStore.get('uid')?.value;
  const rolesCookie = cookieStore.get('roles')?.value;
  if (!uid) {
    return null;
  }
  const roles = new Set(decodeRolesCookie(rolesCookie));
  if (!roles.has('admin') && !roles.has('finance')) {
    return null;
  }
  if (!loadUserDoc) {
    return { uid, email: null };
  }
  try {
    const firestore = getFirebaseAdminFirestore();
    const snapshot = await firestore.collection('users').doc(uid).get();
    const email = typeof snapshot.data()?.email === 'string' ? (snapshot.data()?.email as string) : null;
    return { uid, email };
  } catch (error) {
    console.warn('Failed to load admin user profile', error);
    return { uid, email: null };
  }
}

export async function GET() {
  const context = await resolveAdminContext(false);
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
  const context = await resolveAdminContext(true);
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
  };

  if (parsedBody.secretKey !== undefined) {
    const secret = parsedBody.secretKey && parsedBody.secretKey.length > 0 ? parsedBody.secretKey : null;
    updates.secretKey = secret;
    updates.secretKeyLast4 = secret ? secret.slice(-4) : null;
  }

  if (parsedBody.webhookSecret !== undefined) {
    const secret = parsedBody.webhookSecret && parsedBody.webhookSecret.length > 0 ? parsedBody.webhookSecret : null;
    updates.webhookSecret = secret;
    updates.webhookSecretLast4 = secret ? secret.slice(-4) : null;
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
