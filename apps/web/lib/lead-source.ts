import type { ReadonlyURLSearchParams } from "next/navigation";

export type LeadSourceKind =
  | "hq"
  | "franchise_referral"
  | "franchise_affiliate"
  | "franchise_voucher"
  | "other";

export interface LeadSourceState {
  kind: LeadSourceKind;
  detail: string;
}

export const defaultLeadSourceState: LeadSourceState = {
  kind: "hq",
  detail: "",
};

export const franchiseKeywordHints = [
  "franchise",
  "territory",
  "operator",
  "referral",
];

export const affiliateKeywordHints = ["affiliate", "partner", "influencer"];

const voucherKeywordHints = ["voucher", "promo", "promotion", "code"];

const clean = (value: string | null | undefined): string =>
  (value ?? "").trim();

const hasKeyword = (value: string, keywords: string[]): boolean => {
  const lower = value.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
};

export const isDefaultLeadSourceState = (state: LeadSourceState): boolean =>
  state.kind === "hq" && clean(state.detail) === "";

const interpretLeadHint = (hint: string): LeadSourceState => {
  const trimmed = clean(hint);
  if (!trimmed) {
    return { ...defaultLeadSourceState };
  }
  const lower = trimmed.toLowerCase();
  if (hasKeyword(lower, voucherKeywordHints)) {
    return { kind: "franchise_voucher", detail: trimmed.replace(/^[^:]*:/, "") };
  }
  if (hasKeyword(lower, affiliateKeywordHints)) {
    return { kind: "franchise_affiliate", detail: trimmed };
  }
  if (hasKeyword(lower, franchiseKeywordHints)) {
    return { kind: "franchise_referral", detail: trimmed };
  }
  return { kind: "other", detail: trimmed };
};

const getParam = (
  params: URLSearchParams | ReadonlyURLSearchParams,
  key: string
): string | null => {
  const value = params.get(key);
  const trimmed = clean(value);
  return trimmed ? trimmed : null;
};

export const deriveLeadSourceFromParams = (
  params: URLSearchParams | ReadonlyURLSearchParams | null
): LeadSourceState | null => {
  if (!params) {
    return null;
  }

  const explicit = getParam(params, "leadSource") ?? getParam(params, "lead");
  if (explicit) {
    return interpretLeadHint(explicit);
  }

  const franchise =
    getParam(params, "franchise") ??
    getParam(params, "territory") ??
    getParam(params, "operator");
  if (franchise) {
    return { kind: "franchise_referral", detail: franchise };
  }

  const affiliate =
    getParam(params, "affiliate") ??
    getParam(params, "partner") ??
    getParam(params, "ref") ??
    getParam(params, "referral");
  if (affiliate) {
    return { kind: "franchise_affiliate", detail: affiliate };
  }

  const voucher =
    getParam(params, "voucher") ??
    getParam(params, "promo") ??
    getParam(params, "promoCode");
  if (voucher) {
    return { kind: "franchise_voucher", detail: voucher };
  }

  const utmValues = [
    getParam(params, "utm_source"),
    getParam(params, "utm_campaign"),
    getParam(params, "utm_medium"),
  ].filter(Boolean) as string[];
  if (utmValues.length) {
    const combined = utmValues.join(" ").toLowerCase();
    if (hasKeyword(combined, franchiseKeywordHints)) {
      return {
        kind: "franchise_referral",
        detail: utmValues.find((v) => hasKeyword(v.toLowerCase(), franchiseKeywordHints)) ??
          utmValues[0],
      };
    }
    if (hasKeyword(combined, affiliateKeywordHints)) {
      return {
        kind: "franchise_affiliate",
        detail: utmValues.find((v) => hasKeyword(v.toLowerCase(), affiliateKeywordHints)) ??
          utmValues[0],
      };
    }
  }

  return null;
};

const detailOrFallback = (detail: string, fallback?: string | null): string => {
  const trimmed = clean(detail);
  if (trimmed) {
    return trimmed;
  }
  const fallbackTrimmed = clean(fallback ?? "");
  return fallbackTrimmed;
};

export const encodeLeadSourceValue = (
  state: LeadSourceState,
  fallbackVoucher?: string | null
): string => {
  switch (state.kind) {
    case "franchise_referral": {
      const detail = clean(state.detail);
      return detail ? `franchise_referral:${detail}` : "franchise_referral";
    }
    case "franchise_affiliate": {
      const detail = clean(state.detail);
      return detail ? `franchise_affiliate:${detail}` : "franchise_affiliate";
    }
    case "franchise_voucher": {
      const detail = detailOrFallback(state.detail, fallbackVoucher);
      return detail ? `franchise_voucher:${detail}` : "franchise_voucher";
    }
    case "other": {
      const detail = clean(state.detail);
      return detail || "other";
    }
    case "hq":
    default: {
      const detail = clean(state.detail);
      return detail || "hq";
    }
  }
};

export const leadSourceKindLabel = (kind: LeadSourceKind): string => {
  switch (kind) {
    case "franchise_referral":
      return "Franchise referral";
    case "franchise_affiliate":
      return "Franchise affiliate or partner link";
    case "franchise_voucher":
      return "Franchise voucher or promo code";
    case "other":
      return "Other";
    case "hq":
    default:
      return "Head office marketing";
  }
};

export const leadSourceDetailPlaceholder = (kind: LeadSourceKind): string => {
  switch (kind) {
    case "franchise_referral":
      return "Franchise name, operator or territory";
    case "franchise_affiliate":
      return "Affiliate code or partner campaign";
    case "franchise_voucher":
      return "Voucher or promo code";
    case "other":
      return "Describe the lead source";
    case "hq":
    default:
      return "";
  }
};

export const describeLeadSource = (
  value: string | null | undefined
): string => {
  const raw = clean(value);
  if (!raw) {
    return "HQ marketing";
  }
  const lower = raw.toLowerCase();
  const [prefix, ...rest] = raw.split(":");
  const detail = clean(rest.join(":"));
  if (lower.startsWith("franchise_referral")) {
    return detail ? `Franchise referral (${detail})` : "Franchise referral";
  }
  if (lower.startsWith("franchise_affiliate")) {
    return detail ? `Franchise affiliate (${detail})` : "Franchise affiliate";
  }
  if (lower.startsWith("franchise_voucher")) {
    return detail ? `Franchise voucher (${detail})` : "Franchise voucher";
  }
  if (lower === "hq") {
    return "HQ marketing";
  }
  if (lower.startsWith("other")) {
    return detail ? `Other (${detail})` : "Other";
  }
  if (hasKeyword(lower, franchiseKeywordHints) || hasKeyword(lower, affiliateKeywordHints)) {
    return detail ? `Franchise lead (${detail})` : "Franchise lead";
  }
  return prefix;
};

