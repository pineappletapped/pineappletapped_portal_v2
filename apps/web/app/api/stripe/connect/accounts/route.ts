import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import Stripe from 'stripe';

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { getStripeClient } from '@/lib/stripe-config';
import { decodeRolesCookie } from '@/lib/roles';

const DEFAULT_LINK_MODE = 'onboarding';

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function resolveAdminContext() {
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
  return { uid };
}

function determineBaseUrl() {
  const envValues = [
    process.env.NEXT_PUBLIC_WEBAPP_URL,
    process.env.WEBAPP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
  ];
  for (const value of envValues) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim().replace(/\/$/, '');
    }
  }
  return 'http://localhost:3000';
}

export async function POST(req: NextRequest) {
  const adminContext = await resolveAdminContext();
  if (!adminContext) {
    return unauthorized();
  }

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    return badRequest('Invalid JSON payload.');
  }

  const franchiseIdRaw = typeof body?.franchiseId === 'string' ? body.franchiseId.trim() : '';
  if (!franchiseIdRaw) {
    return badRequest('franchiseId is required.');
  }

  const firestore = getFirebaseAdminFirestore();
  const franchiseRef = firestore.collection('franchises').doc(franchiseIdRaw);
  const franchiseSnap = await franchiseRef.get();
  if (!franchiseSnap.exists) {
    return NextResponse.json({ error: 'Franchise not found.' }, { status: 404 });
  }

  const franchiseData = (franchiseSnap.data() as Record<string, unknown>) || {};
  const contactEmail = typeof franchiseData.contactEmail === 'string' ? franchiseData.contactEmail.trim() : null;
  const accountCountry = typeof body?.country === 'string' && body.country.trim().length > 1
    ? body.country.trim().toUpperCase()
    : 'GB';
  const linkMode = typeof body?.linkMode === 'string' ? body.linkMode : DEFAULT_LINK_MODE;

  let stripe: Stripe;
  try {
    const client = await getStripeClient();
    if (!client) {
      throw new Error('Stripe secret key is not configured.');
    }
    stripe = client;
  } catch (error) {
    console.error('Unable to load Stripe client for Connect provisioning', error);
    return NextResponse.json({ error: 'Stripe configuration unavailable.' }, { status: 500 });
  }

  let accountId = typeof franchiseData.stripeAccountId === 'string' ? franchiseData.stripeAccountId.trim() : '';
  const onboardingPath = (franchiseData.onboarding as Record<string, unknown> | undefined) || {};

  try {
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: accountCountry,
        email: contactEmail || undefined,
        business_type: 'company',
        metadata: { franchiseId: franchiseIdRaw },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      await franchiseRef.set(
        {
          stripeAccountId: accountId,
          onboarding: {
            ...onboardingPath,
            stripeAccountStatus: 'in_progress',
            lastSyncedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const baseUrl = determineBaseUrl();
    const refreshUrl =
      typeof body?.refreshUrl === 'string' && body.refreshUrl.trim().length > 0
        ? body.refreshUrl.trim()
        : `${baseUrl}/admin/franchises/${franchiseIdRaw}?stripe=refresh`;
    const returnUrl =
      typeof body?.returnUrl === 'string' && body.returnUrl.trim().length > 0
        ? body.returnUrl.trim()
        : `${baseUrl}/admin/franchises/${franchiseIdRaw}?stripe=return`;

    let linkUrl: string | null = null;
    let linkType: 'onboarding' | 'login';

    if (linkMode === 'login') {
      const loginLink = await stripe.accounts.createLoginLink(accountId, {
        redirect_url: returnUrl,
      });
      linkUrl = loginLink.url;
      linkType = 'login';
    } else {
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });
      linkUrl = accountLink.url;
      linkType = 'onboarding';
    }

    return NextResponse.json({
      accountId,
      linkUrl,
      linkType,
    });
  } catch (error) {
    console.error('Failed to prepare Stripe Connect account', error);
    return NextResponse.json({ error: 'Failed to prepare Stripe Connect account.' }, { status: 500 });
  }
}
