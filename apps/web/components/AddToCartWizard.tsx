"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Product,
  ProductModifierSelection,
  getProductEventWindow,
  resolveProductOnsiteDays,
  formatProductOnsiteDuration,
  getProductEventRangeLabel,
  getProductEventMonthKeys,
  resolveProductOnsiteTiming,
  type ProductOnsiteTiming,
  type ProductOrderFieldType,
} from "@/lib/products";
import { useCart } from "@/lib/cart";
import { db, ensureFirebase } from "@/lib/firebase";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import {
  isOrganiserProgramEnabled,
  normaliseOrganiserId,
  normaliseOrganiserProgram,
  type OrganiserAccessContext,
} from "@/lib/organisers";
import clsx from "clsx";
import ProductDatePicker, {
  type ProductAvailabilityScope,
  type ProductAvailabilityStatus,
} from "./ProductDatePicker";
import {
  getPriceForTier,
  normalisePriceTierLevel,
  type PriceTierLevel,
  type PriceTiers,
} from "@/lib/pricing";
import {
  DEFAULT_KIT_ROUTING_SETTINGS,
  cloneKitRoutingSettings,
  parseKitRoutingSettings,
  resolveRoutingAttempts,
  type KitRoutingSettings,
} from "@/lib/kit-routing";

interface ModifierOption {
  id: string;
  name: string;
  basePrice: number;
  priceTiers?: PriceTiers | null;
}

interface ModifierGroup {
  id: string;
  name: string;
  multiple: boolean;
  options: ModifierOption[];
}

interface Props {
  product: Product;
  variationId?: string;
  basePrice: number;
  onClose: () => void;
  organiserContext?: OrganiserAccessContext;
}

const DRONE_STANDARD_ID = "drone_compliance";
const parseOptionalNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

interface PostalCodeEntry {
  raw: string;
  normalised: string;
}

interface TerritoryRecord {
  id: string;
  label: string | null;
  type: "postal" | "radius";
  franchiseId: string | null;
  exclusive: boolean;
  postalCodes: PostalCodeEntry[];
  radiusKm: number | null;
  centerLat: number | null;
  centerLng: number | null;
  priceTier: PriceTierLevel;
}

interface FranchiseRecord {
  id: string;
  name: string | null;
  code: string | null;
}

interface CampaignSlotRecord {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  booked: number;
  priceClass: string | null;
  priceAdjustment: number;
  notes: string;
  held: number;
}

type TerritoryMatchType = "exact" | "prefix" | "superset" | "radius" | "venue";

interface TerritoryMatch {
  territoryId: string;
  territoryLabel: string | null;
  territoryPostalCode: string;
  franchiseId: string | null;
  exclusive: boolean;
  priceTier: PriceTierLevel;
  hqFallback: boolean;
  matchType: TerritoryMatchType;
}

interface CoverageAssignment {
  type: "hq" | "franchise";
  franchiseId: string | null;
  territoryId: string | null;
  territoryLabel: string | null;
  priceTier: PriceTierLevel;
  hqFallback: boolean;
  label: string;
  postalCode: string | null;
  matchType: TerritoryMatchType | "hq";
}

type CoverageStatus = "idle" | "loading" | "success" | "error";
type CampaignSlotStatus = "idle" | "loading" | "success" | "error";

interface PostcodeLookupResult {
  resolved: string;
  lat: number | null;
  lng: number | null;
}

type OrderFormQuestion = {
  id: string;
  label: string;
  description: string | null;
  required: boolean;
  type: ProductOrderFieldType;
};

const normalisePostalCode = (value: string): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : null;
};

const extractPostalCodes = (input: unknown): PostalCodeEntry[] => {
  const rawValues: string[] = [];
  if (Array.isArray(input)) {
    input.forEach((entry) => {
      if (typeof entry === "string" && entry.trim().length > 0) {
        rawValues.push(entry);
      } else if (entry != null) {
        rawValues.push(String(entry));
      }
    });
  } else if (typeof input === "string") {
    rawValues.push(input);
  }
  const expanded = rawValues.flatMap((value) =>
    value
      .split(/\r?\n|,/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
  );
  return expanded
    .map((value) => {
      const normalised = normalisePostalCode(value);
      if (!normalised) return null;
      return { raw: value, normalised };
    })
    .filter((value): value is PostalCodeEntry => value !== null);
};

const parsePriceTiers = (input: unknown): PriceTiers | null => {
  if (!input || typeof input !== "object") {
    return null;
  }
  const result: PriceTiers = {};
  let hasValue = false;
  const data = input as Record<string, unknown>;
  ("tier1" in data ? ["tier1", "tier2", "tier3"] : Object.keys(data)).forEach((key) => {
    if (key === "tier1" || key === "tier2" || key === "tier3") {
      const raw = data[key];
      const num = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(num)) {
        (result as any)[key] = num;
        hasValue = true;
      }
    }
  });
  return hasValue ? result : null;
};

const toFiniteOrNull = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

const haversineDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const toRad = (val: number) => (val * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Number.isFinite(distance) ? distance : Number.NaN;
};

const resolveTerritoryMatch = (
  territories: TerritoryRecord[],
  postalCode: string,
  geocode: PostcodeLookupResult | null
): TerritoryMatch | null => {
  const normalisedInput = normalisePostalCode(postalCode);
  if (!normalisedInput) {
    return null;
  }
  let best: { score: number; match: TerritoryMatch } | null = null;
  for (const territory of territories) {
    const hasFranchise = Boolean(territory.franchiseId);
    if (territory.type === "postal") {
      for (const code of territory.postalCodes) {
        let matchType: TerritoryMatchType | null = null;
        let score = 0;
        if (code.normalised === normalisedInput) {
          matchType = "exact";
          score = 2000 + code.normalised.length;
        } else if (normalisedInput.startsWith(code.normalised)) {
          matchType = "prefix";
          score = 1200 + code.normalised.length;
        } else if (code.normalised.startsWith(normalisedInput)) {
          matchType = "superset";
          score = 800 + normalisedInput.length;
        }
        if (!matchType) {
          continue;
        }
        if (territory.exclusive) {
          score += 50;
        }
        if (!hasFranchise) {
          score -= 25;
        }
        const candidate: TerritoryMatch = {
          territoryId: territory.id,
          territoryLabel: territory.label,
          territoryPostalCode: code.normalised,
          franchiseId: territory.franchiseId,
          exclusive: territory.exclusive,
          priceTier: territory.priceTier,
          hqFallback: !hasFranchise,
          matchType,
        };
        if (!best || score > best.score) {
          best = { score, match: candidate };
        }
      }
      continue;
    }

    if (!geocode || geocode.lat == null || geocode.lng == null) {
      continue;
    }
    if (
      territory.radiusKm == null ||
      territory.centerLat == null ||
      territory.centerLng == null
    ) {
      continue;
    }
    const distanceKm = haversineDistanceKm(
      geocode.lat,
      geocode.lng,
      territory.centerLat,
      territory.centerLng
    );
    if (!Number.isFinite(distanceKm) || distanceKm > territory.radiusKm * 1.01) {
      continue;
    }
    const coverageRatio = Math.min(
      Math.max(1 - distanceKm / territory.radiusKm, 0),
      1
    );
    let score = 1500 + Math.round(coverageRatio * 400);
    if (territory.exclusive) {
      score += 50;
    }
    if (!hasFranchise) {
      score -= 25;
    }
    const candidate: TerritoryMatch = {
      territoryId: territory.id,
      territoryLabel: territory.label,
      territoryPostalCode: normalisedInput,
      franchiseId: territory.franchiseId,
      exclusive: territory.exclusive,
      priceTier: territory.priceTier,
      hqFallback: !hasFranchise,
      matchType: "radius",
    };
    if (!best || score > best.score) {
      best = { score, match: candidate };
    }
  }
  return best?.match ?? null;
};

