
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, where, type DocumentData } from "firebase/firestore";

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
  deliverables: string;
  budget: string;
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

function createInitialRows(): PlanRow[] {
  return MONTHS.slice(0, 4).map((month, index) => ({
    id: `${month}-${index}`,
    month,
    theme: "",
    deliverables: "",
    budget: "",
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

  const remainingMonths = useMemo(
    () => MONTHS.filter((month) => !rows.some((row) => row.month === month)),
    [rows]
  );

  const productMap = useMemo(() => {
    const map = new Map<string, ProductSummary>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const totalBudget = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const amount = parseFloat(row.budget);
        return sum + (Number.isNaN(amount) ? 0 : amount);
      }, 0),
    [rows]
  );

  const perQuarterSummary = useMemo(() => {
    return rows.reduce<Record<string, { budget: number; orders: number }>>((acc, row) => {
      const quarter = QUARTER_BY_MONTH[row.month];
      if (!quarter) return acc;
      const deliverableCount = parseDeliverables(row.deliverables).length;
      const recommendedOrders = deliverableCount > 0 ? Math.max(1, Math.ceil(deliverableCount / 2)) : 0;
      const amount = parseFloat(row.budget);
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
      if (deliverables.length === 0 && row.productIds.length === 0) return;
      const recommendedOrders = deliverables.length > 0 ? Math.max(1, Math.ceil(deliverables.length / 2)) : 1;
      const productNames = row.productIds
        .map((id) => productMap.get(id)?.name)
        .filter((name): name is string => Boolean(name));
      const headline = [row.theme, ...productNames].filter(Boolean).join(" • ");
      if (headline) {
        insights.push(
          `${row.month}: Anchor around ${headline} and plan for ${recommendedOrders} order${
            recommendedOrders > 1 ? "s" : ""
          } to cover ${deliverables.length || productNames.length} deliverable${
            deliverables.length + productNames.length > 1 ? "s" : ""
          }.`
        );
      } else if (deliverables.length > 0) {
        insights.push(
          `${row.month}: plan for ${recommendedOrders} order${
            recommendedOrders > 1 ? "s" : ""
          } to cover ${deliverables.length} deliverable${deliverables.length > 1 ? "s" : ""}.`
        );
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
  }, [marketingMix.conversion, productMap, remainingMonths.length, rows, totalBudget]);

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
          const priceCandidate = (
            (typeof data.price === "number" && data.price) ||
            (typeof data.basePrice === "number" && data.basePrice) ||
            (typeof data.startingPrice === "number" && data.startingPrice) ||
            null
          );
          return {
            id: docSnap.id,
            name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled product",
            category: typeof data.category === "string" ? data.category : null,
            price: priceCandidate,
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

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
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

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
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
    if (remainingMonths.length === 0) return;
    const next = remainingMonths[0];
    setRows((prev) => [
      ...prev,
      {
        id: `${next}-${randomId()}`,
        month: next,
        theme: "",
        deliverables: "",
        budget: "",
        priority: "mixed",
        productIds: [],
        templateId: null,
      },
    ]);
  };

  const handleRowChange = (id: string, key: keyof PlanRow, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [key]: value,
              ...(key === "templateId" ? {} : { templateId: key === "deliverables" || key === "theme" ? null : row.templateId ?? null }),
            }
          : row
      )
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
      const response = await fetch("/api/content-plans/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId: row.id,
          month: row.month,
          theme: row.theme,
          deliverables: row.deliverables,
          budget: row.budget,
          priority: row.priority,
          productIds: row.productIds,
          note,
          templateId: row.templateId ?? null,
          productSummaries: row.productIds
            .map((id) => {
              const product = productMap.get(id);
              return product
                ? {
                    id: product.id,
                    name: product.name,
                    category: product.category,
                    price: product.price,
                  }
                : null;
            })
            .filter((item): item is Record<string, unknown> => item !== null),
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
            deliverables: row.deliverables,
            budget: row.budget,
            priority: row.priority,
            productIds: row.productIds,
            templateId: row.templateId ?? null,
            products: row.productIds
              .map((id) => {
                const product = productMap.get(id);
                return product
                  ? {
                      id: product.id,
                      name: product.name,
                      category: product.category,
                      price: product.price,
                    }
                  : null;
              })
              .filter((item): item is Record<string, unknown> => item !== null),
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

    const goals = [
      `Awareness weighting ${marketingMix.awareness}%`,
      `Engagement weighting ${marketingMix.engagement}%`,
      `Conversion weighting ${marketingMix.conversion}%`,
    ];

    const notes: string[] = [];
    if (totalBudget > 0) {
      notes.push(`Working budget ${formatCurrency(totalBudget)}.`);
    }
    if (meaningfulRows.length < 12) {
      notes.push(`Plan covers ${meaningfulRows.length} months.`);
    }

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
            .map((section: any) => {
              if (!section || typeof section !== "object") return null;
              const talkingPoints = Array.isArray(section.talkingPoints)
                ? section.talkingPoints.filter((item: unknown): item is string => typeof item === "string")
                : [];
              return {
                id: typeof section.id === "string" ? section.id : randomId(),
                title: typeof section.title === "string" ? section.title : "Storyboard scene",
                summary: typeof section.summary === "string" ? section.summary : "",
                talkingPoints,
              };
            })
            .filter((item): item is StoryboardDraft["sections"][number] => item !== null)
        : [];
      const timeline = Array.isArray(payload.timeline)
        ? payload.timeline
            .map((entry: any) => {
              if (!entry || typeof entry !== "object") return null;
              const tasks = Array.isArray(entry.tasks)
                ? entry.tasks.filter((task: unknown): task is string => typeof task === "string")
                : [];
              return {
                phase: typeof entry.phase === "string" ? entry.phase : "Phase",
                duration: typeof entry.duration === "string" ? entry.duration : "",
                tasks,
              };
            })
            .filter((item): item is StoryboardDraft["timeline"][number] => item !== null)
        : [];
      const recommendedItems = Array.isArray(payload.recommendedItems)
        ? payload.recommendedItems
            .map((entry: any) => {
              if (!entry || typeof entry !== "object") return null;
              return {
                id: typeof entry.id === "string" ? entry.id : randomId(),
                name: typeof entry.name === "string" ? entry.name : "Proposal line item",
                priceHint: typeof entry.priceHint === "string" ? entry.priceHint : null,
                description: typeof entry.description === "string" ? entry.description : null,
              };
            })
            .filter((item): item is StoryboardDraft["recommendedItems"][number] => item !== null)
        : [];

      setStoryboardDraft({
        id: typeof payload.id === "string" ? payload.id : randomId(),
        narrative: typeof payload.narrative === "string" ? payload.narrative : "Storyboard prepared.",
        sections,
        timeline,
        recommendedItems,
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
        <button type="button" className="btn-sm" onClick={addMonthRow} disabled={remainingMonths.length === 0}>
          Add {remainingMonths.length > 0 ? `${remainingMonths[0]} plan` : "month"}
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
              <th className="px-3 py-2">Key deliverables</th>
              <th className="px-3 py-2">Products</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Budget ($)</th>
              <th className="px-3 py-2">Orders</th>
              <th className="px-3 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const deliverableList = parseDeliverables(row.deliverables);
              const recommendedOrders = deliverableList.length > 0 ? Math.max(1, Math.ceil(deliverableList.length / 2)) : 0;
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
                                {product ? (
                                  <Link href={`/products/${product.id}`} className="hover:underline">
                                    {product.name}
                                  </Link>
                                ) : (
                                  <span className="text-gray-500">{productId}</span>
                                )}
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
                    <input
                      className="input w-28"
                      type="number"
                      min="0"
                      step="100"
                      value={row.budget}
                      onChange={(event) => handleRowChange(row.id, "budget", event.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {recommendedOrders > 0 ? (
                      <div>
                        <p className="font-medium">{recommendedOrders} order{recommendedOrders > 1 ? "s" : ""}</p>
                        <p className="text-xs text-gray-500">{deliverableList.length} deliverable{deliverableList.length > 1 ? "s" : ""}</p>
                      </div>
                    ) : row.productIds.length > 0 ? (
                      <p className="text-xs text-gray-500">Linked products ready for scoping</p>
                    ) : (
                      <p className="text-xs text-gray-400">Add deliverables</p>
                    )}
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
