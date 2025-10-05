import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue, Timestamp, type QuerySnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import {
  estimateUsageCost,
  generateStructuredContent,
  sanitiseModelRecord,
  type SanitisedAiModel,
  type StructuredGenerationUsage,
} from '@/lib/ai/structured-generation.server';
import { ensurePromptRecord } from '@/lib/ai/prompt-registry.server';
import { getAiModelRecordById } from '@/lib/ai/models.server';
import { CLIENT_RESEARCH_MANUAL_PROMPT_TEMPLATE } from '@/lib/ai/templates';
import { extractUserRoles, hasRole, type RoleKey } from '@/lib/roles';

const ALLOWED_ROLES: RoleKey[] = ['admin', 'sales', 'marketing', 'projects'];

const REQUEST_SCHEMA = z.object({
  userId: z.string().min(1, 'userId is required'),
});

const CRM_BIO_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    opportunities: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    recommendedNextSteps: { type: 'array', items: { type: 'string' } },
    tone: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['overview', 'opportunities', 'risks', 'recommendedNextSteps', 'tone', 'sources'],
} as const;

const CRM_BIO_RESPONSE_SCHEMA = z.object({
  overview: z.string().min(1),
  opportunities: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  recommendedNextSteps: z.array(z.string()).default([]),
  tone: z.string().default(''),
  sources: z.array(z.string()).default([]),
  warnings: z.array(z.string()).optional(),
});

type CrmBioResponse = z.infer<typeof CRM_BIO_RESPONSE_SCHEMA>;

type ContactSummary = {
  fullName: string | null;
  organisation: string | null;
  email: string | null;
  phone: string | null;
  crmStatus: string | null;
  linkedinBio: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  lastLoginAt: string | null;
  affiliate: { name: string | null; refCode: string | null; notes: string | null } | null;
};

type OrderSummary = {
  id: string;
  status: string | null;
  createdAt: string | null;
  price: number | null;
  currency: string | null;
  items: string[];
};

type ProjectSummary = {
  id: string;
  title: string | null;
  status: string | null;
  kickoffDate: string | null;
  dueDate: string | null;
  territory: string | null;
};

type QuoteSummary = {
  id: string;
  label: string | null;
  client: string | null;
  status: string | null;
  createdAt: string | null;
};

type ProposalSummary = {
  id: string;
  title: string | null;
  status: string | null;
  projectName: string | null;
  createdAt: string | null;
};

function normaliseString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) {
        result.push(trimmed);
      }
    }
    if (result.length >= limit) break;
  }
  return result;
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normaliseCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function normaliseDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'object' && typeof (value as any).toDate === 'function') {
    try {
      return (value as any).toDate().toISOString();
    } catch (_error) {
      return null;
    }
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function mapContact(data: Record<string, unknown>): ContactSummary {
  const affiliate = typeof data.affiliate === 'object' && data.affiliate
    ? (data.affiliate as Record<string, unknown>)
    : null;

  return {
    fullName: normaliseString(data.fullName),
    organisation: normaliseString(data.organisation),
    email: normaliseString(data.email),
    phone: normaliseString(data.phone),
    crmStatus: normaliseString(data.crmStatus),
    linkedinBio: normaliseString(data.linkedinBio),
    notes: normaliseString(data.notes) ?? normaliseString(data.crmNotes),
    tags: normaliseStringArray(data.tags, 12),
    createdAt: normaliseDate(data.createdAt),
    updatedAt: normaliseDate(data.updatedAt),
    lastLoginAt: normaliseDate(data.lastLoginAt ?? data.lastSeenAt),
    affiliate: affiliate
      ? {
          name: normaliseString(affiliate.name) ?? normaliseString(affiliate.label),
          refCode: normaliseString(affiliate.refCode) ?? normaliseString(affiliate.code),
          notes: normaliseString(affiliate.notes),
        }
      : null,
  };
}

function normaliseOrderItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) items.push(trimmed);
      continue;
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const name = normaliseString(record.name ?? record.title ?? record.productName);
      if (name) items.push(name);
    }
    if (items.length >= 8) break;
  }
  return items;
}

function mapOrders(snapshot: QuerySnapshot): OrderSummary[] {
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        status: normaliseString(data.status),
        createdAt: normaliseDate(data.createdAt),
        price: normaliseNumber(data.price ?? data.total ?? data.amount),
        currency: normaliseCurrency(data.currency ?? data.currencyCode ?? 'GBP'),
        items: normaliseOrderItems(data.items),
      };
    })
    .sort((a, b) => (b.createdAt ? b.createdAt.localeCompare(a.createdAt ?? '') : -1))
    .slice(0, 8);
}

function mapProjects(snapshot: QuerySnapshot): ProjectSummary[] {
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const assignment =
        typeof data.franchiseAssignment === 'object' && data.franchiseAssignment
          ? (data.franchiseAssignment as Record<string, unknown>)
          : null;
      return {
        id: doc.id,
        title: normaliseString(data.title ?? data.projectName),
        status: normaliseString(data.status),
        kickoffDate: normaliseDate(data.kickoffDate ?? data.startDate),
        dueDate: normaliseDate(data.dueDate ?? data.deadline),
        territory: assignment ? normaliseString(assignment.territoryLabel) : null,
      };
    })
    .sort((a, b) => (b.dueDate ? b.dueDate.localeCompare(a.dueDate ?? '') : -1))
    .slice(0, 8);
}

