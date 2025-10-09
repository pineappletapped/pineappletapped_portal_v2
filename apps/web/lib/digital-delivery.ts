export type DigitalStatusKey =
  | "pending"
  | "processing"
  | "released"
  | "archived"
  | "partial";

export type DigitalStatusTone = DigitalStatusKey;

export interface DigitalStatusMeta {
  key: DigitalStatusKey;
  label: string;
  tone: DigitalStatusTone;
  description: string;
}

export const DIGITAL_STATUS_META: Record<DigitalStatusKey, DigitalStatusMeta> = {
  pending: {
    key: "pending",
    label: "Pending release",
    tone: "pending",
    description: "Awaiting upload from the production team.",
  },
  processing: {
    key: "processing",
    label: "Processing",
    tone: "processing",
    description: "The team is preparing the release for download.",
  },
  released: {
    key: "released",
    label: "Released",
    tone: "released",
    description: "Customers can download the final files.",
  },
  archived: {
    key: "archived",
    label: "Archived",
    tone: "archived",
    description: "This release has been archived for reference.",
  },
  partial: {
    key: "partial",
    label: "Partially released",
    tone: "partial",
    description: "Some items are live while others are still pending.",
  },
};

export function getDigitalStatusMeta(
  status: string | null | undefined
): DigitalStatusMeta | null {
  if (typeof status !== "string") {
    return null;
  }
  const key = status.trim().toLowerCase() as DigitalStatusKey;
  if (!key) {
    return null;
  }
  return DIGITAL_STATUS_META[key] ?? null;
}

export function formatDigitalTimestamp(value: unknown): string {
  if (!value) return "—";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "—" : value.toLocaleString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    try {
      const converted = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(converted.getTime()) ? "—" : converted.toLocaleString();
    } catch {
      return "—";
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "—";
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toLocaleString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { seconds?: number }).seconds === "number"
  ) {
    const seconds = (value as { seconds: number; nanoseconds?: number }).seconds;
    const millis = seconds * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
  }
  return "—";
}
