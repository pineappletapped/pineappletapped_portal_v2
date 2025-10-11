import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";

import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { getStripeClient } from "@/lib/stripe-config";
import { decodeRolesCookie } from "@/lib/roles";
import { resolveAppOrigin } from "@/lib/origin";
import {
  describeAffiliateStripeStatus,
  normaliseAffiliateStripeStatus,
  type AffiliateStripeStatus,
} from "@/lib/affiliates";

const ALLOWED_ADMIN_ROLES = new Set(["admin", "marketing", "sales"]);

type StripeLinkMode = "onboarding" | "login";

type StripeLinkResponse = {
  accountId: string;
  linkUrl: string | null;
  linkType: StripeLinkMode;
  status: AffiliateStripeStatus;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  requirementsDue: string[];
  requirementsPastDue: string[];
  requirementsEventuallyDue: string[];
  disabledReason: string | null;
};

function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function parseString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseMode(value: unknown): StripeLinkMode {
  const candidate = parseString(value)?.toLowerCase();
  return candidate === "login" ? "login" : "onboarding";
}

function normaliseCountry(value: unknown): string {
  const code = parseString(value);
  return code ? code.toUpperCase() : "GB";
}

async function resolveAffiliateContext() {
  const cookieStore = cookies();
  const uid = parseString(cookieStore.get("uid")?.value);
  if (!uid) {
    return null;
  }
  const roles = new Set(decodeRolesCookie(cookieStore.get("roles")?.value));
  const isAffiliate = roles.has("affiliate");
  const isAdmin = Array.from(ALLOWED_ADMIN_ROLES).some((role) => roles.has(role));
  if (!isAffiliate && !isAdmin) {
    return null;
  }
  return { uid, isAffiliate, isAdmin };
}

function deriveAffiliateStripeStatus(account: Stripe.Account): AffiliateStripeStatus {
  const requirements = account.requirements ?? { currently_due: [], past_due: [], eventually_due: [] };
  const disabledReason =
    requirements.disabled_reason ?? account.future_requirements?.disabled_reason ?? null;
  if (disabledReason || (requirements.past_due?.length ?? 0) > 0) {
    return "restricted";
  }
  if (!account.details_submitted) {
    return "in_progress";
  }
  if (
    !account.payouts_enabled ||
    !account.charges_enabled ||
    (requirements.currently_due?.length ?? 0) > 0 ||
    (account.future_requirements?.currently_due?.length ?? 0) > 0
  ) {
    return "pending_verification";
  }
  return "active";
}

function buildStripeResponse(
  account: Stripe.Account,
  linkUrl: string | null,
  linkType: StripeLinkMode
): StripeLinkResponse {
  const requirements = account.requirements ?? { currently_due: [], past_due: [], eventually_due: [] };
  const futureRequirements = account.future_requirements ?? {
    currently_due: [],
    eventually_due: [],
    past_due: [],
  };
  const requirementsDue = requirements.currently_due ?? [];
  const requirementsPastDue = requirements.past_due ?? [];
  const requirementsEventuallyDue = (
    requirements.eventually_due ?? []
  ).concat(futureRequirements.eventually_due ?? []);
  const disabledReason =
    requirements.disabled_reason ?? account.future_requirements?.disabled_reason ?? null;
  const status = deriveAffiliateStripeStatus(account);

  return {
    accountId: account.id,
    linkUrl,
    linkType,
    status,
    payoutsEnabled: account.payouts_enabled ?? false,
    chargesEnabled: account.charges_enabled ?? false,
    requirementsDue,
    requirementsPastDue,
    requirementsEventuallyDue,
    disabledReason,
  };
}

