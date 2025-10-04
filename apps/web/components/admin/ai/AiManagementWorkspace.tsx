"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Timestamp,
  Unsubscribe,
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import PortalHero from "@/components/PortalHero";
import { ensureFirebase } from "@/lib/firebase";

import AiWorkflowCatalog from "./AiWorkflowCatalog";

const MODEL_STATUSES = ["active", "pilot", "inactive", "deprecated"] as const;
type AiModelStatus = (typeof MODEL_STATUSES)[number];

const PROMPT_STATUSES = ["active", "draft", "archived"] as const;
type AiPromptStatus = (typeof PROMPT_STATUSES)[number];

interface AiModelRecord {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  status: AiModelStatus;
  description: string;
  endpoint: string;
  currency: string;
  inputCostPer1k: number | null;
  outputCostPer1k: number | null;
  notes: string;
  createdAt: Timestamp | Date | null;
  updatedAt: Timestamp | Date | null;
  hasApiKey: boolean;
}

interface AiPromptRecord {
  id: string;
  name: string;
  category: string;
  description: string;
  content: string;
  defaultModelId: string;
  status: AiPromptStatus;
  estimatedTokens: number | null;
  notes: string;
  createdAt: Timestamp | Date | null;
  updatedAt: Timestamp | Date | null;
}

interface AiUsageRecord {
  id: string;
  promptId: string | null;
  promptName: string | null;
  commandName: string | null;
  clientId: string | null;
  clientName: string | null;
  franchiseId: string | null;
  franchiseName: string | null;
  modelId: string | null;
  modelName: string | null;
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number | null;
  currency: string | null;
  createdAt: Timestamp | Date | null;
  requestId: string | null;
}

interface ModelFormState {
  name: string;
  provider: string;
  modelId: string;
  status: AiModelStatus;
  description: string;
  endpoint: string;
  currency: string;
  inputCostPer1k: string;
  outputCostPer1k: string;
  notes: string;
  apiKey: string;
}

interface PromptFormState {
  name: string;
  category: string;
  description: string;
  content: string;
  defaultModelId: string;
  status: AiPromptStatus;
  estimatedTokens: string;
  notes: string;
}

interface UsageSummary {
  tokens: number;
  cost: number;
  currency: string;
  commands: number;
}

interface UsageAggregate {
  key: string;
  label: string;
  tokens: number;
  cost: number;
  count: number;
  currency: string;
}

interface UsageAnalytics {
  totals: UsageSummary;
  weeklySummary: UsageSummary;
  perPromptWeek: UsageAggregate[];
  perClientWeek: UsageAggregate[];
  perFranchiseWeek: UsageAggregate[];
}

const MODEL_FORM_INITIAL_STATE: ModelFormState = {
  name: "",
  provider: "",
  modelId: "",
  status: "active",
  description: "",
  endpoint: "",
  currency: "GBP",
  inputCostPer1k: "",
  outputCostPer1k: "",
  notes: "",
  apiKey: "",
};

const PROMPT_FORM_INITIAL_STATE: PromptFormState = {
  name: "",
  category: "",
  description: "",
  content: "",
  defaultModelId: "",
  status: "active",
  estimatedTokens: "",
  notes: "",
};

const MODEL_STATUS_META: Record<AiModelStatus, { label: string; badgeClass: string }> = {
  active: { label: "Active", badgeClass: "bg-emerald-100 text-emerald-700" },
  pilot: { label: "Pilot", badgeClass: "bg-blue-100 text-blue-700" },
  inactive: { label: "Inactive", badgeClass: "bg-slate-100 text-slate-600" },
  deprecated: { label: "Deprecated", badgeClass: "bg-rose-100 text-rose-700" },
};

const PROMPT_STATUS_META: Record<AiPromptStatus, { label: string; badgeClass: string }> = {
  active: { label: "Active", badgeClass: "bg-emerald-100 text-emerald-700" },
  draft: { label: "Draft", badgeClass: "bg-amber-100 text-amber-700" },
  archived: { label: "Archived", badgeClass: "bg-slate-200 text-slate-600" },
};

function isModelStatus(value: unknown): value is AiModelStatus {
  return typeof value === "string" && MODEL_STATUSES.includes(value as AiModelStatus);
}

function isPromptStatus(value: unknown): value is AiPromptStatus {
  return typeof value === "string" && PROMPT_STATUSES.includes(value as AiPromptStatus);
}

function parseTimestampValue(value: unknown): Timestamp | Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function parseNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pickCurrency(candidates: string[], fallback = "GBP"): string {
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return found ? found.toUpperCase() : fallback;
}

