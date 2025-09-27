import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function parseProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function parseBudgetValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

  const rowId = typeof payload.rowId === "string" ? payload.rowId : null;
  const month = typeof payload.month === "string" ? payload.month : null;
  const theme = typeof payload.theme === "string" ? payload.theme : null;
  const goals = typeof payload.goals === "string" ? payload.goals : null;
  const productLaunches = typeof payload.productLaunches === "string" ? payload.productLaunches : null;
  const keyEvents = typeof payload.keyEvents === "string" ? payload.keyEvents : null;
  const deliverables = typeof payload.deliverables === "string" ? payload.deliverables : null;
  const priority = typeof payload.priority === "string" ? payload.priority : null;
  const note = typeof payload.note === "string" ? payload.note : null;
  const templateId = typeof payload.templateId === "string" ? payload.templateId : null;

  const productIds = parseProductIds(payload.productIds);
  const budgetValue = Number.parseFloat(typeof payload.budget === "string" ? payload.budget : `${payload.budget ?? ""}`);
  const budget = Number.isFinite(budgetValue) ? Math.max(0, budgetValue) : null;
  const budgetMin = parseBudgetValue(payload.budgetMin);
  const budgetMax = parseBudgetValue(payload.budgetMax);

  const suggestedProductRaw = payload.suggestedProduct;
  const suggestedProduct =
    suggestedProductRaw && typeof suggestedProductRaw === "object"
      ? {
          id: typeof suggestedProductRaw.id === "string" ? suggestedProductRaw.id : null,
          name: typeof suggestedProductRaw.name === "string" ? suggestedProductRaw.name : null,
          reason: typeof suggestedProductRaw.reason === "string" ? suggestedProductRaw.reason : null,
          priceMin: parseBudgetValue((suggestedProductRaw as Record<string, unknown>).priceMin),
          priceMax: parseBudgetValue((suggestedProductRaw as Record<string, unknown>).priceMax),
        }
      : null;

  type ProductSummary = {
    id: string;
    name: string;
    category: string | null;
    price: number | null;
    priceMin: number | null;
    priceMax: number | null;
    tags: string[];
  };

  const productSummaries: ProductSummary[] = Array.isArray(payload.productSummaries)
    ? payload.productSummaries.reduce((acc: ProductSummary[], entry: unknown) => {
        if (entry === null || typeof entry !== "object") {
          return acc;
        }

        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : null;
        const name = typeof record.name === "string" ? record.name : null;
        const category = typeof record.category === "string" ? record.category : null;
        const price = typeof record.price === "number" ? record.price : null;
        const priceMin = typeof record.priceMin === "number" ? record.priceMin : null;
        const priceMax = typeof record.priceMax === "number" ? record.priceMax : null;
        const tags = Array.isArray(record.tags)
          ? record.tags.filter((tag): tag is string => typeof tag === "string")
          : [];

        if (id && name) {
          acc.push({ id, name, category, price, priceMin, priceMax, tags });
        }

        return acc;
      }, [] as ProductSummary[])
    : [];

  const safeSuggestedProduct =
    suggestedProduct && suggestedProduct.id && suggestedProduct.name
      ? {
          id: suggestedProduct.id,
          name: suggestedProduct.name,
          reason: suggestedProduct.reason ?? null,
          priceMin: suggestedProduct.priceMin ?? null,
          priceMax: suggestedProduct.priceMax ?? null,
        }
      : null;

  const firestore = getFirebaseAdminFirestore();
  const docRef = await firestore.collection("contentPlanRequests").add({
    userId: uid,
    rowId,
    month,
    theme,
    goals,
    productLaunches,
    keyEvents,
    deliverables,
    priority,
    note,
    templateId,
    productIds,
    productSummaries,
    budget,
    budgetMin: budgetMin ?? null,
    budgetMax: budgetMax ?? null,
    suggestedProduct: safeSuggestedProduct,
    status: "requested",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ id: docRef.id, status: "requested", createdAt: new Date().toISOString() }, { status: 201 });
}
