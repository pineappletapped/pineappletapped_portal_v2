export type RiskDocumentKind = "risk-assessment" | "operating-procedure";
export type RiskDocumentAudience = "hq" | "franchisee" | "team" | "client";
export type RiskDocumentStatus = "current" | "in-review" | "archived";

export interface RiskDocumentLink {
  label: string;
  url: string;
}

export interface RiskDocumentProductOption {
  id: string;
  name: string;
  category: string;
  focus: string;
  summary: string;
}

export interface RiskDocumentProjectOption {
  id: string;
  name: string;
  reference: string;
  client: string;
  productIds: string[];
  notes?: string;
}

interface RiskDocumentCore {
  id: string;
  title: string;
  kind: RiskDocumentKind;
  task: string;
  summary: string;
  hazards: string[];
  controls: string[];
  documentUrl: string;
  lastReviewedOn: string;
  owner: "hq" | "franchisee";
  status: RiskDocumentStatus;
  version?: string | null;
  visibleTo: RiskDocumentAudience[];
}

export interface GenericRiskDocument extends RiskDocumentCore {
  type: "generic";
  productIds: string[];
  categories: string[];
  attachments?: RiskDocumentLink[];
}

export interface CustomRiskDocument extends RiskDocumentCore {
  type: "custom";
  projectKeys: string[];
  projectName: string;
  linkedProductIds: string[];
}

export type RiskDocumentRecord = GenericRiskDocument | CustomRiskDocument;

export interface ResolvedRiskDocument extends RiskDocumentCore {
  type: "generic" | "custom";
  productIds: string[];
  categories: string[];
  attachments?: RiskDocumentLink[];
  projectName?: string;
  projectKeys?: string[];
  linkedProductIds?: string[];
  appliesToProducts: { id: string; name: string }[];
  audienceNotes: string | null;
}

export const RISK_DOCUMENT_KIND_LABELS: Record<RiskDocumentKind, string> = {
  "risk-assessment": "Risk assessment",
  "operating-procedure": "Operating procedure",
};

export const RISK_DOCUMENT_AUDIENCE_LABELS: Record<RiskDocumentAudience, string> = {
  hq: "HQ",
  franchisee: "Franchisees",
  team: "Team members",
  client: "Clients",
};

const RISK_PRODUCT_OPTIONS: RiskDocumentProductOption[] = [
  {
    id: "brand-film-shoot",
    name: "Brand film shoot",
    category: "videography",
    focus: "On-location filming with lighting and audio crew",
    summary:
      "Full service crew with lighting, audio, and directing support for a brand storytelling film.",
  },
  {
    id: "studio-highlights",
    name: "Studio highlights package",
    category: "studio",
    focus: "Studio-based filming with controlled lighting",
    summary:
      "Half-day studio highlights session capturing talking-head content and B-roll.",
  },
  {
    id: "drone-upgrade",
    name: "Drone capture add-on",
    category: "drone",
    focus: "CAA-licensed aerial filming on commercial sites",
    summary:
      "Adds licensed drone operator coverage with pre-flight planning, marshals, and permissions handling.",
  },
  {
    id: "event-live-stream",
    name: "Event live stream",
    category: "live-event",
    focus: "Multi-camera live streaming for conferences and launches",
    summary:
      "Live streaming production with redundant encoders, crew, and show caller support.",
  },
];

const RISK_PROJECT_OPTIONS: RiskDocumentProjectOption[] = [
  {
    id: "proj-alpha-launch",
    name: "Alpha launch campaign",
    reference: "PTFB-2025-001",
    client: "Alpha Fitness",
    productIds: ["brand-film-shoot", "drone-upgrade"],
    notes: "Hybrid HQ and franchise collaboration to relaunch the Alpha Fitness brand.",
  },
  {
    id: "proj-harbour-marina",
    name: "Harbour drone launch",
    reference: "PTFB-2025-002",
    client: "Harbour Developments",
    productIds: ["drone-upgrade"],
    notes: "Bespoke drone capture over water with harbour master supervision.",
  },
  {
    id: "proj-conference-live",
    name: "Summit live stream",
    reference: "PTFB-2025-003",
    client: "Summit Partners",
    productIds: ["event-live-stream", "studio-highlights"],
    notes: "Two-day conference live stream with studio add-on for speaker promos.",
  },
];

