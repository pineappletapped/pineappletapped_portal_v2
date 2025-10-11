import type { Timestamp } from "firebase/firestore";

export type InsuranceTargetType = "user" | "franchise";

export type InsuranceCoverageStatus =
  | "covered"
  | "needs_action"
  | "revoked"
  | "external";

export type TimestampLike = Timestamp | Date | string | number | null | undefined;

export interface InsurancePolicyActivityValidation {
  id: string;
  activity: string;
  notes?: string | null;
}

export interface InsuranceAttachmentRecord {
  id: string;
  label: string;
  fileName: string;
  url: string;
  storagePath: string;
  description?: string | null;
  requireAcknowledgement: boolean;
  renewalDays?: number | null;
  coverageLevel?: string | null;
  lastUpdatedAt?: TimestampLike | null;
}

export interface InsuranceTrainingRequirement {
  id: string;
  moduleId: string;
  moduleTitle: string;
  renewalDays?: number | null;
}

export interface InsuranceAcknowledgementRequirement {
  id: string;
  attachmentId: string;
  label: string;
  renewalDays?: number | null;
}

export interface InsurancePolicyRecord {
  id: string;
  name: string;
  coverageLevel?: string | null;
  coverageLimit?: string | null;
  description?: string | null;
  coverageNotes?: string | null;
  appliesToAllFranchises: boolean;
  appliesToAllTeam: boolean;
  activitiesCovered: string[];
  activityValidations: InsurancePolicyActivityValidation[];
  attachments: InsuranceAttachmentRecord[];
  trainingRequirements: InsuranceTrainingRequirement[];
  acknowledgementRequirements: InsuranceAcknowledgementRequirement[];
  createdAt?: TimestampLike | null;
  updatedAt?: TimestampLike | null;
}

export interface InsuranceAcknowledgementRecord {
  id: string;
  policyId: string;
  attachmentId: string;
  targetType: InsuranceTargetType;
  targetId: string;
  acknowledgedBy: string;
  acknowledgedAt: Date | null;
  expiresAt: Date | null;
  notes?: string | null;
}

export interface InsuranceAssignmentManualOverride {
  status: Exclude<InsuranceCoverageStatus, "needs_action">;
  note?: string | null;
  updatedAt: Date | null;
  updatedBy?: string | null;
}

export interface InsuranceAssignmentRecord {
  id: string;
  policyId: string;
  targetType: InsuranceTargetType;
  targetId: string;
  status: InsuranceCoverageStatus;
  expiresAt: Date | null;
  missingRequirements: string[];
  validatedActivities: string[];
  trackedMemberIds: string[];
  requiresExternalPolicy: boolean;
  externalPolicyUrl?: string | null;
  externalPolicyFileUrl?: string | null;
  externalPolicyExpiry?: Date | null;
  manualOverride?: InsuranceAssignmentManualOverride | null;
  lastEvaluatedAt?: Date | null;
  evaluationNotes?: string | null;
}

export interface InsuranceRequirementEvaluation {
  id: string;
  label: string;
  satisfied: boolean;
  expiresAt: Date | null;
  lastCompletedAt: Date | null;
  requirementType: "training" | "acknowledgement";
  context?: string | null;
}

export interface InsuranceEvaluationResult {
  status: InsuranceCoverageStatus;
  expiresAt: Date | null;
  missing: string[];
  requirements: InsuranceRequirementEvaluation[];
}

export const timestampToDate = (value: TimestampLike): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && typeof (value as Timestamp).toDate === "function") {
    try {
      return (value as Timestamp).toDate();
    } catch (error) {
      console.warn("Failed to convert timestamp via toDate", error);
    }
  }
  if (typeof value === "object" && value !== null && typeof (value as Timestamp).toMillis === "function") {
    try {
      return new Date((value as Timestamp).toMillis() ?? NaN);
    } catch (error) {
      console.warn("Failed to convert timestamp via toMillis", error);
    }
  }
  const parsed = new Date(value as Exclude<TimestampLike, Timestamp | Date | null | undefined>);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normaliseStringArray = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item): item is string => item.length > 0)
    )
  );
};

const normaliseRenewalDays = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.max(0, Math.round(parsed));
  return Number.isFinite(rounded) ? rounded : null;
};

const randomId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

