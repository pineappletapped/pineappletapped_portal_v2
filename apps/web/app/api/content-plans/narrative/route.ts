import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";

const MONTH_ORDER: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

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

type SanitisedPlanRow = {
  id: string;
  month: string;
  theme: string | null;
  deliverables: string | null;
  priority: string | null;
  productNames: string[];
  templateId: string | null;
};

type MarketingMix = {
  awareness?: number;
  engagement?: number;
  conversion?: number;
};

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseRows(value: unknown): SanitisedPlanRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const data = entry as Record<string, unknown>;
      const id = typeof data.id === "string" && data.id ? data.id : randomUUID();
      const month = typeof data.month === "string" && data.month ? data.month : "Unscheduled";
      const deliverables = typeof data.deliverables === "string" ? data.deliverables : null;
      const theme = typeof data.theme === "string" ? data.theme : null;
      const priority = typeof data.priority === "string" ? data.priority : null;
      const templateId = typeof data.templateId === "string" ? data.templateId : null;
      const productNames = Array.isArray(data.products)
        ? data.products
            .map((product) =>
              product && typeof product === "object" && typeof (product as any).name === "string"
                ? (product as any).name
                : null
            )
            .filter((name): name is string => Boolean(name))
        : [];
      if (!theme && !deliverables && productNames.length === 0) {
        return null;
      }
      return { id, month, deliverables, theme, priority, productNames, templateId } satisfies SanitisedPlanRow;
    })
    .filter((entry): entry is SanitisedPlanRow => entry !== null);
}

function parseMarketingMix(value: unknown): MarketingMix {
  if (!value || typeof value !== "object") return {};
  const data = value as Record<string, unknown>;
  const result: MarketingMix = {};
  ["awareness", "engagement", "conversion"].forEach((key) => {
    const raw = data[key];
    const parsed = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
    if (Number.isFinite(parsed)) {
      (result as any)[key] = parsed;
    }
  });
  return result;
}

function parseTotalBudget(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(typeof value === "string" ? value : `${value ?? ""}`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDeliverablesText(value: string | null) {
  if (!value) return [] as string[];
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatCurrency(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "a flexible budget";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

function describeMarketingMix(mix: MarketingMix) {
  const entries = Object.entries(mix).filter(([, value]) => typeof value === "number");
  if (entries.length === 0) {
    return "a balanced brand, engagement, and conversion mix";
  }
  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const top = entries[0];
  if (!top) return "a balanced brand, engagement, and conversion mix";
  const labelMap: Record<string, string> = {
    awareness: "brand awareness",
    engagement: "always-on engagement",
    conversion: "sales activation",
  };
  return `${Math.round(top[1] || 0)}% weighted toward ${labelMap[top[0]] || top[0]}`;
}

function createQuarterSummary(rows: SanitisedPlanRow[], totalBudget: number, mix: MarketingMix) {
  if (rows.length === 0) {
    return {
      narrative: "Draft at least one campaign row to generate a storyboard.",
      beats: [] as string[],
    };
  }

  const quarterMap = new Map<string, SanitisedPlanRow[]>();
  rows.forEach((row) => {
    const quarter = QUARTER_BY_MONTH[row.month] ?? "Ongoing";
    if (!quarterMap.has(quarter)) {
      quarterMap.set(quarter, []);
    }
    quarterMap.get(quarter)!.push(row);
  });

  quarterMap.forEach((value) => {
    value.sort((a, b) => (MONTH_ORDER[a.month] || 99) - (MONTH_ORDER[b.month] || 99));
  });

  const quarterDescriptions: string[] = [];
  const beats: string[] = [];

  quarterMap.forEach((rowsInQuarter, quarter) => {
    const monthList = rowsInQuarter.map((row) => row.month).join(", ");
    const themes = rowsInQuarter
      .map((row) => row.theme)
      .filter((theme): theme is string => Boolean(theme));
    const deliverables = rowsInQuarter.flatMap((row) => parseDeliverablesText(row.deliverables));
    const products = rowsInQuarter.flatMap((row) => row.productNames);

    const headline = themes.length > 0 ? themes.join(" • ") : deliverables.slice(0, 3).join(", ");
    const productLine = products.length > 0 ? ` featuring ${products.join(", ")}` : "";
    const deliverableLine = deliverables.length > 0 ? `${deliverables.length} deliverable${deliverables.length > 1 ? "s" : ""}` : "campaign groundwork";

    quarterDescriptions.push(
      `${quarter} centres on ${headline || "campaign storytelling"} across ${monthList}${productLine}, with ${deliverableLine} to advance the pipeline.`
    );

    beats.push(
      `${quarter} • ${headline || monthList} → ${deliverableLine}${products.length > 0 ? ` • Highlight ${products[0]}` : ""}`
    );
  });

  const marketingSummary = describeMarketingMix(mix);
  const budgetSummary = formatCurrency(totalBudget);

  const narrative = `The annual slate steers ${budgetSummary} through ${quarterMap.size} seasonal pushes, ${marketingSummary}. ${quarterDescriptions.join(
    " "
  )}`.trim();

  if (beats.length > 0) {
    beats.push("Wrap with measurement sprints and refreshed creative cutdowns to keep momentum between key launches.");
  }

  return { narrative, beats };
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const uid = cookieStore.get("uid")?.value;

  if (!uid) {
    return unauthorizedResponse();
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const rows = parseRows(payload.rows);
  const marketingMix = parseMarketingMix(payload.marketingMix);
  const totalBudget = parseTotalBudget(payload.totalBudget);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "At least one campaign row with a theme, deliverable, or linked product is required." },
      { status: 400 }
    );
  }

  const { narrative, beats } = createQuarterSummary(rows, totalBudget, marketingMix);

  const firestore = getFirebaseAdminFirestore();
  const docRef = await firestore.collection("contentPlanNarratives").add({
    userId: uid,
    status: "ready",
    narrative,
    storyBeats: beats,
    planSnapshot: {
      rows,
      marketingMix,
      totalBudget,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const timestamp = new Date().toISOString();

  return NextResponse.json(
    {
      id: docRef.id,
      status: "ready",
      narrative,
      storyBeats: beats,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { status: 201 }
  );
}
