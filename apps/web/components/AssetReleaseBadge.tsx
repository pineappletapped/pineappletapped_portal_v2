import clsx from "clsx";

type Tone = "success" | "warning" | "info";

export interface AssetReleaseMeta {
  tone: Tone;
  label: string;
  description?: string | null;
  releasedAt?: Date | null;
}

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-900 border border-emerald-200",
  warning: "bg-amber-50 text-amber-900 border border-amber-200",
  info: "bg-sky-50 text-sky-900 border border-sky-200",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const parseTimestamp = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("Failed to convert timestamp", error);
      return null;
    }
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
};

export const getAssetReleaseMeta = (asset: any): AssetReleaseMeta | null => {
  if (!asset) return null;
  const deliverablesReleased = asset.deliverablesReleased === true;
  const releaseHoldReason =
    typeof asset.releaseHoldReason === "string" ? asset.releaseHoldReason : null;
  const status = typeof asset.status === "string" ? asset.status.toLowerCase() : "";
  const releaseHoldNote =
    typeof asset.releaseHoldNote === "string" ? asset.releaseHoldNote : null;
  const assetType =
    typeof asset.assetType === "string" ? asset.assetType.toLowerCase() : "";

  if (assetType === "flight_plan") {
    if (deliverablesReleased) {
      return {
        tone: "success",
        label: "Flight plan released",
        description:
          releaseHoldNote ||
          "Download the approved plan and brief the pilot before departure.",
      };
    }

    if (releaseHoldReason === "payment_pending") {
      return {
        tone: "warning",
        label: "Awaiting payment clearance",
        description:
          releaseHoldNote ||
          "Finance will unlock the flight plan once the outstanding balance is paid.",
      };
    }

    if (status === "approved" || status === "final" || status === "final_approved") {
      return {
        tone: "success",
        label: "Flight plan approved",
        description:
          releaseHoldNote ||
          "Crew can proceed once pre-flight safety checks are complete.",
      };
    }

    return {
      tone: "warning",
      label: "Airspace approval pending",
      description:
        releaseHoldNote ||
        "Operations must review the plan before drone work can be scheduled.",
    };
  }

  if (deliverablesReleased) {
    const releasedAt = parseTimestamp(asset.releaseReadyAt || asset.updatedAt);
    return {
      tone: "success",
      label: releasedAt ? `Download unlocked ${DATE_FORMAT.format(releasedAt)}` : "Download unlocked",
      description: "Use the download button to fetch the final deliverable.",
      releasedAt,
    };
  }

  if (releaseHoldReason === "payment_pending") {
    return {
      tone: "warning",
      label: "Awaiting payment clearance",
      description:
        releaseHoldNote ||
        "Finance will unlock downloads once the outstanding balance has been marked as paid.",
    };
  }

  if (status === "approved" || status === "final" || status === "final_approved") {
    return {
      tone: "info",
      label: "Ready to release",
      description:
        releaseHoldNote ||
        "Mark the invoice as paid to automatically unlock the download link for the client.",
    };
  }

  return null;
};

interface AssetReleaseBadgeProps {
  asset: any;
  className?: string;
}

export default function AssetReleaseBadge({ asset, className }: AssetReleaseBadgeProps) {
  const meta = getAssetReleaseMeta(asset);
  if (!meta) return null;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
        TONE_CLASSES[meta.tone],
        className
      )}
    >
      {meta.label}
    </span>
  );
}