export const parseInsurancePolicyDoc = (
  id: string,
  data: Record<string, unknown>
): InsurancePolicyRecord => {
  const attachments = Array.isArray(data.attachments)
    ? data.attachments
        .map((attachment) => {
          if (!attachment || typeof attachment !== "object") return null;
          const record = attachment as Record<string, unknown>;
          const attachmentId =
            typeof record.id === "string" && record.id.trim().length > 0
              ? record.id.trim()
              : randomId("attachment");
          const label = typeof record.label === "string" ? record.label.trim() : "Untitled attachment";
          const fileName = typeof record.fileName === "string" ? record.fileName : label;
          const url = typeof record.url === "string" ? record.url : "";
          const storagePath = typeof record.storagePath === "string" ? record.storagePath : "";
          if (!url || !storagePath) {
            return null;
          }
          return {
            id: attachmentId,
            label,
            fileName,
            url,
            storagePath,
            description:
              typeof record.description === "string" && record.description.trim().length > 0
                ? record.description.trim()
                : null,
            requireAcknowledgement: record.requireAcknowledgement === true,
            renewalDays: normaliseRenewalDays(record.renewalDays),
            coverageLevel:
              typeof record.coverageLevel === "string" && record.coverageLevel.trim().length > 0
                ? record.coverageLevel.trim()
                : null,
            lastUpdatedAt: timestampToDate(record.lastUpdatedAt as TimestampLike) ?? null,
          } satisfies InsuranceAttachmentRecord;
        })
        .filter((attachment): attachment is InsuranceAttachmentRecord => Boolean(attachment))
    : [];

  const trainingRequirements = Array.isArray(data.trainingRequirements)
    ? data.trainingRequirements
        .map((raw) => {
          if (!raw || typeof raw !== "object") return null;
          const record = raw as Record<string, unknown>;
          const moduleId = typeof record.moduleId === "string" ? record.moduleId.trim() : "";
          if (!moduleId) return null;
          const requirementId =
            typeof record.id === "string" && record.id.trim().length > 0
              ? record.id.trim()
              : `${moduleId}-${randomId("training")}`;
          return {
            id: requirementId,
            moduleId,
            moduleTitle:
              typeof record.moduleTitle === "string" && record.moduleTitle.trim().length > 0
                ? record.moduleTitle.trim()
                : "Training module",
            renewalDays: normaliseRenewalDays(record.renewalDays),
          } satisfies InsuranceTrainingRequirement;
        })
        .filter((requirement): requirement is InsuranceTrainingRequirement => Boolean(requirement))
    : [];

  const acknowledgementRequirements = Array.isArray(data.acknowledgementRequirements)
    ? data.acknowledgementRequirements
        .map((raw) => {
          if (!raw || typeof raw !== "object") return null;
          const record = raw as Record<string, unknown>;
          const attachmentId = typeof record.attachmentId === "string" ? record.attachmentId.trim() : "";
          if (!attachmentId) return null;
          const requirementId =
            typeof record.id === "string" && record.id.trim().length > 0
              ? record.id.trim()
              : `${attachmentId}-${randomId("ack")}`;
          return {
            id: requirementId,
            attachmentId,
            label:
              typeof record.label === "string" && record.label.trim().length > 0
                ? record.label.trim()
                : "Policy acknowledgement",
            renewalDays: normaliseRenewalDays(record.renewalDays),
          } satisfies InsuranceAcknowledgementRequirement;
        })
        .filter((requirement): requirement is InsuranceAcknowledgementRequirement => Boolean(requirement))
    : [];

  const activityValidations = Array.isArray(data.activityValidations)
    ? data.activityValidations
        .map((raw) => {
          if (!raw || typeof raw !== "object") return null;
          const record = raw as Record<string, unknown>;
          const activity = typeof record.activity === "string" ? record.activity.trim() : "";
          if (!activity) return null;
          return {
            id:
              typeof record.id === "string" && record.id.trim().length > 0
                ? record.id.trim()
                : randomId("activity"),
            activity,
            notes:
              typeof record.notes === "string" && record.notes.trim().length > 0
                ? record.notes.trim()
                : null,
          } satisfies InsurancePolicyActivityValidation;
        })
        .filter((item): item is InsurancePolicyActivityValidation => Boolean(item))
    : [];

  return {
    id,
    name: typeof data.name === "string" ? data.name : "Insurance policy",
    coverageLevel:
      typeof data.coverageLevel === "string" && data.coverageLevel.trim().length > 0
        ? data.coverageLevel.trim()
        : null,
    coverageLimit:
      typeof data.coverageLimit === "string" && data.coverageLimit.trim().length > 0
        ? data.coverageLimit.trim()
        : null,
    description:
      typeof data.description === "string" && data.description.trim().length > 0
        ? data.description.trim()
        : null,
    coverageNotes:
      typeof data.coverageNotes === "string" && data.coverageNotes.trim().length > 0
        ? data.coverageNotes.trim()
        : null,
    appliesToAllFranchises: data.appliesToAllFranchises === true,
    appliesToAllTeam: data.appliesToAllTeam === true,
    activitiesCovered: normaliseStringArray(data.activitiesCovered),
    activityValidations,
    attachments,
    trainingRequirements,
    acknowledgementRequirements,
    createdAt: timestampToDate(data.createdAt as TimestampLike) ?? null,
    updatedAt: timestampToDate(data.updatedAt as TimestampLike) ?? null,
  } satisfies InsurancePolicyRecord;
};

