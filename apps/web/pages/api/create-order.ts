import type { NextApiRequest, NextApiResponse } from "next";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import Stripe from "stripe";

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { getStripeClient } from "@/lib/stripe-config";

import { applyApiCors, handleOptions } from "./_utils/cors";

const ZERO_BALANCE_TOLERANCE = 0.005;
const CURRENCY = "gbp";

interface CheckoutItemPayload {
  id: string;
  name: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  price: number;
  variation: string | null;
  date: string | null;
  location: string | null;
  postalCode: string | null;
  rentalTotal: number | null;
  modifiers: unknown;
  kitStatus: string | null;
  kitWarnings: string[];
  orderFormResponses: unknown;
  coverage: unknown;
  timeSlot: unknown;
  exhibition: unknown;
  campaignBooking: unknown;
  organiser: unknown;
  organisation: CheckoutOrganisationPayload | null;
}

interface CheckoutOrganisationPayload {
  id: string | null;
  name: string | null;
  source: string | null;
  brandLogoUrl: string | null;
  brandColors: string[];
}

interface CheckoutKitPayload {
  id: string;
  name: string | null;
  category: string | null;
  start: string;
  end: string;
}

interface CheckoutOrderPayload {
  items: CheckoutItemPayload[];
  kitItems: CheckoutKitPayload[];
  rentalSubtotal: number;
  kitReservationStatus: "pending" | "confirmed";
  kitReservationWarnings: string[];
  userEmail: string | null;
  customerName: string | null;
  companyName: string | null;
  location: string | null;
  postalCode: string | null;
  projectName: string | null;
  voucher: string | null;
  leadSource: string | null;
  organisers: unknown[];
  organisation: CheckoutOrganisationPayload | null;
}

interface CheckoutPricingPayload {
  productTotal: number;
  rentalTotal: number;
  voucherDiscount: number;
  discountPercent: number;
  discountAmount: number;
  subtotal: number;
  vat: number;
  grandTotal: number;
  hasZeroBalance?: boolean;
  voucherCode?: string | null;
}

interface NormalisedCheckoutData {
  order: CheckoutOrderPayload;
  pricing: CheckoutPricingPayload;
}

interface ProductTaskSeed {
  productId: string;
  productName: string | null;
  title: string;
  forCustomer: boolean;
  subtasks: string[];
}

const normaliseString = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
};

const optionalString = (value: unknown): string | null => {
  const normalised = normaliseString(value);
  return normalised.length > 0 ? normalised : null;
};

const normaliseOrganisation = (input: unknown): CheckoutOrganisationPayload | null => {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const id = optionalString(record.id);
  const name = optionalString(record.name);
  const source = optionalString(record.source);
  const brandLogoUrl = optionalString(record.brandLogoUrl);
  const brandColors = Array.isArray(record.brandColors)
    ? record.brandColors
        .map((colour) => optionalString(colour))
        .filter((colour): colour is string => Boolean(colour))
        .map((colour) => {
          const upper = colour.toUpperCase();
          return upper.startsWith("#") ? upper : `#${upper}`;
        })
    : [];
  if (!id && !name && !source && !brandLogoUrl && brandColors.length === 0) {
    return null;
  }
  return {
    id: id ?? null,
    name: name ?? null,
    source: source ?? null,
    brandLogoUrl: brandLogoUrl ?? null,
    brandColors: Array.from(new Set(brandColors)),
  };
};

const ensureNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]+/g, "");
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const ensureInteger = (value: unknown, fallback = 0): number => {
  const numeric = ensureNumber(value, fallback);
  const rounded = Math.round(numeric);
  return Number.isFinite(rounded) ? rounded : fallback;
};

const toCurrency = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
};

