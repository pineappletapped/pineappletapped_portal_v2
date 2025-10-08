"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

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
  const [rosterAvailability, setRosterAvailability] = useState<
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

  useEffect(() => {
    let cancelled = false;
    if (!scope) {
      setRosterAvailability({});
      return () => {
        cancelled = true;
      };
    }
    loadAvailabilityForScope(scope)
      .then((data) => {
        if (!cancelled) {
          setRosterAvailability(data);
        }
      })
      .catch((error) => {
        console.error("Failed to load routing availability", error);
        if (!cancelled) {
          setRosterAvailability({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

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
          const statusSource =
            overrides?.[date] ?? availability[date] ?? rosterAvailability[date];
          const fallbackStatus: ProductAvailabilityStatus = scope
            ? "pending"
            : "available";
          let status: ProductAvailabilityStatus =
            statusSource ?? fallbackStatus;
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

const ROUTING_AVAILABILITY_CACHE_TTL = 5 * 60 * 1000;

type RoutingStageKey = "franchise" | "hq";

interface RoutingStageRoster {
  members: Record<string, RoutingStageKey[]>;
}

const rosterCache = new Map<string, { fetchedAt: number; roster: RoutingStageRoster }>();
const availabilityCache = new Map<
  string,
  { fetchedAt: number; data: Record<string, ProductAvailabilityStatus> }
>();

const mapTeamAvailabilityToProduct = (
  value: unknown
): ProductAvailabilityStatus | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  switch (trimmed) {
    case "available":
      return "available";
    case "partial":
    case "limited":
      return "pending";
    case "booked":
      return "booked";
    case "unavailable":
      return "unavailable";
    default:
      return null;
  }
};

const summariseStageStatuses = (
  statuses: ProductAvailabilityStatus[]
): ProductAvailabilityStatus | null => {
  if (!statuses || statuses.length === 0) {
    return null;
  }
  if (statuses.some((status) => status === "unavailable")) {
    return "unavailable";
  }
  if (statuses.some((status) => status === "booked")) {
    return "booked";
  }
  if (statuses.some((status) => status === "pending")) {
    return "pending";
  }
  return "available";
};

const resolveFinalStatusForScope = (
  scope: ProductAvailabilityScope,
  franchiseStatus: ProductAvailabilityStatus | null,
  hqStatus: ProductAvailabilityStatus | null,
  options: { hasFranchiseMembers: boolean; hasHqMembers: boolean }
): ProductAvailabilityStatus => {
  const { hasFranchiseMembers, hasHqMembers } = options;
  if (scope.type === "franchise") {
    if (franchiseStatus === "available") {
      return "available";
    }
    if (franchiseStatus === "pending") {
      return "pending";
    }
    if (franchiseStatus === "booked" || franchiseStatus === "unavailable") {
      if (!hqStatus) {
        return hasHqMembers ? "pending" : franchiseStatus;
      }
      if (hqStatus === "available" || hqStatus === "pending") {
        return "pending";
      }
      if (hqStatus === "booked") {
        return "booked";
      }
      return "unavailable";
    }
    if (franchiseStatus == null) {
      if (hasFranchiseMembers) {
        if (!hqStatus) {
          return hasHqMembers ? "pending" : "pending";
        }
        if (hqStatus === "available") {
          return "pending";
        }
        return hqStatus;
      }
      if (!hqStatus) {
        return hasHqMembers ? "pending" : "pending";
      }
      if (hqStatus === "available") {
        return "pending";
      }
      return hqStatus;
    }
    return franchiseStatus;
  }
  if (!hqStatus) {
    return hasHqMembers ? "pending" : "pending";
  }
  return hqStatus;
};

const loadRosterForScope = async (
  scope: ProductAvailabilityScope
): Promise<RoutingStageRoster> => {
  const cacheKey = JSON.stringify(scope);
  const now = Date.now();
  const cached = rosterCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < ROUTING_AVAILABILITY_CACHE_TTL) {
    return cached.roster;
  }

  const membership = new Map<string, Set<RoutingStageKey>>();
  const addMember = (uid: string | null | undefined, stage: RoutingStageKey) => {
    if (!uid) {
      return;
    }
    const trimmed = uid.trim();
    if (!trimmed) {
      return;
    }
    let stages = membership.get(trimmed);
    if (!stages) {
      stages = new Set<RoutingStageKey>();
      membership.set(trimmed, stages);
    }
    stages.add(stage);
  };

  try {
    const userCollection = collection(db, "users");
    if (scope.type === "franchise" && scope.franchiseId) {
      const franchiseId = scope.franchiseId;
      const [franchiseSnap, primarySnap] = await Promise.all([
        getDocs(
          query(userCollection, where("franchiseIds", "array-contains", franchiseId))
        ),
        getDocs(query(userCollection, where("primaryFranchiseId", "==", franchiseId))),
      ]);
      [franchiseSnap, primarySnap].forEach((snap) => {
        snap.docs.forEach((docSnap) => {
          addMember(docSnap.id, "franchise");
        });
      });
    }

    const hqQueries = [
      query(userCollection, where("isStaff", "==", true)),
      query(userCollection, where("roles.admin", "==", true)),
      query(userCollection, where("roles.operations", "==", true)),
      query(userCollection, where("roles.projects", "==", true)),
    ];

    await Promise.all(
      hqQueries.map((hqQuery) =>
        getDocs(hqQuery)
          .then((snap) => {
            snap.docs.forEach((docSnap) => {
              addMember(docSnap.id, "hq");
            });
          })
          .catch((error) => {
            console.error("Failed to load HQ availability roster", error);
            return null;
          })
      )
    );
  } catch (error) {
    console.error("Failed to load availability roster", error);
  }

  const members: Record<string, RoutingStageKey[]> = {};
  membership.forEach((stages, uid) => {
    members[uid] = Array.from(stages);
  });

  const roster: RoutingStageRoster = { members };
  rosterCache.set(cacheKey, { fetchedAt: now, roster });
  return roster;
};

const loadAvailabilityForScope = async (
  scope: ProductAvailabilityScope
): Promise<Record<string, ProductAvailabilityStatus>> => {
  const cacheKey = JSON.stringify(scope);
  const now = Date.now();
  const cached = availabilityCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < ROUTING_AVAILABILITY_CACHE_TTL) {
    return cached.data;
  }

  const roster = await loadRosterForScope(scope);
  const membershipEntries = Object.entries(roster.members);
  if (membershipEntries.length === 0) {
    availabilityCache.set(cacheKey, { fetchedAt: now, data: {} });
    return {};
  }

  const stageMap = new Map<
    string,
    { franchise: ProductAvailabilityStatus[]; hq: ProductAvailabilityStatus[] }
  >();

  const tasks = membershipEntries.map(async ([uid, stages]) => {
    try {
      const availabilitySnap = await getDocs(
        query(collection(db, "availability"), where("uid", "==", uid))
      );
      availabilitySnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const dateKey =
          typeof data.date === "string" ? normaliseDateKey(data.date) : null;
        const status = mapTeamAvailabilityToProduct(data.status);
        if (!dateKey || !status) {
          return;
        }
        let entry = stageMap.get(dateKey);
        if (!entry) {
          entry = { franchise: [], hq: [] };
          stageMap.set(dateKey, entry);
        }
        stages.forEach((stage) => {
          entry![stage].push(status);
        });
      });
    } catch (error) {
      console.error("Failed to load team availability", error);
    }
  });

  await Promise.all(tasks);

  const hasFranchiseMembers = membershipEntries.some(([, stages]) =>
    stages.includes("franchise")
  );
  const hasHqMembers = membershipEntries.some(([, stages]) =>
    stages.includes("hq")
  );

  const aggregated: Record<string, ProductAvailabilityStatus> = {};
  stageMap.forEach((stageStatuses, dateKey) => {
    const franchiseStatus = summariseStageStatuses(stageStatuses.franchise);
    const hqStatus = summariseStageStatuses(stageStatuses.hq);
    aggregated[dateKey] = resolveFinalStatusForScope(scope, franchiseStatus, hqStatus, {
      hasFranchiseMembers,
      hasHqMembers,
    });
  });

  availabilityCache.set(cacheKey, { fetchedAt: now, data: aggregated });
  return aggregated;
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
