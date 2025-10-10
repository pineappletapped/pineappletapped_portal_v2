export type RoutingStageKey = "franchise_primary" | "franchise_team" | "hq";

export type RoutingFlowKey = "franchise" | "hq";

export interface RoutingStageConfig {
  key: RoutingStageKey;
  label: string;
  description: string;
  requiresKit: boolean;
  autoConfirm: boolean;
  enabled: boolean;
}

export interface KitRoutingSettings {
  franchiseFlow: RoutingStageConfig[];
  hqFlow: RoutingStageConfig[];
  updatedAt?: string | null;
}

export interface RoutingCoverage {
  type: 'franchise' | 'hq';
  franchiseId?: string | null;
  label?: string | null;
}

export interface RoutingAttemptSummary {
  key: RoutingStageKey;
  label: string;
  requiresKit: boolean;
  autoConfirm: boolean;
  ownerType: 'company' | 'franchise' | 'user';
  franchiseId: string | null;
  description: string | null;
}

interface StageMeta {
  name: string;
  defaultLabel: string;
  defaultDescription: string;
  defaultRequiresKit: boolean;
  defaultAutoConfirm: boolean;
  flows: RoutingFlowKey[];
  ownerType: 'company' | 'franchise' | 'user';
  ownerScope: string;
  summary: string;
  tokenHint?: string;
}

export const ROUTING_STAGE_META: Record<RoutingStageKey, StageMeta> = {
  franchise_primary: {
    name: "Franchise operations",
    defaultLabel: "{{coverageLabel}} operations",
    defaultDescription:
      "Check franchise-managed stock first so client bookings can be auto-confirmed when everything is available.",
    defaultRequiresKit: true,
    defaultAutoConfirm: true,
    flows: ["franchise"],
    ownerType: 'franchise',
    ownerScope: "Franchise inventory & on-site staff",
    summary: "Looks for kit owned by the selected franchise location and confirms immediately when everything is available.",
    tokenHint: "Use {{coverageLabel}} to automatically insert the franchise or territory name.",
  },
  franchise_team: {
    name: "Franchise freelance team",
    defaultLabel: "{{coverageLabel}} freelance network",
    defaultDescription:
      "Invite the wider franchise crew and contractors to confirm they can cover the shoot and secure the required kit.",
    defaultRequiresKit: false,
    defaultAutoConfirm: false,
    flows: ["franchise"],
    ownerType: 'user',
    ownerScope: "Franchise-linked freelancers & owned kit",
    summary: "Requests confirmation from franchise freelancers or contractors when the core team can't auto-book the work.",
    tokenHint: "Use {{coverageLabel}} to reference the franchise territory in the stage title.",
  },
  hq: {
    name: "HQ operations",
    defaultLabel: "HQ operations",
    defaultDescription:
      "Fallback to central operations to secure company-owned kit or escalate bookings that need manual confirmation.",
    defaultRequiresKit: true,
    defaultAutoConfirm: true,
    flows: ["franchise", "hq"],
    ownerType: 'company',
    ownerScope: "Company inventory & central scheduling",
    summary: "Checks company-managed kit or escalates the booking to HQ for manual confirmation.",
  },
};

const DEFAULT_FRANCHISE_FLOW_KEYS: RoutingStageKey[] = [
  "franchise_primary",
  "franchise_team",
  "hq",
];

const DEFAULT_HQ_FLOW_KEYS: RoutingStageKey[] = ["hq"];

export const DEFAULT_KIT_ROUTING_SETTINGS: KitRoutingSettings = {
  franchiseFlow: DEFAULT_FRANCHISE_FLOW_KEYS.map((key) => {
    const base = createDefaultStage(key);
    if (key === "hq") {
      return { ...base, autoConfirm: false };
    }
    return base;
  }),
  hqFlow: DEFAULT_HQ_FLOW_KEYS.map((key) => createDefaultStage(key)),
  updatedAt: null,
};

export function createDefaultStage(key: RoutingStageKey): RoutingStageConfig {
  const meta = ROUTING_STAGE_META[key];
  return {
    key,
    label: meta.defaultLabel,
    description: meta.defaultDescription,
    requiresKit: meta.defaultRequiresKit,
    autoConfirm: meta.defaultAutoConfirm,
    enabled: true,
  };
}

