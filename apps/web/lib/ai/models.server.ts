import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { getFirebaseAdminFirestore } from "@/lib/firebase-admin";

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
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export type AiModelStatus = "active" | "pilot" | "inactive" | "deprecated";

export interface AiModelRecord {
  id: string;
  name: string;
  provider: string | null;
  modelId: string | null;
  status: AiModelStatus;
  description: string | null;
  endpoint: string | null;
  apiKey: string | null;
  currency: string | null;
  inputCostPer1k: number | null;
  outputCostPer1k: number | null;
  notes: string | null;
  createdAt: Timestamp | Date | null;
  updatedAt: Timestamp | Date | null;
}

function isModelStatus(value: unknown): value is AiModelStatus {
  return value === "active" || value === "pilot" || value === "inactive" || value === "deprecated";
}

export async function getAiModelRecordById(id: string): Promise<AiModelRecord | null> {
  const firestore = getFirebaseAdminFirestore();
  const docRef = firestore.collection("aiModels").doc(id);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() ?? {};
  const status = isModelStatus(data.status) ? (data.status as AiModelStatus) : "inactive";
  return {
    id: snapshot.id,
    name: normaliseString(data.name) ?? snapshot.id,
    provider: normaliseString(data.provider),
    modelId: normaliseString(data.modelId),
    status,
    description: normaliseString(data.description),
    endpoint: normaliseString(data.endpoint),
    apiKey: normaliseString(data.apiKey),
    currency: normaliseString(data.currency),
    inputCostPer1k: normaliseNumber(data.inputCostPer1k),
    outputCostPer1k: normaliseNumber(data.outputCostPer1k),
    notes: normaliseString(data.notes),
    createdAt: parseTimestamp(data.createdAt),
    updatedAt: parseTimestamp(data.updatedAt),
  };
}