const normaliseItems = (input: unknown): CheckoutItemPayload[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map<CheckoutItemPayload | null>((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = normaliseString(record.id);
      if (!id) {
        return null;
      }

      const quantity = Math.max(1, ensureInteger(record.quantity, 1));
      const unitPrice = toCurrency(ensureNumber(record.unitPrice ?? record.price ?? 0));
      const lineTotal = toCurrency(
        ensureNumber(record.lineTotal, Number.isFinite(unitPrice * quantity) ? unitPrice * quantity : 0),
      );

      const rawWarnings = Array.isArray(record.kitWarnings)
        ? record.kitWarnings
            .map((warning) => normaliseString(warning))
            .filter((warning) => warning.length > 0)
        : [];

      return {
        id,
        name: optionalString(record.name),
        quantity,
        unitPrice,
        price: unitPrice,
        lineTotal,
        variation: optionalString(record.variation),
        date: optionalString(record.date),
        location: optionalString(record.location),
        postalCode: optionalString(record.postalCode),
        rentalTotal: Number.isFinite(ensureNumber(record.rentalTotal))
          ? toCurrency(ensureNumber(record.rentalTotal))
          : null,
        modifiers: record.modifiers ?? null,
        kitStatus: optionalString(record.kitStatus),
        kitWarnings: rawWarnings,
        orderFormResponses: record.orderFormResponses ?? null,
        coverage: record.coverage ?? null,
        timeSlot: record.timeSlot ?? null,
        exhibition: record.exhibition ?? null,
        campaignBooking: record.campaignBooking ?? null,
        organiser: record.organiser ?? null,
        organisation: normaliseOrganisation(record.organisation),
      } satisfies CheckoutItemPayload;
    })
    .filter((item): item is CheckoutItemPayload => Boolean(item));
};

const normaliseKitItems = (input: unknown): CheckoutKitPayload[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map<CheckoutKitPayload | null>((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = normaliseString(record.id);
      const start = normaliseString(record.start);
      const end = normaliseString(record.end);
      if (!id || !start || !end) {
        return null;
      }
      return {
        id,
        name: optionalString(record.name),
        category: optionalString(record.category),
        start,
        end,
      } satisfies CheckoutKitPayload;
    })
    .filter((item): item is CheckoutKitPayload => Boolean(item));
};

const normaliseWarnings = (input: unknown): string[] => {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((entry) => normaliseString(entry))
    .filter((warning) => warning.length > 0);
};

const normaliseProductTaskList = (input: unknown): Array<{
  title: string;
  forCustomer: boolean;
  subtasks: string[];
}> => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const title = normaliseString(record.title);
      if (!title) {
        return null;
      }

      const subtasks = Array.isArray(record.subtasks)
        ? record.subtasks
            .map((value) => normaliseString(value))
            .filter((value) => value.length > 0)
        : [];

      return {
        title,
        forCustomer: record.forCustomer === true,
        subtasks,
      };
    })
    .filter((task): task is { title: string; forCustomer: boolean; subtasks: string[] } => Boolean(task));
};

const collectProductDefaultTasks = async (
  firestore: Firestore,
  items: CheckoutItemPayload[],
): Promise<ProductTaskSeed[]> => {
  if (!items.length) {
    return [];
  }

  const productQuantities = new Map<string, number>();
  items.forEach((item) => {
    const quantity = Number.isFinite(item.quantity) ? Math.max(1, Math.trunc(item.quantity)) : 1;
    const current = productQuantities.get(item.id) ?? 0;
    productQuantities.set(item.id, current + quantity);
  });

  const uniqueProductIds = Array.from(productQuantities.keys());
  if (uniqueProductIds.length === 0) {
    return [];
  }

  const productsCollection = firestore.collection("products");
  const snapshots = await Promise.all(
    uniqueProductIds.map(async (productId) => {
      try {
        const snap = await productsCollection.doc(productId).get();
        return { productId, snap };
      } catch (error) {
        console.error("Failed to load product when seeding project tasks", { productId, error });
        return null;
      }
    }),
  );

  const seeds: ProductTaskSeed[] = [];
  snapshots.forEach((entry) => {
    if (!entry) {
      return;
    }

    const { productId, snap } = entry;
    if (!snap.exists) {
      console.warn("Product missing while seeding project tasks", { productId });
      return;
    }

    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const productName = typeof data.name === "string" && data.name.trim().length > 0 ? data.name.trim() : null;
    const tasks = normaliseProductTaskList(data.defaultTasks);
    if (!tasks.length) {
      return;
    }

    tasks.forEach((task) => {
      seeds.push({
        productId,
        productName,
        title: task.title,
        forCustomer: task.forCustomer,
        subtasks: task.subtasks,
      });
    });
  });

  return seeds;
};

