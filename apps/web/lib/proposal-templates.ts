import {
  DEFAULT_BRAND_GUIDELINES,
  type BrandGuidelinesState,
} from "@/lib/brand-guidelines";

export type ProposalTemplateKind = "mini" | "detailed" | "quick";

export type ProposalTemplatePageType =
  | "cover"
  | "intro"
  | "about"
  | "contents"
  | "service_overview"
  | "storyboard"
  | "operations"
  | "quote"
  | "estimate"
  | "terms"
  | "custom";

export type ProposalTemplatePageLayout =
  | "hero"
  | "split"
  | "columns"
  | "gallery"
  | "timeline"
  | "table";

export interface ProposalTemplateItem {
  type: "product" | "custom";
  productId?: string;
  name: string;
  price?: number;
  description?: string;
}

export type ProposalTemplateElementType =
  | "text"
  | "placeholder"
  | "image"
  | "shape";

export type ProposalTemplateElementRole =
  | "title"
  | "subtitle"
  | "body"
  | "list"
  | "notes"
  | "custom";

export interface ProposalTemplateElementBase {
  id: string;
  type: ProposalTemplateElementType;
  role?: ProposalTemplateElementRole;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  order: number;
}

export interface ProposalTemplateTextElement
  extends ProposalTemplateElementBase {
  type: "text" | "placeholder";
  content: string;
  fontSize: number;
  fontWeight: "regular" | "medium" | "bold";
  align: "left" | "center" | "right";
  color: string;
  lineHeight: number;
  placeholderToken?: string | null;
}

export interface ProposalTemplateImageElement
  extends ProposalTemplateElementBase {
  type: "image";
  url: string;
  fit: "cover" | "contain";
  borderRadius: number;
}

export interface ProposalTemplateShapeElement
  extends ProposalTemplateElementBase {
  type: "shape";
  shape: "rectangle" | "rounded" | "pill";
  fill: string;
  opacity: number;
  borderRadius: number;
}

export type ProposalTemplateElement =
  | ProposalTemplateTextElement
  | ProposalTemplateImageElement
  | ProposalTemplateShapeElement;

export interface ProposalTemplateCanvasSettings {
  aspectRatio: "16:9" | "4:3";
  backgroundColor?: string | null;
  padding?: number;
}

export interface ProposalTemplatePage {
  id: string;
  type: ProposalTemplatePageType;
  layout: ProposalTemplatePageLayout;
  title: string;
  subtitle?: string;
  body?: string;
  bulletPoints?: string[];
  sections?: string[];
  includeInContents?: boolean;
  productId?: string | null;
  displayMode?: "quote" | "estimate";
  autoContents?: boolean;
  notes?: string;
  elements?: ProposalTemplateElement[];
  canvas?: ProposalTemplateCanvasSettings;
}

export interface ProposalTemplateStyling {
  theme: "modern" | "spotlight" | "classic";
  accentColor: string;
  secondaryColor: string;
  background: "clean" | "gradient" | "texture";
  includePageNumbers: boolean;
}

export interface TemplateProductSummary {
  id: string;
  name: string;
  summary?: string;
  headline?: string;
  storyboardEnabled?: boolean;
  operationsSummary?: string;
  price?: number;
}

export interface TemplatePresetOptions {
  brand: BrandGuidelinesState;
  product?: TemplateProductSummary | null;
}

export interface TemplatePreset {
  pages: ProposalTemplatePage[];
  items: ProposalTemplateItem[];
  notes?: string;
}

export type TemplateLayoutOption = {
  id: ProposalTemplatePageLayout;
  label: string;
  description: string;
};

export type TemplateKindDescriptor = {
  id: ProposalTemplateKind;
  label: string;
  description: string;
};

export type ProposalPlaceholderCategory =
  | "client"
  | "project"
  | "proposal"
  | "financial"
  | "narrative";

export const PROPOSAL_PLACEHOLDER_CATEGORY_LABELS: Record<
  ProposalPlaceholderCategory,
  string