const lookupPostcode = async (
  postcode: string
): Promise<PostcodeLookupResult | null> => {
  const trimmed = postcode.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(trimmed)}`
    );
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    if (!json || typeof json !== "object" || json.status !== 200) {
      return null;
    }
    const result = json.result || {};
    const lat = toFiniteOrNull(result.latitude);
    const lng = toFiniteOrNull(result.longitude);
    const resolved =
      typeof result.postcode === "string" && result.postcode.trim().length > 0
        ? result.postcode
        : trimmed.toUpperCase();
    return { resolved, lat, lng };
  } catch (error) {
    console.warn("Failed to look up postcode", error);
    return null;
  }
};

const slotDateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface WizardTimeSlot {
  id: string;
  startMinutes: number;
  endMinutes: number;
  label: string;
}

const formatTimeOfDay = (minutes: number): string => {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = Math.round(minutes % 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const buildTimeSlots = (
  timing: ProductOnsiteTiming | null
): WizardTimeSlot[] => {
  if (!timing) {
    return [];
  }
  const slots: WizardTimeSlot[] = [];
  const span = Math.max(0, timing.totalMinutes);
  if (span <= 0) {
    return slots;
  }
  const start = timing.windowStartMinutes;
  const end = Math.max(start + span, timing.windowEndMinutes);
  const windowEnd = timing.windowEndMinutes <= start ? end : timing.windowEndMinutes;
  const step = span <= 60 ? 15 : span <= 180 ? 30 : 60;
  for (
    let cursor = start;
    cursor + span <= windowEnd + 0.01;
    cursor += Math.max(step, 15)
  ) {
    const slotEnd = cursor + span;
    if (slotEnd > windowEnd + 0.01) {
      break;
    }
    const label = `${formatTimeOfDay(cursor)} – ${formatTimeOfDay(slotEnd)}`;
    slots.push({
      id: `${cursor}-${slotEnd}`,
      startMinutes: cursor,
      endMinutes: slotEnd,
      label,
    });
  }
  if (slots.length === 0) {
    const slotEnd = start + span;
    const label = `${formatTimeOfDay(start)} – ${formatTimeOfDay(slotEnd)}`;
    slots.push({
      id: `${start}-${slotEnd}`,
      startMinutes: start,
      endMinutes: slotEnd,
      label,
    });
  }
  return slots;
};

const toDateKeyFromDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day));
};

const expandDateKeyRange = (key: string, span: number): string[] => {
  const start = parseDateKey(key);
  if (!start) {
    return [];
  }
  const days = Math.max(1, Math.floor(span));
  const keys: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const cursor = new Date(start.getTime() + offset * DAY_IN_MS);
    keys.push(toDateKeyFromDate(cursor));
  }
  return keys;
};

const formatDateForSpeech = (date: Date): string =>
  date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const formatCampaignSlotWindow = (slot: CampaignSlotRecord): string => {
  const parse = (value: string | null): Date | null => {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const start = parse(slot.startAt);
  const end = parse(slot.endAt);
  if (start && end) {
    return `${slotDateFormatter.format(start)} – ${slotDateFormatter.format(end)}`;
  }
  if (start) {
    return slotDateFormatter.format(start);
  }
  if (end) {
    return `Ends ${slotDateFormatter.format(end)}`;
  }
  return slot.label;
};

const normaliseSlotDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const normaliseDateKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

type FunctionsError = {
  code: string;
  message: string;
  details?: unknown;
};

const isFunctionsError = (error: unknown): error is FunctionsError => {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  const code = (error as any).code;
  return typeof code === "string" && code.length > 0;
};

export default function AddToCartWizard({
  product,
  variationId,
  basePrice,
  organiserContext,
  onClose,
}: Props) {
  if ((product.salesMode ?? "ecommerce") === "quote") {
    throw new Error("Quote-only products cannot be added to the cart.");
  }
  const { items, add } = useCart();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const eventWindow = useMemo(() => getProductEventWindow(product), [product]);
  const selectedVariation = useMemo(() => {
    if (!variationId) {
      return null;
    }
    const entries = Array.isArray(product.variations)
      ? product.variations
      : [];
    return entries.find((entry) => entry?.id === variationId) ?? null;
  }, [product.variations, variationId]);
  const onsiteDaysConfigured = useMemo(
    () => resolveProductOnsiteDays(product, selectedVariation) ?? 1,
    [product, selectedVariation]
  );
  const onsiteBlockingDays = useMemo(
    () => Math.max(1, Math.ceil(onsiteDaysConfigured)),
    [onsiteDaysConfigured]
  );
  const onsiteTiming = useMemo(
    () => resolveProductOnsiteTiming(product, selectedVariation),
    [product, selectedVariation]
  );
  const timeSlotRequired = useMemo(
    () => onsiteTiming !== null && onsiteBlockingDays <= 1,
    [onsiteTiming, onsiteBlockingDays]
  );
  const onsiteSummary = useMemo(
    () => formatProductOnsiteDuration(product, undefined, selectedVariation),
    [product, selectedVariation]
  );
  const eventRangeLabel = useMemo(
    () => getProductEventRangeLabel(product),
    [product]
  );
  const eventMonths = useMemo(
    () => getProductEventMonthKeys(product),
    [product]
  );
  const exhibitionSchedule = useMemo(() => {
    if (product.category !== "exhibition-videography") {
      return {
        showOptions: [] as Array<{ key: string; label: string }>,
        setupOption: null as { key: string; label: string; helper?: string } | null,
      };
    }
    const { start, end, setup } = eventWindow;
    if (!start) {
      return {
        showOptions: [] as Array<{ key: string; label: string }>,
        setupOption: null as { key: string; label: string; helper?: string } | null,
      };
    }
    const resolvedEnd = end ?? start;
    const showOptions: Array<{ key: string; label: string }> = [];
    let setupOption: { key: string; label: string; helper?: string } | null = null;
    const fallbackSetup = new Date(start.getTime() - DAY_IN_MS);
    const setupCandidate = setup ?? fallbackSetup;
    if (setupCandidate && !Number.isNaN(setupCandidate.getTime())) {
      const key = toDateKeyFromDate(setupCandidate);
      setupOption = {
        key,
        label: setupCandidate.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
        helper: "Arrive a day early to capture stand build and pre-show content.",
      };
    }
    const startCursor = parseDateKey(toDateKeyFromDate(start));
    const endCursor = parseDateKey(toDateKeyFromDate(resolvedEnd));
    if (!startCursor || !endCursor) {
      return { showOptions, setupOption };
    }
    let dayIndex = 0;
    for (
      let cursor = startCursor;
      cursor.getTime() <= endCursor.getTime();
      cursor = new Date(cursor.getTime() + DAY_IN_MS)
    ) {
      dayIndex += 1;
      const key = toDateKeyFromDate(cursor);
      showOptions.push({
        key,
        label: `Day ${dayIndex}: ${cursor.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}`,
      });
    }
    return { showOptions, setupOption };
  }, [eventWindow, product.category]);
  const exhibitionOptions = exhibitionSchedule.showOptions;
  const exhibitionSetupOption = exhibitionSchedule.setupOption;
  const defaultExhibitionDate = useMemo(() => {
    if (product.category !== "exhibition-videography") {
      return null;
    }
    return exhibitionOptions[0]?.key ?? null;
  }, [exhibitionOptions, product.category]);
  const exhibitionDayLabels = useMemo(() => {
    if (product.category !== "exhibition-videography") {
      return {} as Record<string, string>;
    }
    return exhibitionOptions.reduce<Record<string, string>>((acc, option) => {
      const key = normaliseDateKey(option.key);
      if (!key) {
        return acc;
      }
      const prefix = option.label.includes(":")
        ? option.label.split(":")[0]?.trim()
        : option.label.trim();
      acc[key] = prefix && prefix.length > 0 ? prefix : option.label;
      return acc;
    }, {});
  }, [exhibitionOptions, product.category]);
  const exhibitionHighlightDates = useMemo(() => {
    if (!exhibitionSetupOption) {
      return [] as string[];
    }
    return [exhibitionSetupOption.key];
  }, [exhibitionSetupOption]);
  const exhibitionCalendarMonth = useMemo(() => {
    if (product.category !== "exhibition-videography") {
      return null;
    }
    const first = exhibitionOptions[0]?.key;
    if (!first) {
      return null;
    }
    const normalised = normaliseDateKey(first);
    return normalised ? normalised.slice(0, 7) : null;
  }, [exhibitionOptions, product.category]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(0);
  const [date, setDate] = useState<string | null>(() =>
    product.category === "exhibition-videography" ? defaultExhibitionDate : null
  );
  const [includeSetupDay, setIncludeSetupDay] = useState(false);
  useEffect(() => {
    if (product.category !== "exhibition-videography") {
      return;
    }
    if (exhibitionOptions.length === 0) {
      setDate(null);
      return;
    }
    setDate((current) => {
      if (!current) {
        return defaultExhibitionDate;
      }
      return exhibitionOptions.some((option) => option.key === current)
        ? current
        : defaultExhibitionDate;
    });
  }, [product.category, exhibitionOptions, defaultExhibitionDate]);
  useEffect(() => {
    if (!exhibitionSetupOption) {
      setIncludeSetupDay(false);
    }
  }, [exhibitionSetupOption]);
  const exhibitionAllowedDates = useMemo(() => {
    if (product.category !== "exhibition-videography") {
      return [] as string[];
    }
    return exhibitionOptions.map((option) => option.key);
  }, [exhibitionOptions, product.category]);
  const calendarInitialMonth = useMemo(() => {
    const selectedMonth = normaliseDateKey(date)?.slice(0, 7) ?? null;
    if (selectedMonth) {
      return selectedMonth;
    }
    if (
      product.category === "exhibition-videography" &&
      exhibitionCalendarMonth
    ) {
      return exhibitionCalendarMonth;
    }
    return eventMonths[0] ?? null;
  }, [
    date,
    eventMonths,
    exhibitionCalendarMonth,
    product.category,
  ]);
  const bookingSpan = useMemo(() => {
    if (
      product.category === "exhibition-videography" &&
      includeSetupDay &&
      exhibitionSetupOption
    ) {
      return onsiteBlockingDays + 1;
    }
    return onsiteBlockingDays;
  }, [
    exhibitionSetupOption,
    includeSetupDay,
    onsiteBlockingDays,
    product.category,
  ]);
  const reservationStartKey = useMemo(() => {
    if (product.category !== "exhibition-videography") {
      return date;
    }
    if (includeSetupDay && exhibitionSetupOption) {
      return exhibitionSetupOption.key;
    }
    return date;
  }, [date, exhibitionSetupOption, includeSetupDay, product.category]);
  const slotDateKey = useMemo(() => {
    if (product.category === "exhibition-videography") {
      return normaliseDateKey(date);
    }
    return normaliseDateKey(reservationStartKey);
  }, [date, product.category, reservationStartKey]);
  const showTimeSlotPanel = timeSlotRequired && !!slotDateKey;
  const timeSlots = useMemo(
    () => buildTimeSlots(timeSlotRequired ? onsiteTiming : null),
    [onsiteTiming, timeSlotRequired]
  );
  const selectedDateRange = useMemo(() => {
    if (!reservationStartKey) {
      return null;
    }
    const base =
      parseDateKey(reservationStartKey) ??
      new Date(`${reservationStartKey}T00:00:00`);
    if (Number.isNaN(base.getTime())) {
      return null;
    }
    const end = new Date(base.getTime() + (bookingSpan - 1) * DAY_IN_MS);
    return { start: base, end };
  }, [bookingSpan, reservationStartKey]);
  const [selectedTimeSlot, setSelectedTimeSlot] =
    useState<WizardTimeSlot | null>(null);
  const selectedTimeSlotRange = useMemo(() => {
    if (!selectedTimeSlot || !slotDateKey) {
      return null;
    }
    const base =
      parseDateKey(slotDateKey) ?? new Date(`${slotDateKey}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) {
      return null;
    }
    const start = new Date(
      base.getTime() + selectedTimeSlot.startMinutes * 60 * 1000
    );
    const end = new Date(
      base.getTime() + selectedTimeSlot.endMinutes * 60 * 1000
    );
    return { start, end };
  }, [selectedTimeSlot, slotDateKey]);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [liveMessage, setLiveMessage] = useState("Add this product to your cart");
  const [organiserQueryToken, setOrganiserQueryToken] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const token = params.get("organiser") ?? params.get("organiserId");
    setOrganiserQueryToken(token);
  }, []);
  const normalisedOrganiserProgram = useMemo(
    () => normaliseOrganiserProgram(product.organiserProgram ?? null),
    [product.organiserProgram]
  );
  const organiserProgramEnabled = useMemo(
    () => isOrganiserProgramEnabled(product.organiserProgram ?? null),
    [product.organiserProgram]
  );
  const fallbackOrganiserProgramKey = useMemo(() => {
    return product?.id ? `program:${product.id}` : "program";
  }, [product?.id]);
  const derivedOrganiserId = useMemo(
    () => normaliseOrganiserId(organiserQueryToken),
    [organiserQueryToken]
  );
  const organiserAccess = useMemo<OrganiserAccessContext | null>(() => {
    if (organiserContext) {
      return organiserContext;
    }
    if (!normalisedOrganiserProgram) {
      return null;
    }
    const active = Boolean(
      derivedOrganiserId && derivedOrganiserId === normalisedOrganiserProgram.organiserId
    );
    return {
      program: normalisedOrganiserProgram,
      active,
      source: "query",
      token: derivedOrganiserId ?? null,
    } satisfies OrganiserAccessContext;
  }, [
    derivedOrganiserId,
    normalisedOrganiserProgram,
    organiserContext,
  ]);
  const organiserActive = organiserAccess?.active ?? false;
  const [locationInput, setLocationInput] = useState("");
  const [postcodeInput, setPostcodeInput] = useState("");
  const [coverage, setCoverage] = useState<CoverageAssignment | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<CoverageStatus>("idle");
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [kitRoutingSettings, setKitRoutingSettings] = useState<KitRoutingSettings | null>(null);
  const [campaignSlots, setCampaignSlots] = useState<CampaignSlotRecord[]>([]);
  const [campaignSlotStatus, setCampaignSlotStatus] =
    useState<CampaignSlotStatus>("idle");
  const [campaignSlotError, setCampaignSlotError] = useState<string | null>(null);
  const [overrideLocation, setOverrideLocation] = useState(false);
  useEffect(() => {
    if (organiserActive) {
      setOverrideLocation(false);
    }
  }, [organiserActive]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureFirebase();
        if (cancelled || !db) {
          if (!cancelled) {
            setKitRoutingSettings(cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS));
          }
          return;
        }
        const ref = doc(db, "settings", "kitRouting");
        const snap = await getDoc(ref);
        if (cancelled) {
          return;
        }
        const parsed = snap.exists()
          ? parseKitRoutingSettings(snap.data())
          : cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS);
        setKitRoutingSettings(parsed);
      } catch (err) {
        console.error("Failed to load kit routing settings", err);
        if (!cancelled) {
          setKitRoutingSettings(cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [availabilityOverrides, setAvailabilityOverrides] = useState<
    Record<string, ProductAvailabilityStatus>
  >({});
  const orderFormQuestions = useMemo<OrderFormQuestion[]>(() => {
    const fields = Array.isArray(product.orderFormFields)
      ? (product.orderFormFields as any[])
      : [];
    return fields
      .map((raw, index) => {
        if (!raw || typeof raw !== "object") {
          return null;
        }
        const label =
          typeof raw.label === "string" && raw.label.trim().length > 0
            ? raw.label.trim()
            : "";
        if (!label) {
          return null;
        }
        const id =
          typeof raw.id === "string" && raw.id.trim().length > 0
            ? raw.id.trim()
            : `order-field-${index}`;
        const description =
          typeof raw.description === "string" && raw.description.trim().length > 0
            ? raw.description.trim()
            : null;
        const typeValue =
          typeof raw.type === "string" && raw.type === "long-text"
            ? "long-text"
            : "short-text";
        const required = raw.required === true;
        return {
          id,
          label,
          description,
          required,
          type: typeValue as ProductOrderFieldType,
        } satisfies OrderFormQuestion;
      })
      .filter((entry): entry is OrderFormQuestion => entry !== null);
  }, [product.orderFormFields]);
  const [orderFormValues, setOrderFormValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    orderFormQuestions.forEach((question) => {
      initial[question.id] = "";
    });
    return initial;
  });
  const [orderFormErrors, setOrderFormErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setOrderFormValues((prev) => {
      const next: Record<string, string> = {};
      orderFormQuestions.forEach((question) => {
        next[question.id] = prev[question.id] ?? "";
      });
      return next;
    });
    setOrderFormErrors({});
  }, [orderFormQuestions]);
  const handleOrderFieldChange = useCallback((id: string, value: string) => {
    setOrderFormValues((prev) => ({ ...prev, [id]: value }));
    setOrderFormErrors((prev) => {
      if (!prev[id]) {
        return prev;
      }
      if (value.trim().length > 0) {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  }, []);
  const validateOrderForm = useCallback(() => {
    if (orderFormQuestions.length === 0) {
      setOrderFormErrors({});
      return true;
    }
    const errors: Record<string, string> = {};
    orderFormQuestions.forEach((question) => {
      if (!question.required) {
        return;
      }
      const value = orderFormValues[question.id]?.trim() ?? "";
      if (value.length === 0) {
        errors[question.id] = "Please provide a response.";
      }
    });
    setOrderFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [orderFormQuestions, orderFormValues]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const territoriesRef = useRef<TerritoryRecord[] | null>(null);
  const franchiseMapRef = useRef<Map<string, FranchiseRecord> | null>(null);
  const hasPresetVenue = Boolean(
    (product.venueId && product.venueId.trim().length > 0) ||
      product.venueCoverage ||
      (product.venue && product.venue.trim().length > 0)
  );
  const venueCoveragePreset = useMemo<CoverageAssignment | null>(() => {
    if (!hasPresetVenue) {
      return null;
    }
    const config = product.venueCoverage ?? null;
    const label =
      (config?.label && config.label.trim().length > 0
        ? config.label.trim()
        : product.venue && product.venue.trim().length > 0
          ? product.venue.trim()
          : "Venue production") || "Venue production";
    const tier = normalisePriceTierLevel(config?.priceTier ?? 1);
    const franchiseId = config?.franchiseId?.trim()?.length ? config.franchiseId!.trim() : null;
    const territoryId = config?.territoryId?.trim()?.length ? config.territoryId!.trim() : null;
    const territoryLabel =
      config?.territoryLabel && config.territoryLabel.trim().length > 0
        ? config.territoryLabel.trim()
        : null;
    const postalCode =
      config?.postalCode && config.postalCode.trim().length > 0
        ? config.postalCode.trim().toUpperCase()
        : null;
    const type: CoverageAssignment["type"] = franchiseId ? "franchise" : "hq";
    const matchType: CoverageAssignment["matchType"] = franchiseId ? "venue" : "hq";
    return {
      type,
      franchiseId,
      territoryId,
      territoryLabel,
      priceTier: tier,
      hqFallback: config?.hqFallback ?? !franchiseId,
      label,
      postalCode,
      matchType,
    } satisfies CoverageAssignment;
  }, [hasPresetVenue, product.venueCoverage, product.venue]);
  const isCampaignProduct = Boolean(
    product.campaignBooking?.projectId && product.campaignBooking?.bookingId
  );
  useEffect(() => {
    if (!hasPresetVenue) {
      return;
    }
    if (overrideLocation) {
      setCoverage(null);
      setCoverageStatus("idle");
      setCoverageError(null);
      setLiveMessage("Enter the filming location to continue");
      return;
    }
    setCoverage(venueCoveragePreset);
    setCoverageStatus(venueCoveragePreset ? "success" : "idle");
    setCoverageError(null);
    setPostcodeInput(venueCoveragePreset?.postalCode ?? "");
    if (venueCoveragePreset?.label) {
      setLocationInput(venueCoveragePreset.label);
    } else if (product.venue && product.venue.trim().length > 0) {
      setLocationInput(product.venue.trim());
    } else {
      setLocationInput("");
    }
  }, [hasPresetVenue, overrideLocation, product.venue, venueCoveragePreset]);
  const priceTier: PriceTierLevel = organiserActive
    ? 1
    : coverage?.priceTier ?? 1;
  const cartSlotHolds = useMemo(() => {
    if (!isCampaignProduct || !product.campaignBooking) {
      return new Map<string, number>();
    }
    const bookingId = product.campaignBooking.bookingId;
    const projectId = product.campaignBooking.projectId;
    const map = new Map<string, number>();
    items.forEach((item) => {
      if (!item.campaignBooking) {
        return;
      }
      if (
        item.id !== product.id ||
        item.campaignBooking.bookingId !== bookingId ||
        item.campaignBooking.projectId !== projectId
      ) {
        return;
      }
      const slotId = item.campaignBooking.slotId;
      if (!slotId) {
        return;
      }
      const existing = map.get(slotId) ?? 0;
      map.set(slotId, existing + Math.max(1, item.quantity));
    });
    return map;
  }, [
    isCampaignProduct,
    items,
    product.campaignBooking,
    product.id,
  ]);
  const effectiveBasePrice = useMemo(
    () => getPriceForTier(basePrice, product.priceTiers ?? null, priceTier),
    [basePrice, product.priceTiers, priceTier]
  );
  const resolveOptionPrice = useCallback(
    (option: ModifierOption) =>
      getPriceForTier(option.basePrice, option.priceTiers ?? null, priceTier),
    [priceTier]
  );
  const availabilityScope = useMemo<ProductAvailabilityScope | null>(() => {
    if (!coverage || coverageStatus !== "success") {
      return null;
    }
    if (coverage.type === "franchise" && coverage.franchiseId) {
      return {
        type: "franchise",
        franchiseId: coverage.franchiseId,
        territoryId: coverage.territoryId ?? undefined,
      } satisfies ProductAvailabilityScope;
    }
    return { type: "hq", organisationId: null } satisfies ProductAvailabilityScope;
  }, [coverage, coverageStatus]);
  const routingAttempts = useMemo(() => {
    if (!coverage || coverageStatus !== "success") {
      return [];
    }
    const settings = kitRoutingSettings ?? DEFAULT_KIT_ROUTING_SETTINGS;
    return resolveRoutingAttempts(settings, {
      type: coverage.type,
      franchiseId: coverage.franchiseId,
      label: coverage.label,
    });
  }, [coverage, coverageStatus, kitRoutingSettings]);
  const skipAutomaticKitCheck = useMemo(() => {
    if (!coverage || coverageStatus !== "success") {
      return false;
    }
    const primary = routingAttempts[0];
    return Boolean(primary && primary.requiresKit === false);
  }, [coverage, coverageStatus, routingAttempts]);
  const announceSelection = useCallback(
    (startKey: string | null, span: number) => {
      if (!startKey) {
        return;
      }
      const base = parseDateKey(startKey) ?? new Date(`${startKey}T00:00:00`);
      if (Number.isNaN(base.getTime())) {
        setLiveMessage(`Selected ${startKey} for production`);
        return;
      }
      if (span > 1) {
        const end = new Date(base.getTime() + (span - 1) * DAY_IN_MS);
        setLiveMessage(
          `Selected ${formatDateForSpeech(base)} – crew reserved until ${formatDateForSpeech(end)}.`
        );
      } else {
        setLiveMessage(`Selected ${formatDateForSpeech(base)} for production`);
      }
    },
    []
  );
  const handleDateSelect = (value: string) => {
    setDate(value);
    setConflicts([]);
    setError(null);
    setSelectedTimeSlot(null);
    const startKey =
      product.category === "exhibition-videography" &&
      includeSetupDay &&
      exhibitionSetupOption
        ? exhibitionSetupOption.key
        : value;
    const span =
      product.category === "exhibition-videography" &&
      includeSetupDay &&
      exhibitionSetupOption
        ? onsiteBlockingDays + 1
        : onsiteBlockingDays;
    announceSelection(startKey, span);
  };
  useEffect(() => {
    if (!date) {
      return;
    }
    announceSelection(reservationStartKey, bookingSpan);
  }, [announceSelection, bookingSpan, date, reservationStartKey]);

  const handleTimeSlotSelect = useCallback(
    (slot: WizardTimeSlot) => {
      setSelectedTimeSlot(slot);
      setError(null);
      setLiveMessage(`Selected ${slot.label} filming window`);
    },
    []
  );

  useEffect(() => {
    if (!timeSlotRequired) {
      setSelectedTimeSlot(null);
    }
  }, [timeSlotRequired]);

  useEffect(() => {
    setSelectedTimeSlot(null);
  }, [slotDateKey]);

  useEffect(() => {
    async function load() {
      if (!product.modifiers || product.modifiers.length === 0) {
        setGroups([]);
        return;
      }
      const groupIds = Array.from(new Set(product.modifiers.map((m) => m.groupId)));
      const snaps = await Promise.all(
        groupIds.map((id) => getDoc(doc(db, "modifiers", id)))
      );
      const filtered = snaps
        .filter((snap) => snap.exists())
        .map((snap) => {
          const data = snap.data() as Record<string, unknown> | undefined;
          const optionsSource = Array.isArray(data?.options) ? data?.options : [];
          const options: ModifierOption[] = optionsSource
            .filter((option) =>
              product.modifiers?.some((m) => m.groupId === snap.id && m.optionId === option?.id)
            )
            .map((option) => {
              const override = product.modifiers?.find(
                (m) => m.groupId === snap.id && m.optionId === option?.id
              );
              const overridePrice = override ? toFiniteOrNull((override as any).price) : null;
              const optionPrice = toFiniteOrNull((option as any)?.price);
              const basePriceValue = overridePrice ?? optionPrice ?? 0;
              const overrideTiers =
                (override?.priceTiers as PriceTiers | null | undefined) ?? null;
              const optionTiers = parsePriceTiers((option as any)?.priceTiers);
              const id =
                typeof option?.id === "string"
                  ? option.id
                  : option?.id != null
                    ? String(option.id)
                    : "";
              const name =
                typeof option?.name === "string"
                  ? option.name
                  : option?.name != null
                    ? String(option.name)
                    : id || "Option";
              return {
                id,
                name,
                basePrice: basePriceValue,
                priceTiers: overrideTiers ?? optionTiers ?? null,
              } satisfies ModifierOption;
            })
            .filter((option) => option.id.length > 0);
          return {
            id: snap.id,
            name:
              typeof data?.name === "string" && data.name.trim().length > 0
                ? data.name
                : snap.id,
            multiple: data?.multiple === true,
            options,
          } satisfies ModifierGroup;
        })
        .filter((group) => group.options.length > 0);
      setGroups(filtered);
    }
    load();
  }, [product]);

  const hasLocationStep = !hasPresetVenue || overrideLocation;
  const hasOrderFields = orderFormQuestions.length > 0;
  const totalSteps =
    groups.length + (hasLocationStep ? 1 : 0) + (hasOrderFields ? 1 : 0) + 1;
  const locationStep = hasLocationStep && step === 0;
  const orderFieldsStepIndex = hasLocationStep ? 1 : 0;
  const orderFieldsStep = hasOrderFields && step === orderFieldsStepIndex;
  const modifierIndex =
    step - (hasLocationStep ? 1 : 0) - (hasOrderFields ? 1 : 0);
  const currentGroup =
    modifierIndex >= 0 && modifierIndex < groups.length ? groups[modifierIndex] : null;
  const dateStep = step === totalSteps - 1;
  const stepLabel = locationStep
    ? overrideLocation && hasPresetVenue
      ? "Enter the alternate filming location"
      : "Confirm the filming location"
    : orderFieldsStep
      ? orderFormQuestions.length > 1
        ? "Answer the booking questions"
        : "Provide the booking detail"
      : currentGroup
        ? `Choose ${currentGroup.multiple ? "one or more" : "an"} option for ${currentGroup.name}`
        : isCampaignProduct
          ? "Choose a campaign slot"
          : "Confirm the production date";

  useEffect(() => {
    setStep(0);
  }, [hasLocationStep, hasOrderFields]);

  useEffect(() => {
    setLiveMessage(`Step ${step + 1} of ${totalSteps}: ${stepLabel}`);
  }, [step, totalSteps, stepLabel]);

  useEffect(() => {
    if (!hasLocationStep) {
      return;
    }
    setCoverage(null);
    setCoverageStatus("idle");
    setCoverageError(null);
    setCampaignSlots([]);
    setCampaignSlotStatus("idle");
    setCampaignSlotError(null);
    setSelectedSlotId(null);
    setAvailabilityOverrides({});
  }, [hasLocationStep, locationInput, postcodeInput]);

  const loadTerritories = useCallback(async (): Promise<TerritoryRecord[]> => {
    if (territoriesRef.current) {
      return territoriesRef.current;
    }
    try {
      const snap = await getDocs(collection(db, "franchiseTerritories"));
      const records: TerritoryRecord[] = snap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown> | undefined;
        const typeValue =
          typeof data?.type === "string" && data.type.toLowerCase() === "radius"
            ? "radius"
            : "postal";
        return {
          id: docSnap.id,
          label:
            typeof data?.label === "string" && data.label.trim().length > 0
              ? data.label
              : null,
          type: typeValue,
          franchiseId:
            typeof data?.franchiseId === "string" && data.franchiseId.trim().length > 0
              ? data.franchiseId.trim()
              : null,
          exclusive: data?.exclusive !== false,
          postalCodes: extractPostalCodes(data?.postalCodes),
          radiusKm: toFiniteOrNull(data?.radiusKm),
          centerLat: toFiniteOrNull(data?.centerLat),
          centerLng: toFiniteOrNull(data?.centerLng),
          priceTier: normalisePriceTierLevel(data?.priceTier),
        } satisfies TerritoryRecord;
      });
      territoriesRef.current = records;
      return records;
    } catch (err) {
      console.warn("Failed to load territory metadata", err);
      territoriesRef.current = [];
      return [];
    }
  }, []);

  const loadFranchises = useCallback(async () => {
    if (franchiseMapRef.current) {
      return franchiseMapRef.current;
    }
    try {
      const snap = await getDocs(collection(db, "franchises"));
      const map = new Map<string, FranchiseRecord>();
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown> | undefined;
        const name =
          typeof data?.name === "string" && data.name.trim().length > 0
            ? data.name.trim()
            : typeof data?.code === "string" && data.code.trim().length > 0
              ? data.code.trim()
              : null;
        const code =
          typeof data?.code === "string" && data.code.trim().length > 0
            ? data.code.trim()
            : null;
        map.set(docSnap.id, { id: docSnap.id, name, code });
      });
      franchiseMapRef.current = map;
      return map;
    } catch (err) {
      console.warn("Failed to load franchise metadata", err);
      franchiseMapRef.current = new Map();
      return franchiseMapRef.current;
    }
  }, []);

  useEffect(() => {
    if (!isCampaignProduct) {
      return;
    }
    if (coverageStatus !== "success" || !coverage) {
      setCampaignSlots([]);
      setCampaignSlotStatus("idle");
      setCampaignSlotError(null);
      return;
    }
    let cancelled = false;
    const booking = product.campaignBooking;
    if (!booking) {
      return;
    }
    const priceAdjustments: Record<string, number> = Object.entries(
      booking.priceClassAdjustments ?? {}
    ).reduce<Record<string, number>>((acc, [key, value]) => {
      if (typeof key !== "string") {
        return acc;
      }
      const numeric = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        return acc;
      }
      acc[key.trim().toLowerCase()] = numeric;
      return acc;
    }, {});

    const loadSlots = async () => {
      setCampaignSlotStatus("loading");
      setCampaignSlotError(null);
      try {
        const bookingRef = doc(
          db,
          "projects",
          booking.projectId,
          "projectBookings",
          booking.bookingId
        );
        const [bookingSnap, responsesSnap] = await Promise.all([
          getDoc(bookingRef),
          getDocs(collection(bookingRef, "responses")),
        ]);
        if (!bookingSnap.exists()) {
          throw new Error("Booking session not found.");
        }
        const raw = (bookingSnap.data() as Record<string, any>) ?? {};
        const slotResponses = new Map<string, number>();
        responsesSnap.forEach((docSnap) => {
          const data = (docSnap.data() as Record<string, any>) ?? {};
          const slotId =
            typeof data.slotId === "string" && data.slotId.trim().length > 0
              ? data.slotId.trim()
              : null;
          if (!slotId) {
            return;
          }
          const status =
            typeof data.status === "string" && data.status.trim().length > 0
              ? data.status.trim().toLowerCase()
              : "pending";
          if (status === "cancelled" || status === "declined") {
            return;
          }
          slotResponses.set(slotId, (slotResponses.get(slotId) ?? 0) + 1);
        });
        const slotsInput: any[] = Array.isArray(raw.slots) ? raw.slots : [];
        const parsed: CampaignSlotRecord[] = slotsInput
          .map((slot, index) => {
            if (!slot || typeof slot !== "object") {
              return null;
            }
            const id =
              typeof slot.id === "string" && slot.id.trim().length > 0
                ? slot.id.trim()
                : `${booking.bookingId}-slot-${index + 1}`;
            const label =
              typeof slot.label === "string" && slot.label.trim().length > 0
                ? slot.label.trim()
                : `Slot ${index + 1}`;
            const startAt =
              typeof slot.startAt === "string" && slot.startAt.trim().length > 0
                ? slot.startAt
                : null;
            const endAt =
              typeof slot.endAt === "string" && slot.endAt.trim().length > 0
                ? slot.endAt
                : null;
            let capacity = 1;
            if (typeof slot.capacity === "number" && Number.isFinite(slot.capacity)) {
              capacity = Math.max(1, Math.round(slot.capacity));
            } else if (typeof slot.capacity === "string") {
              const parsedCapacity = Number.parseInt(slot.capacity, 10);
              if (Number.isFinite(parsedCapacity)) {
                capacity = Math.max(1, Math.round(parsedCapacity));
              }
            }
            const priceClass =
              typeof slot.priceClass === "string" && slot.priceClass.trim().length > 0
                ? slot.priceClass.trim()
                : null;
            const priceAdjustment =
              priceClass && priceAdjustments[priceClass.trim().toLowerCase()]
                ? priceAdjustments[priceClass.trim().toLowerCase()]
                : 0;
            const notes =
              typeof slot.notes === "string" && slot.notes.trim().length > 0
                ? slot.notes.trim()
                : "";
            const booked = slotResponses.get(id) ?? 0;
            const held = cartSlotHolds.get(id) ?? 0;
            return {
              id,
              label,
              startAt,
              endAt,
              capacity,
              booked,
              priceClass,
              priceAdjustment,
              notes,
              held,
            } satisfies CampaignSlotRecord;
          })
          .filter((slot): slot is CampaignSlotRecord => Boolean(slot));
        if (!cancelled) {
          setCampaignSlots(parsed);
          const stillValid = parsed.some(
            (slot) =>
              slot.id === selectedSlotId && slot.capacity - slot.booked - slot.held > 0
          );
          if (!stillValid) {
            setSelectedSlotId(null);
          }
          setCampaignSlotStatus("success");
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load campaign slots", err);
        setCampaignSlots([]);
        setCampaignSlotStatus("error");
        setCampaignSlotError(
          err instanceof Error ? err.message : "Unable to load available slots right now."
        );
      }
    };
    void loadSlots();
    return () => {
      cancelled = true;
    };
  }, [
    cartSlotHolds,
    coverage,
    coverageStatus,
    isCampaignProduct,
    product.campaignBooking,
    selectedSlotId,
  ]);

  const selectedSlot = useMemo(() => {
    if (!selectedSlotId) {
      return null;
    }
    return campaignSlots.find((slot) => slot.id === selectedSlotId) ?? null;
  }, [campaignSlots, selectedSlotId]);

  const handleSlotChoice = useCallback((slot: CampaignSlotRecord) => {
    setSelectedSlotId(slot.id);
    const slotDate = normaliseSlotDate(slot.startAt) ?? normaliseSlotDate(slot.endAt);
    if (slotDate) {
      setDate(slotDate);
    } else {
      setDate(slot.id);
    }
    setError(null);
  }, []);

  const handleCoverageLookup = useCallback(async () => {
    const trimmedLocation = locationInput.trim();
    const trimmedPostcode = postcodeInput.trim();
    if (!trimmedLocation) {
      setCoverage(null);
      setCoverageStatus("error");
      const message = "Enter the filming address or venue before continuing.";
      setCoverageError(message);
      setError(message);
      setLiveMessage("Filming address required");
      return;
    }
    if (!trimmedPostcode) {
      setCoverage(null);
      setCoverageStatus("error");
      const message = "Enter the filming postcode so we can route your booking.";
      setCoverageError(message);
      setError(message);
      setLiveMessage("Filming postcode required");
      return;
    }
    setCoverageStatus("loading");
    setCoverageError(null);
    setError(null);
    setLiveMessage("Checking franchise coverage for the filming location");
    try {
      const [territories, franchiseMap, postcodeDetails] = await Promise.all([
        loadTerritories(),
        loadFranchises(),
        lookupPostcode(trimmedPostcode),
      ]);
      const match = resolveTerritoryMatch(territories, trimmedPostcode, postcodeDetails);
      const resolvedPostalCode =
        postcodeDetails?.resolved ??
        normalisePostalCode(trimmedPostcode) ??
        trimmedPostcode.toUpperCase();
      if (match) {
        const label = match.franchiseId
          ? franchiseMap?.get(match.franchiseId)?.name ||
            franchiseMap?.get(match.franchiseId)?.code ||
            "Franchise operations"
          : "HQ operations";
        const assignment: CoverageAssignment = {
          type: match.franchiseId ? "franchise" : "hq",
          franchiseId: match.franchiseId,
          territoryId: match.territoryId,
          territoryLabel: match.territoryLabel,
          priceTier: match.priceTier,
          hqFallback: match.hqFallback,
          label,
          postalCode: resolvedPostalCode,
          matchType: match.matchType,
        };
        setCoverage(assignment);
        setCoverageStatus("success");
        setLiveMessage(
          match.franchiseId
            ? `Coverage confirmed via ${label}`
            : "Coverage confirmed via HQ operations"
        );
      } else {
        const assignment: CoverageAssignment = {
          type: "hq",
          franchiseId: null,
          territoryId: null,
          territoryLabel: null,
          priceTier: 1,
          hqFallback: true,
          label: "HQ operations",
          postalCode: resolvedPostalCode,
          matchType: "hq",
        };
        setCoverage(assignment);
        setCoverageStatus("success");
        setLiveMessage("Coverage confirmed via HQ operations");
      }
    } catch (err) {
      console.error("Coverage lookup failed", err);
      setCoverage(null);
      setCoverageStatus("error");
      setCoverageError(
        "We couldn't verify coverage right now. Double-check the postcode and try again."
      );
      setLiveMessage("Coverage lookup failed");
    }
  }, [locationInput, postcodeInput, loadTerritories, loadFranchises]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const dialogNode = dialogRef.current;
    dialogNode?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab" && dialogNode) {
        const focusable = Array.from(
          dialogNode.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("data-focus-guard"));

        if (focusable.length === 0) {
          event.preventDefault();
          dialogNode.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const isShift = event.shiftKey;
        const active = document.activeElement as HTMLElement;

        if (!isShift && active === last) {
          event.preventDefault();
          first.focus();
        } else if (isShift && active === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const toggle = (group: ModifierGroup, optionId: string, checked: boolean) => {
    setError(null);
    setSelected((prev) => {
      const current = prev[group.id] || [];
      if (group.multiple) {
        const next = checked
          ? [...current, optionId]
          : current.filter((id) => id !== optionId);
        return { ...prev, [group.id]: next };
      }
      return { ...prev, [group.id]: checked ? [optionId] : [] };
    });
  };

  const next = () => {
    setError(null);
    if (orderFieldsStep && !validateOrderForm()) {
      setLiveMessage("Answer the required booking questions to continue");
      return;
    }
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  };
  const back = () => {
    if (step === 0) onClose();
    else setStep((s) => s - 1);
  };

  const handleFinish = async () => {
    setError(null);
    setConflicts([]);
    if (!validateOrderForm()) {
      setLiveMessage("Answer the required booking questions to continue");
      if (hasOrderFields) {
        setStep(orderFieldsStepIndex);
      }
      setError("Answer the required booking questions to continue.");
      return;
    }
    const selections: ProductModifierSelection[] = [];
    let adj = 0;
    groups.forEach((g) => {
      const ids = selected[g.id] || [];
      ids.forEach((id) => {
        const opt = g.options.find((o) => o.id === id);
        if (opt) {
          const optionPrice = resolveOptionPrice(opt);
          selections.push({ groupId: g.id, optionId: id, price: optionPrice });
          adj += optionPrice || 0;
        }
      });
    });
    const slotSelection = isCampaignProduct ? selectedSlot : null;
    let price = effectiveBasePrice + adj;
    if (slotSelection) {
      price += slotSelection.priceAdjustment;
    }
    if (!coverage || coverageStatus !== "success") {
      setError("Confirm the filming location before selecting a production date.");
      setLiveMessage("Filming location required before booking");
      return;
    }
    const showDateKey = normaliseDateKey(date);
    let startDateKey =
      product.category === "exhibition-videography"
        ? normaliseDateKey(reservationStartKey)
        : showDateKey;
    if (!startDateKey) {
      startDateKey = showDateKey;
    }
    let requestDateIso: string | null = null;
    let timeWindow: { start: string; end: string } | null = null;
    if (isCampaignProduct) {
      if (!slotSelection) {
        setError("Select an available slot to continue.");
        setLiveMessage("Slot selection required before adding to cart");
        return;
      }
      const cartHeld = cartSlotHolds.get(slotSelection.id) ?? 0;
      const remaining = Math.max(
        slotSelection.capacity - slotSelection.booked - cartHeld,
        0
      );
      if (remaining <= 0) {
        setError("This slot has just sold out. Please choose another option.");
        setLiveMessage("Selected slot unavailable");
        return;
      }
      requestDateIso =
        normaliseSlotDate(slotSelection.startAt) ??
        normaliseSlotDate(slotSelection.endAt) ??
        null;
      startDateKey =
        normaliseDateKey(slotSelection.startAt) ??
        normaliseDateKey(slotSelection.endAt) ??
        startDateKey;
      if (!requestDateIso) {
        requestDateIso = new Date().toISOString();
      }
      if (!startDateKey) {
        startDateKey = showDateKey;
      }
    } else {
      if (!date || !startDateKey) {
        setError("Select a production date to continue.");
        setLiveMessage("Production date required before adding to cart");
        return;
      }
      if (timeSlotRequired) {
        if (!selectedTimeSlotRange) {
          setError("Select a production time to continue.");
          setLiveMessage("Production time required before adding to cart");
          return;
        }
        const startIso = selectedTimeSlotRange.start.toISOString();
        const endIso = selectedTimeSlotRange.end.toISOString();
        timeWindow = { start: startIso, end: endIso };
      }
      requestDateIso = `${startDateKey}T00:00:00.000Z`;
    }
    const affectedCalendarKeys =
      startDateKey ? expandDateKeyRange(startDateKey, bookingSpan) : [];
    const updateCalendarStatus = (statusValue: ProductAvailabilityStatus) => {
      if (affectedCalendarKeys.length === 0) {
        return;
      }
      setAvailabilityOverrides((prev) => {
        let changed = false;
        const next = { ...prev };
        affectedCalendarKeys.forEach((key) => {
          if (next[key] !== statusValue) {
            next[key] = statusValue;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };
    if (!requestDateIso) {
      requestDateIso = new Date().toISOString();
    }
    setSubmitting(true);
    setLiveMessage("Checking equipment availability");
    try {
      const response = await fetch("/api/reserve-kit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          productId: product.id,
          date: requestDateIso,
          spanOverride: bookingSpan,
          timeWindow: timeWindow ?? null,
          coverage: coverage
            ? {
                type: coverage.type,
                franchiseId: coverage.franchiseId,
                territoryId: coverage.territoryId,
                label: coverage.label,
                territoryLabel: coverage.territoryLabel,
                postalCode: coverage.postalCode,
                matchType: coverage.matchType,
              }
            : null,
          skipKitCheck: skipAutomaticKitCheck,
        }),
      });

      const responseText = await response.text();
      let parsed: any = null;

      if (responseText) {
        try {
          parsed = JSON.parse(responseText);
        } catch (parseError) {
          throw {
            code: "invalid-response",
            message: "Kit availability response was not valid JSON.",
            details: (parseError as Error)?.message ?? null,
          } as FunctionsError;
        }
      }

      if (!response.ok) {
        const errorMessage =
          (parsed && typeof parsed.error === "string" && parsed.error) ||
          "reserve-kit-error";
        const errorCode =
          (parsed && typeof parsed.code === "string" && parsed.code) ||
          "reserve-kit-error";
        throw {
          code: errorCode,
          message: errorMessage,
          details: parsed?.details ?? null,
        } as FunctionsError;
      }

      const reservePayload =
        parsed && typeof parsed === "object" && "data" in parsed ? (parsed as any).data : parsed;
      const {
        conflicts = [],
        kitItems = [],
        rentalTotal = 0,
        status,
        missingStandards = [],
        provider: providerInfo = null,
      } = (reservePayload && typeof reservePayload === "object" ? reservePayload : {}) as any;
      const reservationStatus = status === "pending" ? "pending" : "confirmed";
      if (reservationStatus === "confirmed" && conflicts.length > 0) {
        const conflictNames = conflicts
          .map((c: any) => (c && (c.name || c.id)) || "Unavailable item")
          .filter(Boolean);
        setConflicts(conflictNames);
        setError("Some equipment is already reserved on the selected date.");
        setLiveMessage("Equipment conflicts found for the selected date");
        updateCalendarStatus("unavailable");
        setSubmitting(false);
        return;
      }
      setConflicts([]);
      const warnings: string[] = [];
      if (reservationStatus === "pending") {
        const conflictNames = conflicts
          .map((c: any) => (c && (c.name || c.id)) || "Unavailable item")
          .filter(Boolean);
        if (conflictNames.length > 0) {
          warnings.push(`Equipment already booked: ${conflictNames.join(", ")}`);
        }
        if (missingStandards.length > 0) {
          warnings.push(
            `Missing required equipment standards: ${missingStandards.join(", ")}`
          );
        }
        if (providerInfo && typeof providerInfo === "object") {
          const providerLevel = String((providerInfo as any).level ?? "").toLowerCase();
          const rawLabel = (providerInfo as any).label;
          const providerLabel =
            typeof rawLabel === "string" && rawLabel.trim().length > 0
              ? rawLabel.trim()
              : null;
          if (providerLevel === "franchise_team") {
            const message =
              providerLabel
                ? `${providerLabel} will confirm their availability and kit for this date.`
                : "Local franchise freelancers and crew will confirm availability for this date.";
            if (!warnings.includes(message)) {
              warnings.push(message);
            }
          } else if (providerLevel === "hq") {
            const message =
              providerLabel
                ? `${providerLabel} will confirm availability and secure the required kit.`
                : "HQ operations will confirm availability and secure the required kit.";
            if (!warnings.includes(message)) {
              warnings.push(message);
            }
          }
        }
        if (warnings.length === 0) {
          warnings.push("Kit availability will be confirmed manually by the operations team.");
        }
        if (typeof window !== "undefined") {
          const message = [
            "We've added this to your cart, but kit availability still needs manual confirmation.",
            ...warnings,
          ].join("\n\n");
          window.alert(message);
        }
      }
      updateCalendarStatus(
        reservationStatus === "pending" ? "pending" : "available"
      );
      const locationLabel = locationInput.trim();
      const postalCodeLabel =
        coverage.postalCode ||
        (postcodeInput.trim().length > 0
          ? postcodeInput.trim().toUpperCase()
          : null);
      const exhibitionSelection =
        product.category === "exhibition-videography"
          ? {
              showDate: showDateKey,
              setupIncluded: includeSetupDay && Boolean(exhibitionSetupOption),
              setupDate:
                includeSetupDay && exhibitionSetupOption
                  ? exhibitionSetupOption.key
                  : null,
            }
          : null;
      const orderFormResponses = orderFormQuestions.map((question) => ({
        fieldId: question.id,
        label: question.label,
        value: (orderFormValues[question.id] ?? "").trim(),
        required: question.required,
        type: question.type,
        description: question.description ?? null,
      }));
      add({
        id: product.id,
        name: product.name,
        price,
        date:
          showDateKey ||
          startDateKey ||
          requestDateIso ||
          date ||
          new Date().toISOString(),
        variation: variationId,
        modifiers: selections,
        kitItems,
        rentalTotal,
        kitStatus: reservationStatus,
        kitWarnings: warnings,
        exhibition: exhibitionSelection,
        orderFormResponses,
        location: locationLabel.length > 0 ? locationLabel : null,
        postalCode: postalCodeLabel,
        timeSlot:
          timeSlotRequired && selectedTimeSlotRange
            ? {
                start: selectedTimeSlotRange.start.toISOString(),
                end: selectedTimeSlotRange.end.toISOString(),
                label: selectedTimeSlot?.label ?? null,
                totalMinutes: onsiteTiming?.totalMinutes ?? null,
                setupMinutes: onsiteTiming?.setupMinutes ?? null,
                shootMinutes: onsiteTiming?.shootMinutes ?? null,
                breakdownMinutes: onsiteTiming?.breakdownMinutes ?? null,
              }
            : null,
        coverage: {
          type: coverage.type,
          franchiseId: coverage.franchiseId,
          territoryId: coverage.territoryId,
          priceTier,
          hqFallback: coverage.hqFallback,
          territoryLabel: coverage.territoryLabel ?? null,
          label: coverage.label ?? null,
          postalCode: coverage.postalCode ?? null,
          matchType: coverage.matchType ?? null,
        },
        campaignBooking: isCampaignProduct && slotSelection && product.campaignBooking
          ? {
              projectId: product.campaignBooking.projectId,
              bookingId: product.campaignBooking.bookingId,
              slotId: slotSelection.id,
              slotLabel: slotSelection.label,
              slotStartAt: slotSelection.startAt,
              slotEndAt: slotSelection.endAt,
              priceClass: slotSelection.priceClass,
              priceAdjustment: slotSelection.priceAdjustment,
            }
          : null,
        organiser: (() => {
          if (organiserAccess && organiserAccess.active) {
            return {
              organiserId: organiserAccess.program.organiserId,
              minimumGuarantee:
                organiserAccess.program.minimumGuarantee ?? null,
              exhibitorProductId:
                organiserAccess.program.exhibitorProductId ?? null,
              exhibitorPrice:
                organiserAccess.program.exhibitorPrice ?? basePrice,
              upsellVariationIds:
                organiserAccess.program.upsellVariationIds ?? [],
              commissionRate: organiserAccess.program.commissionRate ?? null,
              source: organiserAccess.source ?? "query",
              programEnabled: true,
              programKey: organiserAccess.program.organiserId,
              programProductId: product?.id ?? null,
            };
          }
          if (organiserProgramEnabled) {
            const rawProgram = product.organiserProgram ?? null;
            const minimum = parseOptionalNumber(rawProgram?.minimumGuarantee);
            const exhibitorPriceValue =
              parseOptionalNumber(rawProgram?.exhibitorPrice) ?? null;
            const commission = parseOptionalNumber(rawProgram?.commissionRate);
            const upsells = Array.isArray(rawProgram?.upsellVariationIds)
              ? rawProgram.upsellVariationIds.filter(
                  (value: unknown): value is string =>
                    typeof value === "string" && value.trim().length > 0
                )
              : [];
            const exhibitorProductId =
              typeof rawProgram?.exhibitorProductId === "string"
                ? rawProgram.exhibitorProductId
                : null;
            return {
              organiserId: null,
              minimumGuarantee: minimum,
              exhibitorProductId,
              exhibitorPrice: exhibitorPriceValue ?? basePrice,
              upsellVariationIds: upsells,
              commissionRate: commission,
              programEnabled: true,
              programKey: fallbackOrganiserProgramKey,
              programProductId: product?.id ?? null,
              source: "product",
            };
          }
          return null;
        })(),
      });
      setLiveMessage(
        reservationStatus === "pending"
          ? "Added to cart – kit confirmation pending"
          : "Added to cart"
      );
      setSubmitting(false);
      onClose();
    } catch (err) {
      updateCalendarStatus("available");
      console.error(err);
      setSubmitting(false);
      if (isFunctionsError(err) && err.code === "failed-precondition") {
        const details = (err as FunctionsError).details as any;
        const missingStandards = Array.isArray(details?.missingStandards)
          ? details.missingStandards.filter(
              (value: unknown): value is string => typeof value === "string"
            )
          : [];
        if (missingStandards.includes(DRONE_STANDARD_ID)) {
          setError(
            "Drone coverage isn't available yet because no registered kit meets the drone compliance standard. Please upload pilot licences and insurance on your equipment before trying again."
          );
          setLiveMessage("Drone compliance missing – reservation blocked");
          return;
        }
        if (missingStandards.length > 0) {
          setError(
            "We need equipment that meets the required standards before this package can be scheduled. Update your kit register or contact the operations team."
          );
          setLiveMessage("Missing required equipment standards");
          return;
        }
      }
      setError("We couldn't reserve the equipment right now. Try again in a moment.");
      setLiveMessage("Reservation failed");
    }
  };

  const canNext = locationStep
    ? coverageStatus === "success" && !!coverage && locationInput.trim().length > 0
    : orderFieldsStep
      ? orderFormQuestions.every((question) => {
          if (!question.required) {
            return true;
          }
          const value = orderFormValues[question.id] ?? "";
          return value.trim().length > 0;
        })
      : currentGroup
        ? (selected[currentGroup.id] || []).length > 0
        : isCampaignProduct
          ? campaignSlotStatus === "success" && !!selectedSlotId
          : !!date;

  const descriptionIds = useMemo(() => {
    const ids = ["wizard-description"];
    if (error) ids.push("wizard-error");
    if (conflicts.length > 0) ids.push("wizard-conflicts");
    if (coverageStatus === "error" && coverageError) ids.push("wizard-coverage-error");
    return ids.join(" ");
  }, [error, conflicts, coverageStatus, coverageError]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        aria-describedby={descriptionIds}
        tabIndex={-1}
        className={clsx(
          "bg-white p-6 rounded-lg shadow-xl max-w-lg w-full space-y-5 focus:outline-none transition-[max-width] duration-300",
          showTimeSlotPanel ? "lg:max-w-5xl" : undefined,
        )}
      >
        <div className="sr-only" aria-live="polite">
          {liveMessage}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="wizard-title" className="text-lg font-semibold">
              Add {product.name} to your cart
            </h2>
            <p id="wizard-description" className="mt-1 text-sm text-gray-600">
              Step {step + 1} of {totalSteps}. {stepLabel}
            </p>
            {organiserAccess && (
              <p
                className={clsx(
                  "mt-2 text-xs",
                  organiserActive ? "text-emerald-600" : "text-slate-500"
                )}
              >
                {organiserActive
                  ? "Partner organiser pricing is applied automatically for this booking."
                  : "Partner organiser pricing is available when booking through the event organiser link."}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close add to cart dialog"
          >
            Close
          </button>
        </div>
        {!hasLocationStep && (coverage || venueCoveragePreset) && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">
              Filming at {locationInput || venueCoveragePreset?.label || product.venue || "the booked venue"}
            </p>
            {coverage?.type === "franchise" && coverage.label && (
              <p className="mt-1">
                Local franchise partner: <span className="font-medium">{coverage.label}</span>
              </p>
            )}
            {coverage?.territoryLabel && (
              <p className="mt-1">Territory: {coverage.territoryLabel}</p>
            )}
            <p className="mt-2 text-sm font-medium text-slate-900">
              Base price for this venue: {GBP.format(effectiveBasePrice)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Location is pre-assigned for this package so we can fast-track scheduling with the on-site team.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!organiserActive && (
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={() => setOverrideLocation(true)}
                >
                  Use a different location
                </button>
              )}
            </div>
        </div>
      )}
      {locationStep ? (
        <div className="space-y-3">
          {hasPresetVenue && overrideLocation && !organiserActive && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                This package is normally fulfilled at {venueCoveragePreset?.label || product.venue || "the booked venue"}.
                Provide an alternate filming location below if this booking needs to be routed elsewhere.
              </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={() => setOverrideLocation(false)}
                  >
                    Use preset venue
                  </button>
                </div>
              </div>
            )}
            <div>
              <label
                htmlFor="wizard-location"
                className="block text-sm font-semibold text-gray-900"
              >
                Filming address or venue
              </label>
              <input
                id="wizard-location"
                type="text"
                className="input input-bordered mt-1 w-full"
                value={locationInput}
                onChange={(event) => setLocationInput(event.target.value)}
                placeholder="123 Example Street, Manchester"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label
                  htmlFor="wizard-postcode"
                  className="block text-sm font-semibold text-gray-900"
                >
                  Postcode
                </label>
                <input
                  id="wizard-postcode"
                  type="text"
                  className="input input-bordered mt-1 w-full uppercase"
                  value={postcodeInput}
                  onChange={(event) => setPostcodeInput(event.target.value)}
                  placeholder="e.g. M1 1AA"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="btn btn-primary w-full sm:w-auto"
                  onClick={handleCoverageLookup}
                  disabled={
                    coverageStatus === "loading" ||
                    locationInput.trim().length === 0 ||
                    postcodeInput.trim().length === 0
                  }
                >
                  {coverageStatus === "loading" ? "Checking…" : "Check coverage"}
                </button>
              </div>
            </div>
            {coverageStatus === "loading" && (
              <p className="text-sm text-gray-500">Checking franchise coverage…</p>
            )}
            {coverageStatus === "error" && coverageError && (
              <p id="wizard-coverage-error" className="text-sm text-red-600">
                {coverageError}
              </p>
            )}
            {coverageStatus === "success" && coverage && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                <p className="font-medium">
                  {coverage.type === "franchise"
                    ? `Coverage provided by ${coverage.label}`
                    : "HQ operations will coordinate this shoot"}
                </p>
                {coverage.territoryLabel && (
                  <p className="mt-1">Territory: {coverage.territoryLabel}</p>
                )}
                <p className="mt-1">
                  Base price for this location:{" "}
                  <span className="font-semibold">{GBP.format(effectiveBasePrice)}</span>
                </p>
              </div>
            )}
            <p className="text-xs text-gray-500">
              Confirming the filming location routes your booking to the right franchise or HQ
              team before we show available production dates.
            </p>
          </div>
        ) : orderFieldsStep ? (
          <div className="space-y-3">
            {orderFormQuestions.map((question) => {
              const inputId = `order-question-${question.id}`;
              const value = orderFormValues[question.id] ?? "";
              const fieldError = orderFormErrors[question.id];
              return (
                <div key={question.id} className="space-y-1">
                  <label
                    htmlFor={inputId}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-900"
                  >
                    {question.label}
                    {question.required && (
                      <span className="text-xs font-medium text-red-600">Required</span>
                    )}
                  </label>
                  {question.description && (
                    <p className="text-xs text-gray-500">{question.description}</p>
                  )}
                  {question.type === "long-text" ? (
                    <textarea
                      id={inputId}
                      className={`textarea textarea-bordered mt-1 w-full ${
                        fieldError ? "border-red-500 focus:border-red-500 focus:ring-red-500" : ""
                      }`}
                      value={value}
                      rows={3}
                      onChange={(event) =>
                        handleOrderFieldChange(question.id, event.target.value)
                      }
                    />
                  ) : (
                    <input
                      id={inputId}
                      type="text"
                      className={`input input-bordered mt-1 w-full ${
                        fieldError ? "border-red-500 focus:border-red-500 focus:ring-red-500" : ""
                      }`}
                      value={value}
                      onChange={(event) =>
                        handleOrderFieldChange(question.id, event.target.value)
                      }
                    />
                  )}
                  {fieldError && (
                    <p className="text-xs text-red-600">{fieldError}</p>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-gray-500">
              Your answers help the production team prepare for the shoot.
            </p>
          </div>
        ) : currentGroup ? (
          <div className="space-y-2">
            <p className="font-semibold">{currentGroup.name}</p>
            {currentGroup.options.map((o) => {
              const ids = selected[currentGroup.id] || [];
              const checked = ids.includes(o.id);
              return (
                <label
                  key={o.id}
                  className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm hover:border-gray-300 focus-within:border-orange-400"
                >
                  <input
                    type={currentGroup.multiple ? "checkbox" : "radio"}
                    name={`mod-${currentGroup.id}`}
                    checked={checked}
                    onChange={(e) => toggle(currentGroup, o.id, e.target.checked)}
                  />
                  <span>
                    {o.name}
                    {resolveOptionPrice(o) > 0
                      ? ` (+${GBP.format(resolveOptionPrice(o))})`
                      : ""}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-semibold">
              {isCampaignProduct ? "Select a slot" : "Production Date"}
            </p>
            {isCampaignProduct ? (
              <div className="space-y-2">
                {campaignSlotStatus === "loading" && (
                  <p className="text-sm text-gray-500">Loading available slots…</p>
                )}
                {campaignSlotStatus === "error" && campaignSlotError && (
                  <p className="text-sm text-red-600">{campaignSlotError}</p>
                )}
                {campaignSlotStatus === "success" && campaignSlots.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No slots are available right now. Check back soon or contact the team for
                    assistance.
                  </p>
                ) : null}
                {campaignSlots.length > 0 && (
                  <div className="space-y-2">
                    {campaignSlots.map((slot) => {
                      const remaining = Math.max(
                        slot.capacity - slot.booked - slot.held,
                        0
                      );
                      const slotPrice = effectiveBasePrice + slot.priceAdjustment;
                      const disabled = remaining === 0;
                      const checked = selectedSlotId === slot.id;
                      return (
                        <label
                          key={slot.id}
                          className={`flex flex-col gap-1 rounded-md border p-3 transition focus-within:border-orange-400 focus-within:ring-1 focus-within:ring-orange ${
                            checked ? "border-orange-400 bg-orange-50" : "border-gray-200 bg-white"
                          } ${disabled ? "opacity-60" : ""}`}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex items-start gap-3">
                              <input
                                type="radio"
                                name="campaign-slot"
                                className="mt-1"
                                checked={checked}
                                disabled={disabled}
                                onChange={() => handleSlotChoice(slot)}
                              />
                              <div className="space-y-1">
                                <p className="text-sm font-semibold">{slot.label}</p>
                                <p className="text-xs text-gray-600">
                                  {formatCampaignSlotWindow(slot)}
                                </p>
                                {slot.notes && (
                                  <p className="text-xs text-gray-500">{slot.notes}</p>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">
                                {GBP.format(slotPrice)}
                              </p>
                              {slot.priceClass && (
                                <p className="text-xs text-gray-500">{slot.priceClass}</p>
                              )}
                            </div>
                          </div>
                          <p
                            className={`text-xs ${
                              remaining > 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {remaining > 0
                              ? `${remaining} of ${slot.capacity} available`
                              : "Fully booked"}
                          </p>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : product.category === "exhibition-videography" && exhibitionOptions.length === 0 ? (
              <p className="text-sm text-gray-500">Show dates coming soon.</p>
            ) : coverageStatus === "success" && coverage ? (
              <div className="space-y-3">
                {product.category === "exhibition-videography" && eventRangeLabel && (
                  <p className="text-sm text-gray-600">Show runs {eventRangeLabel}.</p>
                )}
                <div
                  className={clsx(
                    "relative flex w-full flex-col gap-4",
                    showTimeSlotPanel ? "lg:flex-row lg:items-start lg:gap-8" : undefined,
                  )}
                >
                  <div
                    className={clsx(
                      "flex flex-col gap-3",
                      showTimeSlotPanel ? "lg:flex-shrink-0" : undefined,
                    )}
                  >
                    <div className="self-center lg:self-start">
                      <ProductDatePicker
                        productId={product.id}
                        selected={date}
                        onSelect={handleDateSelect}
                        scope={availabilityScope}
                        overrides={availabilityOverrides}
                        allowedDates={
                          product.category === "exhibition-videography"
                            ? exhibitionAllowedDates
                            : undefined
                        }
                        allowedDateLabels={
                          product.category === "exhibition-videography" &&
                          Object.keys(exhibitionDayLabels).length > 0
                            ? exhibitionDayLabels
                            : undefined
                        }
                        highlightedDates={
                          product.category === "exhibition-videography" &&
                          exhibitionHighlightDates.length > 0
                            ? exhibitionHighlightDates
                            : undefined
                        }
                        initialMonth={calendarInitialMonth}
                      />
                    </div>
                    {timeSlotRequired && !slotDateKey && (
                      <p className="text-xs text-gray-500">
                        Choose a production date to see available times.
                      </p>
                    )}
                  </div>
                  {timeSlotRequired && (
                    <aside
                      className={clsx(
                        "w-full rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-sm transition-all duration-300 ease-out lg:w-[22rem]",
                        showTimeSlotPanel
                          ? "mt-4 opacity-100 lg:mt-0 lg:translate-x-0"
                          : "mt-4 hidden opacity-0 lg:mt-0 lg:pointer-events-none lg:absolute lg:right-0 lg:top-0 lg:block lg:translate-x-[110%]",
                      )}
                      aria-hidden={showTimeSlotPanel ? undefined : true}
                    >
                      <p className="text-sm font-semibold text-gray-900">
                        Select a filming window
                      </p>
                      <div className="mt-3 space-y-3">
                        {slotDateKey && timeSlots.length > 0 ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {timeSlots.map((slot) => {
                              const checked = selectedTimeSlot?.id === slot.id;
                              return (
                                <label
                                  key={slot.id}
                                  className={clsx(
                                    "flex items-center gap-3 rounded-md border p-3 text-sm transition focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange",
                                    checked
                                      ? "border-orange-500 bg-orange-50 text-orange-900 shadow-sm"
                                      : "border-emerald-500 bg-emerald-50 text-emerald-900 hover:border-emerald-600 hover:bg-emerald-100",
                                  )}
                                >
                                  <input
                                    type="radio"
                                    name="onsite-slot"
                                    className="mt-0.5"
                                    checked={checked}
                                    onChange={() => handleTimeSlotSelect(slot)}
                                  />
                                  <span className="font-semibold">{slot.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">
                            This product doesn’t have any bookable windows yet.
                          </p>
                        )}
                        <p className="text-xs text-gray-500">
                          Times shown in UK local time.
                        </p>
                      </div>
                    </aside>
                  )}
                </div>
                {product.category === "exhibition-videography" && exhibitionSetupOption && (
                  <label
                    className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm transition focus-within:border-orange-400 focus-within:ring-1 focus-within:ring-orange ${
                      includeSetupDay
                        ? "border-orange-400 bg-orange-50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={includeSetupDay}
                      onChange={() => {
                        setConflicts([]);
                        setError(null);
                        setIncludeSetupDay((prev) => {
                          const next = !prev;
                          if (!next) {
                            announceSelection(date, onsiteBlockingDays);
                          } else {
                            announceSelection(
                              exhibitionSetupOption.key,
                              onsiteBlockingDays + 1
                            );
                          }
                          return next;
                        });
                      }}
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Include setup day coverage</p>
                      <p className="text-xs text-gray-500">
                        We’ll arrive on {exhibitionSetupOption.label} to capture stand build and
                        pre-show content. The setup day is outlined on the calendar above.
                      </p>
                    </div>
                  </label>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Confirm the filming address and postcode first to check availability.
              </p>
            )}
            {(onsiteSummary || (selectedDateRange && bookingSpan > 1)) && (
              <div className="space-y-1 text-xs text-gray-600">
                {onsiteSummary && <p>{onsiteSummary}</p>}
                {timeSlotRequired && selectedTimeSlot && (
                  <p>Preferred time: {selectedTimeSlot.label}</p>
                )}
                {selectedDateRange && bookingSpan > 1 && (
                  <p>
                    Crew reserved {" "}
                    {selectedDateRange.start.toLocaleDateString()} – {" "}
                    {selectedDateRange.end.toLocaleDateString()}
                  </p>
                )}
                {product.category === "exhibition-videography" &&
                  includeSetupDay &&
                  exhibitionSetupOption && (
                    <p>Setup day coverage included.</p>
                  )}
              </div>
            )}
          </div>
        )}
        {error && (
          <div
            id="wizard-error"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p id="wizard-conflicts" className="font-medium">
              The following items are unavailable on {date}:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {conflicts.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <p className="mt-2">
              Choose a different date or adjust your selections to continue.
            </p>
          </div>
        )}
        <div className="flex justify-between pt-2">
          <button className="btn btn-sm" onClick={back}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {dateStep ? (
            <button
              className="btn btn-sm"
              disabled={
                !date || submitting || (timeSlotRequired && !selectedTimeSlotRange)
              }
              onClick={handleFinish}
            >
              {submitting ? "Adding…" : "Add to Cart"}
            </button>
          ) : (
            <button
              className="btn btn-sm"
              disabled={!canNext}
              onClick={next}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