export const parseInsuranceAcknowledgementDoc = (
  id: string,
  data: Record<string, unknown>
): InsuranceAcknowledgementRecord => {
  return {
    id,
    policyId: typeof data.policyId === "string" ? data.policyId : "",
    attachmentId: typeof data.attachmentId === "string" ? data.attachmentId : "",
    targetType: data.targetType === "franchise" ? "franchise" : "user",
    targetId: typeof data.targetId === "string" ? data.targetId : "",
    acknowledgedBy: typeof data.acknowledgedBy === "string" ? data.acknowledgedBy : "",
    acknowledgedAt: timestampToDate(data.acknowledgedAt as TimestampLike),
    expiresAt: timestampToDate(data.expiresAt as TimestampLike),
    notes: typeof data.notes === "string" ? data.notes : null,
  } satisfies InsuranceAcknowledgementRecord;
};

export const parseInsuranceAssignmentDoc = (
  id: string,
  data: Record<string, unknown>
): InsuranceAssignmentRecord => {
  const overrideRaw = data.manualOverride;
  const manualOverride: InsuranceAssignmentManualOverride | null =
    overrideRaw && typeof overrideRaw === "object"
      ? {
          status:
            (overrideRaw as Record<string, unknown>).status === "revoked"
              ? "revoked"
              : (overrideRaw as Record<string, unknown>).status === "external"
                ? "external"
                : "covered",
          note:
            typeof (overrideRaw as Record<string, unknown>).note === "string"
              ? (overrideRaw as Record<string, unknown>).note
              : null,
          updatedAt: timestampToDate((overrideRaw as Record<string, unknown>).updatedAt as TimestampLike),
          updatedBy:
            typeof (overrideRaw as Record<string, unknown>).updatedBy === "string"
              ? (overrideRaw as Record<string, unknown>).updatedBy
              : null,
        }
      : null;

  const statusValue =
    data.status === "revoked"
      ? "revoked"
      : data.status === "external"
        ? "external"
        : data.status === "covered"
          ? "covered"
          : "needs_action";

  return {
    id,
    policyId: typeof data.policyId === "string" ? data.policyId : "",
    targetType: data.targetType === "franchise" ? "franchise" : "user",
    targetId: typeof data.targetId === "string" ? data.targetId : "",
    status: statusValue,
    expiresAt: timestampToDate(data.expiresAt as TimestampLike),
    missingRequirements: normaliseStringArray(data.missingRequirements),
    validatedActivities: normaliseStringArray(data.validatedActivities),
    trackedMemberIds: normaliseStringArray(data.trackedMemberIds),
    requiresExternalPolicy: data.requiresExternalPolicy === true,
    externalPolicyUrl:
      typeof data.externalPolicyUrl === "string" && data.externalPolicyUrl.trim().length > 0
        ? data.externalPolicyUrl.trim()
        : null,
    externalPolicyFileUrl:
      typeof data.externalPolicyFileUrl === "string" && data.externalPolicyFileUrl.trim().length > 0
        ? data.externalPolicyFileUrl.trim()
        : null,
    externalPolicyExpiry: timestampToDate(data.externalPolicyExpiry as TimestampLike),
    manualOverride,
    lastEvaluatedAt: timestampToDate(data.lastEvaluatedAt as TimestampLike),
    evaluationNotes:
      typeof data.evaluationNotes === "string" && data.evaluationNotes.trim().length > 0
        ? data.evaluationNotes.trim()
        : null,
  } satisfies InsuranceAssignmentRecord;
};

const MINUTES_PER_DAY = 60 * 24;

const computeRenewalExpiry = (lastCompletedAt: Date | null, renewalDays: number | null | undefined) => {
  if (!lastCompletedAt) return null;
  if (!renewalDays || renewalDays <= 0) {
    return null;
  }
  const expiry = new Date(lastCompletedAt);
  expiry.setMinutes(expiry.getMinutes() + renewalDays * MINUTES_PER_DAY);
  return expiry;
};

