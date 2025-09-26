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
  const deliverables = typeof payload.deliverables === "string" ? payload.deliverables : null;
  const priority = typeof payload.priority === "string" ? payload.priority : null;
  const note = typeof payload.note === "string" ? payload.note : null;
  const templateId = typeof payload.templateId === "string" ? payload.templateId : null;

  const productIds = parseProductIds(payload.productIds);
  const budgetValue = Number.parseFloat(typeof payload.budget === "string" ? payload.budget : `${payload.budget ?? ""}`);
  const budget = Number.isFinite(budgetValue) ? Math.max(0, budgetValue) : null;

  type ProductSummary = {
    id: string;
    name: string;
    category: string | null;
    price: number | null;
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

        if (id && name) {
          acc.push({ id, name, category, price });
        }

        return acc;
      }, [] as ProductSummary[])
    : [];

  const firestore = getFirebaseAdminFirestore();
  const docRef = await firestore.collection("contentPlanRequests").add({
    userId: uid,
    rowId,
    month,
    theme,
    deliverables,
    priority,
    note,
    templateId,
    productIds,
    productSummaries,
    budget,
    status: "requested",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ id: docRef.id, status: "requested", createdAt: new Date().toISOString() }, { status: 201 });
}
