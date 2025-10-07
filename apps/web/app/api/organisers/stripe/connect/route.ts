import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";

import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { getStripeClient } from "@/lib/stripe-config";
import { decodeRolesCookie } from "@/lib/roles";
import { resolveAppOrigin } from "@/lib/origin";

type StripeLinkMode = "onboarding" | "login";

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
  if (candidate === "login") {
    return "login";
  }
  return "onboarding";
}

async function resolveOrganiserContext() {
  const cookieStore = cookies();
  const uid = parseString(cookieStore.get("uid")?.value);
  if (!uid) {
    return null;
  }
  const rolesCookie = cookieStore.get("roles")?.value;
  const roles = new Set(decodeRolesCookie(rolesCookie));
  const isOrganiser = roles.has("organiser");
  const isAdmin = roles.has("admin");
  if (!isOrganiser && !isAdmin) {
    return null;
  }
  return { uid, isAdmin };
}

export async function POST(request: NextRequest) {
  const context = await resolveOrganiserContext();
  if (!context) {
    return unauthorized();
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedOrganiserId = parseString(body?.organiserId);
  const targetOrganiserId =
    context.isAdmin && requestedOrganiserId ? requestedOrganiserId : context.uid;

  if (!context.isAdmin && requestedOrganiserId && requestedOrganiserId !== context.uid) {
    return unauthorized();
  }

  if (!targetOrganiserId) {
    return badRequest("organiserId is required.");
  }

  const mode = normaliseMode(body?.mode);
  const country = (parseString(body?.country) ?? "GB").toUpperCase();

  let stripe: Stripe;
  try {
    const client = await getStripeClient();
    if (!client) {
      throw new Error("Stripe secret key is not configured.");
    }
    stripe = client;
  } catch (error) {
    console.error("Unable to load Stripe client for organiser Connect", error);
    return NextResponse.json({ error: "Stripe configuration unavailable." }, { status: 500 });
  }

  const firestore = getFirebaseAdminFirestore();
  const organiserRef = firestore.collection("eventOrganisers").doc(targetOrganiserId);
  const organiserSnap = await organiserRef.get();
  const organiserData = (organiserSnap.data() as Record<string, any>) ?? {};

  const userRef = firestore.collection("users").doc(targetOrganiserId);
  const userSnap = await userRef.get();
  const userData = (userSnap.data() as Record<string, any>) ?? {};

  const contactEmail =
    parseString(body?.email) ??
    parseString(organiserData.email) ??
    parseString(userData.email) ??
    parseString(userData.contactEmail);
  const organiserName =
    parseString(body?.organiserName) ??
    parseString(organiserData.name) ??
    parseString(userData.fullName) ??
    parseString(userData.displayName);

  let stripeAccountId = parseString(organiserData.stripeAccountId);
  let stripeStatus = parseString(organiserData.stripeStatus) ?? null;

  try {
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country,
        email: contactEmail ?? undefined,
        business_profile: organiserName ? { name: organiserName } : undefined,
        metadata: { organiserId: targetOrganiserId },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      stripeAccountId = account.id;
      stripeStatus = "in_progress";
      await organiserRef.set(
        {
          userId: targetOrganiserId,
          active: true,
          stripeAccountId,
          stripeStatus,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await userRef.set(
        {
          "roles.organiser": true,
          "organiser.active": true,
          "organiser.stripeAccountId": stripeAccountId,
          "organiser.stripeStatus": stripeStatus,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      // Ensure the organiser document stays active and reflects the account ID.
      await organiserRef.set(
        {
          userId: targetOrganiserId,
          active: true,
          stripeAccountId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await userRef.set(
        {
          "roles.organiser": true,
          "organiser.active": true,
          "organiser.stripeAccountId": stripeAccountId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (error) {
    console.error("Failed to prepare organiser Stripe account", error);
    return NextResponse.json(
      { error: "Failed to create or update the Stripe Connect account." },
      { status: 500 }
    );
  }

  if (!stripeAccountId) {
    return NextResponse.json(
      { error: "Stripe account could not be prepared for this organiser." },
      { status: 500 }
    );
  }

  if (mode === "login" && !organiserData.stripeAccountId) {
    // Prevent login links before an account has been onboarded.
    return badRequest("Stripe Connect onboarding must be completed before opening the dashboard.");
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
    parseString(body?.refreshUrl) ?? `${origin.replace(/\/$/, "")}/organiser?stripe=refresh`;
  const returnUrl =
    parseString(body?.returnUrl) ?? `${origin.replace(/\/$/, "")}/organiser?stripe=return`;

  try {
    let linkUrl: string | null = null;
    let linkType: StripeLinkMode = mode;

    if (mode === "login") {
      const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
      linkUrl = loginLink.url;
    } else {
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });
      linkUrl = accountLink.url;
      stripeStatus = "in_progress";
      await organiserRef.set(
        {
          stripeStatus,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await userRef.set(
        {
          "organiser.stripeStatus": stripeStatus,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return NextResponse.json({
      accountId: stripeAccountId,
      linkUrl,
      linkType,
      status: stripeStatus,
    });
  } catch (error) {
    console.error("Failed to prepare organiser Stripe link", error);
    return NextResponse.json(
      { error: "Failed to prepare the Stripe Connect link." },
      { status: 500 }
    );
  }
}