const VALID_STAGE_KEYS = new Set<RoutingStageKey>([
  "franchise_primary",
  "franchise_team",
  "hq",
]);

const FLOW_KEY_TO_ALLOWED_STAGE_MAP: Record<RoutingFlowKey, RoutingStageKey[]> = {
  franchise: DEFAULT_FRANCHISE_FLOW_KEYS,
  hq: DEFAULT_HQ_FLOW_KEYS,
};

const COVERAGE_LABEL_TOKEN = /\{\{\s*coverageLabel\s*\}\}/gi;

export function resolveStageLabel(
  stage: RoutingStageConfig,
  options: { coverageLabel?: string | null; fallback?: string | null } = {},
): string {
  const { coverageLabel = null, fallback = null } = options;
  const trimmed = stage.label?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : fallback || ROUTING_STAGE_META[stage.key].defaultLabel;
  if (!base.includes("{{")) {
    return base;
  }
  const safeCoverage = coverageLabel && coverageLabel.trim().length > 0 ? coverageLabel.trim() : "Franchise operations";
  return base.replace(COVERAGE_LABEL_TOKEN, safeCoverage);
}

export function cloneKitRoutingSettings(settings: KitRoutingSettings): KitRoutingSettings {
  return {
    franchiseFlow: settings.franchiseFlow.map((stage) => ({ ...stage })),
    hqFlow: settings.hqFlow.map((stage) => ({ ...stage })),
    updatedAt: settings.updatedAt ?? null,
  };
}

function normaliseStage(
  stage: unknown,
  defaults: RoutingStageConfig,
): RoutingStageConfig {
  if (!stage || typeof stage !== "object") {
    return { ...defaults };
  }
  const candidate = stage as Record<string, unknown>;
  const requiresKit = typeof candidate.requiresKit === "boolean" ? candidate.requiresKit : defaults.requiresKit;
  const autoConfirm = typeof candidate.autoConfirm === "boolean" ? candidate.autoConfirm : defaults.autoConfirm;
  const enabled = candidate.enabled === false ? false : candidate.enabled === true ? true : defaults.enabled;
  const label = typeof candidate.label === "string" ? candidate.label.trim() : defaults.label;
  const description = typeof candidate.description === "string" ? candidate.description.trim() : defaults.description;
  return {
    key: defaults.key,
    label: label.length > 0 ? label : defaults.label,
    description: description.length > 0 ? description : defaults.description,
    requiresKit,
    autoConfirm,
    enabled,
  };
}

function parseFlow(
  raw: unknown,
  flowKey: RoutingFlowKey,
  defaults: RoutingStageConfig[],
): RoutingStageConfig[] {
  const allowedKeys = new Set<RoutingStageKey>(FLOW_KEY_TO_ALLOWED_STAGE_MAP[flowKey]);
  const stages: RoutingStageConfig[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const key = typeof item === "object" && item && "key" in item ? (item as any).key : null;
      if (typeof key !== "string") continue;
      if (!VALID_STAGE_KEYS.has(key as RoutingStageKey)) continue;
      const typedKey = key as RoutingStageKey;
      if (!allowedKeys.has(typedKey)) continue;
      if (stages.some((stage) => stage.key === typedKey)) continue;
      const defaultStage = defaults.find((stage) => stage.key === typedKey) ?? createDefaultStage(typedKey);
      stages.push(normaliseStage(item, defaultStage));
    }
  }
  defaults.forEach((defaultStage) => {
    if (!stages.some((stage) => stage.key === defaultStage.key)) {
      stages.push({ ...defaultStage });
    }
  });
  return stages;
}

export function parseKitRoutingSettings(data: unknown): KitRoutingSettings {
  if (!data || typeof data !== "object") {
    return cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS);
  }
  const raw = data as Record<string, unknown>;
  const franchiseFlow = parseFlow(raw.franchiseFlow, "franchise", DEFAULT_KIT_ROUTING_SETTINGS.franchiseFlow);
  const hqFlow = parseFlow(raw.hqFlow, "hq", DEFAULT_KIT_ROUTING_SETTINGS.hqFlow);
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
  return { franchiseFlow, hqFlow, updatedAt };
}

