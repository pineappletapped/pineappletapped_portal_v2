import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin';
import { ensurePromptRecord } from '@/lib/ai/prompt-registry.server';
import { getAiModelRecordById } from '@/lib/ai/models.server';
import { CONTENT_REPURPOSING_PROMPT_TEMPLATE } from '@/lib/ai/templates';
import {
  estimateUsageCost,
  generateStructuredContent,
  sanitiseModelRecord,
  type SanitisedAiModel,
  type StructuredGenerationUsage,
} from '@/lib/ai/structured-generation.server';

interface TranscriptSource {
  type: 'drive' | 'upload' | 'manual';
  driveFileId?: string | null;
  driveFileUrl?: string | null;
  fileName?: string | null;
}

interface GenerationPayload {
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  deliverableLabel: string | null;
  deliverableProductId: string | null;
  deliverableProductName: string | null;
  transcript: string | null;
  transcriptSource: TranscriptSource | null;
  tone: string | null;
  callToAction: string | null;
  notes: string | null;
  platforms: string[];
}

interface GenerationResult {
  id: string;
  status: 'draft' | 'published';
  summary: string;
  keywords: string[];
  youtubeTitles: string[];
  youtubeDescription: string;
  youtubeTags: string[];
  socialPosts: Array<{
    id: string;
    platform: string;
    headline: string;
    body: string;
    hashtags: string[];
  }>;
  warnings?: string[];
  transcriptPreview: string;
  projectName: string | null;
  deliverableLabel: string | null;
  deliverableProductId: string | null;
  deliverableProductName: string | null;
  createdAt: string;
  updatedAt: string;
  requestId?: string | null;
  promptId?: string | null;
  promptName?: string | null;
  modelName?: string | null;
  generationMode?: string | null;
}

const CONTENT_ASSISTANT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    youtube: {
      type: 'object',
      properties: {
        titles: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['titles', 'description', 'tags'],
    },
    socialPosts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          platform: { type: 'string' },
          headline: { type: 'string' },
          body: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
        },
        required: ['platform', 'body'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'keywords', 'youtube', 'socialPosts'],
} as const;

const CONTENT_ASSISTANT_RESPONSE_SCHEMA = z.object({
  summary: z.string(),
  keywords: z.array(z.string()),
  youtube: z.object({
    titles: z.array(z.string()).min(1),
    description: z.string(),
    tags: z.array(z.string()),
  }),
  socialPosts: z
    .array(
      z.object({
        id: z.string().optional(),
        platform: z.string(),
        headline: z.string().optional(),
        body: z.string(),
        hashtags: z.array(z.string()).optional(),
      })
    )
    .min(1),
  warnings: z.array(z.string()).optional(),
});

type ContentAssistantAiPayload = z.infer<typeof CONTENT_ASSISTANT_RESPONSE_SCHEMA>;

const STOP_WORDS = new Set(
  [
    'the',
    'and',
    'for',
    'with',
    'that',
    'from',
    'this',
    'have',
    'your',
    'about',
    'into',
    'their',
    'will',
    'there',
    'been',
    'were',
    'they',
    'them',
    'when',
    'what',
    'where',
    'like',
    'through',
    'over',
    'also',
    'because',
    'than',
    'make',
    'made',
    'just',
    'more',
    'some',
    'then',
    'well',
    'very',
    'here',
    'ours',
    'ourselves',
    'hers',
    'herself',
    'himself',
    'yours',
    'yourself',
    'myself',
  ]
);

const DEFAULT_PLATFORMS: Array<{ value: string; label: string; tone: string }> = [
  { value: 'linkedin', label: 'LinkedIn', tone: 'professional' },
  { value: 'instagram', label: 'Instagram', tone: 'energetic' },
  { value: 'facebook', label: 'Facebook', tone: 'approachable' },
  { value: 'twitter', label: 'X', tone: 'punchy' },
];

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function parseString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parsePlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: string[] = [];
  value.forEach((item) => {
    if (typeof item === 'string') {
      const trimmed = item.trim().toLowerCase();
      if (trimmed) entries.push(trimmed);
    }
  });
  return Array.from(new Set(entries));
}

