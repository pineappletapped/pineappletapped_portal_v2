export const DRONE_STANDARD_ID = "drone_compliance";

export type ComplianceWorkflowStatus =
  | "pending"
  | "approved"
  | "rejected";

export type DerivedComplianceStatus =
  | "missing"
  | "pending"
  | "approved"
  | "expired"
  | "rejected";

export interface ComplianceRecord {
  id: string;
  uid: string;
  status?: ComplianceWorkflowStatus | string | null;
  licenceUrl?: string | null;
  licenceName?: string | null;
  licenceExpiry?: unknown;
  licenceUploadedAt?: unknown;
  insuranceUrl?: string | null;
  insuranceName?: string | null;
  insuranceExpiry?: unknown;
  insuranceUploadedAt?: unknown;
  reviewNotes?: string | null;
  reviewerUid?: string | null;
  reviewedAt?: unknown;
  submittedAt?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
}

export interface ComplianceState {
  status: DerivedComplianceStatus;
  licenceExpiry: Date | null;
  insuranceExpiry: Date | null;
  issues: string[];
  licenceExpired: boolean;
  insuranceExpired: boolean;
  expiresSoon: boolean;
  missingDocuments: boolean;
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && value) {
    if (typeof (value as any).toDate === "function") {
      try {
        return (value as any).toDate();
      } catch (error) {
        console.warn("Failed to convert compliance date", error);
        return null;
      }
    }
    if (
      typeof (value as any).seconds === "number" &&
      typeof (value as any).nanoseconds === "number"
    ) {
      const millis = (value as any).seconds * 1000 + Math.round((value as any).nanoseconds / 1_000_000);
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return null;
};

export const complianceDateToInputValue = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return "";
  const iso = date.toISOString();
  return iso.slice(0, 10);
};

export const complianceDateToDisplay = (value: unknown): string => {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export const deriveComplianceState = (
  record: ComplianceRecord | null | undefined
): ComplianceState => {
  if (!record) {
    return {
      status: "missing",
      licenceExpiry: null,
      insuranceExpiry: null,
      issues: ["Upload your drone licence and insurance certificates."],
      licenceExpired: true,
      insuranceExpired: true,
      expiresSoon: false,
      missingDocuments: true,
    };
  }

  const status =
    typeof record.status === "string" && record.status
      ? (record.status as ComplianceWorkflowStatus | string)
      : "pending";

  const licenceExpiry = toDate(record.licenceExpiry);
  const insuranceExpiry = toDate(record.insuranceExpiry);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const soonThreshold = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);

  const licenceExpired = !licenceExpiry || licenceExpiry.getTime() < now.getTime();
  const insuranceExpired = !insuranceExpiry || insuranceExpiry.getTime() < now.getTime();
  const expiresSoon =
    (!!licenceExpiry && licenceExpiry.getTime() < soonThreshold.getTime() && !licenceExpired) ||
    (!!insuranceExpiry && insuranceExpiry.getTime() < soonThreshold.getTime() && !insuranceExpired);

  const hasLicence = typeof record.licenceUrl === "string" && record.licenceUrl.length > 0;
  const hasInsurance = typeof record.insuranceUrl === "string" && record.insuranceUrl.length > 0;
  const missingDocuments = !hasLicence || !hasInsurance;

  const issues: string[] = [];

  if (missingDocuments) {
    issues.push("Both licence and insurance documents are required.");
  }

  if (licenceExpired) {
    issues.push("Your licence has expired.");
  } else if (licenceExpiry && expiresSoon) {
    issues.push("Licence is expiring soon.");
  }

  if (insuranceExpired) {
    issues.push("Your insurance has expired.");
  } else if (insuranceExpiry && expiresSoon) {
    issues.push("Insurance is expiring soon.");
  }

  let derived: DerivedComplianceStatus = "pending";

  if (status === "rejected") {
    derived = "rejected";
    if (issues.length === 0) {
      issues.push("HQ requested updates to your compliance documents.");
    }
  } else if (missingDocuments) {
    derived = "missing";
  } else if (licenceExpired || insuranceExpired) {
    derived = "expired";
  } else if (status === "approved") {
    derived = "approved";
  } else {
    derived = "pending";
    if (issues.length === 0) {
      issues.push("Compliance is awaiting HQ review.");
    }
  }

  return {
    status: derived,
    licenceExpiry,
    insuranceExpiry,
    issues,
    licenceExpired,
    insuranceExpired,
    expiresSoon,
    missingDocuments,
  };
};

export const isComplianceApproved = (state: ComplianceState): boolean =>
  state.status === "approved";