> = {
  client: "Client & organisation",
  project: "Project details",
  proposal: "Proposal metadata",
  financial: "Commercials & pricing",
  narrative: "Story & impact",
};

export interface ProposalPlaceholderToken {
  token: string;
  label: string;
  description: string;
  category: ProposalPlaceholderCategory;
}

export const PROPOSAL_PLACEHOLDER_TOKENS: ProposalPlaceholderToken[] = [
  {
    token: "{{clientName}}",
    label: "Client name",
    description: "Primary client contact that the proposal is addressed to.",
    category: "client",
  },
  {
    token: "{{organisationName}}",
    label: "Organisation name",
    description: "Organisation selected during proposal setup.",
    category: "client",
  },
  {
    token: "{{clientEmail}}",
    label: "Client email",
    description: "Email address used for proposal delivery.",
    category: "client",
  },
  {
    token: "{{projectTitle}}",
    label: "Project title",
    description: "The working project or campaign title.",
    category: "project",
  },
  {
    token: "{{projectSummary}}",
    label: "Project summary",
    description: "Short summary captured during proposal intake.",
    category: "project",
  },
  {
    token: "{{eventDate}}",
    label: "Event date",
    description: "Primary production or event date.",
    category: "project",
  },
  {
    token: "{{projectLocation}}",
    label: "Project location",
    description: "Venue or shoot location confirmed for the proposal.",
    category: "project",
  },
  {
    token: "{{proposalDate}}",
    label: "Proposal date",
    description: "Date the proposal is prepared for the client.",
    category: "proposal",
  },
  {
    token: "{{preparedBy}}",
    label: "Prepared by",
    description: "Staff member responsible for the proposal.",
    category: "proposal",
  },
  {
    token: "{{proposalReference}}",
    label: "Proposal reference",
    description: "Reference number or identifier used internally.",
    category: "proposal",
  },
  {
    token: "{{formattedTotal}}",
    label: "Total investment",
    description: "Formatted proposal total derived from pricing.",
    category: "financial",
  },
  {
    token: "{{depositDueDate}}",
    label: "Deposit due date",
    description: "Due date for deposit based on payment schedule.",
    category: "financial",
  },
  {
    token: "{{marginPercent}}",
    label: "Margin percent",
    description: "Calculated margin for the scoped work.",
    category: "financial",
  },
  {
    token: "{{packageOutcome}}",
    label: "Package outcome",
    description: "Outcome statement defined by the selected product.",
    category: "narrative",
  },
  {
    token: "{{primaryMetric}}",
    label: "Primary metric",
    description: "Key success metric tied to the proposal objectives.",
    category: "narrative",
  },
  {
    token: "{{topClients}}",
    label: "Top clients",
    description: "List of marquee clients for credibility slides.",
    category: "narrative",
  },
];

const createPageId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `page-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

const createElementId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `element-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

const fallbackBrand = DEFAULT_BRAND_GUIDELINES;

const fallbackString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
};

const buildHeroCopy = (brand: BrandGuidelinesState): string => {
  const elevatorPitch = fallbackString(
    brand.voice?.elevatorPitch,
    fallbackBrand.voice.elevatorPitch,
  );
  const tone = fallbackString(
    brand.voice?.tonePrinciples,
    fallbackBrand.voice.tonePrinciples,
  );
  return `${elevatorPitch}\n\nTone: ${tone}`.trim();
};

const buildAboutCopy = (brand: BrandGuidelinesState): string => {
  const principles = fallbackString(
    brand.voice?.voicePrinciples,
    fallbackBrand.voice.voicePrinciples,
  );
  const imagery = fallbackString(
    brand.imagery?.notes,
    fallbackBrand.imagery.notes,
  );
  return `${principles}\n\nImagery: ${imagery}`.trim();
};

const defaultCanvasSettings = (
  canvas?: ProposalTemplateCanvasSettings | null,
): ProposalTemplateCanvasSettings => ({
  aspectRatio: canvas?.aspectRatio ?? "16:9",
  backgroundColor: canvas?.backgroundColor ?? null,
  padding: canvas?.padding ?? 8,
});

