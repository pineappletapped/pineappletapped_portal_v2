import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { extractUserRoles, hasRole, type RoleKey, type UserRoles } from '@/lib/roles';
import { getStripeClient } from '@/lib/stripe-config';
import type Stripe from 'stripe';

const FINANCE_ROLES: RoleKey[] = ['admin', 'finance'];

type FinanceContext = { uid: string; email: string | null; roles: UserRoles };

type HistoryEntry = {
  event: string;
  at: string;
  actor: { uid: string; email: string | null } | null;
  notes?: string | null;
};

const LINE_ITEM_SCHEMA = z
  .array(
    z
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
      }))
  )
  .optional();

const SPLIT_PAYMENT_SCHEMA = z
  .array(
    z
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
      }))
  )
  .optional();

const UPDATE_SCHEMA = z.object({
  organisationName: z
    .union([z.string(), z.undefined()])
    .transform((value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }
      return value;
    })
    .optional(),
  clientName: z
    .union([z.string(), z.undefined()])
    .transform((value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }
      return value;
    })
    .optional(),
  clientEmail: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== 'string') {
        return value ?? undefined;
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
    .optional(),
  dueDate: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (!value && value !== '') {
        return undefined;
      }
      if (value === null || value === '') {
        return null;
      }
      const isoDate = parseDateInput(value.trim());
      if (!isoDate) {
        throw new Error('Invalid due date.');
      }
      return isoDate;
    })
    .optional(),
  paymentTerms: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (value === null) {
        return null;
      }
      return undefined;
    })
    .optional(),
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
      if (value === null) {
        return null;
      }
      return undefined;
    })
    .optional(),
  status: z
    .union([
      z.literal('draft'),
      z.literal('sent'),
      z.literal('unpaid'),
      z.literal('paid'),
      z.literal('overdue'),
      z.literal('void'),
      z.undefined(),
    ])
    .optional(),
  portalPublished: z.boolean().optional(),
  allowStripePayment: z.boolean().optional(),
  items: LINE_ITEM_SCHEMA,
  splitPayments: SPLIT_PAYMENT_SCHEMA,
  notes: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (value === null) {
        return null;
      }
      return undefined;
    })
    .optional(),
  regenerateStripeLink: z.boolean().optional(),
  markSent: z.boolean().optional(),
  markPaid: z.boolean().optional(),
});

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
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
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serialiseValue(entry));
  }
  if (typeof value !== 'object') {
    return value;
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

function serialiseDoc(doc: DocumentSnapshot | QueryDocumentSnapshot) {
  const data = doc.data() ?? {};
  const result: Record<string, unknown> = { id: doc.id };
  Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
    result[key] = serialiseValue(value);
  });
  return result;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await resolveFinanceContext();
  if (!context) {
    return unauthorized();
  }

  const { id } = params;
  if (!id) {
    return badRequest('Invoice ID is required.');
  }

  try {
    const firestore = getFirebaseAdminFirestore();
    const invoiceRef = firestore.collection('clientInvoices').doc(id);
    const snapshot = await invoiceRef.get();
    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    }
    const invoice = serialiseDoc(snapshot);
    return NextResponse.json({ invoice });
  } catch (error) {
    console.error('Failed to load invoice', error);
    return NextResponse.json({ error: 'Failed to load invoice.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const context = await resolveFinanceContext();
  if (!context) {
    return unauthorized();
  }

  const { id } = params;
  if (!id) {
    return badRequest('Invoice ID is required.');
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch (error) {
    return badRequest('Invalid JSON payload.');
  }

  const parseResult = UPDATE_SCHEMA.safeParse(payload ?? {});
  if (!parseResult.success) {
    const message = parseResult.error.errors.at(0)?.message ?? 'Invalid invoice update payload.';
    return badRequest(message);
  }

  const updatesInput = parseResult.data;
  const firestore = getFirebaseAdminFirestore();
  const invoiceRef = firestore.collection('clientInvoices').doc(id);
  const snapshot = await invoiceRef.get();
  if (!snapshot.exists) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }

  const existing = snapshot.data() ?? {};
  const now = new Date();
  const nowIso = now.toISOString();
  const updates: Record<string, unknown> = { updatedAt: nowIso };
  const history: HistoryEntry[] = Array.isArray(existing.history)
    ? ([...existing.history] as HistoryEntry[])
    : [];
  const historyEvents: HistoryEntry[] = [];

  if (updatesInput.organisationName !== undefined) {
    updates.organisationName = updatesInput.organisationName ?? null;
  }
  if (updatesInput.clientName !== undefined) {
    updates.clientName = updatesInput.clientName ?? null;
  }
  if (updatesInput.clientEmail !== undefined) {
    updates.clientEmail = updatesInput.clientEmail;
  }
  if (updatesInput.dueDate !== undefined) {
    updates.dueDate = updatesInput.dueDate;
  }
  if (updatesInput.paymentTerms !== undefined) {
    updates.paymentTerms = updatesInput.paymentTerms;
  }
  if (updatesInput.termsUrl !== undefined) {
    updates.termsUrl = updatesInput.termsUrl;
  }
  if (updatesInput.notes !== undefined) {
    updates.notes = updatesInput.notes;
  }
  if (typeof updatesInput.portalPublished === 'boolean') {
    updates.portalPublished = updatesInput.portalPublished;
    historyEvents.push({
      event: updatesInput.portalPublished ? 'published_to_portal' : 'unpublished_from_portal',
      at: nowIso,
      actor: { uid: context.uid, email: context.email },
    });
  }
  if (typeof updatesInput.allowStripePayment === 'boolean') {
    updates.allowStripePayment = updatesInput.allowStripePayment;
  }

  let itemsChanged = false;
  if (updatesInput.items) {
    updates.items = updatesInput.items;
    itemsChanged = true;
  }
  if (updatesInput.splitPayments) {
    updates.splitPayments = updatesInput.splitPayments;
    updates.splitPaymentsCount = updatesInput.splitPayments.length;
  }

  let statusChanged = false;
  if (updatesInput.status) {
    updates.status = updatesInput.status;
    statusChanged = true;
    historyEvents.push({
      event: `status_${updatesInput.status}`,
      at: nowIso,
      actor: { uid: context.uid, email: context.email },
    });
    if (updatesInput.status === 'paid') {
      updates.paidAt = nowIso;
    }
    if (updatesInput.status === 'sent') {
      updates.sentAt = nowIso;
    }
  }

  if (updatesInput.markSent) {
    updates.status = 'sent';
    updates.sentAt = nowIso;
    statusChanged = true;
    historyEvents.push({
      event: 'status_sent',
      at: nowIso,
      actor: { uid: context.uid, email: context.email },
    });
  }

  if (updatesInput.markPaid) {
    updates.status = 'paid';
    updates.paidAt = nowIso;
    statusChanged = true;
    historyEvents.push({
      event: 'status_paid',
      at: nowIso,
      actor: { uid: context.uid, email: context.email },
    });
  }

  let total = typeof existing.total === 'number' ? existing.total : 0;
  if (itemsChanged && Array.isArray(updatesInput.items)) {
    total = updatesInput.items.reduce((sum, item) => sum + item.amount, 0);
    updates.total = Number.parseFloat(total.toFixed(2));
    if (!statusChanged || updates.status !== 'paid') {
      updates.outstandingBalance = Number.parseFloat(total.toFixed(2));
    }
  }

  if (updatesInput.splitPayments && updatesInput.splitPayments.length > 0) {
    const scheduleTotal = updatesInput.splitPayments.reduce((sum, item) => sum + item.amount, 0);
    const roundedTotal = Number.parseFloat(total.toFixed(2));
    const roundedSchedule = Number.parseFloat(scheduleTotal.toFixed(2));
    if (Math.abs(roundedTotal - roundedSchedule) > 0.5) {
      return badRequest('Split payment schedule total must match the invoice total.');
    }
  }

  if (statusChanged && updates.status === 'paid') {
    updates.outstandingBalance = 0;
  }

  let regenerateStripe = Boolean(updatesInput.regenerateStripeLink);
  if (itemsChanged && updatesInput.allowStripePayment !== false && existing.allowStripePayment !== false) {
    regenerateStripe = regenerateStripe || Boolean(existing.allowStripePayment ?? true);
  }
  if (updatesInput.allowStripePayment === false) {
    regenerateStripe = false;
    updates.stripePaymentUrl = null;
    updates.stripePaymentLinkId = null;
  }

  if (regenerateStripe) {
    try {
      const stripe = await getStripeClient();
      if (stripe && Array.isArray(updatesInput.items) && updatesInput.items.length > 0) {
        const lineItems = updatesInput.items
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
            // Stripe's API accepts inline `price_data`, but the current type
            // definition only models the `price` field. Cast to keep the code
            // aligned with the documented request shape until the upstream
            // types catch up.
            line_items: lineItems as unknown as Stripe.PaymentLinkCreateParams.LineItem[],
            after_completion: { type: 'hosted_confirmation', custom_message: 'Thanks for your payment!' },
            metadata: {
              invoiceId: id,
              organisationName: (updates.organisationName as string | undefined) ?? existing.organisationName ?? '',
              clientName: (updates.clientName as string | undefined) ?? existing.clientName ?? '',
            },
          });
          updates.stripePaymentUrl = paymentLink.url;
          updates.stripePaymentLinkId = paymentLink.id;
          historyEvents.push({
            event: 'stripe_link_regenerated',
            at: nowIso,
            actor: { uid: context.uid, email: context.email },
          });
        }
      }
    } catch (error) {
      console.error('Failed to regenerate Stripe payment link for invoice', error);
    }
  }

  if (historyEvents.length > 0) {
    history.push(...historyEvents);
    updates.history = history;
  }

  try {
    await invoiceRef.set(updates, { merge: true });
    const refreshed = await invoiceRef.get();
    const invoice = serialiseDoc(refreshed);
    return NextResponse.json({ invoice });
  } catch (error) {
    console.error('Failed to update invoice', error);
    return NextResponse.json({ error: 'Failed to update invoice.' }, { status: 500 });
  }
}