const GENERIC_RISK_LIBRARY: readonly GenericRiskDocument[] = [
  {
    id: "generic-brand-film-risk",
    type: "generic",
    title: "Brand film on-location RAMS",
    kind: "risk-assessment",
    task: "On-location brand filming",
    summary:
      "Assesses hazards for on-location brand filming including cable routing, lighting rigs, and working around the public.",
    hazards: [
      "Trip hazards from cable runs and lighting stands",
      "Manual handling of heavy camera and lighting kit",
      "Filming in mixed public / crew environments",
    ],
    controls: [
      "Deploy cable ramps, mats, and signage to protect walkways",
      "Brief two-person lifts for lighting and camera cases",
      "Use cones and a client liaison to manage any public interactions",
    ],
    documentUrl: "https://example.com/risk-brand-film.pdf",
    lastReviewedOn: "2025-01-12",
    owner: "hq",
    status: "current",
    version: "v2.3",
    visibleTo: ["hq", "franchisee", "team", "client"],
    productIds: ["brand-film-shoot", "cinematic-package"],
    categories: ["videography", "brand-film"],
    attachments: [
      {
        label: "RAMS PDF",
        url: "https://example.com/rams-brand-film.pdf",
      },
    ],
  },
  {
    id: "generic-studio-sop",
    type: "generic",
    title: "Studio day operating procedure",
    kind: "operating-procedure",
    task: "Studio highlights filming",
    summary:
      "Standard operating steps for running a Pineapple Tapped studio highlight day covering crew roles and client preparation.",
    hazards: [
      "Heat build-up from continuous lighting",
      "Electrical overloads from multiple fixtures",
      "Crew fatigue across back-to-back takes",
    ],
    controls: [
      "Schedule ventilation breaks every 45 minutes",
      "Load-balance fixtures across separate circuits",
      "Rotate camera ops and schedule hydration reminders",
    ],
    documentUrl: "https://example.com/sop-studio-day.pdf",
    lastReviewedOn: "2024-12-04",
    owner: "hq",
    status: "current",
    version: "v1.8",
    visibleTo: ["hq", "franchisee", "team", "client"],
    productIds: ["studio-highlights"],
    categories: ["studio"],
  },
  {
    id: "generic-drone-method-statement",
    type: "generic",
    title: "Drone deployment method statement",
    kind: "operating-procedure",
    task: "Aerial capture planning",
    summary:
      "Step-by-step method for planning, briefing, and executing CAA-compliant drone flights across the UK network.",
    hazards: [
      "Uncontrolled launch / landing zones",
      "Weather deterioration mid-flight",
      "RF interference near industrial estates",
    ],
    controls: [
      "Establish a 30m sterile launch area with marshals",
      "Monitor METAR updates and set wind speed abort thresholds",
      "Scan for radio interference and brief contingency landings",
    ],
    documentUrl: "https://example.com/drone-method-statement.pdf",
    lastReviewedOn: "2025-02-01",
    owner: "hq",
    status: "current",
    version: "v3.1",
    visibleTo: ["hq", "franchisee", "team"],
    productIds: ["drone-upgrade"],
    categories: ["drone"],
  },
];