const normaliseElementBase = <T extends ProposalTemplateElement>(
  element: T,
  index: number,
): T => {
  const base = {
    ...element,
    id: element.id || createElementId(),
    order: element.order ?? index,
    x: element.x ?? 10,
    y: element.y ?? 12 + index * 14,
    width: element.width ?? 80,
    height: element.height ?? 12,
    rotation: element.rotation ?? 0,
  } as ProposalTemplateElement;

  if (base.type === "image") {
    const image = element as ProposalTemplateImageElement;
    return {
      ...(base as ProposalTemplateImageElement),
      type: "image",
      url: image.url || "",
      fit: image.fit || "cover",
      borderRadius: image.borderRadius ?? 0,
    } as T;
  }

  if (base.type === "shape") {
    const shape = element as ProposalTemplateShapeElement;
    return {
      ...(base as ProposalTemplateShapeElement),
      type: "shape",
      shape: shape.shape || "rectangle",
      fill: shape.fill || "#E5E7EB",
      opacity: shape.opacity ?? 1,
      borderRadius: shape.borderRadius ?? 0,
    } as T;
  }

  const typed = element as ProposalTemplateTextElement;
  const role = typed.role;
  const fontSize =
    typed.fontSize ??
    (role === "title"
      ? 42
      : role === "subtitle"
        ? 26
        : role === "notes"
          ? 14
          : 18);
  const fontWeight =
    typed.fontWeight ?? (role === "title" ? "bold" : role === "subtitle" ? "medium" : "regular");
  const align = typed.align ?? (role === "title" ? "center" : "left");

  return {
    ...(base as ProposalTemplateTextElement),
    type: typed.type || "text",
    content: typed.content ?? typed.placeholderToken ?? "",
    fontSize,
    fontWeight,
    align,
    color: typed.color || "#111827",
    lineHeight: typed.lineHeight ?? 1.4,
    placeholderToken:
      typed.placeholderToken ?? (typed.type === "placeholder" ? "{{clientName}}" : null),
  } as T;
};

const createTextElement = (
  content: string,
  overrides: Partial<ProposalTemplateTextElement> = {},
): ProposalTemplateTextElement =>
  normaliseElementBase<ProposalTemplateTextElement>(
    {
      id: createElementId(),
      type: overrides.type ?? "text",
      content,
      fontSize: overrides.fontSize ?? 28,
      fontWeight: overrides.fontWeight ?? "regular",
      align: overrides.align ?? "left",
      color: overrides.color ?? "#111827",
      lineHeight: overrides.lineHeight ?? 1.4,
      placeholderToken: overrides.placeholderToken ?? null,
      role: overrides.role,
      x: overrides.x ?? 10,
      y: overrides.y ?? 18,
      width: overrides.width ?? 80,
      height: overrides.height ?? 12,
      rotation: overrides.rotation ?? 0,
      order: overrides.order ?? 0,
    },
    overrides.order ?? 0,
  );