function mapQuotes(snapshot: QuerySnapshot): QuoteSummary[] {
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const label =
        normaliseString(data.projectName) ||
        normaliseString(data.service) ||
        normaliseString(data.projectType) ||
        normaliseString(data.eventType) ||
        normaliseString(data.requestType) ||
        normaliseString(data.title) ||
        normaliseString(data.companyName) ||
        normaliseString(data.contactName) ||
        normaliseString(data.clientName);
      const client =
        normaliseString(data.contactName) ||
        normaliseString(data.clientName) ||
        normaliseString(data.companyName) ||
        normaliseString(data.clientCompany) ||
        normaliseString(data.userEmail) ||
        normaliseString(data.userId);
      return {
        id: doc.id,
        label: label ?? `Quote ${doc.id.slice(0, 8)}`,
        client: client ?? null,
        status: normaliseString(data.status),
        createdAt: normaliseDate(data.createdAt),
      };
    })
    .sort((a, b) => (b.createdAt ? b.createdAt.localeCompare(a.createdAt ?? '') : -1))
    .slice(0, 8);
}

function mapProposals(snapshot: QuerySnapshot): ProposalSummary[] {
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        title: normaliseString(data.title ?? data.projectName ?? data.clientCompany ?? data.clientName),
        status: normaliseString(data.status),
        projectName: normaliseString(data.projectName),
        createdAt: normaliseDate(data.createdAt),
      };
    })
    .sort((a, b) => (b.createdAt ? b.createdAt.localeCompare(a.createdAt ?? '') : -1))
    .slice(0, 8);
}