const CUSTOM_RISK_LIBRARY: readonly CustomRiskDocument[] = [
  {
    id: "custom-alpha-launch",
    type: "custom",
    title: "Alpha Fitness flagship store RAMS",
    kind: "risk-assessment",
    task: "Retail store brand film",
    summary:
      "Site-specific RAMS capturing overnight store access, client staff briefings, and public diversion plan for Alpha Fitness.",
    hazards: [
      "Filming after hours with limited building staff",
      "Public exposure when filming exterior hero shots",
      "Shared working at height for overhead slider rig",
    ],
    controls: [
      "Coordinate lone-worker check-ins with Alpha HQ every 60 minutes",
      "Deploy cones and signage across pavement filming zones",
      "Use mobile scaffold with guard rails for elevated slider work",
    ],
    documentUrl: "https://example.com/risk-alpha-launch.pdf",
    lastReviewedOn: "2025-02-06",
    owner: "hq",
    status: "current",
    version: "v1.2",
    visibleTo: ["hq", "franchisee", "team", "client"],
    projectKeys: ["proj-alpha-launch", "ptfb-2025-001", "alpha launch campaign"],
    projectName: "Alpha launch campaign",
    linkedProductIds: ["brand-film-shoot", "drone-upgrade"],
  },
  {
    id: "custom-harbour-drone",
    type: "custom",
    title: "Milton Keynes marina drone RAMS",
    kind: "risk-assessment",
    task: "Over-water drone capture",
    summary:
      "Franchise-authored RAMS for marina aerial filming including harbour master liaison and rescue plans.",
    hazards: [
      "Drone recovery over open water",
      "Crowd gathering on marina balconies",
      "Bird strike risk from nesting gulls",
    ],
    controls: [
      "Deploy life jackets and rescue throw line for pilot and observer",
      "Assign marshals to restrict balcony spectator access",
      "Schedule flights outside of peak feeding times and brief wildlife spotter",
    ],
    documentUrl: "https://example.com/risk-harbour-drone.pdf",
    lastReviewedOn: "2025-01-28",
    owner: "franchisee",
    status: "current",
    version: "v1.0",
    visibleTo: ["hq", "franchisee", "team", "client"],
    projectKeys: ["proj-harbour-marina", "ptfb-2025-002", "harbour drone launch"],
    projectName: "Harbour drone launch",
    linkedProductIds: ["drone-upgrade"],
  },
  {
    id: "custom-summit-stream-sop",
    type: "custom",
    title: "Summit live stream show-caller SOP",
    kind: "operating-procedure",
    task: "Conference live streaming",
    summary:
      "Live event run-of-show procedure covering redundant encoders, comms checks, and presenter cueing for the Summit conference.",
    hazards: [
      "Slip hazards from fibre and SDI cabling across gangways",
      "Overheating of primary encoder rack",
      "Cueing errors when switching between remote presenters",
    ],
    controls: [
      "Route fibre under cable ramps with glow tape edges",
      "Deploy backup fan units and temperature monitoring",
      "Use producer + show caller double confirmation on comms for every cue",
    ],
    documentUrl: "https://example.com/sop-summit-livestream.pdf",
    lastReviewedOn: "2025-02-10",
    owner: "hq",
    status: "in-review",
    version: "draft v0.9",
    visibleTo: ["hq", "franchisee", "team"],
    projectKeys: ["proj-conference-live", "ptfb-2025-003", "summit live stream"],
    projectName: "Summit live stream",
    linkedProductIds: ["event-live-stream", "studio-highlights"],
  },
];

function cloneGeneric(doc: GenericRiskDocument): GenericRiskDocument {
  return {
    ...doc,
    hazards: [...doc.hazards],
    controls: [...doc.controls],
    productIds: [...doc.productIds],
    categories: [...doc.categories],
    attachments: doc.attachments ? doc.attachments.map((link) => ({ ...link })) : undefined,
    visibleTo: [...doc.visibleTo],
  };
}

function cloneCustom(doc: CustomRiskDocument): CustomRiskDocument {
  return {
    ...doc,
    hazards: [...doc.hazards],
    controls: [...doc.controls],
    projectKeys: [...doc.projectKeys],
    linkedProductIds: [...doc.linkedProductIds],
    visibleTo: [...doc.visibleTo],
  };
}

const normalise = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};