export const ensurePageElements = (
  page: ProposalTemplatePage,
  options?: { brand?: BrandGuidelinesState },
): ProposalTemplatePage => {
  const accent =
    options?.brand?.colors?.secondary ?? fallbackBrand.colors.secondary ?? "#111827";

  if (Array.isArray(page.elements) && page.elements.length > 0) {
    const normalised = page.elements.map((element, index) =>
      normaliseElementBase(element, index),
    );
    return {
      ...page,
      elements: normalised,
      canvas: defaultCanvasSettings(page.canvas),
    };
  }

  const elements: ProposalTemplateElement[] = [];

  if (page.title) {
    elements.push(
      createTextElement(page.title, {
        role: "title",
        align: "center",
        fontSize: 44,
        fontWeight: "bold",
        color: accent,
        y: 18,
        width: 80,
        x: 10,
        order: 0,
      }),
    );
  }

  if (page.subtitle) {
    elements.push(
      createTextElement(page.subtitle, {
        role: "subtitle",
        align: "center",
        fontSize: 26,
        fontWeight: "medium",
        color: "#1F2937",
        y: page.title ? 34 : 22,
        width: 80,
        x: 10,
        order: elements.length,
      }),
    );
  }

  if (page.body) {
    elements.push(
      createTextElement(page.body, {
        role: "body",
        align: "left",
        fontSize: 18,
        color: "#111827",
        y: elements.length ? elements[elements.length - 1].y + 12 : 32,
        width: 80,
        x: 10,
        order: elements.length,
      }),
    );
  }

  if (Array.isArray(page.sections) && page.sections.length > 0) {
    elements.push(
      createTextElement(page.sections.join("\n"), {
        role: "list",
        align: "left",
        fontSize: 18,
        color: "#111827",
        y: elements.length ? elements[elements.length - 1].y + 14 : 40,
        width: 80,
        x: 10,
        order: elements.length,
      }),
    );
  }

  return {
    ...page,
    elements,
    canvas: defaultCanvasSettings(page.canvas),
  };
};

export const syncPageFieldsFromElements = (
  page: ProposalTemplatePage,
): ProposalTemplatePage => {
  if (!Array.isArray(page.elements) || page.elements.length === 0) {
    return {
      ...page,
      canvas: defaultCanvasSettings(page.canvas),
    };
  }

  const next = { ...page };
  const getText = (
    role: ProposalTemplateElementRole,
  ): ProposalTemplateTextElement | null => {
    const match = page.elements?.find(
      (element): element is ProposalTemplateTextElement =>
        (element.type === "text" || element.type === "placeholder") &&
        element.role === role,
    );
    return match || null;
  };

  const title = getText("title");
  const subtitle = getText("subtitle");
  const body = getText("body");

  next.title = title?.content?.trim() || next.title || "Untitled page";
  next.subtitle = subtitle?.content?.trim() || undefined;
  next.body = body?.content?.trim() || undefined;

  return {
    ...next,
    elements: page.elements.map((element, index) =>
      normaliseElementBase(element, index),
    ),
    canvas: defaultCanvasSettings(page.canvas),
  };
};

function createBasePage(
  type: ProposalTemplatePageType,
  overrides: Partial<ProposalTemplatePage>,
): ProposalTemplatePage {
  return ensurePageElements({
    id: createPageId(),
    type,
    layout: "hero",
    title: "Untitled page",
    includeInContents: type !== "cover",
    canvas: {
      aspectRatio: "16:9",
      padding: 8,
    },
    ...overrides,
  });
}

export const TEMPLATE_LAYOUT_OPTIONS: TemplateLayoutOption[] = [
  {
    id: "hero",
    label: "Hero statement",
    description: "Full-bleed hero with centred copy and supporting notes.",
  },
  {
    id: "split",
    label: "Split highlight",
    description: "Two-column layout ideal for service highlights and benefits.",
  },
  {
    id: "columns",
    label: "Columns",
    description: "Three-column overview for quick stats or team introductions.",
  },
  {
    id: "gallery",
    label: "Storyboard",
    description: "Storyboard or visual gallery with captions and sequencing.",
  },
  {
    id: "timeline",
    label: "Operations timeline",
    description: "Timeline layout outlining production milestones and logistics.",
  },
  {
    id: "table",
    label: "Quote / estimate",
    description: "Table layout tailored for quote or estimate breakdowns.",
  },
];

export const TEMPLATE_KINDS: TemplateKindDescriptor[] = [
  {
    id: "mini",
    label: "Mini (3-page)",
    description:
      "Rapid-fire proposal with a cover, capabilities snapshot, and pricing page.",
  },
  {
    id: "detailed",
    label: "Detailed",
    description:
      "Comprehensive storytelling with contents, storyboard, operations, and pricing.",
  },
  {
    id: "quick",
    label: "Quick product-led",
    description:
      "Start from a product, then tailor copy and pricing for fast turnarounds.",
  },
];

