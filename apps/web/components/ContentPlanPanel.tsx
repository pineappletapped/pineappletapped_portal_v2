
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, where, type DocumentData } from "firebase/firestore";
import { type User } from "firebase/auth";

import { auth, db } from "@/lib/firebase";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const QUARTER_BY_MONTH: Record<string, string> = {
  January: "Q1",
  February: "Q1",
  March: "Q1",
  April: "Q2",
  May: "Q2",
  June: "Q2",
  July: "Q3",
  August: "Q3",
  September: "Q3",
  October: "Q4",
  November: "Q4",
  December: "Q4",
};

type PlanRow = {
  id: string;
  month: string;
  theme: string;
  goals: string;
  productLaunches: string;
  keyEvents: string;
  deliverables: string;
  budget: string;
  budgetMin: string;
  budgetMax: string;
  priority: "awareness" | "engagement" | "conversion" | "mixed";
  productIds: string[];
  templateId?: string | null;
};

type ContentPlanTemplate = {
  id: string;
  label: string;
  deliverables: string;
  budget: string;
  priority: PlanRow["priority"];
  productIds: string[];
  aiPrompt?: string | null;
};

type ProductSummary = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  priceMin: number | null;
  priceMax: number | null;
  tags: string[];
};

type CustomIdeaRequest = {
  id: string;
  rowId: string | null;
  status: string;
  note: string | null;
  adminNotes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  templateId: string | null;
  month?: string;
  theme?: string;
  goals?: string | null;
  productLaunches?: string | null;
  keyEvents?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  suggestedProduct?: {
    id: string;
    name: string;
    reason: string | null;
    priceMin?: number | null;
    priceMax?: number | null;
  } | null;
};

type NarrativeDoc = {
  id: string;
  status: string;
  narrative: string | null;
  storyBeats: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
};

type StoryboardDraft = {
  id: string;
  narrative: string;
  sections: Array<{
    id: string;
    title: string;
    summary: string;
    talkingPoints: string[];
  }>;
  timeline: Array<{
    phase: string;
    duration: string;
    tasks: string[];
  }>;
  recommendedItems: Array<{
    id: string;
    name: string;
    priceHint: string | null;
    description: string | null;
  }>;
  requestId?: string | null;
  promptId?: string | null;
  promptName?: string | null;
  modelName?: string | null;
  generationMode?: string | null;
};

type ProductSuggestion = {
  product: ProductSummary;
  reason: string;
  matchedTags: string[];
  priceText: string | null;
};

const MARKETING_PRIORITY_LABELS: Record<PlanRow["priority"], string> = {
  awareness: "Awareness",
  engagement: "Engagement",
  conversion: "Conversion",
  mixed: "Full funnel",
};

const DEFAULT_TEMPLATES: ContentPlanTemplate[] = [
  {
    id: "thought-leadership-blitz",
    label: "Thought leadership blitz",
    deliverables: "2x Blog posts, Webinar deck, Executive LinkedIn kit",
    budget: "4200",
    priority: "awareness",
    productIds: [],
  },
  {
    id: "product-launch-runway",
    label: "Product launch runway",
    deliverables: "Launch video, Landing page copy, Email nurture (3), Paid social set",
    budget: "6100",
    priority: "conversion",
    productIds: [],
  },
  {
    id: "always-on-social-sprints",
    label: "Always-on social sprints",
    deliverables: "4x Reels/TikToks, 12x Social captions, Influencer outreach",
    budget: "3600",
    priority: "engagement",
    productIds: [],
  },
];

const REQUEST_STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  researching: "Researching",
  quoted: "Quote drafted",
  scheduled: "Scheduled",
  completed: "Completed",
  rejected: "Declined",
};

const NARRATIVE_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  analysing: "Analysing",
  ready: "Draft ready",
  failed: "Needs attention",
};

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function parseDeliverables(value: string) {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "$0";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatBudgetRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) {
    return null;
  }
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  });
  if (min !== null && max !== null) {
    if (min === max) {
      return formatter.format(min);
    }
    return `${formatter.format(Math.min(min, max))} – ${formatter.format(Math.max(min, max))}`;
  }
  if (min !== null) {
    return `From ${formatter.format(min)}`;
  }
  return `Up to ${formatter.format(max!)}`;
}

function normaliseKeywordSet(...inputs: string[]): Set<string> {
  const keywords = new Set<string>();
  inputs
    .filter(Boolean)
    .forEach((input) => {
      input
        .toLowerCase()
        .split(/[^a-z0-9+]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1)
        .forEach((token) => keywords.add(token));
    });
  return keywords;
}

function scoreProductAgainstKeywords(product: ProductSummary, keywords: Set<string>) {
  if (keywords.size === 0) {
    return { score: 0, matches: [] as string[] };
  }
  const matches: string[] = [];
  product.tags.forEach((tag) => {
    const token = tag.toLowerCase();
    if (keywords.has(token)) {
      matches.push(tag);
      return;
    }
    token
      .split(/[^a-z0-9+]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 1)
      .forEach((part) => {
        if (keywords.has(part) && !matches.includes(tag)) {
          matches.push(tag);
        }
      });
  });
  const score = matches.length + (product.category && keywords.has(product.category.toLowerCase()) ? 0.5 : 0);
  return { score, matches };
}

function normaliseProductTags(data: Record<string, unknown>): string[] {
  const tagSet = new Set<string>();
  const addTag = (value: unknown) => {
    if (typeof value === "string") {
      value
        .split(/[,/]|\n|\r|\t/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => tagSet.add(entry.toLowerCase()));
      return;
    }
    if (Array.isArray(value)) {
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => tagSet.add(entry.toLowerCase()));
    }
  };

  [
    data.tags,
    data.goalTags,
    data.goals,
    data.focusAreas,
    data.personas,
    data.audience,
    data.keywords,
    data.useCases,
  ].forEach(addTag);

  if (typeof data.category === "string") {
    tagSet.add(data.category.toLowerCase());
  }
  if (typeof data.type === "string") {
    tagSet.add(data.type.toLowerCase());
  }

  return Array.from(tagSet);
}

function normalisePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseBudgetInput(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveAverageBudget(row: Pick<PlanRow, "budget" | "budgetMin" | "budgetMax">): number {
  const min = parseBudgetInput(row.budgetMin);
  const max = parseBudgetInput(row.budgetMax);
  if (min === null && max === null) {
    const fallback = parseBudgetInput(row.budget);
    return fallback ?? 0;
  }
  if (min !== null && max !== null) {
    return (min + max) / 2;
  }
  return (min ?? max ?? 0);
}

function createInitialRows(): PlanRow[] {
  return MONTHS.slice(0, 4).map((month, index) => ({
    id: `${month}-${index}`,
    month,
    theme: "",
    goals: "",
    productLaunches: "",
    keyEvents: "",
    deliverables: "",
    budget: "",
    budgetMin: "",
    budgetMax: "",
    priority: "mixed",
    productIds: [],
    templateId: null,
  }));
}

function normaliseTemplates(value: unknown): ContentPlanTemplate[] {
  if (!Array.isArray(value)) {
    return DEFAULT_TEMPLATES;
  }
  const templates: ContentPlanTemplate[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const data = entry as Record<string, unknown>;
    const id = typeof data.id === "string" && data.id ? data.id : randomId();
    const label = typeof data.label === "string" && data.label.trim() ? data.label.trim() : id;
    const deliverables = typeof data.deliverables === "string" ? data.deliverables : "";
    const budgetValue = data.budget;
    const budget = typeof budgetValue === "number" ? String(budgetValue) : typeof budgetValue === "string" ? budgetValue : "";
    const priorityValue = typeof data.priority === "string" ? data.priority.toLowerCase() : "mixed";
    const priority = (Object.keys(MARKETING_PRIORITY_LABELS) as Array<PlanRow["priority"]>).includes(
      priorityValue as PlanRow["priority"]
    )
      ? (priorityValue as PlanRow["priority"])
      : "mixed";
    const productIds = Array.isArray(data.productIds)
      ? data.productIds.filter((item): item is string => typeof item === "string")
      : [];
    const aiPrompt = typeof data.aiPrompt === "string" ? data.aiPrompt : null;
    templates.push({ id, label, deliverables, budget, priority, productIds, aiPrompt });
  });
  return templates.length > 0 ? templates : DEFAULT_TEMPLATES;
}

function buildRequestStatusLabel(status: string) {
  return REQUEST_STATUS_LABELS[status] || status.replace(/_/g, " ");
}

function buildNarrativeStatusLabel(status: string) {
  return NARRATIVE_STATUS_LABELS[status] || status.replace(/_/g, " ");
}

