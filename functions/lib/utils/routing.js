export const ROUTING_STAGE_META = {
    franchise_primary: {
        name: 'Franchise operations',
        defaultLabel: '{{coverageLabel}} operations',
        defaultDescription: 'Check franchise-managed stock first so client bookings can be auto-confirmed when everything is available.',
        defaultRequiresKit: true,
        defaultAutoConfirm: true,
        flows: ['franchise'],
        ownerType: 'franchise',
    },
    franchise_team: {
        name: 'Franchise freelance team',
        defaultLabel: '{{coverageLabel}} freelance network',
        defaultDescription: 'Invite the wider franchise crew and contractors to confirm they can cover the shoot and secure the required kit.',
        defaultRequiresKit: false,
        defaultAutoConfirm: false,
        flows: ['franchise'],
        ownerType: 'user',
    },
    hq: {
        name: 'HQ operations',
        defaultLabel: 'HQ operations',
        defaultDescription: 'Fallback to central operations to secure company-owned kit or escalate bookings that need manual confirmation.',
        defaultRequiresKit: true,
        defaultAutoConfirm: true,
        flows: ['franchise', 'hq'],
        ownerType: 'company',
    },
};
const DEFAULT_FRANCHISE_FLOW_KEYS = ['franchise_primary', 'franchise_team', 'hq'];
const DEFAULT_HQ_FLOW_KEYS = ['hq'];
export const DEFAULT_KIT_ROUTING_SETTINGS = {
    franchiseFlow: DEFAULT_FRANCHISE_FLOW_KEYS.map((key) => {
        const stage = createDefaultStage(key);
        if (key === 'hq') {
            return { ...stage, autoConfirm: false };
        }
        return stage;
    }),
    hqFlow: DEFAULT_HQ_FLOW_KEYS.map((key) => createDefaultStage(key)),
    updatedAt: null,
};
const VALID_STAGE_KEYS = new Set(['franchise_primary', 'franchise_team', 'hq']);
const FLOW_KEY_TO_ALLOWED_STAGE_MAP = {
    franchise: DEFAULT_FRANCHISE_FLOW_KEYS,
    hq: DEFAULT_HQ_FLOW_KEYS,
};
const COVERAGE_LABEL_TOKEN = /\{\{\s*coverageLabel\s*\}\}/gi;
export function createDefaultStage(key) {
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
export function resolveStageLabel(stage, options = {}) {
    const { coverageLabel = null, fallback = null } = options;
    const trimmed = typeof stage.label === 'string' ? stage.label.trim() : '';
    const base = trimmed.length > 0 ? trimmed : fallback || ROUTING_STAGE_META[stage.key].defaultLabel;
    if (!base.includes('{{')) {
        return base;
    }
    const safeCoverage = coverageLabel && coverageLabel.trim().length > 0 ? coverageLabel.trim() : 'Franchise operations';
    return base.replace(COVERAGE_LABEL_TOKEN, safeCoverage);
}
function normaliseStage(stage, defaults) {
    if (!stage || typeof stage !== 'object') {
        return { ...defaults };
    }
    const candidate = stage;
    const requiresKit = typeof candidate.requiresKit === 'boolean' ? candidate.requiresKit : defaults.requiresKit;
    const autoConfirm = typeof candidate.autoConfirm === 'boolean' ? candidate.autoConfirm : defaults.autoConfirm;
    const enabled = candidate.enabled === false ? false : candidate.enabled === true ? true : defaults.enabled;
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : defaults.label;
    const description = typeof candidate.description === 'string' ? candidate.description.trim() : defaults.description;
    return {
        key: defaults.key,
        label: label.length > 0 ? label : defaults.label,
        description: description.length > 0 ? description : defaults.description,
        requiresKit,
        autoConfirm,
        enabled,
    };
}
function parseFlow(raw, flowKey, defaults) {
    const allowedKeys = new Set(FLOW_KEY_TO_ALLOWED_STAGE_MAP[flowKey]);
    const stages = [];
    if (Array.isArray(raw)) {
        for (const item of raw) {
            const key = typeof item === 'object' && item && 'key' in item ? item.key : null;
            if (typeof key !== 'string')
                continue;
            if (!VALID_STAGE_KEYS.has(key))
                continue;
            const typedKey = key;
            if (!allowedKeys.has(typedKey))
                continue;
            if (stages.some((stage) => stage.key === typedKey))
                continue;
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
export function parseKitRoutingSettings(data) {
    if (!data || typeof data !== 'object') {
        return cloneRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS);
    }
    const raw = data;
    const franchiseFlow = parseFlow(raw.franchiseFlow, 'franchise', DEFAULT_KIT_ROUTING_SETTINGS.franchiseFlow);
    const hqFlow = parseFlow(raw.hqFlow, 'hq', DEFAULT_KIT_ROUTING_SETTINGS.hqFlow);
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
    return { franchiseFlow, hqFlow, updatedAt };
}
export function cloneRoutingSettings(settings) {
    return {
        franchiseFlow: settings.franchiseFlow.map((stage) => ({ ...stage })),
        hqFlow: settings.hqFlow.map((stage) => ({ ...stage })),
        updatedAt: settings.updatedAt ?? null,
    };
}