export const PAGE_TYPE_LABELS: Record<ProposalTemplatePageType, string> = {
  cover: "Cover",
  intro: "Introduction",
  about: "About us",
  contents: "Contents",
  service_overview: "Service overview",
  storyboard: "Storyboard",
  operations: "Operations",
  quote: "Quote",
  estimate: "Estimate",
  terms: "Terms & conditions",
  custom: "Custom",
};

const defaultLayoutForType = (
  type: ProposalTemplatePageType,
): ProposalTemplatePageLayout => {
  switch (type) {
    case "cover":
    case "intro":
      return "hero";
    case "about":
    case "service_overview":
      return "split";
    case "storyboard":
      return "gallery";
    case "operations":
      return "timeline";
    case "quote":
    case "estimate":
    case "terms":
      return "table";
    default:
      return "columns";
  }
};

export const createBlankPage = (
  type: ProposalTemplatePageType,
  brand: BrandGuidelinesState,
  product?: TemplateProductSummary | null,
): ProposalTemplatePage => {
  const layout = defaultLayoutForType(type);
  let base: ProposalTemplatePage;
  switch (type) {
    case "cover":
      base = createBasePage(type, {
        layout,
        title: product?.name || "Proposal",
        subtitle: fallbackString(
          brand.voice?.elevatorPitch,
          fallbackBrand.voice.elevatorPitch,
        ),
        includeInContents: false,
      });
      break;
    case "intro":
      base = createBasePage(type, {
        layout,
        title: "Project vision",
        body: buildHeroCopy(brand),
      });
      break;
    case "about":
      base = createBasePage(type, {
        layout,
        title: "Why Pineapple Tapped",
        body: buildAboutCopy(brand),
      });
      break;
    case "contents":
      base = createBasePage(type, {
        layout: "columns",
        title: "Contents",
        body: "Auto-generated list of sections",
        autoContents: true,
      });
      break;
    case "service_overview":
      base = createBasePage(type, {
        layout,
        title: product?.name || "Service overview",
        subtitle: fallbackString(product?.summary, "Key outcomes"),
        sections: ["overview"],
      });
      break;
    case "storyboard":
      base = createBasePage(type, {
        layout,
        title: "Storyboard",
        subtitle: "Scene-by-scene breakdown",
        sections: ["storyboard"],
      });
      break;
    case "operations":
      base = createBasePage(type, {
        layout,
        title: "Operations & logistics",
        subtitle: fallbackString(
          product?.operationsSummary,
          "Capture schedule, crew call, and responsibilities",
        ),
        sections: ["operations"],
      });
      break;
    case "quote":
    case "estimate":
      base = createBasePage(type, {
        layout,
        title: type === "quote" ? "Investment" : "Estimate",
        displayMode: type,
      });
      break;
    case "terms":
      base = createBasePage(type, {
        layout,
        title: "Terms & Conditions",
        includeInContents: true,
      });
      break;
    default:
      base = createBasePage(type, {
        layout,
        title: "Custom page",
      });
      break;
  }

  return ensurePageElements(base, { brand });
};

export const defaultTemplateStyling = (
  brand: BrandGuidelinesState,
): ProposalTemplateStyling => ({
  theme: "modern",
  accentColor: fallbackString(
    brand.colors?.secondary,
    fallbackBrand.colors.secondary,
  ),
  secondaryColor: fallbackString(
    brand.colors?.accent,
    fallbackBrand.colors.accent,
  ),
  background: "clean",
  includePageNumbers: true,
});

export const summarisePageForContents = (
  page: ProposalTemplatePage,
): string => {
  const title = fallbackString(page.title, PAGE_TYPE_LABELS[page.type]);
  const subtitle = fallbackString(page.subtitle);
  if (subtitle) {
    return `${title} — ${subtitle}`;
  }
  return title;
};

