import type { DerivedComplianceStatus } from "@/lib/compliance";

const STATUS_STYLES: Record<DerivedComplianceStatus, string> = {
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  missing: "bg-slate-100 text-slate-700 border-slate-200",
  expired: "bg-red-100 text-red-700 border-red-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
};

const STATUS_LABELS: Record<DerivedComplianceStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  missing: "Action needed",
  expired: "Expired",
  rejected: "Rejected",
};

interface ComplianceBadgeProps {
  status: DerivedComplianceStatus;
  title?: string;
  className?: string;
}

const sanitiseAriaLabel = (label: string | undefined, fallback: string) => {
  if (!label) return fallback;
  return `${fallback}. ${label}`
    .replace(/\s+/g, " ")
    .trim();
};

export default function ComplianceBadge({
  status,
  title,
  className = "",
}: ComplianceBadgeProps) {
  const baseClass =
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium";
  const label = STATUS_LABELS[status];
  const ariaLabel = sanitiseAriaLabel(title, label);

  return (
    <span
      className={`${baseClass} ${STATUS_STYLES[status]} ${className}`.trim()}
      title={title}
      aria-label={ariaLabel}
    >
      {label}
    </span>
  );
}