async function ensureAffiliateOwnership(
  firestore: FirebaseFirestore.Firestore,
  affiliateId: string,
  context: { uid: string; isAffiliate: boolean; isAdmin: boolean }
) {
  const affiliateRef = firestore.collection("affiliates").doc(affiliateId);
  const snapshot = await affiliateRef.get();
  if (!snapshot.exists) {
    return { ref: affiliateRef, snapshot: null, data: null } as const;
  }
  const data = (snapshot.data() as Record<string, any>) ?? {};
  const ownerUid = parseString(data.ownerUid);
  if (!context.isAdmin && ownerUid && ownerUid !== context.uid) {
    throw new Error("unauthorized");
  }
  if (!ownerUid && context.isAffiliate) {
    await affiliateRef.set(
      {
        ownerUid: context.uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  return { ref: affiliateRef, snapshot, data } as const;
}

export async function POST(request: NextRequest) {
  const context = await resolveAffiliateContext();
  if (!context) {
    return unauthorized();
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  let targetAffiliateId = parseString(body?.affiliateId);
  const mode = normaliseMode(body?.mode);
  const country = normaliseCountry(body?.country);

  const firestore = getFirebaseAdminFirestore();

  if (!targetAffiliateId && context.isAffiliate) {
    const ownerQuery = await firestore
      .collection("affiliates")
      .where("ownerUid", "==", context.uid)
      .limit(1)
      .get();
    if (!ownerQuery.empty) {
      targetAffiliateId = ownerQuery.docs[0].id;
    }
  }

  if (!targetAffiliateId) {
    return badRequest("affiliateId is required.");
  }

  const ownership = await ensureAffiliateOwnership(firestore, targetAffiliateId, context).catch((error) => {
    if (error instanceof Error && error.message === "unauthorized") {
      return null;
    }
    throw error;
  });

  if (!ownership) {
    return unauthorized();
  }

  const { ref: affiliateRef, snapshot, data: affiliateData } = ownership;
  if (!snapshot) {
    return NextResponse.json({ error: "Affiliate profile not found." }, { status: 404 });
  }

  const ownerUid = parseString(affiliateData.ownerUid) ?? (context.isAffiliate ? context.uid : null);
  const contactEmail =
    parseString(body?.email) ??
    parseString(affiliateData.email) ??
    parseString(affiliateData.primaryEmail) ??
    null;
  const affiliateName =
    parseString(body?.affiliateName) ??
    parseString(affiliateData.name) ??
    parseString(affiliateData.company) ??
    "Affiliate";

  let stripeClient: Stripe;
  try {
    const client = await getStripeClient();
    if (!client) {
      throw new Error("Stripe secret key is not configured.");
    }
    stripeClient = client;
  } catch (error) {
    console.error("Unable to initialise Stripe client for affiliate Connect", error);
    return NextResponse.json({ error: "Stripe configuration unavailable." }, { status: 500 });
  }

  let stripeAccountId = parseString(affiliateData.stripeAccountId ?? affiliateData.connectAccountId);
  let stripeAccount: Stripe.Account | null = null;

  try {
    if (!stripeAccountId) {
      const account = await stripeClient.accounts.create({
        type: "express",
        country,
        email: contactEmail ?? undefined,
        business_profile: affiliateName ? { name: affiliateName } : undefined,
        metadata: { affiliateId: targetAffiliateId },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      stripeAccountId = account.id;
      stripeAccount = account;
    }
  } catch (error) {
    console.error("Failed to create affiliate Stripe account", error);
    return NextResponse.json({ error: "Unable to prepare a Stripe Connect account." }, { status: 500 });
  }

  if (!stripeAccountId) {
    return NextResponse.json({ error: "Stripe account could not be prepared." }, { status: 500 });
  }

  try {
    stripeAccount = await stripeClient.accounts.retrieve(stripeAccountId);
  } catch (error) {
    console.error("Failed to load affiliate Stripe account", error);
    return NextResponse.json({ error: "Unable to load Stripe account details." }, { status: 500 });
  }

  if (!stripeAccount) {
    return NextResponse.json({ error: "Stripe account unavailable." }, { status: 500 });
  }

  if (mode === "login" && !stripeAccount.details_submitted) {
    return badRequest("Complete Stripe onboarding before opening the dashboard.");
  }

  const origin =
    resolveAppOrigin({
      request: {
        headers: request.headers,
        nextUrl: { origin: request.nextUrl.origin },
        url: request.url,
      },
    }) ?? "https://pineappletapped.com";

  const refreshUrl =
    parseString(body?.refreshUrl) ?? `${origin.replace(/\/$/, "")}/affiliate?stripe=refresh`;
  const returnUrl = parseString(body?.returnUrl) ?? `${origin.replace(/\/$/, "")}/affiliate?stripe=return`;

  let linkUrl: string | null = null;
  let linkType: StripeLinkMode = mode;

  try {
    if (mode === "login") {
      const loginLink = await stripeClient.accounts.createLoginLink(stripeAccountId);
      linkUrl = loginLink.url;
    } else {
      const accountLink = await stripeClient.accountLinks.create({
        account: stripeAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });
      linkUrl = accountLink.url;
      linkType = "onboarding";
    }
  } catch (error) {
    console.error("Failed to generate affiliate Stripe link", error);
    return NextResponse.json({ error: "Unable to prepare the Stripe Connect link." }, { status: 500 });
  }

  const response = buildStripeResponse(stripeAccount, linkUrl, linkType);

  const affiliateUpdates: Record<string, any> = {
    stripeAccountId: response.accountId,
    stripeStatus: normaliseAffiliateStripeStatus(response.status),
    stripePayoutsEnabled: response.payoutsEnabled,
    stripeChargesEnabled: response.chargesEnabled,
    stripeRequirementsDue: response.requirementsDue,
    stripeRequirementsPastDue: response.requirementsPastDue,
    stripeRequirementsEventuallyDue: response.requirementsEventuallyDue,
    stripeDisabledReason: response.disabledReason,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (linkType === "onboarding") {
    affiliateUpdates.stripeLastOnboardingAt = FieldValue.serverTimestamp();
  } else {
    affiliateUpdates.stripeLastLoginAt = FieldValue.serverTimestamp();
  }

  await affiliateRef.set(affiliateUpdates, { merge: true });

  if (ownerUid) {
    await firestore
      .collection("users")
      .doc(ownerUid)
      .set(
        {
          "roles.affiliate": true,
          "affiliate.stripeAccountId": response.accountId,
          "affiliate.stripeStatus": describeAffiliateStripeStatus(response.status),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  return NextResponse.json(response);
}
