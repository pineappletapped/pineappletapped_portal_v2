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

const createPageId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `page-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;

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

const createBasePage = (
  type: ProposalTemplatePageType,
  overrides: Partial<ProposalTemplatePage>,
): ProposalTemplatePage => ({
  id: createPageId(),
  type,
  layout: "hero",
  title: "Untitled page",
  includeInContents: type !== "cover",
  ...overrides,
});

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
  switch (type) {
    case "cover":
      return createBasePage(type, {
        layout,
        title: product?.name || "Proposal",
        subtitle: fallbackString(
          brand.voice?.elevatorPitch,
          fallbackBrand.voice.elevatorPitch,
        ),
        includeInContents: false,
      });
    case "intro":
      return createBasePage(type, {
        layout,
        title: "Project vision",
        body: buildHeroCopy(brand),
      });
    case "about":
      return createBasePage(type, {
        layout,
        title: "Why Pineapple Tapped",
        body: buildAboutCopy(brand),
      });
    case "contents":
      return createBasePage(type, {
        layout: "columns",
        title: "Contents",
        body: "Auto-generated list of sections",
        autoContents: true,
      });
    case "service_overview":
      return createBasePage(type, {
        layout,
        title: product?.name || "Service overview",
        subtitle: fallbackString(product?.summary, "Key outcomes"),
        sections: ["overview"],
      });
    case "storyboard":
      return createBasePage(type, {
        layout,
        title: "Storyboard",
        subtitle: "Scene-by-scene breakdown",
        sections: ["storyboard"],
      });
    case "operations":
      return createBasePage(type, {
        layout,
        title: "Operations & logistics",
        subtitle: fallbackString(
          product?.operationsSummary,
          "Capture schedule, crew call, and responsibilities",
        ),
        sections: ["operations"],
      });
    case "quote":
    case "estimate":
      return createBasePage(type, {
        layout,
        title: type === "quote" ? "Investment" : "Estimate",
        displayMode: type,
      });
    case "terms":
      return createBasePage(type, {
        layout,
        title: "Terms & Conditions",
        includeInContents: true,
      });
    default:
      return createBasePage(type, {
        layout,
        title: "Custom page",
      });
  }
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

