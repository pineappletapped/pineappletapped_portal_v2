import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";
import { ensurePromptRecord } from "@/lib/ai/prompt-registry.server";
import { getAiModelRecordById } from "@/lib/ai/models.server";
import { PROPOSAL_STORYBOARD_PROMPT_TEMPLATE } from "@/lib/ai/templates";

type InputItem = {
  name: string;
  category: string | null;
  price: number | null;
  deliverables?: string[];
};

type ParsedPayload = {
  projectName: string | null;
  audience: string | null;
  tone: string | null;
  goals: string[];
  deliverables: string[];
  items: InputItem[];
  notes: string | null;
  orgId: string | null;
  projectId: string | null;
};

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function parseDeliverables(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => {
        if (typeof entry === "string") return entry.split(/[\n,]+/);
        if (!entry || typeof entry !== "object") return [];
        const data = entry as Record<string, unknown>;
        if (typeof data.label === "string") return data.label.split(/[\n,]+/);
        if (typeof data.name === "string") return data.name.split(/[\n,]+/);
        return [];
      })
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function parseItems(value: unknown): InputItem[] {
  if (!Array.isArray(value)) return [];
  const items: InputItem[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const data = entry as Record<string, unknown>;
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name) return;
    const category = typeof data.category === "string" ? data.category.trim() : null;
    const priceValue = data.price;
    const price =
      typeof priceValue === "number" && Number.isFinite(priceValue)
        ? priceValue
        : typeof priceValue === "string" && priceValue.trim()
          ? Number.parseFloat(priceValue)
          : null;
    const parsedPrice = Number.isFinite(price || NaN) ? Number(price) : null;
    const itemDeliverables = parseDeliverables(data.deliverables);
    items.push({ name, category, price: parsedPrice, deliverables: itemDeliverables });
  });
  return items;
}

function parsePayload(body: any): ParsedPayload {
  const projectName = typeof body?.projectName === "string" ? body.projectName.trim() : null;
  const audience = typeof body?.audience === "string" ? body.audience.trim() : null;
  const tone = typeof body?.tone === "string" ? body.tone.trim() : null;
  const goals = parseArray(body?.goals);
  const deliverables = parseDeliverables(body?.deliverables);
  const items = parseItems(body?.items);
  const notes = typeof body?.notes === "string" ? body.notes.trim() : null;
  const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : null;
  return { projectName, audience, tone, goals, deliverables, items, notes, orgId, projectId };
}