export default function ContentPlanPanel() {
  const [rows, setRows] = useState<PlanRow[]>(() => createInitialRows());
  const [marketingMix, setMarketingMix] = useState({
    awareness: 40,
    engagement: 35,
    conversion: 25,
  });
  const [templates, setTemplates] = useState<ContentPlanTemplate[]>(DEFAULT_TEMPLATES);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [productPicker, setProductPicker] = useState<Record<string, string>>({});
  const [requestDrafts, setRequestDrafts] = useState<Record<string, string>>({});
  const [requestState, setRequestState] = useState<Record<string, "idle" | "sending" | "success" | "error">>({});
  const [requestErrors, setRequestErrors] = useState<Record<string, string | null>>({});
  const [requestsByRow, setRequestsByRow] = useState<Record<string, CustomIdeaRequest[]>>({});
  const [narrativeStatus, setNarrativeStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  const [narrativeDraft, setNarrativeDraft] = useState<NarrativeDoc | null>(null);
  const [narrativeHistory, setNarrativeHistory] = useState<NarrativeDoc[]>([]);
  const [storyboardStatus, setStoryboardStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [storyboardDraft, setStoryboardDraft] = useState<StoryboardDraft | null>(null);
  const [monthToAdd, setMonthToAdd] = useState<string | null>(null);

  const remainingMonths = useMemo(
    () => MONTHS.filter((month) => !rows.some((row) => row.month === month)),
    [rows]
  );

  useEffect(() => {
    if (remainingMonths.length === 0) {
      setMonthToAdd(null);
      return;
    }
    if (!monthToAdd || !remainingMonths.includes(monthToAdd)) {
      setMonthToAdd(remainingMonths[0]);
    }
  }, [monthToAdd, remainingMonths]);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductSummary>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const productSuggestions = useMemo(() => {
    return rows.reduce<Record<string, ProductSuggestion>>((acc, row) => {
      const keywords = normaliseKeywordSet(row.theme, row.goals, row.productLaunches, row.keyEvents, row.month);
      if (row.priority) {
        keywords.add(row.priority.toLowerCase());
      }
      let best: { product: ProductSummary; score: number; matches: string[] } | null = null;
      products.forEach((product) => {
        if (row.productIds.includes(product.id)) {
          return;
        }
        const { score, matches } = scoreProductAgainstKeywords(product, keywords);
        if (!best || score > best.score || (score === best.score && (product.price ?? 0) > (best.product.price ?? 0))) {
          best = { product, score, matches };
        }
      });

      if (!best && products.length > 0) {
        best = { product: products[0], score: 0, matches: [] };
      }

      if (!best) {
        return acc;
      }

      const { product, matches } = best;
      const priceText = formatBudgetRange(product.priceMin, product.priceMax);
      let reason: string;
      if (matches.length > 0) {
        reason = `Tagged for ${matches.slice(0, 3).join(", ")} objectives.`;
      } else if (row.priority) {
        reason = `Supports your ${MARKETING_PRIORITY_LABELS[row.priority]} focus.`;
      } else if (row.theme) {
        reason = `Complements the "${row.theme}" theme.`;
      } else {
        reason = "Frequently paired with annual campaigns.";
      }

      acc[row.id] = {
        product,
        reason,
        matchedTags: matches,
        priceText,
      };
      return acc;
    }, {});
  }, [products, rows]);

  const totalBudget = useMemo(() => rows.reduce((sum, row) => sum + deriveAverageBudget(row), 0), [rows]);

  const perQuarterSummary = useMemo(() => {
    return rows.reduce<Record<string, { budget: number; orders: number }>>((acc, row) => {
      const quarter = QUARTER_BY_MONTH[row.month];
      if (!quarter) return acc;
      const deliverableCount = parseDeliverables(row.deliverables).length;
      const recommendedOrders = deliverableCount > 0 ? Math.max(1, Math.ceil(deliverableCount / 2)) : 0;
      const amount = deriveAverageBudget(row);
      const current = acc[quarter] || { budget: 0, orders: 0 };
      acc[quarter] = {
        budget: current.budget + (Number.isNaN(amount) ? 0 : amount),
        orders: current.orders + recommendedOrders,
      };
      return acc;
    }, {});
  }, [rows]);

  const orderRecommendations = useMemo(() => {
    const insights: string[] = [];
    rows.forEach((row) => {
      const deliverables = parseDeliverables(row.deliverables);
      const recommendedOrders = deliverables.length > 0 ? Math.max(1, Math.ceil(deliverables.length / 2)) : 1;
      const linkedProducts = row.productIds
        .map((id) => productMap.get(id)?.name)
        .filter((name): name is string => Boolean(name));
      const suggestion = productSuggestions[row.id];
      const manualRange = formatBudgetRange(parseBudgetInput(row.budgetMin), parseBudgetInput(row.budgetMax));
      const budgetText = suggestion?.priceText || manualRange;

      const parts: string[] = [];
      if (row.theme) {
        parts.push(`Focus on ${row.theme}`);
      }
      if (row.goals) {
        parts.push(`Goal: ${row.goals}`);
      }
      if (row.productLaunches) {
        parts.push(`Launch: ${row.productLaunches}`);
      }
      if (row.keyEvents) {
        parts.push(`Event: ${row.keyEvents}`);
      }
      if (deliverables.length > 0) {
        parts.push(`Plan ${deliverables.length} deliverable${deliverables.length === 1 ? "" : "s"}`);
      } else if (linkedProducts.length > 0) {
        parts.push(`Keep ${linkedProducts.join(", ")}`);
      }
      if (budgetText) {
        parts.push(`Budget ${budgetText}/month`);
      }
      parts.push(`Allow for ${recommendedOrders} order${recommendedOrders === 1 ? "" : "s"}`);
      if (suggestion) {
        parts.push(`${suggestion.product.name}: ${suggestion.reason}`);
      }

      if (parts.length > 0) {
        insights.push(`${row.month}: ${parts.join("; ")}`);
      }
    });
    if (totalBudget > 0) {
      const averageOrderValue = 2400;
      const projectedOrders = Math.max(1, Math.ceil(totalBudget / averageOrderValue));
      insights.push(
        `Across the year allocate roughly ${projectedOrders} full-service order${
          projectedOrders > 1 ? "s" : ""
        } to stay within the ${formatCurrency(totalBudget)} content budget.`
      );
    }
    if (rows.length < 12 && remainingMonths.length > 0) {
      insights.push(
        `Add the remaining ${remainingMonths.length} month${remainingMonths.length > 1 ? "s" : ""} to lock-in repeat work and keep your production queue full.`
      );
    }
    if (marketingMix.conversion >= 30) {
      insights.push("High conversion focus detected – bundle campaign and CRO projects to maximise ROI.");
    }
    return insights;
  }, [marketingMix.conversion, productMap, productSuggestions, remainingMonths.length, rows, totalBudget]);

  useEffect(() => {
    const templateRef = doc(db, "contentPlanPresets", "global");
    const unsubscribe = onSnapshot(
      templateRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setTemplates(DEFAULT_TEMPLATES);
          return;
        }
        const data = snapshot.data() as DocumentData;
        setTemplates(normaliseTemplates(data.templates));
      },
      (error) => {
        console.warn("Failed to load content plan templates", error);
        setTemplates(DEFAULT_TEMPLATES);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "products"));
        if (!active) return;
        const list: ProductSummary[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          const priceCandidate =
            normalisePrice(data.price) ??
            normalisePrice(data.basePrice) ??
            normalisePrice(data.startingPrice) ??
            null;
          const priceMin =
            normalisePrice(data.priceMin) ??
            normalisePrice(data.minPrice) ??
            normalisePrice(data.priceFrom) ??
            normalisePrice(data.budgetFrom) ??
            (priceCandidate ?? null);
          const priceMax =
            normalisePrice(data.priceMax) ??
            normalisePrice(data.maxPrice) ??
            normalisePrice(data.priceTo) ??
            normalisePrice(data.budgetTo) ??
            (priceCandidate ?? null);
          const tags = normaliseProductTags(data as Record<string, unknown>);
          return {
            id: docSnap.id,
            name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled product",
            category: typeof data.category === "string" ? data.category : null,
            price: priceCandidate,
            priceMin,
            priceMax,
            tags,
          };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
      } catch (error) {
        console.warn("Failed to load products for planner", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let unsubscribeRequests: (() => void) | null = null;

    const attachListener = (uid: string) => {
      if (unsubscribeRequests) unsubscribeRequests();
      const q = query(collection(db, "contentPlanRequests"), where("userId", "==", uid));
      unsubscribeRequests = onSnapshot(
        q,
        (snapshot) => {
          const grouped: Record<string, CustomIdeaRequest[]> = {};
          snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data() as DocumentData;
            const createdAt = data.createdAt?.toDate?.() ?? null;
            const updatedAt = data.updatedAt?.toDate?.() ?? createdAt;
            const request: CustomIdeaRequest = {
              id: docSnap.id,
              rowId: typeof data.rowId === "string" ? data.rowId : null,
              status: typeof data.status === "string" ? data.status : "requested",
              note: typeof data.note === "string" ? data.note : null,
              adminNotes: typeof data.adminNotes === "string" ? data.adminNotes : null,
              createdAt,
              updatedAt,
              templateId: typeof data.templateId === "string" ? data.templateId : null,
              month: typeof data.month === "string" ? data.month : undefined,
              theme: typeof data.theme === "string" ? data.theme : undefined,
              goals: typeof data.goals === "string" ? data.goals : null,
              productLaunches: typeof data.productLaunches === "string" ? data.productLaunches : null,
              keyEvents: typeof data.keyEvents === "string" ? data.keyEvents : null,
              budgetMin: normalisePrice(data.budgetMin),
              budgetMax: normalisePrice(data.budgetMax),
              suggestedProduct:
                data.suggestedProduct && typeof data.suggestedProduct === "object"
                  ? {
                      id: typeof data.suggestedProduct.id === "string" ? data.suggestedProduct.id : "",
                      name: typeof data.suggestedProduct.name === "string" ? data.suggestedProduct.name : "Recommendation",
                      reason:
                        typeof data.suggestedProduct.reason === "string" ? data.suggestedProduct.reason : null,
                      priceMin: normalisePrice((data.suggestedProduct as Record<string, unknown>).priceMin),
                      priceMax: normalisePrice((data.suggestedProduct as Record<string, unknown>).priceMax),
                    }
                  : null,
            };
            const key = request.rowId || `${request.month || ""}-${docSnap.id}`;
            grouped[key] = grouped[key] ? [...grouped[key], request] : [request];
          });
          Object.values(grouped).forEach((entries) =>
            entries.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
          );
          setRequestsByRow(grouped);
        },
        (error) => {
          console.warn("Failed to load content plan requests", error);
        }
      );
    };

    const unsubscribeAuth = auth.onAuthStateChanged((user: User | null) => {
      setRequestsByRow({});
      if (unsubscribeRequests) {
        unsubscribeRequests();
        unsubscribeRequests = null;
      }
      if (user) {
        attachListener(user.uid);
      }
    });

    const currentUser = auth.currentUser;
    if (currentUser) {
      attachListener(currentUser.uid);
    }

    return () => {
      unsubscribeAuth();
      if (unsubscribeRequests) unsubscribeRequests();
    };
  }, []);

  useEffect(() => {
    let unsubscribeNarratives: (() => void) | null = null;

    const attachListener = (uid: string) => {
      if (unsubscribeNarratives) unsubscribeNarratives();
      const q = query(collection(db, "contentPlanNarratives"), where("userId", "==", uid));
      unsubscribeNarratives = onSnapshot(
        q,
        (snapshot) => {
          const list: NarrativeDoc[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data() as DocumentData;
            const createdAt = data.createdAt?.toDate?.() ?? null;
            const updatedAt = data.updatedAt?.toDate?.() ?? createdAt;
            return {
              id: docSnap.id,
              status: typeof data.status === "string" ? data.status : "queued",
              narrative: typeof data.narrative === "string" ? data.narrative : null,
              storyBeats: Array.isArray(data.storyBeats)
                ? data.storyBeats.filter((item: unknown): item is string => typeof item === "string")
                : [],
              createdAt,
              updatedAt,
            };
          });
          list.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
          setNarrativeHistory(list);
        },
        (error) => {
          console.warn("Failed to load content plan narratives", error);
        }
      );
    };

    const unsubscribeAuth = auth.onAuthStateChanged((user: User | null) => {
      setNarrativeHistory([]);
      if (unsubscribeNarratives) {
        unsubscribeNarratives();
        unsubscribeNarratives = null;
      }
      if (user) {
        attachListener(user.uid);
      }
    });

    const currentUser = auth.currentUser;
    if (currentUser) {
      attachListener(currentUser.uid);
    }

    return () => {
      unsubscribeAuth();
      if (unsubscribeNarratives) unsubscribeNarratives();
    };
  }, []);

  const addMonthRow = () => {
    if (!monthToAdd) return;
    const next = monthToAdd;
    setRows((prev) => [
      ...prev,
      {
        id: `${next}-${randomId()}`,
        month: next,
        theme: "",
        goals: "",
        productLaunches: "",
        keyEvents: "",
        deliverables: "",
        budget: "",
        budgetMin: "",
        budgetMax: "",
        priority: "mixed",
        productIds: [],
        templateId: null,
      },
    ]);
  };

  const handleRowChange = (id: string, key: keyof PlanRow, value: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) {
          return row;
        }
        const next: PlanRow = { ...row };
        if (key === "budgetMin" || key === "budgetMax") {
          next[key] = value;
          const updatedMin = key === "budgetMin" ? value : next.budgetMin;
          const updatedMax = key === "budgetMax" ? value : next.budgetMax;
          const minValue = parseBudgetInput(updatedMin);
          const maxValue = parseBudgetInput(updatedMax);
          if (minValue !== null && maxValue !== null) {
            next.budget = String(Math.round((minValue + maxValue) / 2));
          } else {
            const fallback = minValue ?? maxValue;
            next.budget = fallback !== null ? String(Math.round(fallback)) : "";
          }
        } else if (key === "budget") {
          next.budget = value;
          const parsed = parseBudgetInput(value);
          if (parsed !== null) {
            const formatted = String(Math.round(parsed));
            next.budgetMin = formatted;
            next.budgetMax = formatted;
          }
        } else {
          (next as Record<string, unknown>)[key] = value;
        }

        if (["deliverables", "theme", "goals", "productLaunches", "keyEvents"].includes(key as string)) {
          next.templateId = null;
        }

        if (key === "templateId") {
          next.templateId = value || null;
        }

        return next;
      })
    );
  };

  const applyTemplateToRow = (id: string, templateId: string) => {
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) return;
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              deliverables: template.deliverables,
              budget: template.budget,
              budgetMin: template.budget,
              budgetMax: template.budget,
              priority: template.priority,
              productIds: template.productIds.filter((productId) => productId),
              templateId: template.id,
            }
          : row
      )
    );
  };

  const addProductToRow = (rowId: string, productId: string) => {
    if (!productId) return;
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              productIds: row.productIds.includes(productId) ? row.productIds : [...row.productIds, productId],
              templateId: null,
            }
          : row
      )
    );
  };

  const removeProductFromRow = (rowId: string, productId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? { ...row, productIds: row.productIds.filter((id) => id !== productId), templateId: null }
          : row
      )
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const updateMarketingMix = (key: keyof typeof marketingMix, value: number) => {
    setMarketingMix((prev) => ({ ...prev, [key]: value }));
  };

  const handleRequestCustomIdea = async (row: PlanRow) => {
    const note = (requestDrafts[row.id] || "").trim();
    setRequestErrors((prev) => ({ ...prev, [row.id]: null }));
    setRequestState((prev) => ({ ...prev, [row.id]: "sending" }));

    try {
      const suggestion = productSuggestions[row.id];
      const response = await fetch("/api/content-plans/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId: row.id,
          month: row.month,
          theme: row.theme,
          goals: row.goals,
          productLaunches: row.productLaunches,
          keyEvents: row.keyEvents,
          deliverables: row.deliverables,
          budget: row.budget,
          budgetMin: row.budgetMin,
          budgetMax: row.budgetMax,
          priority: row.priority,
          productIds: row.productIds,
          note,
          templateId: row.templateId ?? null,
          suggestedProduct: suggestion
            ? {
                id: suggestion.product.id,
                name: suggestion.product.name,
                reason: suggestion.reason,
                priceMin: suggestion.product.priceMin,
                priceMax: suggestion.product.priceMax,
              }
            : null,
          productSummaries: row.productIds
            .map((id): ProductSummary | null => {
              const product = productMap.get(id);
              if (!product) {
                return null;
              }
              return {
                id: product.id,
                name: product.name,
                category: product.category,
                price: product.price,
                priceMin: product.priceMin,
                priceMax: product.priceMax,
                tags: product.tags,
              };
            })
            .filter((item): item is ProductSummary => item !== null),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to submit request" }));
        throw new Error(typeof error.error === "string" ? error.error : "Failed to submit request");
      }

      setRequestState((prev) => ({ ...prev, [row.id]: "success" }));
      setRequestDrafts((prev) => ({ ...prev, [row.id]: "" }));
      setTimeout(() => {
        setRequestState((prev) => ({ ...prev, [row.id]: "idle" }));
      }, 3000);
    } catch (error) {
      setRequestState((prev) => ({ ...prev, [row.id]: "error" }));
      setRequestErrors((prev) => ({
        ...prev,
        [row.id]: error instanceof Error ? error.message : "Failed to submit request",
      }));
    }
  };

  const handleGenerateNarrative = async () => {
    const meaningfulRows = rows.filter((row) => row.theme || row.deliverables || row.productIds.length > 0);
    if (meaningfulRows.length === 0) {
      setNarrativeStatus("error");
      setNarrativeError("Add at least one campaign theme, deliverable, or linked product before generating a narrative.");
      return;
    }

    setNarrativeStatus("loading");
    setNarrativeError(null);

    try {
      const response = await fetch("/api/content-plans/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: meaningfulRows.map((row) => ({
            id: row.id,
            month: row.month,
            theme: row.theme,
            goals: row.goals,
            productLaunches: row.productLaunches,
            keyEvents: row.keyEvents,
            deliverables: row.deliverables,
            budget: row.budget,
            budgetMin: row.budgetMin,
            budgetMax: row.budgetMax,
            priority: row.priority,
            productIds: row.productIds,
            templateId: row.templateId ?? null,
            suggestedProduct: productSuggestions[row.id]
              ? {
                  id: productSuggestions[row.id].product.id,
                  name: productSuggestions[row.id].product.name,
                  reason: productSuggestions[row.id].reason,
                  priceMin: productSuggestions[row.id].product.priceMin,
                  priceMax: productSuggestions[row.id].product.priceMax,
                }
              : null,
            products: row.productIds
              .map((id): ProductSummary | null => {
                const product = productMap.get(id);
                if (!product) {
                  return null;
                }
                return {
                  id: product.id,
                  name: product.name,
                  category: product.category,
                  price: product.price,
                  priceMin: product.priceMin,
                  priceMax: product.priceMax,
                  tags: product.tags,
                };
              })
              .filter((item): item is ProductSummary => item !== null),
          })),
          marketingMix,
          totalBudget,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to generate narrative" }));
        throw new Error(typeof error.error === "string" ? error.error : "Failed to generate narrative");
      }

      const payload = await response.json();
      const storyBeats = Array.isArray(payload.storyBeats)
        ? payload.storyBeats.filter((item: unknown): item is string => typeof item === "string")
        : [];
      setNarrativeStatus("ready");
      setNarrativeDraft({
        id: typeof payload.id === "string" ? payload.id : randomId(),
        status: typeof payload.status === "string" ? payload.status : "ready",
        narrative: typeof payload.narrative === "string" ? payload.narrative : null,
        storyBeats,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
        updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : null,
      });
    } catch (error) {
      setNarrativeStatus("error");
      setNarrativeError(error instanceof Error ? error.message : "Failed to generate narrative");
    }
  };

  const handleGenerateStoryboard = async () => {
    const meaningfulRows = rows.filter((row) => row.theme || row.deliverables || row.productIds.length > 0);
    if (meaningfulRows.length === 0) {
      setStoryboardStatus("error");
      setStoryboardError("Add campaign details before building a storyboard.");
      return;
    }

    setStoryboardStatus("loading");
    setStoryboardError(null);

    const primaryTheme = meaningfulRows.find((row) => row.theme)?.theme || meaningfulRows[0]?.month || "Campaign";
    const deliverables = meaningfulRows.flatMap((row) => parseDeliverables(row.deliverables));
    const items = meaningfulRows.flatMap((row) =>
      row.productIds.map((id) => {
        const product = productMap.get(id);
        return {
          name: product?.name || "Service",
          category: product?.category || null,
          price: product?.price ?? null,
          deliverables: parseDeliverables(row.deliverables),
        };
      })
    );

    const qualitativeGoals = meaningfulRows
      .flatMap((row) => {
        const list: string[] = [];
        if (row.goals) {
          list.push(`${row.month}: ${row.goals}`);
        }
        if (row.productLaunches) {
          list.push(`${row.month} launch: ${row.productLaunches}`);
        }
        if (row.keyEvents) {
          list.push(`${row.month} event: ${row.keyEvents}`);
        }
        return list;
      })
      .slice(0, 6);

    const goals = [
      `Awareness weighting ${marketingMix.awareness}%`,
      `Engagement weighting ${marketingMix.engagement}%`,
      `Conversion weighting ${marketingMix.conversion}%`,
      ...qualitativeGoals,
    ];

    const notes: string[] = [];
    if (totalBudget > 0) {
      notes.push(`Working budget ${formatCurrency(totalBudget)}.`);
    }
    if (meaningfulRows.length < 12) {
      notes.push(`Plan covers ${meaningfulRows.length} months.`);
    }
    meaningfulRows.forEach((row) => {
      const manualRange = formatBudgetRange(parseBudgetInput(row.budgetMin), parseBudgetInput(row.budgetMax));
      if (manualRange) {
        notes.push(`${row.month} budget guidance ${manualRange}.`);
      }
      const suggestion = productSuggestions[row.id];
      if (suggestion) {
        notes.push(`Recommend ${suggestion.product.name}: ${suggestion.reason}`);
      }
    });

    try {
      const response = await fetch("/api/proposals/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: primaryTheme,
          audience: null,
          tone: "Strategic",
          goals,
          deliverables,
          items,
          notes: notes.join(" ") || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to build storyboard" }));
        throw new Error(typeof error.error === "string" ? error.error : "Failed to build storyboard");
      }

      const payload = await response.json();
      const sections = Array.isArray(payload.sections)
        ? payload.sections
            .map((section: unknown): StoryboardDraft["sections"][number] | null => {
              if (!section || typeof section !== "object") return null;
              const record = section as Record<string, unknown>;
              const rawTalkingPoints = record.talkingPoints;
              const talkingPoints = Array.isArray(rawTalkingPoints)
                ? rawTalkingPoints.filter((item: unknown): item is string => typeof item === "string")
                : [];
              return {
                id: typeof record.id === "string" ? record.id : randomId(),
                title: typeof record.title === "string" ? record.title : "Storyboard scene",
                summary: typeof record.summary === "string" ? record.summary : "",
                talkingPoints,
              };
            })
            .filter(
              (item: StoryboardDraft["sections"][number] | null): item is StoryboardDraft["sections"][number] =>
                item !== null
            )
        : [];
      const timeline = Array.isArray(payload.timeline)
        ? payload.timeline
            .map((entry: unknown): StoryboardDraft["timeline"][number] | null => {
              if (!entry || typeof entry !== "object") return null;
              const record = entry as Record<string, unknown>;
              const rawTasks = record.tasks;
              const tasks = Array.isArray(rawTasks)
                ? rawTasks.filter((task: unknown): task is string => typeof task === "string")
                : [];
              return {
                phase: typeof record.phase === "string" ? record.phase : "Phase",
                duration: typeof record.duration === "string" ? record.duration : "",
                tasks,
              };
            })
            .filter(
              (item: StoryboardDraft["timeline"][number] | null): item is StoryboardDraft["timeline"][number] =>
                item !== null
            )
        : [];
      const recommendedItems = Array.isArray(payload.recommendedItems)
        ? payload.recommendedItems
            .map((entry: unknown): StoryboardDraft["recommendedItems"][number] | null => {
              if (!entry || typeof entry !== "object") return null;
              const record = entry as Record<string, unknown>;
              return {
                id: typeof record.id === "string" ? record.id : randomId(),
                name: typeof record.name === "string" ? record.name : "Proposal line item",
                priceHint: typeof record.priceHint === "string" ? record.priceHint : null,
                description: typeof record.description === "string" ? record.description : null,
              };
            })
            .filter(
              (item: StoryboardDraft["recommendedItems"][number] | null): item is StoryboardDraft["recommendedItems"][number] =>
                item !== null
            )
        : [];

      const requestId = typeof payload.requestId === "string" ? payload.requestId : null;
      const promptId = typeof payload.promptId === "string" ? payload.promptId : null;
      const promptName = typeof payload.promptName === "string" ? payload.promptName : null;
      const modelName = typeof payload.modelName === "string" ? payload.modelName : null;
      const generationMode = typeof payload.generationMode === "string" ? payload.generationMode : null;

      setStoryboardDraft({
        id: typeof payload.id === "string" ? payload.id : randomId(),
        narrative: typeof payload.narrative === "string" ? payload.narrative : "Storyboard prepared.",
        sections,
        timeline,
        recommendedItems,
        requestId,
        promptId,
        promptName,
        modelName,
        generationMode,
      });
      setStoryboardStatus("ready");
    } catch (error) {
      setStoryboardStatus("error");
      setStoryboardError(error instanceof Error ? error.message : "Failed to build storyboard");
    }
  };

  const latestNarrative = narrativeDraft || narrativeHistory[0] || null;

  return (
    <section className="card p-6 space-y-6" aria-label="Annual content planner">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold">Annual Content Planner</h2>
        <p className="text-sm text-gray-600">
          Build a rolling twelve-month roadmap, attach deliverables, align with live products, and earmark production budget so
          your team can tee up multiple orders in advance.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-gray-600">
          Next month
          <select
            className="input ml-2 inline-flex w-32"
            value={monthToAdd ?? ""}
            onChange={(event) => setMonthToAdd(event.target.value || null)}
            disabled={remainingMonths.length === 0}
          >
            {remainingMonths.length === 0 ? <option value="">All planned</option> : null}
            {remainingMonths.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-sm" onClick={addMonthRow} disabled={!monthToAdd}>
          Add month
        </button>
        <span className="text-xs text-gray-500">{12 - remainingMonths.length} / 12 months planned</span>
        <Link href="/products" className="text-xs text-blue-600 hover:underline">
          Browse full product catalogue
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2">Campaign focus</th>
              <th className="px-3 py-2">Goals & milestones</th>
              <th className="px-3 py-2">Suggested product</th>
              <th className="px-3 py-2">Deliverables & bespoke</th>
              <th className="px-3 py-2">Products</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Budget guidance (£/month)</th>
              <th className="px-3 py-2">Orders</th>
              <th className="px-3 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const deliverableList = parseDeliverables(row.deliverables);
              const linkedProducts = row.productIds
                .map((id) => productMap.get(id)?.name)
                .filter((name): name is string => Boolean(name));
              const suggestion = productSuggestions[row.id];
              const manualRange = formatBudgetRange(parseBudgetInput(row.budgetMin), parseBudgetInput(row.budgetMax));
              const recommendedOrders = Math.max(
                1,
                deliverableList.length > 0
                  ? Math.ceil(deliverableList.length / 2)
                  : linkedProducts.length > 0
                  ? linkedProducts.length
                  : suggestion
                  ? 1
                  : 0
              );
              const relatedRequests = requestsByRow[row.id] || [];
              const latestRequest = relatedRequests[0];
              return (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-2">
                    <select
                      className="input w-32"
                      value={row.month}
                      onChange={(event) => handleRowChange(row.id, "month", event.target.value)}
                    >
                      {MONTHS.map((month) => (
                        <option key={month} value={month}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input w-full"
                      placeholder="Theme or campaign goal"
                      value={row.theme}
                      onChange={(event) => handleRowChange(row.id, "theme", event.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-3 text-xs">
                      <label className="block font-medium text-gray-600" htmlFor={`${row.id}-goals`}>
                        Monthly goals
                      </label>
                      <textarea
                        id={`${row.id}-goals`}
                        className="input w-full min-h-[60px]"
                        placeholder="Pipeline targets, retention focus, lead KPIs"
                        value={row.goals}
                        onChange={(event) => handleRowChange(row.id, "goals", event.target.value)}
                      />
                      <label className="block font-medium text-gray-600" htmlFor={`${row.id}-launches`}>
                        Product releases
                      </label>
                      <input
                        id={`${row.id}-launches`}
                        className="input w-full"
                        placeholder="Upcoming launches or feature drops"
                        value={row.productLaunches}
                        onChange={(event) => handleRowChange(row.id, "productLaunches", event.target.value)}
                      />
                      <label className="block font-medium text-gray-600" htmlFor={`${row.id}-events`}>
                        Events & moments
                      </label>
                      <input
                        id={`${row.id}-events`}
                        className="input w-full"
                        placeholder="Conferences, seasonal moments, campaigns"
                        value={row.keyEvents}
                        onChange={(event) => handleRowChange(row.id, "keyEvents", event.target.value)}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {suggestion ? (
                      <div className="space-y-2 text-xs text-gray-700">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{suggestion.product.name}</p>
                            {suggestion.priceText ? (
                              <p className="text-[11px] text-gray-500">{suggestion.priceText} per month</p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="btn-xs"
                            onClick={() => addProductToRow(row.id, suggestion.product.id)}
                          >
                            Use suggestion
                          </button>
                        </div>
                        <p className="text-gray-500">{suggestion.reason}</p>
                        {suggestion.matchedTags.length > 0 ? (
                          <p className="text-[11px] text-gray-400">Tags: {suggestion.matchedTags.slice(0, 4).join(", ")}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Add goals or events to see curated recommendations.</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <textarea
                          className="input w-full min-h-[80px]"
                          placeholder="List deliverables separated by commas"
                          value={row.deliverables}
                          onChange={(event) => handleRowChange(row.id, "deliverables", event.target.value)}
                        />
                        <div className="flex flex-wrap gap-2 text-xs">
                          {templates.map((template) => {
                            const productNames = template.productIds
                              .map((id) => productMap.get(id)?.name)
                              .filter((name): name is string => Boolean(name));
                            return (
                              <button
                                key={template.id}
                                type="button"
                                className="badge cursor-pointer bg-gray-100 hover:bg-gray-200"
                                onClick={() => applyTemplateToRow(row.id, template.id)}
                                title={
                                  productNames.length > 0
                                    ? `Includes ${productNames.join(", ")}`
                                    : template.deliverables
                                }
                              >
                                {template.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-2 text-xs">
                        <label className="block font-medium">Need a custom idea?</label>
                        <textarea
                          className="input w-full min-h-[60px]"
                          placeholder="Share a brief for a bespoke concept or quote"
                          value={requestDrafts[row.id] || ""}
                          onChange={(event) =>
                            setRequestDrafts((prev) => ({ ...prev, [row.id]: event.target.value }))
                          }
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            className="btn-xs"
                            onClick={() => handleRequestCustomIdea(row)}
                            disabled={requestState[row.id] === "sending"}
                          >
                            {requestState[row.id] === "sending" ? "Sending…" : "Request custom quote"}
                          </button>
                          {latestRequest ? (
                            <span className="text-gray-500">
                              Status: {buildRequestStatusLabel(latestRequest.status)}
                              {latestRequest.updatedAt
                                ? ` • Updated ${latestRequest.updatedAt.toLocaleDateString()}`
                                : ""}
                            </span>
                          ) : null}
                          {row.templateId ? (
                            <span className="text-gray-400">Based on {row.templateId.replace(/-/g, " ")}</span>
                          ) : null}
                        </div>
                        {requestErrors[row.id] ? (
                          <p className="text-red-600">{requestErrors[row.id]}</p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {row.productIds.length === 0 ? (
                          <span className="text-xs text-gray-400">No products linked</span>
                        ) : (
                          row.productIds.map((productId) => {
                            const product = productMap.get(productId);
                            return (
                              <span key={productId} className="inline-flex items-center gap-2 rounded bg-gray-100 px-2 py-1 text-xs">
                                <span className="flex flex-col">
                                  {product ? (
                                    <Link href={`/products/${product.id}`} className="hover:underline">
                                      {product.name}
                                    </Link>
                                  ) : (
                                    <span className="text-gray-500">{productId}</span>
                                  )}
                                  {product ? (
                                    <span className="text-[10px] text-gray-500">
                                      {formatBudgetRange(product.priceMin, product.priceMax) || "Custom pricing"}
                                    </span>
                                  ) : null}
                                </span>
                                <button
                                  type="button"
                                  aria-label="Remove linked product"
                                  onClick={() => removeProductFromRow(row.id, productId)}
                                  className="text-gray-500 hover:text-gray-700"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })
                        )}
                      </div>
                      <label className="block text-xs font-medium">Attach product</label>
                      <select
                        className="input w-full"
                        value={productPicker[row.id] || ""}
                        onChange={(event) => {
                          const productId = event.target.value;
                          addProductToRow(row.id, productId);
                          setProductPicker((prev) => ({ ...prev, [row.id]: "" }));
                        }}
                      >
                        <option value="">Select product…</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="input"
                      value={row.priority}
                      onChange={(event) =>
                        handleRowChange(row.id, "priority", event.target.value as PlanRow["priority"])
                      }
                    >
                      {Object.entries(MARKETING_PRIORITY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <input
                          className="input w-24"
                          type="number"
                          min="0"
                          step="100"
                          placeholder="Min"
                          value={row.budgetMin}
                          onChange={(event) => handleRowChange(row.id, "budgetMin", event.target.value)}
                        />
                        <span className="text-gray-500">to</span>
                        <input
                          className="input w-24"
                          type="number"
                          min="0"
                          step="100"
                          placeholder="Max"
                          value={row.budgetMax}
                          onChange={(event) => handleRowChange(row.id, "budgetMax", event.target.value)}
                        />
                      </div>
                      {suggestion?.priceText ? (
                        <p className="text-[11px] text-gray-500">Suggested: {suggestion.priceText} / month</p>
                      ) : null}
                      {manualRange ? (
                        <p className="text-[11px] text-gray-400">Range in use: {manualRange}</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    <div>
                      <p className="font-medium">{recommendedOrders} order{recommendedOrders > 1 ? "s" : ""}</p>
                      <p className="text-xs text-gray-500">
                        {deliverableList.length > 0
                          ? `${deliverableList.length} deliverable${deliverableList.length > 1 ? "s" : ""}`
                          : linkedProducts.length > 0
                          ? `Anchored by ${linkedProducts.join(", ")}`
                          : suggestion
                          ? suggestion.reason
                          : "Add deliverables or products"}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" className="text-xs text-red-500" onClick={() => removeRow(row.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="card border p-4">
          <h3 className="text-sm font-semibold text-gray-700">Budget outlook</h3>
          <p className="text-2xl font-semibold mt-2">{formatCurrency(totalBudget)}</p>
          <p className="text-xs text-gray-500">Projected spend across planned initiatives.</p>
        </div>
        <div className="card border p-4">
          <h3 className="text-sm font-semibold text-gray-700">Quarterly breakdown</h3>
          <ul className="mt-2 space-y-2 text-xs">
            {(["Q1", "Q2", "Q3", "Q4"] as const).map((quarter) => {
              const data = perQuarterSummary[quarter];
              if (!data) {
                return (
                  <li key={quarter} className="flex items-center justify-between text-gray-400">
                    <span>{quarter}</span>
                    <span>—</span>
                  </li>
                );
              }
              return (
                <li key={quarter} className="flex items-center justify-between">
                  <span>{quarter}</span>
                  <span>
                    {formatCurrency(data.budget)} • {data.orders} order{data.orders !== 1 ? "s" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card border p-4">
          <h3 className="text-sm font-semibold text-gray-700">Marketing mix emphasis</h3>
          <div className="mt-3 space-y-3 text-xs">
            {(
              [
                ["awareness", "Awareness"],
                ["engagement", "Engagement"],
                ["conversion", "Conversion"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-4">
                <span>{label}</span>
                <input
                  className="input w-20"
                  type="number"
                  min={0}
                  max={100}
                  value={marketingMix[key]}
                  onChange={(event) => updateMarketingMix(key, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Aim for ~100% combined to balance your annual mix.</p>
        </div>
      </div>

      <div className="card border p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Narrative & storyboard draft</h3>
            <p className="text-xs text-gray-500">
              Send your plan to our AI assistant for a suggested storyline, quarterly beats, and follow-up recommendations.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-xs"
              onClick={handleGenerateNarrative}
              disabled={narrativeStatus === "loading"}
            >
              {narrativeStatus === "loading" ? "Generating…" : "Generate AI narrative"}
            </button>
            <button
              type="button"
              className="btn-xs"
              onClick={handleGenerateStoryboard}
              disabled={storyboardStatus === "loading"}
            >
              {storyboardStatus === "loading" ? "Building…" : "Build storyboard pack"}
            </button>
          </div>
        </div>
        {narrativeError ? <p className="text-xs text-red-600">{narrativeError}</p> : null}
        {latestNarrative ? (
          <div className="space-y-2 text-sm text-gray-700">
            <p className="text-xs text-gray-500">
              Status: {buildNarrativeStatusLabel(latestNarrative.status)}
              {latestNarrative.updatedAt ? ` • Updated ${latestNarrative.updatedAt.toLocaleString()}` : ""}
            </p>
            {latestNarrative.narrative ? <p>{latestNarrative.narrative}</p> : null}
            {latestNarrative.storyBeats.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Story beats</h4>
                <ul className="list-disc pl-5 text-xs text-gray-600 space-y-1">
                  {latestNarrative.storyBeats.map((beat) => (
                    <li key={beat}>{beat}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Generate a draft narrative to see recommended story arcs and follow-up steps.</p>
        )}
        <div className="border-t pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Storyboard package</h4>
            <span className="text-[11px] text-gray-400">Saved to your proposal workspace for quick quoting.</span>
          </div>
          {storyboardError ? <p className="text-xs text-red-600">{storyboardError}</p> : null}
          {storyboardDraft ? (
            <div className="space-y-3 text-xs text-gray-600">
              <p className="text-sm text-gray-700">{storyboardDraft.narrative}</p>
              {storyboardDraft.sections.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {storyboardDraft.sections.map((section) => (
                    <section key={section.id} className="border rounded-md p-3 bg-gray-50">
                      <h5 className="text-sm font-semibold text-gray-700">{section.title}</h5>
                      <p className="text-[11px] text-gray-500">{section.summary}</p>
                      <ul className="mt-2 list-disc pl-5 space-y-1">
                        {section.talkingPoints.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : null}
              {storyboardDraft.timeline.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {storyboardDraft.timeline.map((phase) => (
                    <section key={phase.phase} className="border rounded-md p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-sm font-semibold text-gray-700">{phase.phase}</h5>
                        <span className="text-[11px] text-gray-500">{phase.duration}</span>
                      </div>
                      <ul className="mt-2 list-disc pl-5 space-y-1">
                        {phase.tasks.map((task) => (
                          <li key={task}>{task}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : null}
              {storyboardDraft.recommendedItems.length > 0 ? (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold text-gray-700">Recommended line items</h5>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {storyboardDraft.recommendedItems.map((item) => (
                      <li key={item.id} className="border rounded-md p-3 bg-white shadow-sm">
                        <p className="font-medium text-gray-700">{item.name}</p>
                        {item.description ? <p className="text-[11px] text-gray-500">{item.description}</p> : null}
                        {item.priceHint ? <p className="text-[11px] text-gray-400">Suggested budget {item.priceHint}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : storyboardStatus === "loading" ? (
            <p className="text-xs text-gray-500">Building storyboard…</p>
          ) : (
            <p className="text-xs text-gray-500">
              Build the storyboard pack to unlock pre-written scenes, production timelines, and ready-to-quote line items.
            </p>
          )}
        </div>
      </div>

      <div className="card border p-4">
        <h3 className="text-sm font-semibold text-gray-700">Order strategy prompts</h3>
        {orderRecommendations.length === 0 ? (
          <p className="text-xs text-gray-500 mt-2">Add deliverables and budget to unlock tailored order suggestions.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-xs text-gray-600">
            {orderRecommendations.map((recommendation) => (
              <li key={recommendation}>• {recommendation}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