function sanitizeArray(values: string[] | undefined): string[] {
  if (!values?.length) return [];
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function buildBioText(data: CrmBioResponse): string {
  const sections: string[] = [];
  if (data.overview) {
    sections.push(`Overview:\n${data.overview.trim()}`);
  }
  if (data.opportunities?.length) {
    sections.push(`Opportunities:\n${data.opportunities.map((item) => `• ${item.trim()}`).join('\n')}`);
  }
  if (data.risks?.length) {
    sections.push(`Risks:\n${data.risks.map((item) => `• ${item.trim()}`).join('\n')}`);
  }
  if (data.recommendedNextSteps?.length) {
    sections.push(
      `Recommended next steps:\n${data.recommendedNextSteps.map((item) => `• ${item.trim()}`).join('\n')}`
    );
  }
  if (data.tone) {
    sections.push(`Tone guidance:\n${data.tone.trim()}`);
  }
  if (data.sources?.length) {
    sections.push(`Sources:\n${data.sources.map((item) => `• ${item.trim()}`).join('\n')}`);
  }
  if (!sections.length) {
    return 'No AI bio generated yet.';
  }
  return sections.join('\n\n');
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const uid = cookieStore.get('uid')?.value;
  if (!uid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (_error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const parsed = REQUEST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const firestore = getFirebaseAdminFirestore();
  const actorSnap = await firestore.collection('users').doc(uid).get();
  if (!actorSnap.exists) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actorData = actorSnap.data() ?? {};
  const actorRoles = extractUserRoles(actorData);
  if (!hasRole(actorRoles, ALLOWED_ROLES)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const targetRef = firestore.collection('users').doc(parsed.data.userId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    return NextResponse.json({ error: 'Client record not found' }, { status: 404 });
  }

  const targetData = targetSnap.data() ?? {};
  const contact = mapContact(targetData);

  const [ordersSnap, projectsSnap, quotesSnap] = await Promise.all([
    firestore.collection('orders').where('userId', '==', targetSnap.id).get(),
    firestore.collection('projects').where('userId', '==', targetSnap.id).get(),
    firestore.collection('quoteRequests').where('userId', '==', targetSnap.id).get(),
  ]);

  const proposalsSnap = contact.email
    ? await firestore.collection('proposals').where('clientEmail', '==', contact.email).get()
    : null;

  const orders = mapOrders(ordersSnap);
  const projects = mapProjects(projectsSnap);
  const quotes = mapQuotes(quotesSnap);
  const proposals = proposalsSnap ? mapProposals(proposalsSnap) : [];

  const context = {
    client: {
      id: targetSnap.id,
      ...contact,
    },
    summary: {
      totalOrders: orders.length,
      totalProjects: projects.length,
      totalQuotes: quotes.length,
      totalProposals: proposals.length,
      lastOrderAt: orders[0]?.createdAt ?? null,
      lastProjectDue: projects[0]?.dueDate ?? null,
      lastQuoteAt: quotes[0]?.createdAt ?? null,
      lastProposalAt: proposals[0]?.createdAt ?? null,
    },
    orders,
    projects,
    quotes,
    proposals,
  };

  const requestId = randomUUID();

  const promptRecord = await ensurePromptRecord(
    CLIENT_RESEARCH_MANUAL_PROMPT_TEMPLATE.name,
    CLIENT_RESEARCH_MANUAL_PROMPT_TEMPLATE
  );

  const modelRecord = promptRecord.defaultModelId
    ? await getAiModelRecordById(promptRecord.defaultModelId)
    : null;

  let aiUsage: StructuredGenerationUsage | null = null;
  let resolvedModel: SanitisedAiModel | null = sanitiseModelRecord(modelRecord);

  let aiResult;
  try {
    aiResult = await generateStructuredContent({
      prompt: promptRecord,
      model: modelRecord,
      context,
      responseSchema: CRM_BIO_RESPONSE_JSON_SCHEMA,
      maxOutputTokens: 1200,
    });
  } catch (error) {
    console.error('Failed to generate CRM bio', { requestId, error });
    return NextResponse.json({ error: 'AI generation failed. Please try again.' }, { status: 502 });
  }

  if (aiResult.model) {
    resolvedModel = aiResult.model;
  }
  aiUsage = aiResult.usage;

  let parsedResponse: CrmBioResponse;
  try {
    parsedResponse = CRM_BIO_RESPONSE_SCHEMA.parse(aiResult.json);
  } catch (error) {
    console.error('Invalid CRM bio schema', { requestId, error });
    return NextResponse.json({ error: 'AI response did not match expected schema.' }, { status: 502 });
  }

  const opportunities = sanitizeArray(parsedResponse.opportunities);
  const risks = sanitizeArray(parsedResponse.risks);
  const recommendedNextSteps = sanitizeArray(parsedResponse.recommendedNextSteps);
  const sources = sanitizeArray(parsedResponse.sources);
  const warnings = sanitizeArray(parsedResponse.warnings);
  const tone = parsedResponse.tone?.trim() ?? '';
  const overview = parsedResponse.overview.trim();

  const bioText = buildBioText({
    overview,
    opportunities,
    risks,
    recommendedNextSteps,
    tone,
    sources,
    warnings,
  });

  const structuredResult: Record<string, unknown> = {
    overview,
    opportunities,
    risks,
    recommendedNextSteps,
    tone,
    sources,
  };
  if (warnings.length) {
    structuredResult.warnings = warnings;
  }

  const usageCost = estimateUsageCost(aiUsage, resolvedModel);
  const currencyRaw = resolvedModel?.currency ?? modelRecord?.currency ?? null;
  const currency = currencyRaw ? currencyRaw.toUpperCase() : null;

  const now = FieldValue.serverTimestamp();

  await targetRef.set(
    {
      aiBio: bioText,
      aiBioStructured: structuredResult,
      aiBioGeneratedAt: now,
      aiBioGeneratedBy: {
        uid,
        email: normaliseString(actorData.email),
        name: normaliseString(actorData.fullName),
      },
      aiBioMetadata: {
        requestId,
        promptId: promptRecord.id,
        promptName: promptRecord.name,
        modelId: resolvedModel?.modelId ?? promptRecord.defaultModelId ?? null,
        modelName: resolvedModel?.name ?? modelRecord?.name ?? null,
        usage: aiUsage
          ? {
              promptTokens: aiUsage.promptTokens ?? null,
              completionTokens: aiUsage.completionTokens ?? null,
              totalTokens: aiUsage.totalTokens ?? null,
              cost: usageCost ?? null,
              currency,
            }
          : null,
        warnings: warnings.length ? warnings : FieldValue.delete(),
      },
      aiBioWarnings: warnings.length ? warnings : FieldValue.delete(),
    },
    { merge: true }
  );

  await firestore.collection('aiCommandLogs').add({
    commandName: 'crm_bio_generate',
    promptId: promptRecord.id,
    promptName: promptRecord.name,
    modelId: resolvedModel?.modelId ?? promptRecord.defaultModelId ?? null,
    modelName: resolvedModel?.name ?? modelRecord?.name ?? null,
    totalTokens: aiUsage?.totalTokens ?? null,
    promptTokens: aiUsage?.promptTokens ?? null,
    completionTokens: aiUsage?.completionTokens ?? null,
    cost: usageCost ?? null,
    currency,
    createdAt: FieldValue.serverTimestamp(),
    requestId,
    actorUid: uid,
    actorEmail: normaliseString(actorData.email),
    targetUserId: targetSnap.id,
    metadata: {
      clientName: contact.fullName ?? contact.organisation ?? contact.email ?? null,
      warnings: warnings.length ? warnings : null,
      source: 'crm_manual_generate',
    },
  });

  const timestamp = new Date().toISOString();

  return NextResponse.json(
    {
      bio: bioText,
      structured: structuredResult,
      warnings,
      promptId: promptRecord.id,
      promptName: promptRecord.name,
      modelName: resolvedModel?.name ?? modelRecord?.name ?? null,
      requestId,
      updatedAt: timestamp,
    },
    { status: 200 }
  );
}
