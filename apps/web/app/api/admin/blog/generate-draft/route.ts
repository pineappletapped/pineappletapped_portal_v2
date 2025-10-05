import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { ensurePromptRecord } from '@/lib/ai/prompt-registry.server';
import { getAiModelRecordById } from '@/lib/ai/models.server';
import { BLOG_POST_DRAFT_PROMPT_TEMPLATE } from '@/lib/ai/templates';
import {
  estimateUsageCost,
  generateStructuredContent,
  sanitiseModelRecord,
  type SanitisedAiModel,
  type StructuredGenerationUsage,
} from '@/lib/ai/structured-generation.server';
import { extractUserRoles, hasRole, type RoleKey } from '@/lib/roles';

const ALLOWED_ROLES: RoleKey[] = ['marketing', 'admin'];

const REQUEST_SCHEMA = z.object({
  summary: z.string().min(20, 'Provide at least a couple of sentences for the summary.'),
  audience: z.string().optional(),
  tone: z.string().optional(),
  campaign: z.string().optional(),
  keywords: z.array(z.string().min(1)).max(12).optional(),
  categories: z.array(z.string().min(1)).max(8).optional(),
  tags: z.array(z.string().min(1)).max(12).optional(),
  relatedProducts: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .max(10)
    .optional(),
  notes: z.string().optional(),
  prohibitedTopics: z.array(z.string().min(1)).max(8).optional(),
  modelId: z.string().optional(),
});

const BLOG_DRAFT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    contentHtml: { type: 'string' },
    seoTitle: { type: 'string' },
    seoDescription: { type: 'string' },
    seoKeywords: { type: 'array', items: { type: 'string' } },
    outline: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'contentHtml', 'seoTitle', 'seoDescription', 'seoKeywords', 'outline'],
} as const;

const BLOG_DRAFT_RESPONSE_SCHEMA = z.object({
  title: z.string().min(3),
  summary: z.string().min(10),
  contentHtml: z.string().min(50),
  seoTitle: z.string().min(10),
  seoDescription: z.string().min(30),
  seoKeywords: z.array(z.string().min(2)).default([]),
  outline: z.array(z.string().min(3)).default([]),
  warnings: z.array(z.string().min(2)).optional(),
});

type BlogDraftResponse = z.infer<typeof BLOG_DRAFT_RESPONSE_SCHEMA>;

type NormalisedProduct = { id: string | null; name: string | null };

type DraftContext = {
  summary: string;
  audience?: string | null;
  tone?: string | null;
  campaign?: string | null;
  keywords: string[];
  categories: string[];
  tags: string[];
  relatedProducts: NormalisedProduct[];
  notes?: string | null;
  prohibitedTopics: string[];
};

function normaliseString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function dedupeStrings(values: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  values.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    results.push(trimmed);
  });
  return results.slice(0, 16);
}

function normaliseProducts(values: NormalisedProduct[] = []): NormalisedProduct[] {
  return values
    .map((product) => ({
      id: product.id && product.id.trim() ? product.id.trim() : null,
      name: product.name && product.name.trim() ? product.name.trim() : null,
    }))
    .filter((product) => product.id || product.name)
    .slice(0, 10);
}

function buildDraftContext(input: z.infer<typeof REQUEST_SCHEMA>): DraftContext {
  return {
    summary: input.summary.trim(),
    audience: normaliseString(input.audience),
    tone: normaliseString(input.tone),
    campaign: normaliseString(input.campaign),
    keywords: dedupeStrings(input.keywords ?? []),
    categories: dedupeStrings(input.categories ?? []),
    tags: dedupeStrings(input.tags ?? []),
    relatedProducts: normaliseProducts(
      (input.relatedProducts ?? []).map((product) => ({
        id: product.id ?? null,
        name: product.name ?? null,
      }))
    ),
    notes: normaliseString(input.notes),
    prohibitedTopics: dedupeStrings(input.prohibitedTopics ?? []),
  };
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

  const requestId = randomUUID();
  const promptRecord = await ensurePromptRecord(
    BLOG_POST_DRAFT_PROMPT_TEMPLATE.name,
    BLOG_POST_DRAFT_PROMPT_TEMPLATE
  );

  const requestedModelId = parsed.data.modelId?.trim();
  const modelRecord = requestedModelId
    ? await getAiModelRecordById(requestedModelId)
    : promptRecord.defaultModelId
      ? await getAiModelRecordById(promptRecord.defaultModelId)
      : null;

  const context = buildDraftContext(parsed.data);

  let aiUsage: StructuredGenerationUsage | null = null;
  let resolvedModel: SanitisedAiModel | null = sanitiseModelRecord(modelRecord);
  let draft: BlogDraftResponse | null = null;

  try {
    const result = await generateStructuredContent({
      prompt: promptRecord,
      model: modelRecord,
      context,
      responseSchema: BLOG_DRAFT_RESPONSE_JSON_SCHEMA,
      maxOutputTokens: 1200,
    });

    aiUsage = result.usage;
    if (result.model) {
      resolvedModel = result.model;
    }

    const parsedDraft = BLOG_DRAFT_RESPONSE_SCHEMA.safeParse(result.json);
    if (!parsedDraft.success) {
      throw new Error(parsedDraft.error.message);
    }

    draft = parsedDraft.data;
  } catch (error) {
    return NextResponse.json(
      { error: `Draft generation failed: ${(error as Error).message}` },
      { status: 502 }
    );
  }

  if (!draft) {
    return NextResponse.json({ error: 'Draft generation failed.' }, { status: 502 });
  }

  const warnings = draft.warnings ?? [];
  const usageCost = estimateUsageCost(aiUsage, resolvedModel);
  const currencyRaw = resolvedModel?.currency ?? modelRecord?.currency ?? null;
  const currency = currencyRaw ? currencyRaw.toUpperCase() : null;

  await firestore.collection('aiCommandLogs').add({
    commandName: 'blog_post_generate',
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
    metadata: {
      brief: {
        audience: context.audience ?? null,
        tone: context.tone ?? null,
        keywords: context.keywords,
        categories: context.categories,
        tags: context.tags,
        products: context.relatedProducts.map((product) => product.name ?? product.id).filter(Boolean),
        prohibitedTopics: context.prohibitedTopics,
      },
      warnings: warnings.length ? warnings : null,
    },
  });

  const timestamp = new Date().toISOString();

  return NextResponse.json(
    {
      title: draft.title,
      summary: draft.summary,
      contentHtml: draft.contentHtml,
      seoTitle: draft.seoTitle,
      seoDescription: draft.seoDescription,
      seoKeywords: draft.seoKeywords,
      outline: draft.outline,
      warnings,
      requestId,
      promptId: promptRecord.id,
      promptName: promptRecord.name,
      modelName: resolvedModel?.name ?? modelRecord?.name ?? null,
      createdAt: timestamp,
    },
    { status: 200 }
  );
}
