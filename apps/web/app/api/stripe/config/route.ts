import { NextResponse } from 'next/server';

import { getStripeConnectSettings } from '@/lib/stripe-config';

export async function GET() {
  try {
    const settings = await getStripeConnectSettings();
    return NextResponse.json({
      publishableKey: settings.publishableKey,
      platformFeePercent: settings.platformFeePercent,
      defaultPayoutScheduleDays: settings.defaultPayoutScheduleDays,
      splitTerms: settings.splitTerms,
    });
  } catch (error) {
    console.error('Failed to load Stripe configuration', error);
    return NextResponse.json(
      { error: 'Stripe configuration unavailable' },
      { status: 500 }
    );
  }
}
