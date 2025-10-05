import "server-only";

import type { AiModelRecord, AiModelStatus } from "./models.server";
import type { AiPromptRecord } from "./prompt-registry.server";

export interface StructuredGenerationUsage {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export type SanitisedAiModel = Omit<AiModelRecord, "apiKey"> & { isFallback?: boolean };

type ResolvedAiModel = AiModelRecord & { apiKey: string | null; isFallback?: boolean };

type StructuredGenerationOptions = {
  prompt: AiPromptRecord;
  model: AiModelRecord | null;
  context: unknown;
  responseSchema?: unknown;
  temperature?: number;
  topK?: number;
  maxOutputTokens?: number;
};

export interface StructuredGenerationResult {
  text: string;
  json: unknown;
  usage: StructuredGenerationUsage | null;
  model: SanitisedAiModel | null;
}

export async function generateStructuredContent(
  options: StructuredGenerationOptions
): Promise<StructuredGenerationResult> {
  const resolvedModel = resolveModel(options.model);
  if (!resolvedModel) {
    throw new Error("AI model is not configured for this prompt.");
  }

  const provider = (resolvedModel.provider ?? "google-gemini").toLowerCase();
  if (provider.includes("gemini") || provider.includes("google")) {
    return callGemini({ ...options, model: resolvedModel });
  }

  throw new Error(`Unsupported AI provider: ${resolvedModel.provider ?? "unknown"}`);
}

export function sanitiseModelRecord(model: AiModelRecord | null): SanitisedAiModel | null {
  if (!model) return null;
  const { apiKey: _apiKey, ...rest } = model;
  void _apiKey;
  return rest;
}

export function estimateUsageCost(
  usage: StructuredGenerationUsage | null | undefined,
  model: SanitisedAiModel | null | undefined
): number | null {
  if (!usage || !model) {
    return null;
  }

  const promptTokens = usage.promptTokens ?? null;
  const completionTokens = usage.completionTokens ?? null;
  let total = 0;
  let hasValue = false;

  if (model.inputCostPer1k != null && promptTokens != null) {
    total += (model.inputCostPer1k / 1000) * promptTokens;
    hasValue = true;
  }

  if (model.outputCostPer1k != null && completionTokens != null) {
    total += (model.outputCostPer1k / 1000) * completionTokens;
    hasValue = true;
  }

  return hasValue && Number.isFinite(total) ? total : null;
}

type GeminiCallOptions = StructuredGenerationOptions & { model: ResolvedAiModel };

type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  [key: string]: unknown;
};

async function callGemini(options: GeminiCallOptions): Promise<StructuredGenerationResult> {
  const { model, prompt, context, responseSchema, temperature, topK, maxOutputTokens } = options;
  const apiKey = (model.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured for this model.");
  }

  const modelId = model.modelId?.trim();
  if (!modelId) {
    throw new Error("Gemini model identifier is missing.");
  }

  const endpoint = buildGeminiEndpoint(model);
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
  };
  if (typeof temperature === "number") generationConfig.temperature = temperature;
  if (typeof topK === "number") generationConfig.topK = topK;
  if (typeof maxOutputTokens === "number") generationConfig.maxOutputTokens = maxOutputTokens;

  const body: Record<string, unknown> = {
    systemInstruction: {
      role: "system",
      parts: [{ text: prompt.content }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: JSON.stringify(context, null, 2) }],
      },
    ],
    generationConfig,
  };

  if (responseSchema) {
    body.responseSchema = responseSchema;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await safeReadResponse(response);
    throw new Error(`Gemini request failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  const candidate = payload.candidates?.[0];
  const textParts = candidate?.content?.parts?.map((part) => part.text ?? "");
  const text = textParts?.join("").trim();

  if (!text) {
    throw new Error("Gemini response did not contain any text output.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini response was not valid JSON: ${(error as Error).message}`);
  }

  const usage: StructuredGenerationUsage | null = payload.usageMetadata
    ? {
        promptTokens: payload.usageMetadata.promptTokenCount ?? null,
        completionTokens: payload.usageMetadata.candidatesTokenCount ?? null,
        totalTokens: payload.usageMetadata.totalTokenCount ?? null,
      }
    : null;

  return {
    text,
    json: parsed,
    usage,
    model: sanitiseResolvedModel(model),
  };
}

function resolveModel(model: AiModelRecord | null): ResolvedAiModel | null {
  if (model?.apiKey && model.modelId) {
    return { ...model, isFallback: false };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const modelId = process.env.GEMINI_MODEL_ID?.trim();
  if (apiKey && modelId) {
    return {
      id: model?.id ?? "env-gemini",
      name: model?.name ?? process.env.GEMINI_MODEL_NAME?.trim() ?? "Gemini (env)",
      provider: model?.provider ?? "google-gemini",
      modelId,
      status: (model?.status as AiModelStatus) ?? "active",
      description: model?.description ?? null,
      endpoint: model?.endpoint ?? process.env.GEMINI_API_ENDPOINT?.trim() ?? null,
      apiKey,
      currency: model?.currency ?? process.env.GEMINI_CURRENCY?.trim() ?? null,
      inputCostPer1k: model?.inputCostPer1k ?? null,
      outputCostPer1k: model?.outputCostPer1k ?? null,
      notes: model?.notes ?? null,
      createdAt: model?.createdAt ?? null,
      updatedAt: model?.updatedAt ?? null,
      isFallback: true,
    } satisfies ResolvedAiModel;
  }

  return model && model.modelId ? { ...model, apiKey: model.apiKey ?? null } : null;
}

function buildGeminiEndpoint(model: ResolvedAiModel): string {
  const normalisedModelId = normaliseModelId(model.modelId ?? "");
  const endpoint = model.endpoint?.trim();
  if (!endpoint) {
    return `https://generativelanguage.googleapis.com/v1beta/${normalisedModelId}:generateContent`;
  }

  if (/^https?:\/\//i.test(endpoint)) {
    if (endpoint.includes(":generate")) {
      return endpoint;
    }
    return `${endpoint.replace(/\/$/, "")}/${normalisedModelId}:generateContent`;
  }

  const trimmed = endpoint.replace(/^\/+/, "").replace(/\/$/, "");
  return `https://generativelanguage.googleapis.com/${trimmed}/${normalisedModelId}:generateContent`;
}

function normaliseModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.startsWith("models/") || trimmed.startsWith("publishers/")) {
    return trimmed;
  }
  return `models/${trimmed}`;
}

function sanitiseResolvedModel(model: ResolvedAiModel): SanitisedAiModel {
  const { apiKey: _apiKey, ...rest } = model;
  void _apiKey;
  return rest;
}

async function safeReadResponse(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 400);
  } catch (error) {
    return (error as Error)?.message ?? "Unknown error";
  }
}