const createMiniPreset = (
  options: TemplatePresetOptions,
): TemplatePreset => {
  const { brand, product } = options;
  return {
    pages: [
      createBlankPage("cover", brand, product),
      createBlankPage("about", brand, product),
      createBlankPage("quote", brand, product),
    ],
    items: product
      ? [
          {
            type: "product",
            productId: product.id,
            name: product.name,
            price: product.price,
            description: product.summary,
          },
        ]
      : [],
  };
};

const createDetailedPreset = (
  options: TemplatePresetOptions,
): TemplatePreset => {
  const { brand, product } = options;
  return {
    pages: [
      createBlankPage("cover", brand, product),
      createBlankPage("intro", brand, product),
      createBlankPage("about", brand, product),
      createBlankPage("contents", brand, product),
      createBlankPage("service_overview", brand, product),
      createBlankPage("storyboard", brand, product),
      createBlankPage("operations", brand, product),
      createBlankPage("quote", brand, product),
      createBlankPage("terms", brand, product),
    ],
    items: product
      ? [
          {
            type: "product",
            productId: product.id,
            name: product.name,
            price: product.price,
            description: product.summary,
          },
        ]
      : [],
  };
};

const createQuickPreset = (
  options: TemplatePresetOptions,
): TemplatePreset => {
  const { brand, product } = options;
  return {
    pages: [
      createBlankPage("cover", brand, product),
      createBlankPage("contents", brand, product),
      createBlankPage("service_overview", brand, product),
      createBlankPage("quote", brand, product),
    ],
    items: product
      ? [
          {
            type: "product",
            productId: product.id,
            name: product.name,
            price: product.price,
            description: product.summary,
          },
        ]
      : [],
  };
};

export const createTemplatePreset = (
  kind: ProposalTemplateKind,
  options: TemplatePresetOptions,
): TemplatePreset => {
  switch (kind) {
    case "mini":
      return createMiniPreset(options);
    case "quick":
      return createQuickPreset(options);
    case "detailed":
    default:
      return createDetailedPreset(options);
  }
};

export const allowedTemplateKinds: ProposalTemplateKind[] = [
  "mini",
  "detailed",
  "quick",
];

export const allowedPageTypes: ProposalTemplatePageType[] = [
  "cover",
  "intro",
  "about",
  "contents",
  "service_overview",
  "storyboard",
  "operations",
  "quote",
  "estimate",
  "terms",
  "custom",
];

export const allowedLayouts: ProposalTemplatePageLayout[] = [
  "hero",
  "split",
  "columns",
  "gallery",
  "timeline",
  "table",
];

export const PAGE_LIBRARY: {
  type: ProposalTemplatePageType;
  label: string;
  description: string;
}[] = [
  {
    type: "cover",
    label: "Cover",
    description: "Branded cover featuring hero copy and proposal title.",
  },
  {
    type: "intro",
    label: "Introduction",
    description: "Scene-setting overview that frames the project vision.",
  },
  {
    type: "about",
    label: "About us",
    description: "Share credentials, differentiators, and the Pineapple Tapped approach.",
  },
  {
    type: "contents",
    label: "Contents",
    description: "Automatically generates a table of contents from the pages below.",
  },
  {
    type: "service_overview",
    label: "Service overview",
    description: "Product or service summary with outcomes and inclusions.",
  },
  {
    type: "storyboard",
    label: "Storyboard",
    description: "Visualise the production plan, camera moves, and creative narrative.",
  },
  {
    type: "operations",
    label: "Operations",
    description: "Outline logistics, crew roles, and the delivery schedule.",
  },
  {
    type: "quote",
    label: "Quote",
    description: "Formal quote with line items, totals, and signature blocks.",
  },
  {
    type: "estimate",
    label: "Estimate",
    description: "Flexible estimate layout before final pricing is confirmed.",
  },
  {
    type: "terms",
    label: "Terms",
    description: "Attach policies & agreements that govern the engagement.",
  },
  {
    type: "custom",
    label: "Custom page",
    description: "Blank canvas for testimonials, case studies, or bespoke content.",
  },
];