const slugify = (value: string | null | undefined): string | null => {
  const norm = normalise(value);
  if (!norm) return null;
  return norm
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

function mapProducts(productIds: string[]): { id: string; name: string }[] {
  if (!Array.isArray(productIds)) {
    return [];
  }
  const summaries = productIds
    .map((id) => {
      const option = RISK_PRODUCT_OPTIONS.find((item) => item.id === id);
      if (option) {
        return { id: option.id, name: option.name };
      }
      const label = id.trim();
      if (!label) {
        return null;
      }
      return { id, name: label };
    })
    .filter((entry): entry is { id: string; name: string } => Boolean(entry));

  if (summaries.length > 0) {
    return summaries;
  }

  return [];
}

const parseList = (value: string): string[] =>
  value
    .split(/[\n;,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const fallbackList = (list: string[], fallback: string): string[] =>
  list.length > 0 ? list : [fallback];

export function createGenericRiskDocumentsSample(): GenericRiskDocument[] {
  return GENERIC_RISK_LIBRARY.map(cloneGeneric);
}

export function createCustomRiskDocumentsSample(): CustomRiskDocument[] {
  return CUSTOM_RISK_LIBRARY.map(cloneCustom);
}

export function getRiskProductOptions(): RiskDocumentProductOption[] {
  return RISK_PRODUCT_OPTIONS.map((option) => ({ ...option }));
}

export function getRiskProjectOptions(): RiskDocumentProjectOption[] {
  return RISK_PROJECT_OPTIONS.map((option) => ({ ...option, productIds: [...option.productIds] }));
}

export interface ResolveRiskDocumentsForProjectInput {
  projectId?: string | null;
  projectName?: string | null;
  projectReference?: string | null;
  productIds?: string[];
  categories?: string[];
  audience: RiskDocumentAudience;
  genericLibrary: GenericRiskDocument[];
  customLibrary: CustomRiskDocument[];
}

const computeProjectKeys = (
  projectId?: string | null,
  projectName?: string | null,
  projectReference?: string | null
): Set<string> => {
  const keys = new Set<string>();
  const idKey = normalise(projectId);
  if (idKey) {
    keys.add(idKey);
  }
  const refKey = normalise(projectReference);
  if (refKey) {
    keys.add(refKey);
  }
  const nameKey = normalise(projectName);
  if (nameKey) {
    keys.add(nameKey);
  }
  const slugKey = slugify(projectName);
  if (slugKey) {
    keys.add(slugKey);
  }
  return keys;
};

const parseDate = (value: string | null | undefined): number => {
  if (!value) return 0;
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
};

export function resolveRiskDocumentsForProject({
  projectId,
  projectName,
  projectReference,
  productIds = [],
  categories = [],
  audience,
  genericLibrary,
  customLibrary,
}: ResolveRiskDocumentsForProjectInput): ResolvedRiskDocument[] {
  const productSet = new Set<string>(
    productIds
      .map((id) => normalise(id))
      .filter((id): id is string => Boolean(id))
  );
  const categorySet = new Set<string>(
    categories
      .map((value) => normalise(value))
      .filter((value): value is string => Boolean(value))
  );
  const projectKeys = computeProjectKeys(projectId ?? null, projectName ?? null, projectReference ?? null);

  const genericMatches: ResolvedRiskDocument[] = genericLibrary
    .filter((doc) => doc.visibleTo.includes(audience))
    .filter((doc) => {
      const hasProductMatch = doc.productIds.some((id) => productSet.has(normalise(id) ?? ""));
      const hasCategoryMatch = doc.categories.some((category) => categorySet.has(normalise(category) ?? ""));
      return hasProductMatch || hasCategoryMatch;
    })
    .map((doc) => {
      const appliesTo = mapProducts(doc.productIds);
      const audienceNotes = doc.visibleTo.includes("client")
        ? "Shared automatically with the client when they purchase the linked products."
        : doc.visibleTo.includes("team")
          ? "Visible to crew inside the delivery workspace."
          : "HQ library reference.";
      return {
        ...doc,
        appliesToProducts: appliesTo,
        projectName: undefined,
        projectKeys: undefined,
        linkedProductIds: undefined,
        audienceNotes,
      } satisfies ResolvedRiskDocument;
    });

  const customMatches: ResolvedRiskDocument[] = customLibrary
    .filter((doc) => doc.visibleTo.includes(audience))
    .filter((doc) => {
      if (projectKeys.size === 0) {
        return false;
      }
      return doc.projectKeys.some((key) => {
        const normalised = normalise(key);
        return normalised ? projectKeys.has(normalised) : false;
      });
    })
    .map((doc) => {
      const appliesTo = mapProducts(doc.linkedProductIds);
      const audienceNotes = doc.owner === "franchisee"
        ? "Authored by the franchise team for this bespoke project."
        : "Issued centrally for this project.";
      return {
        ...doc,
        productIds: [...doc.linkedProductIds],
        categories: Array.from(
          new Set(
            doc.linkedProductIds
              .map((id) => {
                const option = RISK_PRODUCT_OPTIONS.find((item) => item.id === id);
                return option ? option.category : null;
              })
              .filter((value): value is string => Boolean(value))
          )
        ),
        appliesToProducts: appliesTo,
        audienceNotes,
      } satisfies ResolvedRiskDocument;
    });

  return [...genericMatches, ...customMatches].sort((a, b) => parseDate(b.lastReviewedOn) - parseDate(a.lastReviewedOn));
}

export interface CreateRiskDocumentInput {
  type: "generic" | "custom";
  title: string;
  kind: RiskDocumentKind;
  task: string;
  summary: string;
  hazards: string;
  controls: string;
  documentUrl: string;
  lastReviewedOn: string;
  owner: "hq" | "franchisee";
  visibleTo: RiskDocumentAudience[];
  productIds?: string[];
  categories?: string[];
  projectKeys?: string[];
  projectName?: string;
  linkedProductIds?: string[];
}

export function buildGenericRiskDocument(id: string, input: CreateRiskDocumentInput): GenericRiskDocument {
  const productIds = input.productIds ? [...input.productIds] : [];
  const categoryIds = input.categories && input.categories.length > 0
    ? [...new Set(input.categories)]
    : productIds
        .map((pid) => {
          const option = RISK_PRODUCT_OPTIONS.find((item) => item.id === pid);
          return option ? option.category : null;
        })
        .filter((value): value is string => Boolean(value));
  const hazards = fallbackList(parseList(input.hazards), "Hazard assessment pending");
  const controls = fallbackList(parseList(input.controls), "Control plan pending");

  return {
    id,
    type: "generic",
    title: input.title,
    kind: input.kind,
    task: input.task,
    summary: input.summary,
    hazards,
    controls,
    documentUrl: input.documentUrl,
    lastReviewedOn: input.lastReviewedOn,
    owner: input.owner,
    status: "current",
    visibleTo: [...new Set<RiskDocumentAudience>(["hq", ...input.visibleTo])],
    productIds,
    categories: categoryIds.length > 0 ? categoryIds : ["general"],
  };
}

export function buildCustomRiskDocument(id: string, input: CreateRiskDocumentInput): CustomRiskDocument {
  const productIds = input.linkedProductIds ? [...input.linkedProductIds] : [];
  const projectKeys = input.projectKeys
    ? [...new Set(input.projectKeys.map((key) => key.trim()).filter((key) => key.length > 0))]
    : [];
  const hazards = fallbackList(parseList(input.hazards), "Hazard assessment pending");
  const controls = fallbackList(parseList(input.controls), "Control plan pending");

  const derivedProjectKeys = new Set<string>(projectKeys);
  const idKey = normalise(input.projectName);
  if (idKey) {
    derivedProjectKeys.add(idKey);
  }
  const slugKey = slugify(input.projectName);
  if (slugKey) {
    derivedProjectKeys.add(slugKey);
  }

  return {
    id,
    type: "custom",
    title: input.title,
    kind: input.kind,
    task: input.task,
    summary: input.summary,
    hazards,
    controls,
    documentUrl: input.documentUrl,
    lastReviewedOn: input.lastReviewedOn,
    owner: input.owner,
    status: "current",
    visibleTo: [...new Set<RiskDocumentAudience>(["hq", ...input.visibleTo])],
    projectKeys: Array.from(derivedProjectKeys),
    projectName: input.projectName ?? "Project",
    linkedProductIds: productIds,
  };
}