function parseTranscriptSource(value: unknown): TranscriptSource | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const typeRaw = parseString(data.type);
  const type = typeRaw === 'drive' || typeRaw === 'upload' || typeRaw === 'manual' ? typeRaw : 'manual';
  const driveFileId = parseString(data.driveFileId);
  const driveFileUrl = parseString(data.driveFileUrl);
  const fileName = parseString(data.fileName);
  return { type, driveFileId: driveFileId ?? null, driveFileUrl: driveFileUrl ?? null, fileName: fileName ?? null };
}

function parsePayload(body: any): GenerationPayload {
  const clientId = parseString(body?.clientId);
  const clientName = parseString(body?.clientName);
  const projectId = parseString(body?.projectId);
  const projectName = parseString(body?.projectName);
  const deliverableLabel = parseString(body?.deliverableLabel);
  const deliverableProductId = parseString(body?.deliverableProductId);
  const deliverableProductName = parseString(body?.deliverableProductName);
  const transcript = parseString(body?.transcript);
  const tone = parseString(body?.tone);
  const callToAction = parseString(body?.callToAction);
  const notes = parseString(body?.notes);
  const transcriptSource = parseTranscriptSource(body?.transcriptSource);
  const platforms = parsePlatforms(body?.platforms);
  return {
    clientId,
    clientName,
    projectId,
    projectName,
    deliverableLabel,
    deliverableProductId,
    deliverableProductName,
    transcript,
    transcriptSource,
    tone,
    callToAction,
    notes,
    platforms,
  };
}

function stripSrtCues(input: string): string {
  return input
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+$/.test(trimmed)) return false;
      if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}$/.test(trimmed)) return false;
      return true;
    })
    .join(' ');
}

function normaliseWhitespace(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s([?.!])/g, '$1')
    .trim();
}