export function sanitiseKitRoutingSettings(settings: KitRoutingSettings): KitRoutingSettings {
  const cleanFlow = (flow: RoutingStageConfig[], defaults: RoutingStageConfig[]) =>
    flow
      .map((stage) => {
        const defaultStage = defaults.find((item) => item.key === stage.key) ?? createDefaultStage(stage.key);
        const label = typeof stage.label === "string" ? stage.label.trim() : defaultStage.label;
        const description =
          typeof stage.description === "string" ? stage.description.trim() : defaultStage.description;
        return {
          key: stage.key,
          label: label.length > 0 ? label : defaultStage.label,
          description: description.length > 0 ? description : defaultStage.description,
          requiresKit: stage.requiresKit === true,
          autoConfirm: stage.autoConfirm === true,
          enabled: stage.enabled !== false,
        } satisfies RoutingStageConfig;
      })
      .filter((stage, index, arr) => index === arr.findIndex((entry) => entry.key === stage.key));
  return {
    franchiseFlow: cleanFlow(settings.franchiseFlow, DEFAULT_KIT_ROUTING_SETTINGS.franchiseFlow),
    hqFlow: cleanFlow(settings.hqFlow, DEFAULT_KIT_ROUTING_SETTINGS.hqFlow),
    updatedAt: settings.updatedAt ?? null,
  };
}

export function resolveRoutingAttempts(
  settings: KitRoutingSettings,
  coverage: RoutingCoverage,
): RoutingAttemptSummary[] {
  const flowKey: "franchiseFlow" | "hqFlow" =
    coverage.type === "franchise" && coverage.franchiseId ? "franchiseFlow" : "hqFlow";
  const configuredFlow = flowKey === "franchiseFlow" ? settings.franchiseFlow : settings.hqFlow;
  const attempts: RoutingAttemptSummary[] = [];

  const addStage = (stage: RoutingStageConfig) => {
    const meta = ROUTING_STAGE_META[stage.key];
    if (!meta) return;
    if (flowKey === "hqFlow" && stage.key !== "hq") return;
    if (meta.ownerType !== "company" && (!coverage.franchiseId || coverage.type !== "franchise")) {
      return;
    }
    if (attempts.some((entry) => entry.key === stage.key)) {
      return;
    }
    const label = resolveStageLabel(stage, {
      coverageLabel: coverage.label ?? null,
      fallback: meta.defaultLabel,
    });
    const franchiseId =
      meta.ownerType === "franchise" || meta.ownerType === "user" ? coverage.franchiseId ?? null : null;
    attempts.push({
      key: stage.key,
      label,
      requiresKit: stage.requiresKit === true,
      autoConfirm: stage.autoConfirm === true,
      ownerType: meta.ownerType,
      franchiseId,
      description: stage.description?.length ? stage.description : null,
    });
  };

  const activeStages = configuredFlow.filter((stage) => stage.enabled !== false);
  activeStages.forEach((stage) => addStage(stage));

  if (attempts.length === 0) {
    const allDisabled = configuredFlow.length > 0 && configuredFlow.every((stage) => stage.enabled === false);
    if (allDisabled) {
      const fallbackKey: RoutingStageKey =
        coverage.type === "franchise" && coverage.franchiseId ? "franchise_primary" : "hq";
      const fallbackFlow =
        flowKey === "franchiseFlow"
          ? DEFAULT_KIT_ROUTING_SETTINGS.franchiseFlow
          : DEFAULT_KIT_ROUTING_SETTINGS.hqFlow;
      const fallbackStage =
        fallbackFlow.find((stage) => stage.key === fallbackKey) ?? createDefaultStage(fallbackKey);
      addStage({ ...fallbackStage, enabled: true });
    } else {
      const fallbackFlow =
        flowKey === "franchiseFlow"
          ? DEFAULT_KIT_ROUTING_SETTINGS.franchiseFlow
          : DEFAULT_KIT_ROUTING_SETTINGS.hqFlow;
      fallbackFlow.forEach((stage) => addStage(stage));
    }
  }

  return attempts;
}
