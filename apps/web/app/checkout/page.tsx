import { Suspense } from "react";

import { getStripeConnectSettings } from "@/lib/stripe-config";

import CheckoutClient from "./CheckoutClient";

export default async function CheckoutPage() {
  const settings = await getStripeConnectSettings();

  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-gray-500">Loading checkout…</div>}>
      <CheckoutClient publishableKey={settings.publishableKey} />
    </Suspense>
  );
}