function capitalise(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function summariseTranscript(transcript: string) {
  const clean = normaliseWhitespace(transcript);
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const summary = sentences.slice(0, 3).join(' ');
  return summary || clean.slice(0, 280);
}

function extractKeywords(transcript: string): string[] {
  const sanitized = transcript.replace(/[^a-zA-Z0-9\s]/g, ' ').toLowerCase();
  const words = sanitized.split(/\s+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  const counts = new Map<string, number>();
  words.forEach((word) => {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  });
  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);
  return ranked.slice(0, 12);
}

function buildTitleSuggestions(payload: GenerationPayload, keywords: string[]): string[] {
  const base = payload.projectName || payload.deliverableLabel || payload.clientName || 'Video Story';
  const primary = keywords[0] ? capitalise(keywords[0]) : 'Behind the Scenes';
  const secondary = keywords[1] ? capitalise(keywords[1]) : payload.callToAction ? capitalise(payload.callToAction) : 'Highlights';
  const actionSubject = payload.clientName ? `${payload.clientName} team` : 'Our team';
  const tone = payload.tone ? payload.tone.toLowerCase() : 'insightful';
  return [
    `${base}: ${primary} & ${secondary}`,
    `${primary} in Action | ${base}`,
    `How the ${actionSubject} delivers ${secondary.toLowerCase()} (${tone} breakdown)`,
  ];
}

function buildDescription(payload: GenerationPayload, summary: string, keywords: string[]): string {
  const intro = payload.callToAction
    ? `${payload.callToAction}${summary ? ' — ' : ''}${summary}`
    : summary || 'Explore the highlights from our latest production.';
  const deliverableLine = payload.deliverableLabel
    ? `Included deliverable: ${payload.deliverableLabel}.`
    : 'Captured with Pineapple Tapped.';
  const toneLine = payload.tone ? `Tone: ${payload.tone}.` : '';
  const keywordsLine = keywords.length ? `Keywords: ${keywords.slice(0, 8).map((word) => `#${word.replace(/\s+/g, '')}`).join(' ')}` : '';
  const notesLine = payload.notes ? `Notes: ${payload.notes}.` : '';
  return [intro, deliverableLine, toneLine, notesLine, keywordsLine].filter(Boolean).join('\n\n');
}

function buildTags(payload: GenerationPayload, keywords: string[]): string[] {
  const unique = new Set<string>();
  keywords.slice(0, 12).forEach((keyword) => unique.add(keyword.replace(/\s+/g, '')));
  [payload.clientName, payload.projectName, payload.deliverableLabel, payload.deliverableProductName].forEach((value) => {
    if (value) {
      const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (cleaned) unique.add(cleaned);
    }
  });
  return Array.from(unique).slice(0, 15);
}

function choosePlatforms(payload: GenerationPayload) {
  const platforms = payload.platforms.length ? payload.platforms : DEFAULT_PLATFORMS.map((entry) => entry.value);
  const map = new Map<string, { label: string; tone: string }>();
  DEFAULT_PLATFORMS.forEach((entry) => map.set(entry.value, { label: entry.label, tone: entry.tone }));
  return platforms
    .filter((platform) => platform !== 'youtube')
    .map((platform) => {
      const metadata = map.get(platform) ?? { label: capitalise(platform), tone: 'balanced' };
      return { platform, ...metadata };
    });
}

function buildSocialPosts(payload: GenerationPayload, summary: string, keywords: string[]): GenerationResult['socialPosts'] {
  const baseHashtags = keywords.slice(0, 6).map((word) => `#${capitalise(word).replace(/\s+/g, '')}`);
  const deliverableHash = payload.deliverableLabel ? `#${payload.deliverableLabel.replace(/[^a-z0-9]+/gi, '')}` : null;
  const clientHash = payload.clientName ? `#${payload.clientName.replace(/[^a-z0-9]+/gi, '')}` : null;
  if (deliverableHash) baseHashtags.push(deliverableHash);
  if (clientHash) baseHashtags.push(clientHash);
  const uniqueHashtags = Array.from(new Set(baseHashtags.filter(Boolean))).slice(0, 6);

  const actionLine = payload.callToAction ? `${payload.callToAction}. ` : '';
  const deliverableLine = payload.deliverableLabel ? `Deliverable: ${payload.deliverableLabel}. ` : '';

  return choosePlatforms(payload).map((platform) => {
    const platformSummary = `${summary}${summary && !summary.endsWith('.') ? '.' : ''}`;
    const toneLine = `Tone: ${platform.tone}.`;
    const body = [actionLine, platformSummary, deliverableLine, toneLine].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const headline = `${capitalise(platform.platform)} drop`;
    return {
      id: randomUUID(),
      platform: platform.label,
      headline,
      body,
      hashtags: uniqueHashtags,
    };
  });
}

function createTranscriptPreview(transcript: string) {
  const preview = transcript.slice(0, 1000);
  return preview.length < transcript.length ? `${preview}…` : preview;
}

async function assertUserRole(uid: string) {
  const firestore = getFirebaseAdminFirestore();
  const userSnap = await firestore.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    return null;
  }
  const data = userSnap.data() ?? {};
  const roles = Array.isArray(data.roles)
    ? data.roles.map((role: unknown) => (typeof role === 'string' ? role.toLowerCase() : null)).filter(Boolean)
    : [];
  if (roles.includes('admin') || roles.includes('franchise') || roles.includes('projects') || roles.includes('marketing')) {
    return { email: typeof data.email === 'string' ? data.email : null, name: typeof data.fullName === 'string' ? data.fullName : null };
  }
  const roleMap = data?.roleMap;
  if (roleMap && typeof roleMap === 'object') {
    const values = Object.values(roleMap).map((value) => (typeof value === 'string' ? value.toLowerCase() : null));
    if (values.includes('admin') || values.includes('franchise') || values.includes('projects') || values.includes('marketing')) {
      return { email: typeof data.email === 'string' ? data.email : null, name: typeof data.fullName === 'string' ? data.fullName : null };
    }
  }
  return null;
}

