import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { extractUserRoles, hasRole, type RoleKey, type UserRoles } from '@/lib/roles';
import { getStripeClient } from '@/lib/stripe-config';

const FINANCE_ROLES: RoleKey[] = ['admin', 'finance'];

type FinanceContext = { uid: string; email: string | null; roles: UserRoles };

type FirestorePrimitive = string | number | boolean | null;

type InvoiceHistoryEntry = {
  event: string;
  at: string;
  actor: { uid: string; email: string | null } | null;
  notes?: string | null;
};

const LINE_ITEM_SCHEMA = z
  .object({
    description: z
      .string({ required_error: 'Description is required.' })
      .trim()
      .min(1, 'Description is required.'),
    amount: z
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
        throw new Error('Amount must be a number.');
      })
      .refine((value) => value >= 0, 'Amount must be zero or greater.'),
    productId: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .optional(),
  })
  .transform((item) => ({
    description: item.description,
    amount: Number.parseFloat(item.amount.toFixed(2)),
    productId: item.productId ?? null,
  }));

const SPLIT_PAYMENT_SCHEMA = z
  .object({
    amount: z
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
        throw new Error('Split payment amount must be a number.');
      })
      .refine((value) => value >= 0, 'Split payment amount must be zero or greater.'),
    dueDate: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (!value) {
          return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        const isoDate = parseDateInput(trimmed);
        if (!isoDate) {
          throw new Error('Invalid split payment due date.');
        }
        return isoDate;
      })
      .nullable(),
  })
  .transform((payment) => ({
    amount: Number.parseFloat(payment.amount.toFixed(2)),
    dueDate: payment.dueDate,
  }));

const CREATE_INVOICE_SCHEMA = z
  .object({
    orgId: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .nullable(),
    organisationName: z
      .string({ required_error: 'Organisation name is required.' })
      .trim()
      .min(1, 'Organisation name is required.'),
    crmRecordId: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .nullable(),
    clientId: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .nullable(),
    clientName: z
      .string({ required_error: 'Client name is required.' })
      .trim()
      .min(1, 'Client name is required.'),
    clientEmail: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value !== 'string') {
          return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
          throw new Error('Client email is invalid.');
        }
        return trimmed.toLowerCase();
      })
      .nullable(),
    clientStatus: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .nullable(),
    billingEntityType: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .nullable(),
    projectId: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .nullable(),
    dueDate: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (!value) {
          return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        const isoDate = parseDateInput(trimmed);
        if (!isoDate) {
          throw new Error('Invalid due date.');
        }
        return isoDate;
      })
      .nullable(),
    items: z.array(LINE_ITEM_SCHEMA).min(1, 'At least one line item is required.'),
    paymentTerms: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      })
      .nullable(),
    termsUrl: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (!trimmed) {
            return null;
          }
          try {
            const url = new URL(trimmed);
            return url.toString();
          } catch (error) {
            throw new Error('Terms URL is invalid.');
          }
        }
        return null;
      })
      .nullable(),
    allowStripePayment: z.boolean().optional().default(true),
    splitPayments: z.array(SPLIT_PAYMENT_SCHEMA).optional().default([]),
  })
  .transform((payload) => ({
    ...payload,
    allowStripePayment: payload.allowStripePayment ?? true,
  }));

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function parseDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const iso = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(iso.getTime())) {
      return null;
    }
    return iso.toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

async function resolveFinanceContext(): Promise<FinanceContext | null> {
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

    if (!hasRole(roles, FINANCE_ROLES)) {
      return null;
    }

    return { uid: decoded.uid, email, roles };
  } catch (error) {
    console.warn('Failed to verify finance session', error);
    return null;
  }
}

function serialiseValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value as null | undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serialiseValue(entry));
  }

  if (typeof value !== 'object') {
    return value as FirestorePrimitive;
  }

  const maybeDate = value as { toDate?: () => Date };
  if (typeof maybeDate.toDate === 'function') {
    try {
      return maybeDate.toDate().toISOString();
    } catch (error) {
      console.warn('Failed to serialise Firestore timestamp', error);
      return value;
    }
  }

  const proto = Object.getPrototypeOf(value);
  if (!proto || proto === Object.prototype) {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      result[key] = serialiseValue(entry);
    });
    return result;
  }

  return value;
}