export interface TrainingEngagementMap {
  [moduleId: string]: Date | null;
}

export interface AcknowledgementMap {
  [attachmentId: string]: { acknowledgedAt: Date | null; expiresAt: Date | null } | undefined;
}

export interface AssignmentEvaluationContext {
  training: TrainingEngagementMap;
  acknowledgements: AcknowledgementMap;
  manualOverride?: InsuranceAssignmentManualOverride | null;
  requiresExternalPolicy?: boolean;
  externalPolicyExpiry?: Date | null;
  trainingNotes?: Record<string, string | null | undefined>;
  acknowledgementNotes?: Record<string, string | null | undefined>;
}

export const evaluateInsuranceAssignment = (
  policy: InsurancePolicyRecord,
  assignment: InsuranceAssignmentRecord,
  context: AssignmentEvaluationContext
): InsuranceEvaluationResult => {
  const requirements: InsuranceRequirementEvaluation[] = [];
  const missing: string[] = [];

  policy.trainingRequirements.forEach((requirement) => {
    const lastCompletedAt = context.training[requirement.moduleId] ?? null;
    const expiresAt = computeRenewalExpiry(lastCompletedAt, requirement.renewalDays ?? null);
    const satisfied = Boolean(lastCompletedAt) && (!expiresAt || expiresAt > new Date());
    const renewalText = requirement.renewalDays
      ? `Retake every ${requirement.renewalDays} days`
      : "Complete once";
    if (!satisfied) {
      const detail = context.trainingNotes?.[requirement.moduleId];
      missing.push(detail ? `${requirement.moduleTitle} — ${detail}` : `${requirement.moduleTitle} (${renewalText})`);
    }
    requirements.push({
      id: requirement.id,
      label: requirement.moduleTitle,
      satisfied,
      expiresAt,
      lastCompletedAt,
      requirementType: "training",
      context:
        context.trainingNotes?.[requirement.moduleId] ??
        (requirement.renewalDays ? `${requirement.renewalDays} day refresh` : null),
    });
  });

  policy.acknowledgementRequirements.forEach((requirement) => {
    const record = context.acknowledgements[requirement.attachmentId];
    const acknowledgedAt = record?.acknowledgedAt ?? null;
    const expiresAt = record?.expiresAt ?? null;
    const satisfied = Boolean(acknowledgedAt) && (!expiresAt || expiresAt > new Date());
    const renewalText = requirement.renewalDays
      ? `Acknowledge every ${requirement.renewalDays} days`
      : "Acknowledge";
    if (!satisfied) {
      const detail = context.acknowledgementNotes?.[requirement.attachmentId];
      missing.push(detail ? `${requirement.label} — ${detail}` : `${requirement.label} (${renewalText})`);
    }
    requirements.push({
      id: requirement.id,
      label: requirement.label,
      satisfied,
      expiresAt,
      lastCompletedAt: acknowledgedAt,
      requirementType: "acknowledgement",
      context:
        context.acknowledgementNotes?.[requirement.attachmentId] ??
        (requirement.renewalDays ? `${requirement.renewalDays} day renewal` : null),
    });
  });

  let status: InsuranceCoverageStatus = missing.length === 0 ? "covered" : "needs_action";
  let expiresAt: Date | null = null;

  requirements.forEach((requirement) => {
    if (requirement.expiresAt) {
      if (!expiresAt || requirement.expiresAt < expiresAt) {
        expiresAt = requirement.expiresAt;
      }
    }
  });

  if (context.requiresExternalPolicy) {
    status = "external";
    expiresAt = context.externalPolicyExpiry ?? expiresAt;
  }

  if (context.manualOverride) {
    status = context.manualOverride.status;
  }

  return { status, expiresAt, missing, requirements } satisfies InsuranceEvaluationResult;
};

export const getCoverageStatusLabel = (status: InsuranceCoverageStatus): string => {
  switch (status) {
    case "covered":
      return "Covered";
    case "needs_action":
      return "Needs action";
    case "revoked":
      return "Coverage revoked";
    case "external":
      return "External policy";
    default:
      return status;
  }
};

export const getCoverageStatusTone = (status: InsuranceCoverageStatus):
  | "default"
  | "info"
  | "danger"
  | "success"
  | "muted" => {
  switch (status) {
    case "covered":
      return "success";
    case "needs_action":
      return "info";
    case "revoked":
      return "danger";
    case "external":
      return "muted";
    default:
      return "default";
  }
};