function mapToResult(id: string, _payload: GenerationPayload | {}, data: any): GenerationResult {
  return {
    id,
    status: data.status === 'published' ? 'published' : 'draft',
    summary: data.summary || '',
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    youtubeTitles: Array.isArray(data.youtubeTitles) ? data.youtubeTitles : [],
    youtubeDescription: typeof data.youtubeDescription === 'string' ? data.youtubeDescription : '',
    youtubeTags: Array.isArray(data.youtubeTags) ? data.youtubeTags : [],
    socialPosts: Array.isArray(data.socialPosts)
      ? data.socialPosts.map((item: any) => ({
          id: item?.id || randomUUID(),
          platform: item?.platform || 'Social',
          headline: item?.headline || '',
          body: item?.body || '',
          hashtags: Array.isArray(item?.hashtags) ? item.hashtags : [],
        }))
      : [],
    warnings: Array.isArray(data.warnings)
      ? data.warnings
          .map((warning: unknown) => (typeof warning === 'string' ? warning.trim() : ''))
          .filter((warning: string) => Boolean(warning))
      : [],
    transcriptPreview: typeof data.transcriptPreview === 'string' ? data.transcriptPreview : '',
    projectName: typeof data.projectName === 'string' ? data.projectName : null,
    deliverableLabel: typeof data.deliverableLabel === 'string' ? data.deliverableLabel : null,
    deliverableProductId: typeof data.deliverableProductId === 'string' ? data.deliverableProductId : null,
    deliverableProductName: typeof data.deliverableProductName === 'string' ? data.deliverableProductName : null,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
    requestId: typeof data.requestId === 'string' ? data.requestId : null,
    promptId: typeof data.promptId === 'string' ? data.promptId : null,
    promptName: typeof data.promptName === 'string' ? data.promptName : null,
    modelName: typeof data.modelName === 'string' ? data.modelName : null,
    generationMode: typeof data.generationMode === 'string' ? data.generationMode : null,
  };
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const uid = cookieStore.get('uid')?.value;
  if (!uid) {
    return unauthorizedResponse();
  }

  const identity = await assertUserRole(uid);
  if (!identity) {
    return unauthorizedResponse();
  }

  let payload: GenerationPayload;
  try {
    const body = await req.json();
    payload = parsePayload(body);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (!payload.transcript) {
    return NextResponse.json({ error: 'Provide an SRT transcript or paste key talking points.' }, { status: 400 });
  }

  const requestId = randomUUID();

  const promptRecord = await ensurePromptRecord(
    CONTENT_REPURPOSING_PROMPT_TEMPLATE.name,
    CONTENT_REPURPOSING_PROMPT_TEMPLATE
  );

  const modelRecord = promptRecord.defaultModelId
    ? await getAiModelRecordById(promptRecord.defaultModelId)
    : null;

  const firestore = getFirebaseAdminFirestore();
  const now = FieldValue.serverTimestamp();

  const strippedTranscript = stripSrtCues(payload.transcript);
  const trimmedTranscript = strippedTranscript.length > 15000 ? strippedTranscript.slice(0, 15000) : strippedTranscript;
  const transcriptPreview = createTranscriptPreview(strippedTranscript);

  let generationMode: 'ai' | 'rules-draft' = 'ai';
  let generationError: Error | null = null;
  let aiUsage: StructuredGenerationUsage | null = null;
  let resolvedModel: SanitisedAiModel | null = sanitiseModelRecord(modelRecord);
  let warnings: string[] = [];

  let summary = '';
  let keywords: string[] = [];
  let youtubeTitles: string[] = [];
  let youtubeDescription = '';
  let youtubeTags: string[] = [];
  let socialPosts: GenerationResult['socialPosts'] = [];

  try {
    const aiResult = await generateStructuredContent({
      prompt: promptRecord,
      model: modelRecord,
      context: {
        transcript: trimmedTranscript,
        metadata: {
          projectName: payload.projectName,
          deliverableLabel: payload.deliverableLabel,
          deliverableProductName: payload.deliverableProductName,
          tone: payload.tone,
          callToAction: payload.callToAction,
          notes: payload.notes,
          platforms: payload.platforms,
        },
      },
      responseSchema: CONTENT_ASSISTANT_RESPONSE_JSON_SCHEMA,
      maxOutputTokens: 1200,
    });

    if (aiResult.model) {
      resolvedModel = aiResult.model;
    }
    aiUsage = aiResult.usage;

    const parsed = CONTENT_ASSISTANT_RESPONSE_SCHEMA.parse(aiResult.json) as ContentAssistantAiPayload;

    summary = parsed.summary.trim();
    keywords = parsed.keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 12);
    youtubeTitles = parsed.youtube.titles.map((title) => title.trim()).filter(Boolean).slice(0, 5);
    youtubeDescription = parsed.youtube.description.trim();
    youtubeTags = parsed.youtube.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 15);
    socialPosts = parsed.socialPosts.map((post) => ({
      id: post.id && post.id.trim() ? post.id.trim() : randomUUID(),
      platform: post.platform.trim(),
      headline: post.headline ? post.headline.trim() : '',
      body: post.body.trim(),
      hashtags: (post.hashtags ?? [])
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8),
    }));
    warnings = (parsed.warnings ?? []).map((warning) => warning.trim()).filter(Boolean);

    if (!summary || socialPosts.length === 0) {
      throw new Error('AI response missing required content.');
    }
  } catch (error) {
    generationMode = 'rules-draft';
    generationError = error instanceof Error ? error : new Error('Content assistant generation failed');
    console.error('AI content assistant generation failed', { requestId, error: generationError.message });
    const fallbackTranscript = trimmedTranscript || strippedTranscript;
    summary = summariseTranscript(fallbackTranscript);
    keywords = extractKeywords(fallbackTranscript);
    youtubeTitles = buildTitleSuggestions(payload, keywords);
    youtubeDescription = buildDescription(payload, summary, keywords);
    youtubeTags = buildTags(payload, keywords);
    socialPosts = buildSocialPosts(payload, summary, keywords);
    warnings = [];
    aiUsage = null;
  }

  const usageCost = generationMode === 'ai' ? estimateUsageCost(aiUsage, resolvedModel) : null;

  const generationMeta = {
    requestId,
    mode: generationMode,
    prompt: {
      id: promptRecord.id,
      name: promptRecord.name,
      status: promptRecord.status,
      defaultModelId: promptRecord.defaultModelId,
      updatedAt: promptRecord.updatedAt ?? null,
      estimatedTokens: promptRecord.estimatedTokens ?? null,
    },
    model: resolvedModel
      ? {
          docId: resolvedModel.id,
          modelId: resolvedModel.modelId ?? null,
          name: resolvedModel.name,
          provider: resolvedModel.provider ?? null,
          currency: resolvedModel.currency ?? null,
          isFallback: resolvedModel.isFallback ?? false,
        }
      : null,
    usage:
      generationMode === 'ai' && aiUsage
        ? {
            promptTokens: aiUsage.promptTokens ?? null,
            completionTokens: aiUsage.completionTokens ?? null,
            totalTokens: aiUsage.totalTokens ?? null,
          }
        : null,
    warnings: warnings.length ? warnings : null,
    error: generationError ? generationError.message : null,
  } as const;

  const docRef = await firestore.collection('contentAssistantDrafts').add({
    userId: uid,
    creatorEmail: identity.email || null,
    creatorName: identity.name || null,
    clientId: payload.clientId || null,
    clientName: payload.clientName || null,
    projectId: payload.projectId || null,
    projectName: payload.projectName || null,
    deliverableLabel: payload.deliverableLabel || null,
    deliverableProductId: payload.deliverableProductId || null,
    deliverableProductName: payload.deliverableProductName || null,
    transcriptPreview,
    transcriptSource: payload.transcriptSource || null,
    tone: payload.tone || null,
    callToAction: payload.callToAction || null,
    notes: payload.notes || null,
    platforms: payload.platforms,
    summary,
    keywords,
    youtubeTitles,
    youtubeDescription,
    youtubeTags,
    socialPosts,
    warnings,
    status: 'draft',
    requestId,
    promptId: promptRecord.id,
    promptName: promptRecord.name,
    promptStatus: promptRecord.status,
    promptDefaultModelId: promptRecord.defaultModelId,
    promptEstimatedTokens: promptRecord.estimatedTokens ?? null,
    modelName: resolvedModel?.name ?? modelRecord?.name ?? null,
    modelIdentifier: resolvedModel?.modelId ?? promptRecord.defaultModelId ?? null,
    generationMode,
    generation: generationMeta,
    createdAt: now,
    updatedAt: now,
  });

  const currencyRaw = resolvedModel?.currency ?? modelRecord?.currency ?? null;
  const currency = currencyRaw ? currencyRaw.toUpperCase() : null;
  const promptTokens = generationMode === 'ai' ? aiUsage?.promptTokens ?? 0 : 0;
  const completionTokens = generationMode === 'ai' ? aiUsage?.completionTokens ?? 0 : 0;
  const totalTokens = generationMode === 'ai' ? aiUsage?.totalTokens ?? 0 : 0;
  const cost = generationMode === 'ai' ? usageCost ?? 0 : 0;

  await firestore.collection('aiCommandLogs').add({
    commandName: 'content_repurpose_generate',
    promptId: promptRecord.id,
    promptName: promptRecord.name,
    modelId: resolvedModel?.modelId ?? promptRecord.defaultModelId ?? null,
    modelName: resolvedModel?.name ?? modelRecord?.name ?? null,
    totalTokens,
    promptTokens,
    completionTokens,
    cost,
    currency,
    createdAt: FieldValue.serverTimestamp(),
    requestId,
    draftId: docRef.id,
    clientId: payload.clientId || null,
    clientName: payload.clientName || null,
    projectId: payload.projectId || null,
    metadata: {
      mode: generationMode,
      provider: resolvedModel?.provider ?? modelRecord?.provider ?? null,
      fallback: generationMode !== 'ai',
      transcriptSource: payload.transcriptSource?.type ?? null,
      ...(warnings.length ? { warnings } : {}),
      ...(generationError ? { error: generationError.message } : {}),
    },
  });

  const timestamp = new Date().toISOString();

  return NextResponse.json(
    {
      id: docRef.id,
      status: 'draft',
      summary,
      keywords,
      youtubeTitles,
      youtubeDescription,
      youtubeTags,
      socialPosts,
      warnings,
      transcriptPreview,
      projectName: payload.projectName || null,
      deliverableLabel: payload.deliverableLabel || null,
      deliverableProductId: payload.deliverableProductId || null,
      deliverableProductName: payload.deliverableProductName || null,
      requestId,
      promptId: promptRecord.id,
      promptName: promptRecord.name,
      modelName: resolvedModel?.name ?? modelRecord?.name ?? null,
      generationMode,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const cookieStore = cookies();
  const uid = cookieStore.get('uid')?.value;
  if (!uid) {
    return unauthorizedResponse();
  }

  const identity = await assertUserRole(uid);
  if (!identity) {
    return unauthorizedResponse();
  }

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const id = parseString(body?.id);
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const status = parseString(body?.status);
  const projectId = parseString(body?.projectId);
  const publishNote = parseString(body?.publishNote);

  const firestore = getFirebaseAdminFirestore();
  const docRef = firestore.collection('contentAssistantDrafts').doc(id);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }
  const data = snapshot.data() ?? {};
  if (data.userId && data.userId !== uid) {
    const roles = await assertUserRole(uid);
    if (!roles) {
      return unauthorizedResponse();
    }
  }

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (status === 'published') {
    updates.status = 'published';
    updates.publishedBy = { uid, email: identity.email || null };
    updates.publishedAt = FieldValue.serverTimestamp();
  } else if (status === 'draft') {
    updates.status = 'draft';
  }
  if (publishNote) {
    updates.publishNote = publishNote;
  }

  await docRef.set(updates, { merge: true });

  if (status === 'published' && projectId) {
    const projectRef = firestore.collection('projects').doc(projectId);
    const projectSnap = await projectRef.get();
    if (projectSnap.exists) {
      const payload = snapshot.data() ?? {};
      const subcollectionRef = projectRef.collection('contentDrafts').doc(id);
      await subcollectionRef.set(
        {
          assistantId: id,
          status: 'published',
          summary: payload.summary || '',
          keywords: payload.keywords || [],
          youtubeTitles: payload.youtubeTitles || [],
          youtubeDescription: payload.youtubeDescription || '',
          youtubeTags: payload.youtubeTags || [],
          socialPosts: payload.socialPosts || [],
          deliverableLabel: payload.deliverableLabel || null,
          deliverableProductId: payload.deliverableProductId || null,
          deliverableProductName: payload.deliverableProductName || null,
          transcriptPreview: payload.transcriptPreview || '',
          callToAction: payload.callToAction || null,
          tone: payload.tone || null,
          platforms: payload.platforms || [],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          publishedBy: { uid, email: identity.email || null },
          publishNote: publishNote || null,
        },
        { merge: true }
      );
    }
  }

  const refreshed = await docRef.get();
  return NextResponse.json(mapToResult(refreshed.id, {}, refreshed.data()), { status: 200 });
}
