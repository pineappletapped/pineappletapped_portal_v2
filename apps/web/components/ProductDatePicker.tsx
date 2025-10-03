"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";

export type ProductAvailabilityStatus =
  | "available"
  | "pending"
  | "booked"
  | "unavailable";

export type ProductAvailabilityScope =
  | { type: "hq"; organisationId?: string | null }
  | { type: "franchise"; franchiseId: string; territoryId?: string | null };

interface Props {
  productId: string;
  selected: string | null;
  onSelect: (date: string) => void;
  scope?: ProductAvailabilityScope | null;
  overrides?: Record<string, ProductAvailabilityStatus> | null;
  allowedDates?: string[] | null;
  allowedDateLabels?: Record<string, string> | null;
  highlightedDates?: string[] | null;
  initialMonth?: string | null;
}

export default function ProductDatePicker({
  productId,
  selected,
  onSelect,
  scope,
  overrides,
  allowedDates,
  allowedDateLabels,
  highlightedDates,
  initialMonth,
}: Props) {
  const today = useMemo(() => new Date(), []);
  const [entries, setEntries] = useState<
    Array<{ id: string; data: Record<string, unknown> }>
  >([]);
  const [availability, setAvailability] = useState<
    Record<string, ProductAvailabilityStatus>
  >({});

  const allowedInfo = useMemo(() => {
    const allowedSet = new Set<string>();
    const labelMap = new Map<string, string>();
    if (Array.isArray(allowedDates)) {
      allowedDates.forEach((value) => {
        const key = normaliseDateKey(value);
        if (key) {
          allowedSet.add(key);
        }
      });
    }
    if (allowedDateLabels && typeof allowedDateLabels === "object") {
      Object.entries(allowedDateLabels).forEach(([rawKey, rawLabel]) => {
        const key = normaliseDateKey(rawKey);
        if (!key) {
          return;
        }
        const label = String(rawLabel ?? "").trim();
        if (label.length > 0) {
          labelMap.set(key, label);
        }
        allowedSet.add(key);
      });
    }
    let earliest: string | null = null;
    allowedSet.forEach((key) => {
      if (!earliest || key < earliest) {
        earliest = key;
      }
    });
    const signature = Array.from(allowedSet)
      .sort()
      .join("|");
    return {
      hasAllowed: allowedSet.size > 0,
      allowedSet,
      labelMap,
      earliest,
      signature,
    } as const;
  }, [allowedDates, allowedDateLabels]);

  const highlightSet = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(highlightedDates)) {
      highlightedDates.forEach((value) => {
        const key = normaliseDateKey(value);
        if (key) {
          set.add(key);
        }
      });
    }
    return set;
  }, [highlightedDates]);

  const derivedMonthKey = useMemo(() => {
    const selectedMonth = monthKeyFromDateKey(selected);
    if (selectedMonth) {
      return selectedMonth;
    }
    const initialMonthKey = normaliseMonthKey(initialMonth);
    if (initialMonthKey) {
      return initialMonthKey;
    }
    if (allowedInfo.earliest) {
      const allowedMonth = monthKeyFromDateKey(allowedInfo.earliest);
      if (allowedMonth) {
        return allowedMonth;
      }
    }
    return toMonthKey(today);
  }, [allowedInfo.earliest, initialMonth, selected, today]);

  const [view, setView] = useState(() =>
    monthKeyToDate(derivedMonthKey) ??
    new Date(today.getFullYear(), today.getMonth(), 1)
  );

  useEffect(() => {
    setView((current) => {
      const next = monthKeyToDate(derivedMonthKey);
      if (!next) {
        return current;
      }
      const currentKey = toMonthKey(current);
      const nextKey = toMonthKey(next);
      return currentKey === nextKey ? current : next;
    });
  }, [derivedMonthKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDocs(
          collection(db, "productAvailability", productId, "dates")
        );
        const docs = snap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data() as Record<string, unknown>,
        }));
        if (!cancelled) {
          setEntries(docs);
        }
      } catch (e) {
        if (!cancelled) {
          setEntries([]);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  useEffect(() => {
    const map: Record<string, { status: ProductAvailabilityStatus; priority: number }> = {};
    entries.forEach(({ id, data }) => {
      const status = normaliseStatus(data.status);
      const evaluation = evaluateScopeMatch(data, scope);
      if (!evaluation.match) {
        return;
      }
      const existing = map[id];
      if (!existing || evaluation.priority >= existing.priority) {
        map[id] = { status, priority: evaluation.priority };
      }
    });
    const next: Record<string, ProductAvailabilityStatus> = {};
    Object.entries(map).forEach(([id, entry]) => {
      next[id] = entry.status;
    });
    setAvailability(next);
  }, [entries, scope]);

  const y = view.getFullYear();
  const m = view.getMonth();
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const days = useMemo(() => {
    const first = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const arr: (number | null)[] = Array(first).fill(null);
    for (let d = 1; d <= total; d++) arr.push(d);
    return arr;
  }, [y, m]);

  const statusText: Record<ProductAvailabilityStatus, string> = {
    available: "Available",
    pending: "Pending confirmation",
    booked: "Booked",
    unavailable: "Unavailable",
  };

  const indicatorPalette: Record<ProductAvailabilityStatus, string> = {
    available: "bg-green-500",
    pending: "bg-amber-500",
    booked: "bg-red-500",
    unavailable: "bg-gray-400",
  };

  const cellClasses = (
    status: ProductAvailabilityStatus,
    date: string,
    options: { isAllowed: boolean; isHighlighted: boolean; isSelected: boolean }
  ) => {
    const isDisabled =
      status === "booked" || status === "unavailable" || !options.isAllowed;
    const base =
      "relative flex min-h-[4.5rem] flex-col items-center justify-center rounded-md border px-2 py-2 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange";
    const palette: Record<ProductAvailabilityStatus, string> = {
      available: "border-green-500 text-green-700 bg-green-50 hover:bg-green-100",
      pending: "border-amber-500 text-amber-700 bg-amber-50 hover:bg-amber-100",
      booked: "border-red-400 text-red-600 bg-red-50",
      unavailable: "border-gray-300 text-gray-500 bg-gray-100",
    };
    const allowedClass = options.isAllowed ? palette[status] : palette.unavailable;
    const disabled = isDisabled ? " cursor-not-allowed opacity-70" : "";
    const highlight = options.isHighlighted ? " outline outline-1 outline-orange-300" : "";
    const selectedClass = options.isSelected ? " ring-2 ring-orange-500" : "";
    return `${base} ${allowedClass}${disabled}${highlight}${selectedClass}`;
  };

  const handleSelect = (date: string, status: ProductAvailabilityStatus) => {
    const isAllowed = !allowedInfo.hasAllowed || allowedInfo.allowedSet.has(date);
    if (!isAllowed) {
      return;
    }
    if (status === "available" || status === "pending") {
      onSelect(date);
    }
  };

  return (
    <div className="max-w-sm text-xs" role="group" aria-label="Select a production date">
      <div className="mb-1 flex items-center justify-between">
        <button
          className="btn btn-xs"
          onClick={() =>
            setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))
          }
          aria-label="Previous month"
        >
          ‹
        </button>
        <span>
          {view.toLocaleString("default", { month: "long" })} {y}
        </span>
        <button
          className="btn btn-xs"
          onClick={() =>
            setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))
          }
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div
        className="grid grid-cols-7 gap-1 text-[0.6rem] font-medium uppercase tracking-wide text-gray-500"
        aria-hidden
      >
        {dayLabels.map((day) => (
          <div key={day} className="text-center">
            {day}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="presentation">
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(
            2,
            "0"
          )}`;
          const isAllowed =
            !allowedInfo.hasAllowed || allowedInfo.allowedSet.has(date);
          const statusSource = overrides?.[date] ?? availability[date];
          let status: ProductAvailabilityStatus = statusSource ?? "available";
          let statusLabel = statusText[status];
          if (!isAllowed) {
            status = "unavailable";
            statusLabel = "Not in schedule";
          }
          const isDisabled =
            status === "booked" || status === "unavailable" || !isAllowed;
          const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString(
            undefined,
            { weekday: "long", month: "long", day: "numeric", year: "numeric" }
          );
          const helperLabel = allowedInfo.labelMap.get(date) ?? null;
          return (
            <button
              key={date}
              type="button"
              className={cellClasses(status, date, {
                isAllowed,
                isHighlighted: highlightSet.has(date),
                isSelected: selected === date,
              })}
              onClick={() => handleSelect(date, status)}
              aria-disabled={isDisabled}
              disabled={isDisabled}
              aria-pressed={selected === date ? true : undefined}
              aria-label={`${formattedDate} – ${statusLabel}`}
            >
              <span
                aria-hidden
                className={`absolute left-1 top-1 h-2 w-2 rounded-full ${indicatorPalette[status]}`}
              />
              <span className="text-sm font-medium">{d}</span>
              {helperLabel ? (
                <span className="mt-0.5 text-[0.55rem] font-semibold text-gray-700">
                  {helperLabel}
                </span>
              ) : null}
              <span className="mt-0.5 text-[0.6rem] font-semibold">
                {statusLabel}
              </span>
            </button>
          );
        })}
      </div>
      <ul className="mt-3 space-y-1" aria-label="Booking status legend">
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden />
          <span>Available – reserve immediately.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          <span>Pending confirmation – we’ll follow up if the slot changes.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
          <span>Booked – choose a different day.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gray-400" aria-hidden />
          <span>Unavailable – this date can’t be scheduled.</span>
        </li>
      </ul>
    </div>
  );
}

const normaliseStatus = (value: unknown): ProductAvailabilityStatus => {
  if (typeof value !== "string") return "available";
  switch (value.toLowerCase()) {
    case "pending":
      return "pending";
    case "booked":
      return "booked";
    case "unavailable":
      return "unavailable";
    default:
      return "available";
  }
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (entry == null) {
        return null;
      }
      return String(entry);
    })
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
};

const evaluateScopeMatch = (
  data: Record<string, unknown>,
  scope: ProductAvailabilityScope | null | undefined
): { match: boolean; priority: number } => {
  const rawScopeType =
    typeof data.scopeType === "string"
      ? data.scopeType
      : typeof data.scope === "string"
        ? data.scope
        : null;
  const scopeType = rawScopeType ? rawScopeType.toLowerCase() : null;
  const scopeId = typeof data.scopeId === "string" ? data.scopeId : null;
  const franchiseId = typeof data.franchiseId === "string" ? data.franchiseId : null;
  const franchiseIds = toStringArray(data.franchiseIds);
  if (franchiseId && !franchiseIds.includes(franchiseId)) {
    franchiseIds.push(franchiseId);
  }
  const territoryId = typeof data.territoryId === "string" ? data.territoryId : null;
  const territoryIds = toStringArray(data.territoryIds);
  if (territoryId && !territoryIds.includes(territoryId)) {
    territoryIds.push(territoryId);
  }
  const organisationId =
    typeof data.organisationId === "string" ? data.organisationId : null;
  const organisationIds = toStringArray(data.organisationIds);
  if (organisationId && !organisationIds.includes(organisationId)) {
    organisationIds.push(organisationId);
  }
  const appliesGlobally =
    !scopeType &&
    !scopeId &&
    franchiseIds.length === 0 &&
    territoryIds.length === 0 &&
    organisationIds.length === 0 &&
    data.hqOnly !== true &&
    data.franchiseOnly !== true;
  if (!scope) {
    return { match: appliesGlobally, priority: appliesGlobally ? 0 : -1 };
  }
  if (scope.type === "franchise") {
    if (data.hqOnly === true) {
      return { match: false, priority: -1 };
    }
    if (franchiseIds.length > 0 && !franchiseIds.includes(scope.franchiseId)) {
      return { match: false, priority: -1 };
    }
    if (scope.territoryId) {
      if (
        territoryIds.length > 0 &&
        !territoryIds.includes(scope.territoryId)
      ) {
        return { match: false, priority: -1 };
      }
      if (territoryIds.includes(scope.territoryId)) {
        return { match: true, priority: 30 };
      }
    } else if (territoryIds.length > 0) {
      return { match: false, priority: -1 };
    }
    if (franchiseIds.includes(scope.franchiseId)) {
      return { match: true, priority: 20 };
    }
    if (organisationIds.length > 0 && !organisationIds.includes(scope.franchiseId)) {
      return { match: false, priority: -1 };
    }
    if (scopeType === "franchise" && scopeId && scopeId !== scope.franchiseId) {
      return { match: false, priority: -1 };
    }
    return { match: appliesGlobally, priority: appliesGlobally ? 5 : -1 };
  }
  // HQ scope
  if (data.franchiseOnly === true) {
    return { match: false, priority: -1 };
  }
  if (franchiseIds.length > 0 || territoryIds.length > 0) {
    return { match: false, priority: -1 };
  }
  if (organisationIds.length > 0) {
    if (scope.organisationId && organisationIds.includes(scope.organisationId)) {
      return { match: true, priority: 10 };
    }
    return { match: false, priority: -1 };
  }
  if (scopeType === "hq" || scopeType === "organisation") {
    return { match: true, priority: 5 };
  }
  return { match: appliesGlobally, priority: appliesGlobally ? 0 : -1 };
};

const normaliseDateKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const monthKeyFromDateKey = (value: string | null | undefined): string | null => {
  const key = normaliseDateKey(value);
  if (!key) {
    return null;
  }
  return key.slice(0, 7);
};

const normaliseMonthKey = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const [yearStr, monthStr] = trimmed.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }
  if (month < 1 || month > 12) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
};

const toMonthKey = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const monthKeyToDate = (value: string | null): Date | null => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const [yearStr, monthStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }
  return new Date(year, month - 1, 1);
};