const parseCheckoutRequest = (body: unknown): NormalisedCheckoutData | null => {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const orderRaw = record.order;
  const pricingRaw = record.pricing;

  if (!orderRaw || typeof orderRaw !== "object" || !pricingRaw || typeof pricingRaw !== "object") {
    return null;
  }

  const orderRecord = orderRaw as Record<string, unknown>;
  const pricingRecord = pricingRaw as Record<string, unknown>;

  const items = normaliseItems(orderRecord.items);
  if (items.length === 0) {
    return null;
  }

  const kitItems = normaliseKitItems(orderRecord.kitItems);
  const rentalSubtotal = toCurrency(ensureNumber(orderRecord.rentalSubtotal));
  const kitReservationStatus = normaliseString(orderRecord.kitReservationStatus) === "pending"
    ? "pending"
    : "confirmed";

  const orderPayload: CheckoutOrderPayload = {
    items,
    kitItems,
    rentalSubtotal,
    kitReservationStatus,
    kitReservationWarnings: normaliseWarnings(orderRecord.kitReservationWarnings),
    userEmail: optionalString(orderRecord.userEmail),
    customerName: optionalString(orderRecord.customerName),
    companyName: optionalString(orderRecord.companyName),
    location: optionalString(orderRecord.location),
    postalCode: optionalString(orderRecord.postalCode),
    projectName: optionalString(orderRecord.projectName),
    voucher: optionalString(orderRecord.voucher),
    leadSource: optionalString(orderRecord.leadSource) ?? "hq",
    organisers: Array.isArray(orderRecord.organisers) ? orderRecord.organisers : [],
    organisation: normaliseOrganisation(orderRecord.organisation),
  };

  const pricingPayload: CheckoutPricingPayload = {
    productTotal: toCurrency(ensureNumber(pricingRecord.productTotal)),
    rentalTotal: toCurrency(ensureNumber(pricingRecord.rentalTotal)),
    voucherDiscount: toCurrency(ensureNumber(pricingRecord.voucherDiscount)),
    discountPercent: toCurrency(ensureNumber(pricingRecord.discountPercent)),
    discountAmount: toCurrency(ensureNumber(pricingRecord.discountAmount)),
    subtotal: toCurrency(ensureNumber(pricingRecord.subtotal)),
    vat: toCurrency(ensureNumber(pricingRecord.vat)),
    grandTotal: toCurrency(ensureNumber(pricingRecord.grandTotal)),
    hasZeroBalance:
      typeof pricingRecord.hasZeroBalance === "boolean"
        ? pricingRecord.hasZeroBalance
        : undefined,
    voucherCode: optionalString(pricingRecord.voucherCode),
  };

  return { order: orderPayload, pricing: pricingPayload };
};

const respond = (res: NextApiResponse, status: number, payload: Record<string, unknown>) => {
  res.status(status).json(payload);
};