function formatCurrency(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

function deriveThemes(payload: ParsedPayload) {
  const { items, goals, deliverables } = payload;
  const inferredGoals = goals.length > 0 ? goals : ["Increase engagement", "Drive conversions", "Build credibility"];
  const deliverableLabels = deliverables.length > 0 ? deliverables : [];
  const categories = Array.from(new Set(items.map((item) => item.category).filter((category): category is string => Boolean(category))));

  const sceneThemes: string[] = [];

  if (deliverableLabels.length > 0) {
    deliverableLabels.slice(0, 4).forEach((deliverable) => {
      sceneThemes.push(deliverable);
    });
  }

  if (sceneThemes.length < 3 && categories.length > 0) {
    categories.slice(0, 3 - sceneThemes.length).forEach((category) => {
      sceneThemes.push(`${category} focus`);
    });
  }

  if (sceneThemes.length === 0) {
    sceneThemes.push("Hero narrative", "Customer proof point", "Closing CTA");
  }

  const headlineGoal = inferredGoals[0];

  return { sceneThemes, headlineGoal, categories };
}

function buildNarrative(payload: ParsedPayload) {
  const { projectName, audience, tone, goals, notes } = payload;
  const { headlineGoal, categories } = deriveThemes(payload);
  const readableGoals = goals.length > 0 ? goals.join(", ") : headlineGoal;
  const audienceLine = audience ? ` for ${audience}` : "";
  const toneLine = tone ? ` in a ${tone.toLowerCase()} tone` : "";
  const categoriesLine = categories.length > 0 ? ` leaning on ${categories.join(", ")}` : " a multi-format mix";
  const noteLine = notes ? ` Key context: ${notes}.` : "";

  return `Storyboard for ${projectName || "campaign"}${audienceLine}: deliver ${readableGoals}${toneLine},${categoriesLine}.${noteLine}`.trim();
}

function buildSections(payload: ParsedPayload) {
  const { sceneThemes, headlineGoal } = deriveThemes(payload);
  const deliverables = payload.deliverables.length > 0 ? payload.deliverables : payload.items.flatMap((item) => item.deliverables || []);
  return sceneThemes.map((theme, index) => {
    const talkingPoints: string[] = [];
    const deliverable = deliverables[index];
    if (deliverable) {
      talkingPoints.push(`Deliverable: ${deliverable}`);
    }
    if (payload.audience) {
      talkingPoints.push(`Audience hook: tailor messaging to ${payload.audience}.`);
    }
    if (payload.tone) {
      talkingPoints.push(`Tone: keep language ${payload.tone.toLowerCase()}.`);
    }
    talkingPoints.push(`Goal alignment: ${headlineGoal}.`);

    const recommendedItem = payload.items[index] || payload.items[0];
    if (recommendedItem) {
      const priceHint = formatCurrency(recommendedItem.price);
      talkingPoints.push(`Production backbone: ${recommendedItem.name}${priceHint ? ` (${priceHint})` : ""}.`);
    }

    return {
      id: randomUUID(),
      title: theme,
      summary: `Scene ${index + 1}: ${theme}.`,
      talkingPoints,
    };
  });
}

function buildTimeline(payload: ParsedPayload) {
  const hasVideo = payload.deliverables.some((entry) => /video|film|shoot/i.test(entry));
  const hasDesign = payload.deliverables.some((entry) => /design|print|social|graphic/i.test(entry));
  const hasEvent = payload.deliverables.some((entry) => /event|live|conference|stage/i.test(entry));
  const timeline = [
    {
      phase: "Pre-production",
      duration: hasVideo || hasEvent ? "1-2 weeks" : "1 week",
      tasks: [
        "Strategy workshop to align messaging and call-to-action.",
        hasVideo ? "Script and shot list drafting with location recce." : "Channel plan refinement and asset list.",
        hasEvent ? "Technical planning for staging, lighting, and crew." : "Resource booking and approvals.",
      ],
    },
    {
      phase: hasEvent ? "Production" : "Creation",
      duration: hasEvent ? "Event week" : hasVideo ? "2-3 days" : "3-5 days",
      tasks: [
        hasEvent
          ? "Stage build, rehearsals, and live capture across headline segments."
          : hasVideo
            ? "On-site filming across hero, proof, and CTA beats."
            : "Design and copy production for key deliverables.",
        hasDesign ? "Design iterations and campaign asset proofs." : "Midpoint review with client stakeholders.",
        "Daily check-ins to keep approvals under 24 hours.",
      ],
    },
    {
      phase: "Post-production",
      duration: hasVideo ? "1-2 weeks" : "3-5 days",
      tasks: [
        hasVideo
          ? "Editing, grading, and sound mix with two feedback rounds."
          : "Final copy polish and asset export across channels.",
        "QA across brand, accessibility, and platform specs.",
        "Delivery packaging and rollout playbook handover.",
      ],
    },
  ];

  if (hasDesign) {
    timeline.push({
      phase: "Amplification",
      duration: "Ongoing",
      tasks: [
        "Paid and organic channel sequencing to maximise reach.",
        "Performance tracking dashboard with weekly insights.",
        "Repurposing plan for evergreen assets and localisation.",
      ],
    });
  }

  return timeline;
}

function buildRecommendedItems(payload: ParsedPayload) {
  const items = payload.items.length > 0 ? payload.items : [{ name: "Creative services", category: null, price: null }];
  return items.slice(0, 5).map((item) => {
    const priceHint = formatCurrency(item.price);
    const descriptionParts: string[] = [];
    if (item.category) {
      descriptionParts.push(`Category: ${item.category}`);
    }
    const deliverables = (item.deliverables || []).slice(0, 3);
    if (deliverables.length > 0) {
      descriptionParts.push(`Supports ${deliverables.join(", ")}`);
    }
    if (payload.goals.length > 0) {
      descriptionParts.push(`Aligns with ${payload.goals[0]}`);
    }
    return {
      id: randomUUID(),
      name: item.name,
      priceHint,
      description: descriptionParts.join(" · ") || null,
    };
  });
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const uid = cookieStore.get("uid")?.value;

  if (!uid) {
    return unauthorizedResponse();
  }

  let payload: ParsedPayload;
  try {
    const body = await req.json();
    payload = parsePayload(body);
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const allDeliverables = [...payload.deliverables];
  payload.items.forEach((item) => {
    if (item.deliverables) {
      item.deliverables.forEach((deliverable) => allDeliverables.push(deliverable));
    }
  });

  if (payload.items.length === 0 && allDeliverables.length === 0 && !payload.notes) {
    return NextResponse.json(
      { error: "Provide at least one product, deliverable, or context note to generate a storyboard." },
      { status: 400 }
    );
  }

  const requestId = randomUUID();

  const promptRecord = await ensurePromptRecord(
    PROPOSAL_STORYBOARD_PROMPT_TEMPLATE.name,
    PROPOSAL_STORYBOARD_PROMPT_TEMPLATE
  );

  const modelRecord = promptRecord.defaultModelId
    ? await getAiModelRecordById(promptRecord.defaultModelId)
    : null;

  const narrative = buildNarrative(payload);
  const sections = buildSections({ ...payload, deliverables: allDeliverables });
  const timeline = buildTimeline({ ...payload, deliverables: allDeliverables });
  const recommendedItems = buildRecommendedItems({ ...payload, deliverables: allDeliverables });

  const firestore = getFirebaseAdminFirestore();
  const now = FieldValue.serverTimestamp();
  const generationMeta = {
    requestId,
    mode: "rules-draft",
    prompt: {
      id: promptRecord.id,
      name: promptRecord.name,
      status: promptRecord.status,
      defaultModelId: promptRecord.defaultModelId,
      updatedAt: promptRecord.updatedAt ?? null,
      estimatedTokens: promptRecord.estimatedTokens ?? null,
    },
    model: modelRecord
      ? {
          docId: modelRecord.id,
          modelId: modelRecord.modelId,
          name: modelRecord.name,
          provider: modelRecord.provider,
          currency: modelRecord.currency ?? null,
        }
      : null,
  } as const;
  const docRef = await firestore.collection("proposalStoryboards").add({
    userId: uid,
    orgId: payload.orgId || null,
    projectId: payload.projectId || null,
    projectName: payload.projectName || null,
    audience: payload.audience || null,
    tone: payload.tone || null,
    goals: payload.goals,
    deliverables: allDeliverables,
    items: payload.items,
    narrative,
    sections,
    timeline,
    recommendedItems,
    requestId,
    promptId: promptRecord.id,
    promptName: promptRecord.name,
    promptStatus: promptRecord.status,
    promptDefaultModelId: promptRecord.defaultModelId,
    promptEstimatedTokens: promptRecord.estimatedTokens ?? null,
    generationMode: "rules-draft",
    generation: generationMeta,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  });

  const currency = modelRecord?.currency ? modelRecord.currency.toUpperCase() : null;
  await firestore.collection("aiCommandLogs").add({
    commandName: "proposal_storyboard_generate",
    promptId: promptRecord.id,
    promptName: promptRecord.name,
    modelId: modelRecord?.modelId ?? promptRecord.defaultModelId ?? null,
    modelName: modelRecord?.name ?? null,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    currency,
    createdAt: FieldValue.serverTimestamp(),
    requestId,
    storyboardId: docRef.id,
    clientId: payload.orgId || null,
    clientName: null,
    projectId: payload.projectId || null,
    metadata: {
      mode: "rules-draft",
    },
  });

  const timestamp = new Date().toISOString();

  return NextResponse.json(
    {
      id: docRef.id,
      status: "ready",
      narrative,
      sections,
      timeline,
      recommendedItems,
      requestId,
      promptId: promptRecord.id,
      promptName: promptRecord.name,
      modelName: modelRecord?.name ?? null,
      generationMode: "rules-draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { status: 201 }
  );
}