function serialiseInvoiceDoc(doc: QueryDocumentSnapshot | DocumentSnapshot) {
  const data = doc.data() ?? {};
  const result: Record<string, unknown> = { id: doc.id };
  Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
    result[key] = serialiseValue(value);
  });
  return result;
}

export async function GET() {
  const context = await resolveFinanceContext();
  if (!context) {
    return unauthorized();
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const snapshot = await firestore
      .collection('clientInvoices')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const invoices = snapshot.docs.map((doc) => serialiseInvoiceDoc(doc));
    return NextResponse.json({ invoices });
  } catch (error) {
    console.error('Failed to list invoices', error);
    return NextResponse.json({ error: 'Failed to load invoices.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const context = await resolveFinanceContext();
  if (!context) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    return badRequest('Invalid JSON payload.');
  }

  const parseResult = CREATE_INVOICE_SCHEMA.safeParse(body);
  if (!parseResult.success) {
    const message = parseResult.error.errors.at(0)?.message ?? 'Invalid invoice payload.';
    return badRequest(message);
  }

  const payload = parseResult.data;
  const now = new Date();
  const nowIso = now.toISOString();
  const total = payload.items.reduce((sum, item) => sum + item.amount, 0);
  const splitScheduleTotal = (payload.splitPayments ?? []).reduce((sum, entry) => sum + entry.amount, 0);

  if (payload.splitPayments && payload.splitPayments.length > 0) {
    const roundedTotal = Number.parseFloat(total.toFixed(2));
    const roundedSchedule = Number.parseFloat(splitScheduleTotal.toFixed(2));
    if (Math.abs(roundedTotal - roundedSchedule) > 0.5) {
      return badRequest('Split payment schedule total must match the invoice total.');
    }
  }

  const firestore = getFirebaseAdminFirestore();
  const invoiceRef = firestore.collection('clientInvoices').doc();

  let stripePaymentUrl: string | null = null;
  let stripePaymentLinkId: string | null = null;
  if (payload.allowStripePayment) {
    try {
      const stripe = await getStripeClient();
      if (stripe) {
        const lineItems = payload.items
          .filter((item) => item.amount > 0)
          .map((item) => ({
            price_data: {
              currency: 'gbp',
              product_data: { name: item.description },
              unit_amount: Math.round(item.amount * 100),
            },
            quantity: 1,
          }));
        if (lineItems.length > 0) {
          const paymentLink = await stripe.paymentLinks.create({
            line_items: lineItems,
            after_completion: { type: 'hosted_confirmation', custom_message: 'Thanks for your payment!' },
            metadata: {
              invoiceId: invoiceRef.id,
              organisationName: payload.organisationName,
              clientName: payload.clientName,
            },
          });
          stripePaymentUrl = paymentLink.url;
          stripePaymentLinkId = paymentLink.id;
        }
      }
    } catch (error) {
      console.error('Failed to create Stripe payment link for invoice', error);
    }
  }

  const history: InvoiceHistoryEntry[] = [
    {
      event: 'created',
      at: nowIso,
      actor: { uid: context.uid, email: context.email },
    },
  ];

  const invoiceData: Record<string, unknown> = {
    orgId: payload.orgId,
    organisationName: payload.organisationName,
    crmRecordId: payload.crmRecordId,
    clientId: payload.clientId,
    clientName: payload.clientName,
    clientEmail: payload.clientEmail,
    clientStatus: payload.clientStatus,
    billingEntityType: payload.billingEntityType,
    projectId: payload.projectId,
    dueDate: payload.dueDate,
    items: payload.items,
    total: Number.parseFloat(total.toFixed(2)),
    outstandingBalance: Number.parseFloat(total.toFixed(2)),
    paymentTerms: payload.paymentTerms,
    termsUrl: payload.termsUrl,
    allowStripePayment: payload.allowStripePayment,
    splitPayments: payload.splitPayments,
    splitPaymentsCount: payload.splitPayments?.length ?? 0,
    status: 'draft',
    portalPublished: false,
    stripePaymentUrl,
    stripePaymentLinkId,
    createdAt: nowIso,
    updatedAt: nowIso,
    sentAt: null,
    paidAt: null,
    history,
  };

  try {
    await invoiceRef.set(invoiceData);
    const snapshot = await invoiceRef.get();
    const invoice = serialiseInvoiceDoc(snapshot);
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    console.error('Failed to create invoice', error);
    return NextResponse.json({ error: 'Failed to create invoice.' }, { status: 500 });
  }
}
