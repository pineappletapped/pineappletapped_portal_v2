import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse, type NextRequest } from 'next/server';

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';

interface TrackPayload {
  code?: unknown;
  url?: unknown;
  referrer?: unknown;
  userAgent?: unknown;
}

const MAX_STRING_LENGTH = 500;

function normaliseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > MAX_STRING_LENGTH ? trimmed.slice(0, MAX_STRING_LENGTH) : trimmed;
}

function sanitiseUrl(value: unknown): string | null {
  const str = normaliseString(value);
  if (!str) return null;
  try {
    const url = new URL(str);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

async function findAffiliateByCode(code: string) {
  const firestore = getFirebaseAdminFirestore();
  const normalised = code.toLowerCase();

  const attempt = async (field: string, value: string) => {
    const snapshot = await firestore
      .collection('affiliates')
      .where(field, '==', value)
      .limit(1)
      .get();
    if (!snapshot.empty) {
      return snapshot.docs[0];
    }
    return null;
  };

  const byLower = await attempt('refCodeLower', normalised);
  if (byLower) {
    return byLower;
  }
  return attempt('refCode', code);
}

export async function POST(request: NextRequest) {
  let payload: TrackPayload;
  try {
    payload = (await request.json()) as TrackPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid payload.' }, { status: 400 });
  }

  const code = normaliseString(payload.code);
  if (!code) {
    return NextResponse.json({ ok: false, error: 'Affiliate code is required.' }, { status: 400 });
  }

  try {
    const affiliateDoc = await findAffiliateByCode(code);
    if (!affiliateDoc) {
      return NextResponse.json({ ok: true, tracked: false });
    }

    const firestore = getFirebaseAdminFirestore();
    const data = affiliateDoc.data() ?? {};
    const affiliateId = affiliateDoc.id;
    const timestamp = FieldValue.serverTimestamp();
    const clickRef = firestore.collection('affiliateClicks').doc();

    await clickRef.set({
      affiliateId,
      affiliateRefCode: data.refCode ?? code,
      code,
      url: sanitiseUrl(payload.url),
      referrer: sanitiseUrl(payload.referrer),
      userAgent: normaliseString(payload.userAgent),
      createdAt: timestamp,
    });

    await affiliateDoc.ref.set(
      {
        metrics: {
          totalClicks: FieldValue.increment(1),
        },
        updatedAt: timestamp,
        lastReferralAt: data.lastReferralAt ?? timestamp,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, tracked: true });
  } catch (error) {
    console.error('Failed to track affiliate click', error);
    return NextResponse.json({ ok: false, error: 'Unable to record click.' }, { status: 500 });
  }
}
