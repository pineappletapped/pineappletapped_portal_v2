import "server-only";

import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";

import type { PromptTemplateDefinition, PromptTemplateStatus } from "./templates";

type PromptStatus = PromptTemplateStatus | "draft" | "active" | "archived";

export interface AiPromptRecord {
  id: string;
  name: string;
  content: string;
  status: PromptStatus;
  category: string | null;
  description: string | null;
  notes: string | null;
  estimatedTokens: number | null;
  defaultModelId: string | null;
  createdAt: Timestamp | Date | null;
  updatedAt: Timestamp | Date | null;
}

function isPromptStatus(value: unknown): value is PromptStatus {
  return value === "active" || value === "draft" || value === "archived";
}

function normaliseString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseTimestamp(value: unknown): Timestamp | Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value) {
    const maybe = value as { seconds?: number; nanoseconds?: number };
    if (typeof maybe.seconds === "number") {
      return new Timestamp(maybe.seconds, maybe.nanoseconds ?? 0);
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const asDate = new Date(value);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }
  return null;
}

function createPromptSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return base || `prompt-${Date.now()}`;
}

function mapPromptDoc(id: string, data: DocumentData): AiPromptRecord {
  const name = normaliseString(data.name) ?? id;
  const content = normaliseString(data.content);
  if (!content) {
    throw new Error(`Prompt ${id} is missing content.`);
  }
  const status = isPromptStatus(data.status) ? (data.status as PromptStatus) : "draft";
  return {
    id,
    name,
    content,
    status,
    category: normaliseString(data.category),
    description: normaliseString(data.description),
    notes: normaliseString(data.notes),
    estimatedTokens: normaliseNumber(data.estimatedTokens),
    defaultModelId: normaliseString(data.defaultModelId),
    createdAt: parseTimestamp(data.createdAt),
    updatedAt: parseTimestamp(data.updatedAt),
  };
}

export async function ensurePromptRecord(
  name: string,
  template?: PromptTemplateDefinition
): Promise<AiPromptRecord> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Prompt name is required.");
  }

  const firestore = getFirebaseAdminFirestore();
  const collectionRef = firestore.collection("aiPrompts");
  const existingByName = await collectionRef.where("name", "==", trimmedName).limit(1).get();
  if (!existingByName.empty) {
    const docSnap = existingByName.docs[0];
    return mapPromptDoc(docSnap.id, docSnap.data() ?? {});
  }

  if (!template) {
    throw new Error(`Prompt \"${trimmedName}\" is not registered.`);
  }

  const slug = createPromptSlug(template.name ?? trimmedName);
  const slugRef = collectionRef.doc(slug);
  const slugSnap = await slugRef.get();
  if (slugSnap.exists) {
    return mapPromptDoc(slugSnap.id, slugSnap.data() ?? {});
  }

  const payload: Record<string, unknown> = {
    name: template.name ?? trimmedName,
    category: template.category ?? null,
    description: template.description ?? null,
    content: template.content,
    status: template.status ?? "draft",
    notes: template.notes ?? null,
    estimatedTokens: template.estimatedTokens ?? null,
    defaultModelId: template.defaultModelId ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await slugRef.set(payload, { merge: false });
  const createdSnap = await slugRef.get();
  return mapPromptDoc(createdSnap.id, createdSnap.data() ?? {});
}