function toDate(value: Timestamp | Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function computeTokens(entry: AiUsageRecord): number {
  const total = parseNumberValue(entry.totalTokens);
  if (typeof total === "number") {
    return total;
  }
  const promptTokens = parseNumberValue(entry.promptTokens) ?? 0;
  const completionTokens = parseNumberValue(entry.completionTokens) ?? 0;
  return promptTokens + completionTokens;
}

function getEntryCurrency(entry: AiUsageRecord, modelMap: Map<string, AiModelRecord>): string {
  if (entry.currency && entry.currency.trim().length > 0) {
    return entry.currency.toUpperCase();
  }
  if (entry.modelId) {
    const model = modelMap.get(entry.modelId);
    if (model?.currency) {
      return model.currency.toUpperCase();
    }
  }
  return "GBP";
}

function deriveUsageCost(entry: AiUsageRecord, modelMap: Map<string, AiModelRecord>): number {
  if (typeof entry.cost === "number" && Number.isFinite(entry.cost)) {
    return entry.cost;
  }
  const model = entry.modelId ? modelMap.get(entry.modelId) : undefined;
  if (!model) {
    return 0;
  }
  const promptTokens = parseNumberValue(entry.promptTokens);
  const completionTokens = parseNumberValue(entry.completionTokens);
  const totalTokens = computeTokens(entry);
  let totalCost = 0;
  if (promptTokens && model.inputCostPer1k != null) {
    totalCost += (promptTokens / 1000) * model.inputCostPer1k;
  }
  if (completionTokens && model.outputCostPer1k != null) {
    totalCost += (completionTokens / 1000) * model.outputCostPer1k;
  }
  if (totalCost === 0 && model.inputCostPer1k != null && totalTokens) {
    totalCost = (totalTokens / 1000) * model.inputCostPer1k;
  }
  return totalCost;
}

function accumulateAggregate(
  map: Map<string, UsageAggregate>,
  key: string,
  label: string,
  tokens: number,
  cost: number,
  currency: string
) {
  const existing = map.get(key);
  if (existing) {
    existing.tokens += tokens;
    existing.cost += cost;
    existing.count += 1;
  } else {
    map.set(key, { key, label, tokens, cost, count: 1, currency });
  }
}

function toSortedList(map: Map<string, UsageAggregate>): UsageAggregate[] {
  return Array.from(map.values()).sort((a, b) => {
    if (b.cost !== a.cost) {
      return b.cost - a.cost;
    }
    return b.tokens - a.tokens;
  });
}

function formatCurrencyValue(value: number, currency: string): string {
  const safeCurrency = currency && currency.length >= 3 ? currency.toUpperCase() : "GBP";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${safeCurrency} ${value.toFixed(2)}`;
  }
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length - 1)}…`;
}

function describeRelativeTime(timestamp: Timestamp | Date | null): string {
  const date = toDate(timestamp);
  if (!date) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return formatter.format(date);
}

function computeUsageAnalytics(entries: AiUsageRecord[], models: AiModelRecord[]): UsageAnalytics {
  const modelsById = new Map(models.map((model) => [model.id, model]));
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  let totalTokens = 0;
  let totalCost = 0;
  const totalsCurrencyCandidates: string[] = [];

  let weeklyTokens = 0;
  let weeklyCost = 0;
  const weeklyCurrencyCandidates: string[] = [];

  const perPromptWeek = new Map<string, UsageAggregate>();
  const perClientWeek = new Map<string, UsageAggregate>();
  const perFranchiseWeek = new Map<string, UsageAggregate>();

  for (const entry of entries) {
    const tokens = computeTokens(entry);
    const cost = deriveUsageCost(entry, modelsById);
    const currency = getEntryCurrency(entry, modelsById);
    totalTokens += tokens;
    totalCost += cost;
    totalsCurrencyCandidates.push(currency);

    const createdAtDate = toDate(entry.createdAt);
    if (createdAtDate && createdAtDate.getTime() >= weekAgo) {
      weeklyTokens += tokens;
      weeklyCost += cost;
      weeklyCurrencyCandidates.push(currency);

      const promptLabel = entry.promptName || entry.commandName || entry.promptId || "Unlabelled prompt";
      const promptKey = entry.promptId || promptLabel;
      accumulateAggregate(perPromptWeek, promptKey, promptLabel, tokens, cost, currency);

      if (entry.clientId || entry.clientName) {
        const clientLabel = entry.clientName || entry.clientId || "Unknown client";
        const clientKey = entry.clientId || clientLabel;
        accumulateAggregate(perClientWeek, clientKey, clientLabel, tokens, cost, currency);
      }

      if (entry.franchiseId || entry.franchiseName) {
        const franchiseLabel = entry.franchiseName || entry.franchiseId || "Unknown franchise";
        const franchiseKey = entry.franchiseId || franchiseLabel;
        accumulateAggregate(perFranchiseWeek, franchiseKey, franchiseLabel, tokens, cost, currency);
      }
    }
  }

  return {
    totals: {
      tokens: totalTokens,
      cost: totalCost,
      currency: pickCurrency(totalsCurrencyCandidates),
      commands: entries.length,
    },
    weeklySummary: {
      tokens: weeklyTokens,
      cost: weeklyCost,
      currency: pickCurrency(weeklyCurrencyCandidates),
      commands: entries.filter((entry) => {
        const date = toDate(entry.createdAt);
        return Boolean(date && date.getTime() >= weekAgo);
      }).length,
    },
    perPromptWeek: toSortedList(perPromptWeek),
    perClientWeek: toSortedList(perClientWeek),
    perFranchiseWeek: toSortedList(perFranchiseWeek),
  };
}

export default function AiManagementWorkspace() {
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [prompts, setPrompts] = useState<AiPromptRecord[]>([]);
  const [usageEntries, setUsageEntries] = useState<AiUsageRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [modelForm, setModelForm] = useState<ModelFormState>(MODEL_FORM_INITIAL_STATE);
  const [promptForm, setPromptForm] = useState<PromptFormState>(PROMPT_FORM_INITIAL_STATE);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [modelFormError, setModelFormError] = useState<string | null>(null);
  const [promptFormError, setPromptFormError] = useState<string | null>(null);
  const [shouldClearApiKey, setShouldClearApiKey] = useState(false);
  const [modelFormExpanded, setModelFormExpanded] = useState(true);
  const [promptFormExpanded, setPromptFormExpanded] = useState(false);

  const modelFormRef = useRef<HTMLDivElement | null>(null);
  const promptFormRef = useRef<HTMLDivElement | null>(null);
  const modelNameInputRef = useRef<HTMLInputElement | null>(null);
  const promptNameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let unsubModels: Unsubscribe | null = null;
    let unsubPrompts: Unsubscribe | null = null;
    let unsubUsage: Unsubscribe | null = null;
    let cancelled = false;
    const readyState = { models: false, prompts: false, usage: false };

    const markReady = (key: keyof typeof readyState) => {
      if (cancelled || readyState[key]) {
        return;
      }
      readyState[key] = true;
      if (readyState.models && readyState.prompts && readyState.usage) {
        setDataLoading(false);
      }
    };

    setDataError(null);
    setDataLoading(true);

    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (cancelled) return;
        if (!db) {
          throw new Error("Firestore database is unavailable.");
        }

        unsubModels = onSnapshot(
          query(collection(db, "aiModels"), orderBy("name", "asc")),
          (snapshot) => {
            if (cancelled) {
              return;
            }
            const nextModels: AiModelRecord[] = snapshot.docs.map((docSnap) => {
              const data = docSnap.data() as Record<string, unknown>;
              const status = isModelStatus(data.status) ? data.status : "inactive";
              return {
                id: docSnap.id,
                name: safeString(data.name) || "Untitled model",
                provider: safeString(data.provider) || "Custom",
                modelId: safeString(data.modelId),
                status,
                description: safeString(data.description),
                endpoint: safeString(data.endpoint),
                currency: (safeString(data.currency) || "GBP").toUpperCase(),
                inputCostPer1k: parseNumberValue(data.inputCostPer1k),
                outputCostPer1k: parseNumberValue(data.outputCostPer1k),
                notes: safeString(data.notes),
                createdAt: parseTimestampValue(data.createdAt),
                updatedAt: parseTimestampValue(data.updatedAt),
                hasApiKey: Boolean(data.apiKey),
              };
            });
            setModels(nextModels);
            markReady("models");
          },
          (error) => {
            console.error("Failed to subscribe to AI models", error);
            if (!cancelled) {
              setDataError("Failed to load AI model registry. Please refresh the page.");
              setDataLoading(false);
            }
          }
        );

        unsubPrompts = onSnapshot(
          query(collection(db, "aiPrompts"), orderBy("name", "asc")),
          (snapshot) => {
            if (cancelled) return;
            const nextPrompts: AiPromptRecord[] = snapshot.docs.map((docSnap) => {
              const data = docSnap.data() as Record<string, unknown>;
              const status = isPromptStatus(data.status) ? data.status : "draft";
              return {
                id: docSnap.id,
                name: safeString(data.name) || "Untitled prompt",
                category: safeString(data.category),
                description: safeString(data.description),
                content: safeString(data.content),
                defaultModelId: safeString(data.defaultModelId),
                status,
                estimatedTokens: parseNumberValue(data.estimatedTokens),
                notes: safeString(data.notes),
                createdAt: parseTimestampValue(data.createdAt),
                updatedAt: parseTimestampValue(data.updatedAt),
              };
            });
            setPrompts(nextPrompts);
            markReady("prompts");
          },
          (error) => {
            console.error("Failed to subscribe to AI prompts", error);
            if (!cancelled) {
              setDataError("Failed to load prompt library. Please refresh the page.");
              setDataLoading(false);
            }
          }
        );

        unsubUsage = onSnapshot(
          query(collection(db, "aiCommandLogs"), orderBy("createdAt", "desc"), limit(200)),
          (snapshot) => {
            if (cancelled) return;
            const nextUsage: AiUsageRecord[] = snapshot.docs.map((docSnap) => {
              const data = docSnap.data() as Record<string, unknown>;
              return {
                id: docSnap.id,
                promptId: safeString(data.promptId) || null,
                promptName: safeString(data.promptName) || null,
                commandName: safeString(data.commandName) || null,
                clientId: safeString(data.clientId) || null,
                clientName: safeString(data.clientName) || null,
                franchiseId: safeString(data.franchiseId) || null,
                franchiseName: safeString(data.franchiseName) || null,
                modelId: safeString(data.modelId) || null,
                modelName: safeString(data.modelName) || null,
                totalTokens: parseNumberValue(data.totalTokens),
                promptTokens: parseNumberValue(data.promptTokens),
                completionTokens: parseNumberValue(data.completionTokens),
                cost: parseNumberValue(data.cost),
                currency: safeString(data.currency) || null,
                createdAt: parseTimestampValue(data.createdAt),
                requestId: safeString(data.requestId) || null,
              };
            });
            setUsageEntries(nextUsage);
            markReady("usage");
          },
          (error) => {
            console.error("Failed to subscribe to AI command logs", error);
            if (!cancelled) {
              setDataError("Failed to load usage analytics. Please refresh the page.");
              setDataLoading(false);
            }
          }
        );
      } catch (error) {
        console.error("Failed to initialise AI management workspace", error);
        if (!cancelled) {
          setDataError(
            error instanceof Error
              ? error.message
              : "Failed to initialise AI management workspace."
          );
          setDataLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubModels === "function") {
        unsubModels();
      }
      if (typeof unsubPrompts === "function") {
        unsubPrompts();
      }
      if (typeof unsubUsage === "function") {
        unsubUsage();
      }
    };
  }, []);

  const usageAnalytics = useMemo(() => computeUsageAnalytics(usageEntries, models), [usageEntries, models]);
  const modelsById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models]
  );

  const weeklyTokensLabel = useMemo(
    () => usageAnalytics.weeklySummary.tokens.toLocaleString("en-GB"),
    [usageAnalytics.weeklySummary.tokens]
  );

  const totalsTokensLabel = useMemo(
    () => usageAnalytics.totals.tokens.toLocaleString("en-GB"),
    [usageAnalytics.totals.tokens]
  );

  const heroQuickActions = useMemo(
    () => [
      {
        label: "Register model",
        description: "Connect a new AI provider or update credentials.",
        onClick: () => {
          setEditingModelId(null);
          setModelForm(MODEL_FORM_INITIAL_STATE);
          setShouldClearApiKey(false);
          setModelFormExpanded(true);
          if (typeof window !== "undefined") {
            window.requestAnimationFrame(() => {
              modelFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              modelNameInputRef.current?.focus();
            });
          }
        },
      },
      {
        label: "Create prompt",
        description: "Publish reusable system or assistant prompts.",
        onClick: () => {
          setEditingPromptId(null);
          setPromptForm(PROMPT_FORM_INITIAL_STATE);
          setPromptFormExpanded(true);
          if (typeof window !== "undefined") {
            window.requestAnimationFrame(() => {
              promptFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              promptNameInputRef.current?.focus();
            });
          }
        },
      },
    ],
    []
  );

  const handleModelFieldChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;
    setModelForm((prev) => {
      if (name === "currency") {
        return { ...prev, [name]: value.toUpperCase() };
      }
      return { ...prev, [name]: value };
    });
  };

  const handlePromptFieldChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;
    setPromptForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetModelForm = () => {
    setEditingModelId(null);
    setModelForm(MODEL_FORM_INITIAL_STATE);
    setModelFormError(null);
    setShouldClearApiKey(false);
  };

  const resetPromptForm = () => {
    setEditingPromptId(null);
    setPromptForm(PROMPT_FORM_INITIAL_STATE);
    setPromptFormError(null);
  };

  const handleModelSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setModelFormError(null);

    const name = modelForm.name.trim();
    const modelId = modelForm.modelId.trim();
    if (!name) {
      setModelFormError("Model name is required.");
      return;
    }
    if (!modelId) {
      setModelFormError("Model identifier is required.");
      return;
    }
    if (!modelForm.currency.trim()) {
      setModelFormError("Currency code is required.");
      return;
    }

    const inputCostRaw = modelForm.inputCostPer1k.trim();
    let inputCost: number | null = null;
    if (inputCostRaw) {
      const parsed = Number(inputCostRaw);
      if (!Number.isFinite(parsed)) {
        setModelFormError("Enter a valid input cost per 1K tokens.");
        return;
      }
      inputCost = parsed;
    }

    const outputCostRaw = modelForm.outputCostPer1k.trim();
    let outputCost: number | null = null;
    if (outputCostRaw) {
      const parsed = Number(outputCostRaw);
      if (!Number.isFinite(parsed)) {
        setModelFormError("Enter a valid output cost per 1K tokens.");
        return;
      }
      outputCost = parsed;
    }

    setModelSaving(true);
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firestore database is unavailable.");
      }

      const payload: Record<string, unknown> = {
        name,
        provider: modelForm.provider.trim() || "Custom",
        modelId,
        status: modelForm.status,
        description: modelForm.description.trim() || null,
        endpoint: modelForm.endpoint.trim() || null,
        currency: modelForm.currency.trim().toUpperCase(),
        inputCostPer1k: inputCost,
        outputCostPer1k: outputCost,
        notes: modelForm.notes.trim() || null,
        updatedAt: serverTimestamp(),
      };

      const trimmedKey = modelForm.apiKey.trim();
      if (editingModelId) {
        if (shouldClearApiKey) {
          payload.apiKey = null;
        } else if (trimmedKey) {
          payload.apiKey = trimmedKey;
        }
        await updateDoc(doc(db, "aiModels", editingModelId), payload);
      } else {
        payload.createdAt = serverTimestamp();
        payload.apiKey = trimmedKey || null;
        await addDoc(collection(db, "aiModels"), payload);
      }

      resetModelForm();
      setModelFormExpanded(false);
    } catch (error) {
      console.error("Failed to save AI model", error);
      setModelFormError(
        error instanceof Error ? error.message : "Failed to save AI model."
      );
    } finally {
      setModelSaving(false);
    }
  };

  const handlePromptSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPromptFormError(null);

    const name = promptForm.name.trim();
    const content = promptForm.content.trim();
    if (!name) {
      setPromptFormError("Prompt name is required.");
      return;
    }
    if (!content) {
      setPromptFormError("Prompt content is required.");
      return;
    }

    const estimatedTokensRaw = promptForm.estimatedTokens.trim();
    let estimatedTokens: number | null = null;
    if (estimatedTokensRaw) {
      const parsed = Number(estimatedTokensRaw);
      if (!Number.isFinite(parsed)) {
        setPromptFormError("Enter a valid estimated token count.");
        return;
      }
      estimatedTokens = parsed;
    }

    setPromptSaving(true);
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firestore database is unavailable.");
      }

      const payload: Record<string, unknown> = {
        name,
        category: promptForm.category.trim() || null,
        description: promptForm.description.trim() || null,
        content,
        defaultModelId: promptForm.defaultModelId.trim() || null,
        status: promptForm.status,
        estimatedTokens,
        notes: promptForm.notes.trim() || null,
        updatedAt: serverTimestamp(),
      };

      if (editingPromptId) {
        await updateDoc(doc(db, "aiPrompts", editingPromptId), payload);
      } else {
        payload.createdAt = serverTimestamp();
        await addDoc(collection(db, "aiPrompts"), payload);
      }

      resetPromptForm();
      setPromptFormExpanded(false);
    } catch (error) {
      console.error("Failed to save AI prompt", error);
      setPromptFormError(
        error instanceof Error ? error.message : "Failed to save AI prompt."
      );
    } finally {
      setPromptSaving(false);
    }
  };

  const startEditModel = (record: AiModelRecord) => {
    setEditingModelId(record.id);
    setModelForm({
      name: record.name,
      provider: record.provider,
      modelId: record.modelId,
      status: record.status,
      description: record.description,
      endpoint: record.endpoint,
      currency: record.currency,
      inputCostPer1k: record.inputCostPer1k != null ? String(record.inputCostPer1k) : "",
      outputCostPer1k: record.outputCostPer1k != null ? String(record.outputCostPer1k) : "",
      notes: record.notes,
      apiKey: "",
    });
    setShouldClearApiKey(false);
    setModelFormExpanded(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        modelFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        modelNameInputRef.current?.focus();
      });
    }
  };

  const startEditPrompt = (record: AiPromptRecord) => {
    setEditingPromptId(record.id);
    setPromptForm({
      name: record.name,
      category: record.category,
      description: record.description,
      content: record.content,
      defaultModelId: record.defaultModelId,
      status: record.status,
      estimatedTokens: record.estimatedTokens != null ? String(record.estimatedTokens) : "",
      notes: record.notes,
    });
    setPromptFormExpanded(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        promptFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        promptNameInputRef.current?.focus();
      });
    }
  };

  const topPromptsWeek = usageAnalytics.perPromptWeek.slice(0, 6);
  const topClientsWeek = usageAnalytics.perClientWeek.slice(0, 6);
  const topFranchisesWeek = usageAnalytics.perFranchiseWeek.slice(0, 6);
  const recentUsage = usageEntries.slice(0, 100);

  return (
    <div className="space-y-6">
      <PortalHero
        eyebrow="Automation"
        title="AI management control centre"
        description="Configure model connectors, iterate on system prompts, and stay ahead of token spend across every franchise."
        backgroundClass="bg-slate-900"
        metrics={[
          { label: "Models", value: dataLoading ? "…" : models.length },
          { label: "Prompts", value: dataLoading ? "…" : prompts.length },
          {
            label: "Weekly tokens",
            value: dataLoading ? "…" : weeklyTokensLabel,
          },
          {
            label: "Weekly spend",
            value: dataLoading
              ? "…"
              : formatCurrencyValue(
                  usageAnalytics.weeklySummary.cost,
                  usageAnalytics.weeklySummary.currency
                ),
          },
        ]}
        quickActions={heroQuickActions}
      />

      {dataError ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {dataError}
        </div>
      ) : null}

      <AiWorkflowCatalog />

      <section
        ref={modelFormRef}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Model registry</h2>
            <p className="text-sm text-gray-600">
              Register the AI providers available to the platform and track their latest credentials and pricing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModelFormExpanded((value) => !value)}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            {modelFormExpanded ? "Hide form" : "Add model"}
          </button>
        </div>

        {modelFormExpanded ? (
          <form onSubmit={handleModelSubmit} className="mt-6 space-y-4">
            {editingModelId ? (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
                Editing existing model. Leave the API key field blank to keep the stored secret, or tick “Remove saved key” to clear it.
              </div>
            ) : null}
            {modelFormError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {modelFormError}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Model name *</span>
                <input
                  ref={modelNameInputRef}
                  type="text"
                  name="name"
                  value={modelForm.name}
                  onChange={handleModelFieldChange}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Provider</span>
                <input
                  type="text"
                  name="provider"
                  value={modelForm.provider}
                  onChange={handleModelFieldChange}
                  placeholder="OpenAI, Anthropic, Vertex…"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Model identifier *</span>
                <input
                  type="text"
                  name="modelId"
                  value={modelForm.modelId}
                  onChange={handleModelFieldChange}
                  placeholder="gpt-4.1, claude-3.5-sonnet, custom-model"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Status</span>
                <select
                  name="status"
                  value={modelForm.status}
                  onChange={handleModelFieldChange}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                >
                  {MODEL_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {MODEL_STATUS_META[status].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Endpoint</span>
                <input
                  type="text"
                  name="endpoint"
                  value={modelForm.endpoint}
                  onChange={handleModelFieldChange}
                  placeholder="https://api.example.com/v1"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Currency *</span>
                <input
                  type="text"
                  name="currency"
                  value={modelForm.currency}
                  onChange={handleModelFieldChange}
                  maxLength={4}
                  className="uppercase rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Input cost / 1K tokens</span>
                <input
                  type="number"
                  step="0.0001"
                  name="inputCostPer1k"
                  value={modelForm.inputCostPer1k}
                  onChange={handleModelFieldChange}
                  placeholder="0.002"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Output cost / 1K tokens</span>
                <input
                  type="number"
                  step="0.0001"
                  name="outputCostPer1k"
                  value={modelForm.outputCostPer1k}
                  onChange={handleModelFieldChange}
                  placeholder="0.006"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Description</span>
                <textarea
                  name="description"
                  value={modelForm.description}
                  onChange={handleModelFieldChange}
                  rows={3}
                  placeholder="When to use this model, performance notes, or rate limits."
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Operational notes</span>
                <textarea
                  name="notes"
                  value={modelForm.notes}
                  onChange={handleModelFieldChange}
                  rows={2}
                  placeholder="Escalation contact, deployment guardrails, or franchise restrictions."
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">API key / secret</span>
                <input
                  type="password"
                  name="apiKey"
                  value={modelForm.apiKey}
                  onChange={handleModelFieldChange}
                  placeholder="Paste the service key (optional)"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              {editingModelId ? (
                <label className="mt-6 flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={shouldClearApiKey}
                    onChange={(event) => setShouldClearApiKey(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-500"
                  />
                  Remove saved key when saving
                </label>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={modelSaving}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelSaving ? "Saving…" : editingModelId ? "Save changes" : "Create model"}
              </button>
              {editingModelId ? (
                <button
                  type="button"
                  onClick={resetModelForm}
                  className="text-sm font-medium text-slate-600 underline-offset-4 hover:underline"
                >
                  Cancel editing
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        <div className="mt-8 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Model</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Pricing</th>
                <th className="px-4 py-3 text-left font-medium">Credentials</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {models.map((model) => {
                const meta = MODEL_STATUS_META[model.status];
                return (
                  <tr key={model.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-gray-900">{model.name}</div>
                      <div className="text-xs text-gray-500">
                        {model.provider || "Custom"} • {model.modelId || "No identifier"}
                      </div>
                      {model.notes ? (
                        <div className="mt-1 text-xs text-gray-500">{truncate(model.notes, 120)}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-gray-700">
                      {model.inputCostPer1k != null || model.outputCostPer1k != null ? (
                        <div className="space-y-1">
                          {model.inputCostPer1k != null ? (
                            <div>In: {formatCurrencyValue(model.inputCostPer1k, model.currency)} / 1K</div>
                          ) : null}
                          {model.outputCostPer1k != null ? (
                            <div>Out: {formatCurrencyValue(model.outputCostPer1k, model.currency)} / 1K</div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">No pricing recorded</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {model.hasApiKey ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                          Secret stored
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                          Missing key
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-gray-500">
                      {describeRelativeTime(model.updatedAt || model.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <button
                        type="button"
                        onClick={() => startEditModel(model)}
                        className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {models.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    No models registered yet. Use the form above to connect your first provider.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section
        ref={promptFormRef}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Prompt library</h2>
            <p className="text-sm text-gray-600">
              Curate the system prompts and command templates used throughout automations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPromptFormExpanded((value) => !value)}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            {promptFormExpanded ? "Hide form" : "Add prompt"}
          </button>
        </div>

        {promptFormExpanded ? (
          <form onSubmit={handlePromptSubmit} className="mt-6 space-y-4">
            {editingPromptId ? (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
                Editing an existing prompt. Updates apply immediately to new automation runs.
              </div>
            ) : null}
            {promptFormError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {promptFormError}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Prompt name *</span>
                <input
                  ref={promptNameInputRef}
                  type="text"
                  name="name"
                  value={promptForm.name}
                  onChange={handlePromptFieldChange}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Category / use case</span>
                <input
                  type="text"
                  name="category"
                  value={promptForm.category}
                  onChange={handlePromptFieldChange}
                  placeholder="Storyboards, briefs, support, …"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Default model</span>
                <select
                  name="defaultModelId"
                  value={promptForm.defaultModelId}
                  onChange={handlePromptFieldChange}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                >
                  <option value="">Select a model</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Status</span>
                <select
                  name="status"
                  value={promptForm.status}
                  onChange={handlePromptFieldChange}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                >
                  {PROMPT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {PROMPT_STATUS_META[status].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Estimated tokens</span>
                <input
                  type="number"
                  name="estimatedTokens"
                  value={promptForm.estimatedTokens}
                  onChange={handlePromptFieldChange}
                  placeholder="700"
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Short description</span>
                <textarea
                  name="description"
                  value={promptForm.description}
                  onChange={handlePromptFieldChange}
                  rows={2}
                  placeholder="What this prompt does and when to deploy it."
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Prompt content *</span>
                <textarea
                  name="content"
                  value={promptForm.content}
                  onChange={handlePromptFieldChange}
                  rows={6}
                  placeholder="Paste the system prompt, command template, or JSON instructions."
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-relaxed focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  required
                />
              </label>
              <label className="sm:col-span-2 flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Operational notes</span>
                <textarea
                  name="notes"
                  value={promptForm.notes}
                  onChange={handlePromptFieldChange}
                  rows={2}
                  placeholder="Pre-flight checks, fallback behaviour, or linked workflows."
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={promptSaving}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {promptSaving ? "Saving…" : editingPromptId ? "Save changes" : "Create prompt"}
              </button>
              {editingPromptId ? (
                <button
                  type="button"
                  onClick={resetPromptForm}
                  className="text-sm font-medium text-slate-600 underline-offset-4 hover:underline"
                >
                  Cancel editing
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        <div className="mt-8 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Prompt</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Model</th>
                <th className="px-4 py-3 text-left font-medium">Est. tokens</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {prompts.map((prompt) => {
                const meta = PROMPT_STATUS_META[prompt.status];
                const modelLabel = prompt.defaultModelId
                  ? models.find((model) => model.id === prompt.defaultModelId)?.name || "Unknown"
                  : "—";
                return (
                  <tr key={prompt.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-gray-900">{prompt.name}</div>
                      {prompt.category ? (
                        <div className="text-xs uppercase tracking-wide text-gray-500">{prompt.category}</div>
                      ) : null}
                      {prompt.description ? (
                        <div className="mt-1 text-xs text-gray-500">{truncate(prompt.description, 140)}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-gray-700">{modelLabel}</td>
                    <td className="px-4 py-3 align-top text-sm text-gray-700">
                      {prompt.estimatedTokens != null ? prompt.estimatedTokens.toLocaleString("en-GB") : "—"}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-gray-500">
                      {describeRelativeTime(prompt.updatedAt || prompt.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <button
                        type="button"
                        onClick={() => startEditPrompt(prompt)}
                        className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {prompts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    No prompts created yet. Use the form above to publish your first automation prompt.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Usage analytics</h2>
            <p className="text-sm text-gray-600">
              Token consumption and spend by prompt, client, and franchise. Calculations default to the last seven days.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Weekly spend</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {dataLoading
                ? "…"
                : formatCurrencyValue(
                    usageAnalytics.weeklySummary.cost,
                    usageAnalytics.weeklySummary.currency
                  )}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {usageAnalytics.weeklySummary.commands.toLocaleString("en-GB")} commands
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Weekly tokens</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {dataLoading ? "…" : weeklyTokensLabel}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Lifetime spend</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {dataLoading
                ? "…"
                : formatCurrencyValue(usageAnalytics.totals.cost, usageAnalytics.totals.currency)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {usageAnalytics.totals.commands.toLocaleString("en-GB")} total commands
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Lifetime tokens</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {dataLoading ? "…" : totalsTokensLabel}
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Top prompts (7 days)</h3>
            <ul className="mt-4 space-y-3 text-sm">
              {topPromptsWeek.length > 0 ? (
                topPromptsWeek.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-gray-900">{item.label}</div>
                      <div className="text-xs text-gray-500">
                        {item.count.toLocaleString("en-GB")} runs • {item.tokens.toLocaleString("en-GB")} tokens
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {formatCurrencyValue(item.cost, item.currency)}
                    </div>
                  </li>
                ))
              ) : (
                <li className="text-sm text-gray-500">No prompt activity recorded in the last week.</li>
              )}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Top clients (7 days)</h3>
            <ul className="mt-4 space-y-3 text-sm">
              {topClientsWeek.length > 0 ? (
                topClientsWeek.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-gray-900">{item.label}</div>
                      <div className="text-xs text-gray-500">
                        {item.count.toLocaleString("en-GB")} commands • {item.tokens.toLocaleString("en-GB")} tokens
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {formatCurrencyValue(item.cost, item.currency)}
                    </div>
                  </li>
                ))
              ) : (
                <li className="text-sm text-gray-500">No client usage recorded in the last week.</li>
              )}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Top franchises (7 days)</h3>
            <ul className="mt-4 space-y-3 text-sm">
              {topFranchisesWeek.length > 0 ? (
                topFranchisesWeek.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-gray-900">{item.label}</div>
                      <div className="text-xs text-gray-500">
                        {item.count.toLocaleString("en-GB")} commands • {item.tokens.toLocaleString("en-GB")} tokens
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">
                      {formatCurrencyValue(item.cost, item.currency)}
                    </div>
                  </li>
                ))
              ) : (
                <li className="text-sm text-gray-500">No franchise usage recorded in the last week.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Recent commands</h3>
            <p className="text-xs text-gray-500">Latest {recentUsage.length} events (refreshed live)</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Prompt / command</th>
                  <th className="px-4 py-3 text-left font-medium">Client</th>
                  <th className="px-4 py-3 text-left font-medium">Franchise</th>
                  <th className="px-4 py-3 text-left font-medium">Model</th>
                  <th className="px-4 py-3 text-right font-medium">Tokens</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {recentUsage.map((entry) => {
                  const tokens = computeTokens(entry);
                  const currency = getEntryCurrency(entry, modelsById);
                  const cost = deriveUsageCost(entry, modelsById);
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-900">
                          {entry.promptName || entry.commandName || entry.promptId || "Unlabelled prompt"}
                        </div>
                        {entry.commandName ? (
                          <div className="text-xs text-gray-500">{entry.commandName}</div>
                        ) : null}
                        {entry.requestId ? (
                          <div className="text-[10px] uppercase tracking-wide text-gray-400">{entry.requestId}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-700">
                        {entry.clientName || entry.clientId || "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-700">
                        {entry.franchiseName || entry.franchiseId || "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-700">
                        {entry.modelName || entry.modelId || "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-right text-sm text-gray-700">
                        {tokens.toLocaleString("en-GB")}
                      </td>
                      <td className="px-4 py-3 align-top text-right text-sm font-medium text-slate-900">
                        {formatCurrencyValue(cost, currency)}
                      </td>
                      <td className="px-4 py-3 align-top text-right text-xs text-gray-500">
                        {describeRelativeTime(entry.createdAt)}
                      </td>
                    </tr>
                  );
                })}
                {recentUsage.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">
                      No usage events recorded yet. Command activity will appear here automatically.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