const extractBearerToken = (header: string | string[] | undefined): string | null => {
  if (Array.isArray(header)) {
    return extractBearerToken(header[0]);
  }
  if (typeof header !== "string") {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token?.length ? token : null;
};

const createPaymentIntent = async (
  stripe: Stripe,
  amount: number,
  orderId: string,
  customerEmail: string | null,
): Promise<Stripe.PaymentIntent> => {
  const rounded = Math.max(0, Math.round(amount * 100));
  if (rounded <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  return stripe.paymentIntents.create({
    amount: rounded,
    currency: CURRENCY,
    metadata: {
      orderId,
      source: "portal-checkout",
    },
    receipt_email: customerEmail ?? undefined,
    automatic_payment_methods: { enabled: true },
  });
};

const buildPaymentSchedule = (depositAmount: number) => {
  if (depositAmount <= ZERO_BALANCE_TOLERANCE) {
    return [];
  }
  const timestamp = FieldValue.serverTimestamp();
  return [
    {
      id: "due-now",
      label: "Deposit",
      status: "due",
      percentage: 100,
      dueDays: 0,
      grossAmount: depositAmount,
      netAmount: depositAmount,
      createdAt: timestamp,
      dueAt: timestamp,
    },
  ];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    handleOptions(req, res);
    return;
  }

  applyApiCors(req, res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    respond(res, 405, { error: "Method not allowed", code: "method-not-allowed" });
    return;
  }

  const idToken = extractBearerToken(req.headers.authorization);
  if (!idToken) {
    respond(res, 401, { error: "Sign in required", code: "unauthenticated" });
    return;
  }

  let rawBody: unknown = req.body;
  if (typeof rawBody === "string") {
    try {
      rawBody = JSON.parse(rawBody);
    } catch (error) {
      console.error("create-order body parse failed", { error });
      respond(res, 400, { error: "Invalid checkout payload", code: "invalid-argument" });
      return;
    }
  }

  const parsedBody = parseCheckoutRequest(rawBody);
  if (!parsedBody) {
    respond(res, 400, { error: "Invalid checkout payload", code: "invalid-argument" });
    return;
  }

  try {
    const auth = await getFirebaseAdminAuth().verifyIdToken(idToken);
    if (!auth?.uid) {
      respond(res, 401, { error: "Sign in required", code: "unauthenticated" });
      return;
    }

    const firestore = getFirebaseAdminFirestore();
    const ordersCollection = firestore.collection("orders");
    const orderRef = ordersCollection.doc();
    const orderId = orderRef.id;

    const customerName = parsedBody.order.customerName ?? optionalString(auth.name) ?? null;
    if (!customerName) {
      respond(res, 400, { error: "Customer name is required", code: "invalid-argument" });
      return;
    }

    const emailFromToken = optionalString(auth.email);
    const customerEmail = parsedBody.order.userEmail ?? emailFromToken;
    const organisationInfo = parsedBody.order.organisation ?? null;
    const companyName =
      optionalString(parsedBody.order.companyName) ??
      optionalString(organisationInfo?.name) ??
      null;

    const price = Math.max(0, toCurrency(parsedBody.pricing.grandTotal));
    const netTotal = Math.max(0, toCurrency(parsedBody.pricing.subtotal));
    const vat = Math.max(0, toCurrency(parsedBody.pricing.vat));
    const voucherDiscount = Math.max(0, toCurrency(parsedBody.pricing.voucherDiscount));
    const discountAmount = Math.max(0, toCurrency(parsedBody.pricing.discountAmount));
    const hasZeroBalance =
      parsedBody.pricing.hasZeroBalance ?? Math.abs(price) <= ZERO_BALANCE_TOLERANCE;
    const primaryItem = parsedBody.order.items[0] ?? null;
    const serviceId = primaryItem?.id ?? null;
    const serviceName =
      typeof primaryItem?.name === "string" && primaryItem.name.trim().length > 0
        ? primaryItem.name.trim()
        : null;

    const depositAmount = hasZeroBalance ? 0 : price;
    const depositPercentage =
      price > ZERO_BALANCE_TOLERANCE ? Math.min(1, Math.max(0, depositAmount / price)) : 0;
    const balanceAmount = Math.max(0, toCurrency(price - depositAmount));
    const paymentStatus = depositAmount <= ZERO_BALANCE_TOLERANCE ? "paid" : "requires_payment";
    const orderStatus = depositAmount <= ZERO_BALANCE_TOLERANCE ? "confirmed" : "pending_payment";

    let stripeClient: Stripe | null = null;
    let paymentIntent: Stripe.PaymentIntent | null = null;

    if (depositAmount > ZERO_BALANCE_TOLERANCE) {
      stripeClient = await getStripeClient();
      if (!stripeClient) {
        respond(res, 503, { error: "Stripe configuration unavailable", code: "stripe-misconfigured" });
        return;
      }
      try {
        paymentIntent = await createPaymentIntent(stripeClient, depositAmount, orderId, customerEmail);
      } catch (error) {
        console.error("Failed to create Stripe payment intent", { error });
        respond(res, 502, { error: "Payment session could not be created", code: "payment-intent-error" });
        return;
      }
    }

    const timestamp = FieldValue.serverTimestamp();
    const projectsCollection = firestore.collection("projects");
    const projectRef = projectsCollection.doc();
    const projectId = projectRef.id;

    const preferredProjectName =
      typeof parsedBody.order.projectName === "string" && parsedBody.order.projectName.trim().length > 0
        ? parsedBody.order.projectName.trim()
        : null;
    const projectTitle = preferredProjectName ?? serviceName ?? `Order ${orderId}`;

    const projectDocument: Record<string, unknown> = {
      name: projectTitle,
      title: projectTitle,
      projectName: projectTitle,
      status: "intake",
      stage: "intake",
      orderId,
      orderRef: orderRef.path,
      serviceId,
      serviceName,
      userId: auth.uid,
      userEmail: customerEmail,
      customerName,
      companyName,
      location: parsedBody.order.location,
      postalCode: parsedBody.order.postalCode,
      kitReservationStatus: parsedBody.order.kitReservationStatus,
      kitReservationWarnings: parsedBody.order.kitReservationWarnings,
      rentalSubtotal: parsedBody.order.rentalSubtotal,
      channel: "client-portal",
      source: "checkout",
      createdAt: timestamp,
      updatedAt: timestamp,
      organisationId: organisationInfo?.id ?? null,
      organisationName: organisationInfo?.name ?? companyName,
      organisationSource: organisationInfo?.source ?? null,
      organisationBrandLogoUrl: organisationInfo?.brandLogoUrl ?? null,
      organisationBrandColors: organisationInfo?.brandColors ?? [],
    };

    try {
      await projectRef.set(projectDocument, { merge: false });
    } catch (error) {
      console.error("Failed to create project for order", { error, orderId });
      if (paymentIntent && stripeClient) {
        try {
          await stripeClient.paymentIntents.cancel(paymentIntent.id);
        } catch (cancelError) {
          console.warn("Failed to cancel payment intent after project creation error", {
            paymentIntentId: paymentIntent.id,
            error: cancelError,
          });
        }
      }
      respond(res, 500, { error: "Failed to create project", code: "project-creation-failed" });
      return;
    }

    const orderDocument: Record<string, unknown> = {
      userId: auth.uid,
      userEmail: customerEmail,
      status: orderStatus,
      paymentStatus,
      price,
      netTotal,
      subtotal: netTotal,
      vat,
      discountAmount,
      voucherDiscount,
      totals: {
        productTotal: parsedBody.pricing.productTotal,
        rentalTotal: parsedBody.pricing.rentalTotal,
        discountAmount,
        voucherDiscount,
        subtotal: netTotal,
        vat,
        grandTotal: price,
      },
      serviceId,
      serviceName,
      depositAmount,
      depositDue: depositAmount,
      balanceAmount,
      balanceDue: balanceAmount,
      depositPercentage,
      paymentSchedule: buildPaymentSchedule(depositAmount),
      kitReservationStatus: parsedBody.order.kitReservationStatus,
      kitReservationWarnings: parsedBody.order.kitReservationWarnings,
      rentalSubtotal: parsedBody.order.rentalSubtotal,
      items: parsedBody.order.items,
      kitItems: parsedBody.order.kitItems,
      organisers: parsedBody.order.organisers,
      voucher: parsedBody.order.voucher,
      voucherCode: parsedBody.pricing.voucherCode ?? parsedBody.order.voucher,
      leadSource: parsedBody.order.leadSource,
      customerName,
      companyName,
      location: parsedBody.order.location,
      postalCode: parsedBody.order.postalCode,
      projectId,
      projectRef: projectRef.path,
      projectName: projectTitle,
      channel: "client-portal",
      paymentIntentId: paymentIntent?.id ?? null,
      paymentProvider: paymentIntent ? "stripe" : "none",
      zeroBalanceConfirmed: depositAmount <= ZERO_BALANCE_TOLERANCE,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: auth.uid,
      organisationId: organisationInfo?.id ?? null,
      organisationName: organisationInfo?.name ?? companyName,
      organisationSource: organisationInfo?.source ?? null,
      organisationBrandLogoUrl: organisationInfo?.brandLogoUrl ?? null,
      organisationBrandColors: organisationInfo?.brandColors ?? [],
    };

    try {
      await orderRef.set(orderDocument, { merge: false });
    } catch (error) {
      console.error("Failed to persist order document", { error });
      try {
        await projectRef.delete();
      } catch (projectDeleteError) {
        console.warn("Failed to clean up project after order write error", {
          projectId,
          error: projectDeleteError,
        });
      }
      if (paymentIntent && stripeClient) {
        try {
          await stripeClient.paymentIntents.cancel(paymentIntent.id);
        } catch (cancelError) {
          console.warn("Failed to cancel payment intent after Firestore error", {
            paymentIntentId: paymentIntent.id,
            error: cancelError,
          });
        }
      }
      respond(res, 500, { error: "Failed to create order", code: "internal" });
      return;
    }

    try {
      const defaultTasks = await collectProductDefaultTasks(firestore, parsedBody.order.items);
      if (defaultTasks.length > 0) {
        const batch = firestore.batch();
        const tasksCollection = projectRef.collection("tasks");
        defaultTasks.forEach((task) => {
          const taskRef = tasksCollection.doc();
          batch.set(taskRef, {
            title: task.title,
            forCustomer: task.forCustomer,
            subtasks: task.subtasks,
            status: "todo",
            assignedTo: null,
            assigneeName: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            origin: {
              type: "product-default-task",
              productId: task.productId,
              productName: task.productName,
            },
          });
        });
        await batch.commit();
      }
    } catch (error) {
      console.error("Failed to seed project tasks from products", { error, projectId, orderId });
    }

    respond(res, 200, {
      orderId,
      clientSecret: paymentIntent?.client_secret ?? null,
      paymentIntentId: paymentIntent?.id ?? null,
      projectId,
      price,
      netTotal,
      depositAmount,
      depositDue: depositAmount,
      depositPercentage,
      balanceAmount,
      balanceDue: balanceAmount,
      discountAmount,
      voucherDiscount,
    });
  } catch (error) {
    console.error("create-order handler failed", { error });
    respond(res, 500, { error: "Checkout service failed", code: "internal" });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
