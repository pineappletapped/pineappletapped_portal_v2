"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import TerritoryMap from "@/components/TerritoryMap";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import {
  type Franchise,
  type FranchiseOnboardingStatus,
  type FranchiseMember,
  type FranchiseMemberRole,
  type FranchiseStatus,
  type FranchiseTerritory,
  type FranchiseRoyaltyConfig,
  type FranchiseQuickBooksConfig,
  canActivateFranchise,
  defaultFranchiseOnboarding,
  defaultFranchiseRoyaltyConfig,
  defaultFranchiseQuickBooksConfig,
  parseFranchise,
  parseMember,
  parseTerritory,
  territorySummary,
} from "@/lib/franchises";

interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  contractor?: boolean;
  isStaff?: boolean;
  franchiseId?: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
}

const FRANCHISE_STATUSES: { value: FranchiseStatus; label: string; description: string }[] = [
  { value: "prospect", label: "Prospect", description: "Exploring the opportunity and not yet launched." },
  { value: "active", label: "Active", description: "Currently onboarding or servicing clients." },
  { value: "paused", label: "Paused", description: "Temporarily on hold (seasonal or admin reasons)." },
  { value: "suspended", label: "Suspended", description: "Access revoked pending resolution." },
];

const MEMBER_ROLES: { value: FranchiseMemberRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Primary point of contact and legal licensee." },
  { value: "franchisee", label: "Franchisee", description: "Day-to-day operator for the territory." },
  { value: "contractor", label: "Contractor", description: "Operates under the franchise banner for specific jobs." },
  { value: "hq", label: "HQ Liaison", description: "HQ team member supporting the franchise." },
];

const TERRITORY_TYPES = [
  { value: "postal" as const, label: "Postcode collection" },
  { value: "radius" as const, label: "Radius from coordinate" },
];

const ONBOARDING_STATUS_OPTIONS: {
  value: FranchiseOnboardingStatus;
  label: string;
  description: string;
}[] = [
  { value: "not_started", label: "Not started", description: "No information submitted yet." },
  { value: "in_progress", label: "In progress", description: "Franchisee is working through the step." },
  {
    value: "needs_attention",
    label: "Needs attention",
    description: "Information provided but requires follow-up or correction.",
  },
  { value: "completed", label: "Completed", description: "Step verified and approved by HQ." },
];

const onboardingStatusLabel = (value: FranchiseOnboardingStatus) =>
  ONBOARDING_STATUS_OPTIONS.find((option) => option.value === value)?.label || "Not started";

const normalisePostalCode = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned || null;
};

const normalisePostalCodeList = (values: string[]): string[] => {
  const results: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const normalised = normalisePostalCode(value);
    if (!normalised || seen.has(normalised)) {
      return;
    }
    seen.add(normalised);
    results.push(normalised);
  });
  return results;
};

const haversineDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Number.isFinite(distance) ? distance : Number.NaN;
};

type ExclusiveTerritoryCandidate = Pick<
  FranchiseTerritory,
  "type" | "postalCodes" | "radiusKm" | "centerLat" | "centerLng" | "exclusive"
> & {
  id?: string | null;
};

const findExclusiveTerritoryConflicts = (
  candidate: ExclusiveTerritoryCandidate,
  existing: FranchiseTerritory[]
): FranchiseTerritory[] => {
  if (!candidate.exclusive) {
    return [];
  }

  const conflicts: FranchiseTerritory[] = [];
  const candidateId = candidate.id ?? null;

  const candidatePostalCodes = normalisePostalCodeList(candidate.postalCodes ?? []);
  const candidateHasRadius =
    candidate.type === "radius" &&
    typeof candidate.radiusKm === "number" &&
    candidate.radiusKm > 0 &&
    typeof candidate.centerLat === "number" &&
    typeof candidate.centerLng === "number";

  for (const territory of existing) {
    if (!territory.exclusive) {
      continue;
    }
    if (territory.id === candidateId) {
      continue;
    }

    if (candidate.type === "postal" && territory.type === "postal") {
      const territoryCodes = normalisePostalCodeList(territory.postalCodes ?? []);
      if (territoryCodes.length === 0 || candidatePostalCodes.length === 0) {
        continue;
      }
      const hasOverlap = candidatePostalCodes.some((candidateCode) =>
        territoryCodes.some(
          (existingCode) =>
            candidateCode === existingCode ||
            candidateCode.startsWith(existingCode) ||
            existingCode.startsWith(candidateCode)
        )
      );
      if (hasOverlap) {
        conflicts.push(territory);
        continue;
      }
    }

    if (candidate.type === "radius" && territory.type === "radius" && candidateHasRadius) {
      const territoryHasRadius =
        typeof territory.radiusKm === "number" &&
        territory.radiusKm > 0 &&
        typeof territory.centerLat === "number" &&
        typeof territory.centerLng === "number";
      if (!territoryHasRadius) {
        continue;
      }
      const distance = haversineDistanceKm(
        candidate.centerLat as number,
        candidate.centerLng as number,
        territory.centerLat as number,
        territory.centerLng as number
      );
      if (!Number.isFinite(distance)) {
        continue;
      }
      if (distance <= (candidate.radiusKm as number) + (territory.radiusKm as number)) {
        conflicts.push(territory);
        continue;
      }
    }
  }

  return conflicts;
};

function createOnboardingState() {
  return { ...defaultFranchiseOnboarding() };
}

type OnboardingState = ReturnType<typeof createOnboardingState>;

type RoyaltyTierState = {
  id: string;
  minOrder: string;
  maxOrder: string;
  percentage: string;
};

type RoyaltyState = {
  hqTiers: RoyaltyTierState[];
  franchisePercentage: string;
};

type QuickBooksState = {
  environment: 'sandbox' | 'production';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
};

const ordinal = (value: number) => {
  const remainder = value % 10;
  const isTeen = value % 100 >= 11 && value % 100 <= 13;
  if (isTeen) return `${value}th`;
  if (remainder === 1) return `${value}st`;
  if (remainder === 2) return `${value}nd`;
  if (remainder === 3) return `${value}rd`;
  return `${value}th`;
};

const createRoyaltyState = (config?: FranchiseRoyaltyConfig | null): RoyaltyState => {
  const base = config && config.hqTiers?.length > 0 ? config : defaultFranchiseRoyaltyConfig();
  const tiers = (base.hqTiers?.length ? base.hqTiers : defaultFranchiseRoyaltyConfig().hqTiers).map(
    (tier, index) => ({
      id: `${tier.minOrder}-${tier.maxOrder ?? 'open'}-${index}`,
      minOrder: String(tier.minOrder),
      maxOrder: tier.maxOrder == null ? "" : String(tier.maxOrder),
      percentage: String(tier.percentage),
    })
  );
  return {
    hqTiers: tiers,
    franchisePercentage: String(base.franchiseSourcedPercentage ?? defaultFranchiseRoyaltyConfig().franchiseSourcedPercentage),
  };
};

const createQuickBooksState = (config?: FranchiseQuickBooksConfig | null): QuickBooksState => {
  const base = config ?? defaultFranchiseQuickBooksConfig();
  return {
    environment: base.environment ?? 'production',
    clientId: base.clientId ?? '',
    clientSecret: base.clientSecret ?? '',
    refreshToken: base.refreshToken ?? '',
    realmId: base.realmId ?? '',
  };
};

const serializeQuickBooksState = (state: QuickBooksState) => {
  const environment = state.environment === 'sandbox' ? 'sandbox' : 'production';
  const clientId = state.clientId.trim();
  const clientSecret = state.clientSecret.trim();
  const refreshToken = state.refreshToken.trim();
  const realmId = state.realmId.trim();
  const connected = Boolean(clientId && clientSecret && refreshToken && realmId);
  return {
    environment,
    clientId: clientId || null,
    clientSecret: clientSecret || null,
    refreshToken: refreshToken || null,
    realmId: realmId || null,
    connected,
  };
};

const quickBooksConfigConnected = (config: FranchiseQuickBooksConfig | null | undefined): boolean =>
  Boolean(config?.clientId && config?.clientSecret && config?.refreshToken && config?.realmId);

const quickBooksStateConnected = (state: QuickBooksState): boolean => serializeQuickBooksState(state).connected;

const serializeRoyaltyState = (state: RoyaltyState): FranchiseRoyaltyConfig => {
  const defaults = defaultFranchiseRoyaltyConfig();
  const tiers = state.hqTiers
    .map((tier) => {
      const min = Number.parseInt(tier.minOrder, 10);
      const percentage = Number.parseFloat(tier.percentage);
      if (!Number.isFinite(min) || min <= 0 || !Number.isFinite(percentage)) {
        return null;
      }
      const cleanMin = Math.max(1, Math.floor(min));
      const max = tier.maxOrder.trim().length === 0 ? null : Number.parseInt(tier.maxOrder, 10);
      const cleanedMax =
        max == null || !Number.isFinite(max)
          ? null
          : Math.max(cleanMin, Math.floor(max));
      return {
        minOrder: cleanMin,
        maxOrder: cleanedMax,
        percentage,
      };
    })
    .filter((value): value is { minOrder: number; maxOrder: number | null; percentage: number } => value !== null)
    .sort((a, b) => a.minOrder - b.minOrder);
  const franchisePct = Number.parseFloat(state.franchisePercentage);
  const franchisePercentage = Number.isFinite(franchisePct) && franchisePct >= 0
    ? franchisePct
    : defaults.franchiseSourcedPercentage;
  return {
    hqTiers: tiers.length > 0 ? tiers : defaults.hqTiers,
    franchiseSourcedPercentage: franchisePercentage,
  };
};

const appendRoyaltyTier = (state: RoyaltyState): RoyaltyState => {
  const nextTiers = state.hqTiers.slice();
  const last = nextTiers[nextTiers.length - 1];
  const fallbackMin = last ? Number.parseInt(last.minOrder, 10) || 0 : 0;
  const lastMax = last ? Number.parseInt(last.maxOrder, 10) : NaN;
  const nextMin = Number.isFinite(lastMax) ? lastMax + 1 : fallbackMin + 1;
  nextTiers.push({
    id: `tier-${Date.now()}`,
    minOrder: String(Math.max(1, nextMin)),
    maxOrder: "",
    percentage: last ? last.percentage : String(defaultFranchiseRoyaltyConfig().hqTiers[0].percentage),
  });
  return { ...state, hqTiers: nextTiers };
};

const removeRoyaltyTier = (state: RoyaltyState, index: number): RoyaltyState => {
  if (state.hqTiers.length <= 1) {
    return state;
  }
  const tiers = state.hqTiers.filter((_, idx) => idx !== index);
  return { ...state, hqTiers: tiers };
};

type AdminFranchiseTab = "franchises" | "territories" | "members";

const FRANCHISE_TABS: { id: AdminFranchiseTab; label: string }[] = [
  { id: "franchises", label: "Franchises" },
  { id: "territories", label: "Territories" },
  { id: "members", label: "Members & Assignments" },
];

const describeRoyaltyTier = (tier: { minOrder: number; maxOrder?: number | null; percentage: number }) => {
  const maxOrder = tier.maxOrder ?? null;
  if (maxOrder == null) {
    return `${tier.percentage}% ${ordinal(tier.minOrder)}+`;
  }
  if (tier.minOrder === maxOrder) {
    return `${tier.percentage}% ${ordinal(tier.minOrder)}`;
  }
  return `${tier.percentage}% ${ordinal(tier.minOrder)}–${ordinal(maxOrder)}`;
};

export default function AdminFranchisesPage() {
  const { allowed, loading: guardLoading } = useRoleGate("admin");
  const [loading, setLoading] = useState(true);
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [territories, setTerritories] = useState<FranchiseTerritory[]>([]);
  const [members, setMembers] = useState<FranchiseMember[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminFranchiseTab>("franchises");

  const [showCreateFranchise, setShowCreateFranchise] = useState(false);
  const [newFranchise, setNewFranchise] = useState({
    name: "",
    code: "",
    status: "prospect" as FranchiseStatus,
    contactEmail: "",
    contactPhone: "",
    stripeAccountId: "",
    platformFee: "",
    notes: "",
    onboarding: createOnboardingState(),
    royalty: createRoyaltyState(),
    quickbooks: createQuickBooksState(),
  });
  const [editingFranchiseId, setEditingFranchiseId] = useState<string | null>(null);
  const [editingFranchise, setEditingFranchise] = useState({
    name: "",
    code: "",
    status: "prospect" as FranchiseStatus,
    contactEmail: "",
    contactPhone: "",
    stripeAccountId: "",
    platformFee: "",
    notes: "",
    onboarding: createOnboardingState(),
    royalty: createRoyaltyState(),
    quickbooks: createQuickBooksState(),
  });

  const [showCreateTerritory, setShowCreateTerritory] = useState(false);
  const [newTerritory, setNewTerritory] = useState({
    franchiseId: "",
    label: "",
    type: "postal" as "postal" | "radius",
    postalCodes: "",
    exclusive: true,
    radiusKm: "",
    centerLat: "",
    centerLng: "",
    categories: [] as string[],
    licenseFee: "",
    notes: "",
  });
  const [editingTerritoryId, setEditingTerritoryId] = useState<string | null>(null);
  const [editingTerritory, setEditingTerritory] = useState({
    franchiseId: "",
    label: "",
    type: "postal" as "postal" | "radius",
    postalCodes: "",
    exclusive: true,
    radiusKm: "",
    centerLat: "",
    centerLng: "",
    categories: [] as string[],
    licenseFee: "",
    notes: "",
  });

  const [showCreateMember, setShowCreateMember] = useState(false);
  const [newMember, setNewMember] = useState({
    franchiseId: "",
    userId: "",
    role: "franchisee" as FranchiseMemberRole,
    primary: false,
  });

  const updateNewOnboarding = (updates: Partial<OnboardingState>) => {
    setNewFranchise((prev) => ({ ...prev, onboarding: { ...prev.onboarding, ...updates } }));
  };

  const updateEditingOnboarding = (updates: Partial<OnboardingState>) => {
    setEditingFranchise((prev) => ({ ...prev, onboarding: { ...prev.onboarding, ...updates } }));
  };

  const updateNewQuickBooks = (updates: Partial<QuickBooksState>) => {
    setNewFranchise((prev) => ({ ...prev, quickbooks: { ...prev.quickbooks, ...updates } }));
  };

  const updateEditingQuickBooks = (updates: Partial<QuickBooksState>) => {
    setEditingFranchise((prev) => ({ ...prev, quickbooks: { ...prev.quickbooks, ...updates } }));
  };

  const loadAll = useCallback(async (cancelRef?: { current: boolean }) => {
    const [franchiseSnap, territorySnap, memberSnap, usersSnap, categorySnap] = await Promise.all([
      getDocs(collection(db, "franchises")),
      getDocs(collection(db, "franchiseTerritories")),
      getDocs(collection(db, "franchiseMembers")),
      getDocs(collection(db, "users")),
      getDocs(collection(db, "categories")),
    ]);

    if (cancelRef?.current) return;

    const franchiseList = franchiseSnap.docs.map((doc) => parseFranchise(doc)).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const territoryList = territorySnap.docs.map((doc) => parseTerritory(doc));
    const memberList = memberSnap.docs.map((doc) => parseMember(doc));
    const userList = usersSnap.docs.map((doc) => {
      const data = doc.data() as Record<string, any>;
      const displayName =
        (typeof data.fullName === "string" && data.fullName.trim()) ||
        (typeof data.displayName === "string" && data.displayName.trim()) ||
        (typeof data.contractorInfo?.name === "string" && data.contractorInfo.name.trim()) ||
        "";
      return {
        id: doc.id,
        email: (typeof data.email === "string" && data.email.trim()) || doc.id,
        displayName: displayName || ((typeof data.email === "string" && data.email.trim()) || doc.id),
        contractor: data.contractor === true,
        isStaff: data.isStaff === true,
        franchiseId:
          typeof data.franchiseId === "string"
            ? data.franchiseId
            : typeof data.primaryFranchiseId === "string"
            ? data.primaryFranchiseId
            : null,
      } satisfies UserSummary;
    });

    if (cancelRef?.current) return;

    const categories = categorySnap.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : doc.id;
        return { id: doc.id, name } satisfies CategoryOption;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    setFranchises(franchiseList);
    setTerritories(territoryList);
    setMembers(memberList);
    setUsers(userList.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    setCategoryOptions(categories);
  }, []);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }

    const cancelRef = { current: false };

    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadAll(cancelRef);
      } catch (err: any) {
        console.error("Failed to load franchise data", err);
        if (!cancelRef.current) {
          setError(err?.message || "Unable to load franchise records.");
        }
      } finally {
        if (!cancelRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelRef.current = true;
    };
  }, [allowed, guardLoading, loadAll]);

  const franchiseMap = useMemo(() => {
    const map = new Map<string, Franchise>();
    franchises.forEach((franchise) => map.set(franchise.id, franchise));
    return map;
  }, [franchises]);

  const userMap = useMemo(() => {
    const map = new Map<string, UserSummary>();
    users.forEach((user) => map.set(user.id, user));
    return map;
  }, [users]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, CategoryOption>();
    categoryOptions.forEach((category) => map.set(category.id, category));
    return map;
  }, [categoryOptions]);

  const gbpFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );

  const territoryByFranchise = useMemo(() => {
    const map = new Map<string, FranchiseTerritory[]>();
    territories.forEach((territory) => {
      const list = map.get(territory.franchiseId) || [];
      list.push(territory);
      map.set(territory.franchiseId, list);
    });
    return map;
  }, [territories]);

  const membersByFranchise = useMemo(() => {
    const map = new Map<string, FranchiseMember[]>();
    members.forEach((member) => {
      const list = map.get(member.franchiseId) || [];
      list.push(member);
      map.set(member.franchiseId, list);
    });
    return map;
  }, [members]);

  if (guardLoading || loading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage franchise records.</p>;
  }

  const resetFranchiseForm = () => {
    setNewFranchise({
      name: "",
      code: "",
      status: "prospect",
      contactEmail: "",
      contactPhone: "",
      stripeAccountId: "",
      platformFee: "",
      notes: "",
      onboarding: createOnboardingState(),
      royalty: createRoyaltyState(),
      quickbooks: createQuickBooksState(),
    });
  };

  const handleCreateFranchise = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const parsedPlatformFee = Number.parseFloat(newFranchise.platformFee);
      const onboardingNotes =
        typeof newFranchise.onboarding.notes === "string" ? newFranchise.onboarding.notes.trim() : "";
      const onboardingPayload = {
        ...newFranchise.onboarding,
        notes: onboardingNotes.length > 0 ? onboardingNotes : null,
      };
      const royaltyConfig = serializeRoyaltyState(newFranchise.royalty);
      const quickbooksState = serializeQuickBooksState(newFranchise.quickbooks);
      const quickbooksPayload = {
        environment: quickbooksState.environment,
        clientId: quickbooksState.clientId,
        clientSecret: quickbooksState.clientSecret,
        refreshToken: quickbooksState.refreshToken,
        realmId: quickbooksState.realmId,
        connectedAt: quickbooksState.connected ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      };
      const payload = {
        name: newFranchise.name.trim(),
        code: (newFranchise.code || newFranchise.name || "").trim().replace(/\s+/g, "-").toLowerCase(),
        status: newFranchise.status,
        contactEmail: newFranchise.contactEmail.trim() || null,
        contactPhone: newFranchise.contactPhone.trim() || null,
        stripeAccountId: newFranchise.stripeAccountId.trim() || null,
        platformFee:
          newFranchise.platformFee.trim().length > 0 && Number.isFinite(parsedPlatformFee)
            ? parsedPlatformFee
            : null,
        notes: newFranchise.notes.trim() || null,
        onboarding: onboardingPayload,
        quickbooks: quickbooksPayload,
        royalty: royaltyConfig,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await addDoc(collection(db, "franchises"), payload);
      resetFranchiseForm();
      setShowCreateFranchise(false);
      await refreshData();
    } catch (err) {
      console.error("Failed to create franchise", err);
      alert("Unable to create franchise. Please try again.");
    }
  };

  const startEditFranchise = (franchise: Franchise) => {
    setEditingFranchiseId(franchise.id);
    setEditingFranchise({
      name: franchise.name,
      code: franchise.code,
      status: franchise.status,
      contactEmail: franchise.contactEmail || "",
      contactPhone: franchise.contactPhone || "",
      stripeAccountId: franchise.stripeAccountId || "",
      platformFee: typeof franchise.platformFee === "number" ? String(franchise.platformFee) : "",
      notes: franchise.notes || "",
      onboarding: {
        ...createOnboardingState(),
        ...franchise.onboarding,
      },
      royalty: createRoyaltyState(franchise.royalty),
      quickbooks: createQuickBooksState(franchise.quickbooks),
    });
  };

  const cancelEditFranchise = () => {
    setEditingFranchiseId(null);
    setEditingFranchise({
      name: "",
      code: "",
      status: "prospect",
      contactEmail: "",
      contactPhone: "",
      stripeAccountId: "",
      platformFee: "",
      notes: "",
      onboarding: createOnboardingState(),
      royalty: createRoyaltyState(),
      quickbooks: createQuickBooksState(),
    });
  };

  const handleUpdateFranchise = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingFranchiseId) return;
    try {
      const parsedPlatformFee = Number.parseFloat(editingFranchise.platformFee);
      const onboardingNotes =
        typeof editingFranchise.onboarding.notes === "string" ? editingFranchise.onboarding.notes.trim() : "";
      const onboardingPayload = {
        ...editingFranchise.onboarding,
        notes: onboardingNotes.length > 0 ? onboardingNotes : null,
      };
      const royaltyConfig = serializeRoyaltyState(editingFranchise.royalty);
      const quickbooksState = serializeQuickBooksState(editingFranchise.quickbooks);
      const quickbooksPayload = {
        environment: quickbooksState.environment,
        clientId: quickbooksState.clientId,
        clientSecret: quickbooksState.clientSecret,
        refreshToken: quickbooksState.refreshToken,
        realmId: quickbooksState.realmId,
        connectedAt: quickbooksState.connected ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      };
      const activationReady = canActivateFranchise(onboardingPayload);
      if (editingFranchise.status === "active" && !activationReady) {
        alert(
          "Franchises can only be marked Active once KYC and Stripe Connect onboarding are completed and charges are enabled."
        );
        return;
      }
      const payload = {
        name: editingFranchise.name.trim() || "Untitled Franchise",
        code: editingFranchise.code.trim() || editingFranchiseId,
        status: editingFranchise.status,
        contactEmail: editingFranchise.contactEmail.trim() || null,
        contactPhone: editingFranchise.contactPhone.trim() || null,
        stripeAccountId: editingFranchise.stripeAccountId.trim() || null,
        platformFee:
          editingFranchise.platformFee.trim().length > 0 && Number.isFinite(parsedPlatformFee)
            ? parsedPlatformFee
            : null,
        notes: editingFranchise.notes.trim() || null,
        onboarding: onboardingPayload,
        quickbooks: quickbooksPayload,
        royalty: royaltyConfig,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "franchises", editingFranchiseId), payload);
      cancelEditFranchise();
      await refreshData();
    } catch (err) {
      console.error("Failed to update franchise", err);
      alert("Unable to update franchise. Please try again.");
    }
  };

  const resetTerritoryForm = () => {
    setNewTerritory({
      franchiseId: "",
      label: "",
      type: "postal",
      postalCodes: "",
      exclusive: true,
      radiusKm: "",
      centerLat: "",
      centerLng: "",
      categories: [],
      licenseFee: "",
      notes: "",
    });
  };

  const handleCreateTerritory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const postalCodes = newTerritory.postalCodes
        .split(/\s|,|;|\n/g)
        .map((code) => code.trim())
        .filter(Boolean);
      const parsedRadius = Number.parseFloat(newTerritory.radiusKm);
      const parsedLat = Number.parseFloat(newTerritory.centerLat);
      const parsedLng = Number.parseFloat(newTerritory.centerLng);
      const parsedLicense = Number.parseFloat(newTerritory.licenseFee);
      const payload = {
        franchiseId: newTerritory.franchiseId,
        label: newTerritory.label.trim() || "Unnamed Territory",
        type: newTerritory.type,
        postalCodes,
        exclusive: newTerritory.exclusive,
        radiusKm:
          newTerritory.type === "radius" && newTerritory.radiusKm.trim() && Number.isFinite(parsedRadius)
            ? parsedRadius
            : null,
        centerLat:
          newTerritory.type === "radius" && newTerritory.centerLat.trim() && Number.isFinite(parsedLat)
            ? parsedLat
            : null,
        centerLng:
          newTerritory.type === "radius" && newTerritory.centerLng.trim() && Number.isFinite(parsedLng)
            ? parsedLng
            : null,
        categories: newTerritory.categories,
        licenseFee:
          newTerritory.licenseFee.trim() && Number.isFinite(parsedLicense) && parsedLicense >= 0
            ? parsedLicense
            : null,
        notes: newTerritory.notes.trim() || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const conflicts = findExclusiveTerritoryConflicts(
        {
          id: null,
          type: payload.type,
          postalCodes: payload.postalCodes,
          exclusive: payload.exclusive,
          radiusKm: payload.radiusKm,
          centerLat: payload.centerLat,
          centerLng: payload.centerLng,
        },
        territories
      );
      if (conflicts.length > 0) {
        const message = conflicts
          .map((territory) => {
            const franchise = franchiseMap.get(territory.franchiseId);
            const franchiseLabel = franchise?.name?.trim() ? franchise.name : territory.franchiseId;
            return `${territory.label} (${franchiseLabel})`;
          })
          .join("\n");
        alert(
          `Exclusive territories cannot overlap with other exclusive territories.\nConflicts:\n${message}`
        );
        return;
      }
      await addDoc(collection(db, "franchiseTerritories"), payload);
      resetTerritoryForm();
      setShowCreateTerritory(false);
      await refreshData();
    } catch (err) {
      console.error("Failed to create territory", err);
      alert("Unable to create territory. Please try again.");
    }
  };

  const startEditTerritory = (territory: FranchiseTerritory) => {
    setEditingTerritoryId(territory.id);
    setEditingTerritory({
      franchiseId: territory.franchiseId,
      label: territory.label,
      type: territory.type,
      postalCodes: territory.postalCodes.join("\n"),
      exclusive: territory.exclusive,
      radiusKm: territory.radiusKm ? String(territory.radiusKm) : "",
      centerLat: territory.centerLat ? String(territory.centerLat) : "",
      centerLng: territory.centerLng ? String(territory.centerLng) : "",
      categories: territory.categories || [],
      licenseFee: territory.licenseFee != null ? String(territory.licenseFee) : "",
      notes: territory.notes || "",
    });
  };

  const cancelEditTerritory = () => {
    setEditingTerritoryId(null);
    setEditingTerritory({
      franchiseId: "",
      label: "",
      type: "postal",
      postalCodes: "",
      exclusive: true,
      radiusKm: "",
      centerLat: "",
      centerLng: "",
      categories: [],
      licenseFee: "",
      notes: "",
    });
  };

  const handleUpdateTerritory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTerritoryId) return;
    try {
      const postalCodes = editingTerritory.postalCodes
        .split(/\s|,|;|\n/g)
        .map((code) => code.trim())
        .filter(Boolean);
      const parsedRadius = Number.parseFloat(editingTerritory.radiusKm);
      const parsedLat = Number.parseFloat(editingTerritory.centerLat);
      const parsedLng = Number.parseFloat(editingTerritory.centerLng);
      const parsedLicense = Number.parseFloat(editingTerritory.licenseFee);
      const payload = {
        franchiseId: editingTerritory.franchiseId,
        label: editingTerritory.label.trim() || "Unnamed Territory",
        type: editingTerritory.type,
        postalCodes,
        exclusive: editingTerritory.exclusive,
        radiusKm:
          editingTerritory.type === "radius" && editingTerritory.radiusKm.trim() && Number.isFinite(parsedRadius)
            ? parsedRadius
            : null,
        centerLat:
          editingTerritory.type === "radius" && editingTerritory.centerLat.trim() && Number.isFinite(parsedLat)
            ? parsedLat
            : null,
        centerLng:
          editingTerritory.type === "radius" && editingTerritory.centerLng.trim() && Number.isFinite(parsedLng)
            ? parsedLng
            : null,
        categories: editingTerritory.categories,
        licenseFee:
          editingTerritory.licenseFee.trim() && Number.isFinite(parsedLicense) && parsedLicense >= 0
            ? parsedLicense
            : null,
        notes: editingTerritory.notes.trim() || null,
        updatedAt: serverTimestamp(),
      };
      const conflicts = findExclusiveTerritoryConflicts(
        {
          id: editingTerritoryId,
          type: payload.type,
          postalCodes: payload.postalCodes,
          exclusive: payload.exclusive,
          radiusKm: payload.radiusKm,
          centerLat: payload.centerLat,
          centerLng: payload.centerLng,
        },
        territories
      );
      if (conflicts.length > 0) {
        const message = conflicts
          .map((territory) => {
            const franchise = franchiseMap.get(territory.franchiseId);
            const franchiseLabel = franchise?.name?.trim() ? franchise.name : territory.franchiseId;
            return `${territory.label} (${franchiseLabel})`;
          })
          .join("\n");
        alert(
          `Exclusive territories cannot overlap with other exclusive territories.\nConflicts:\n${message}`
        );
        return;
      }
      await updateDoc(doc(db, "franchiseTerritories", editingTerritoryId), payload);
      cancelEditTerritory();
      await refreshData();
    } catch (err) {
      console.error("Failed to update territory", err);
      alert("Unable to update territory. Please try again.");
    }
  };

  const removeTerritory = async (territory: FranchiseTerritory) => {
    if (!confirm(`Remove territory "${territory.label}"?`)) return;
    try {
      await deleteDoc(doc(db, "franchiseTerritories", territory.id));
      await refreshData();
    } catch (err) {
      console.error("Failed to delete territory", err);
      alert("Unable to delete territory. Please try again.");
    }
  };

  const handleCreateMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newMember.franchiseId || !newMember.userId) {
      alert("Select both a franchise and user.");
      return;
    }
    try {
      const payload = {
        franchiseId: newMember.franchiseId,
        userId: newMember.userId,
        role: newMember.role,
        primary: newMember.primary,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await addDoc(collection(db, "franchiseMembers"), payload);
      if (newMember.primary) {
        await updateDoc(doc(db, "users", newMember.userId), {
          franchiseId: newMember.franchiseId,
          primaryFranchiseId: newMember.franchiseId,
          updatedAt: serverTimestamp(),
        }).catch((err) => {
          console.warn("Unable to update user franchise assignment", err);
        });
      }
      setShowCreateMember(false);
      setNewMember({ franchiseId: "", userId: "", role: "franchisee", primary: false });
      await refreshData();
    } catch (err) {
      console.error("Failed to create membership", err);
      alert("Unable to assign member. Please try again.");
    }
  };

  const removeMember = async (member: FranchiseMember) => {
    const user = userMap.get(member.userId);
    const franchise = franchiseMap.get(member.franchiseId);
    const label = `${user?.displayName || user?.email || member.userId} → ${franchise?.name || member.franchiseId}`;
    if (!confirm(`Remove ${label}?`)) return;
    try {
      await deleteDoc(doc(db, "franchiseMembers", member.id));
      if (member.primary) {
        await updateDoc(doc(db, "users", member.userId), {
          franchiseId: null,
          primaryFranchiseId: null,
          updatedAt: serverTimestamp(),
        }).catch((err) => {
          console.warn("Unable to clear user franchise assignment", err);
        });
      }
      await refreshData();
    } catch (err) {
      console.error("Failed to remove membership", err);
      alert("Unable to remove membership. Please try again.");
    }
  };

  async function refreshData() {
    try {
      await loadAll();
    } catch (err) {
      console.error("Failed to refresh franchise data", err);
      alert("Unable to refresh franchise data. Try again.");
    }
  }


  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-xl font-semibold">Franchise Network</h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure franchise territories, assign operators, and prepare Stripe Connect mappings for revenue sharing.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FRANCHISE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition",
              activeTab === tab.id
                ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm"
                : "border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "franchises" && (
        <section className="grid gap-6">
          <div className="grid gap-4">
            <div>
              <h2 className="text-lg font-semibold">Territory manager</h2>
              <p className="mt-1 text-sm text-gray-600">
                Visualise every territory, see included services, and review monthly licensing at a glance.
              </p>
            </div>
            <div className="grid gap-4">
              {franchises.length === 0 ? (
                <p className="text-sm text-gray-500">No franchise records yet.</p>
              ) : (
                franchises.map((franchise) => {
                  const assignedTerritories = territoryByFranchise.get(franchise.id) ?? [];
                  return (
                    <div key={franchise.id} className="rounded border p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-base font-semibold">{franchise.name}</h3>
                          <p className="text-xs uppercase tracking-wide text-gray-500">{franchise.status}</p>
                        </div>
                        {franchise.contactEmail && (
                          <a
                            className="text-sm text-blue-600 hover:underline"
                            href={`mailto:${franchise.contactEmail}`}
                          >
                            {franchise.contactEmail}
                          </a>
                        )}
                      </div>
                      {assignedTerritories.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-500">No territories assigned.</p>
                      ) : (
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          {assignedTerritories.map((territory) => {
                            const categories = territory.categories.map((categoryId) => ({
                              id: categoryId,
                              name: categoryMap.get(categoryId)?.name || categoryId,
                            }));
                            const licenceLabel =
                              typeof territory.licenseFee === "number"
                                ? gbpFormatter.format(territory.licenseFee)
                                : null;
                            return (
                              <div key={territory.id} className="grid gap-2 rounded border border-dashed p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <div className="font-medium text-sm">{territory.label}</div>
                                    <div className="text-xs text-gray-500">{territorySummary(territory)}</div>
                                  </div>
                                  <span
                                    className={clsx(
                                      "rounded px-2 py-0.5 text-[11px] uppercase",
                                      territory.exclusive
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-gray-100 text-gray-600"
                                    )}
                                  >
                                    {territory.exclusive ? "Exclusive" : "Shared"}
                                  </span>
                                </div>
                                {categories.length > 0 && (
                                  <div>
                                    <span className="text-[11px] font-semibold uppercase text-gray-500">
                                      Categories
                                    </span>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {categories.map((category) => (
                                        <span
                                          key={`${territory.id}-card-${category.id}`}
                                          className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700"
                                        >
                                          {category.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <span className="text-[11px] font-semibold uppercase text-gray-500">
                                    License fee
                                  </span>
                                  <div className="mt-0.5 text-xs text-gray-700">
                                    {licenceLabel ? `${licenceLabel} / month` : "Free territory"}
                                  </div>
                                </div>
                                <TerritoryMap territory={territory} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Franchises</h2>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowCreateFranchise((value) => !value)}
              >
                {showCreateFranchise ? "Close" : "New franchise"}
              </button>
            </div>
            {showCreateFranchise && (
              <form className="grid gap-3 rounded border p-4" onSubmit={handleCreateFranchise}>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Franchise name</span>
                <input
                  className="input"
                  value={newFranchise.name}
                  onChange={(event) => setNewFranchise({ ...newFranchise, name: event.target.value })}
                  placeholder="e.g. Pineapple Tapped – Manchester"
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Code</span>
                <input
                  className="input"
                  value={newFranchise.code}
                  onChange={(event) => setNewFranchise({ ...newFranchise, code: event.target.value })}
                  placeholder="manchester"
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Status</span>
              <select
                className="input"
                value={newFranchise.status}
                onChange={(event) => setNewFranchise({ ...newFranchise, status: event.target.value as FranchiseStatus })}
              >
                {FRANCHISE_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gray-500">
                {FRANCHISE_STATUSES.find((status) => status.value === newFranchise.status)?.description}
              </span>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Contact email</span>
                <input
                  className="input"
                  type="email"
                  value={newFranchise.contactEmail}
                  onChange={(event) => setNewFranchise({ ...newFranchise, contactEmail: event.target.value })}
                  placeholder="franchise@pineappletapped.com"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Contact phone</span>
                <input
                  className="input"
                  value={newFranchise.contactPhone}
                  onChange={(event) => setNewFranchise({ ...newFranchise, contactPhone: event.target.value })}
                  placeholder="+44 1234 567890"
                />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Stripe account ID</span>
                <input
                  className="input"
                  value={newFranchise.stripeAccountId}
                  onChange={(event) => setNewFranchise({ ...newFranchise, stripeAccountId: event.target.value })}
                  placeholder="acct_123..."
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Platform fee (%)</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={newFranchise.platformFee}
                  onChange={(event) => setNewFranchise({ ...newFranchise, platformFee: event.target.value })}
                  placeholder="6"
                />
              </label>
            </div>
            <div className="grid gap-3 rounded border border-dashed border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">QuickBooks integration</div>
                  <p className="text-xs text-gray-500">
                    Capture franchise-specific QuickBooks Online credentials so invoices export with their ledger.
                  </p>
                </div>
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase",
                    quickBooksStateConnected(newFranchise.quickbooks)
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-800"
                  )}
                >
                  {quickBooksStateConnected(newFranchise.quickbooks) ? "Connected" : "Pending"}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Environment</span>
                  <select
                    className="input"
                    value={newFranchise.quickbooks.environment}
                    onChange={(event) =>
                      updateNewQuickBooks({ environment: event.target.value as QuickBooksState["environment"] })
                    }
                  >
                    <option value="production">Production</option>
                    <option value="sandbox">Sandbox</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Realm ID</span>
                  <input
                    className="input"
                    value={newFranchise.quickbooks.realmId}
                    onChange={(event) => updateNewQuickBooks({ realmId: event.target.value })}
                    placeholder="1234567890"
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Client ID</span>
                <input
                  className="input"
                  value={newFranchise.quickbooks.clientId}
                  onChange={(event) => updateNewQuickBooks({ clientId: event.target.value })}
                  placeholder="QB0..."
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Client secret</span>
                <input
                  className="input"
                  type="password"
                  value={newFranchise.quickbooks.clientSecret}
                  onChange={(event) => updateNewQuickBooks({ clientSecret: event.target.value })}
                  placeholder="••••••"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Refresh token</span>
                <input
                  className="input"
                  type="password"
                  value={newFranchise.quickbooks.refreshToken}
                  onChange={(event) => updateNewQuickBooks({ refreshToken: event.target.value })}
                  placeholder="Paste the long-lived refresh token"
                />
              </label>
              <p className="text-xs text-gray-500">
                Values are encrypted at rest and only visible to head office administrators.
              </p>
            </div>
            <div className="grid gap-3 rounded border border-dashed border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">Royalty configuration</div>
                  <p className="text-xs text-gray-500">
                    Define how royalties are split between HQ and the franchisee for HQ-sourced and franchise-sourced orders.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() =>
                    setNewFranchise((prev) => ({
                      ...prev,
                      royalty: appendRoyaltyTier(prev.royalty),
                    }))
                  }
                >
                  Add HQ tier
                </button>
              </div>
              <div className="grid gap-3">
                {newFranchise.royalty.hqTiers.map((tier, index) => (
                  <div key={tier.id} className="grid gap-2 rounded border border-gray-200 p-3 sm:grid-cols-4">
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">From order #</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={tier.minOrder}
                        onChange={(event) =>
                          setNewFranchise((prev) => ({
                            ...prev,
                            royalty: {
                              ...prev.royalty,
                              hqTiers: prev.royalty.hqTiers.map((item, idx) =>
                                idx === index ? { ...item, minOrder: event.target.value } : item
                              ),
                            },
                          }))
                        }
                        required
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Through order #</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={tier.maxOrder}
                        onChange={(event) =>
                          setNewFranchise((prev) => ({
                            ...prev,
                            royalty: {
                              ...prev.royalty,
                              hqTiers: prev.royalty.hqTiers.map((item, idx) =>
                                idx === index ? { ...item, maxOrder: event.target.value } : item
                              ),
                            },
                          }))
                        }
                        placeholder="Leave blank for 6th+"
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Royalty %</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.1"
                        value={tier.percentage}
                        onChange={(event) =>
                          setNewFranchise((prev) => ({
                            ...prev,
                            royalty: {
                              ...prev.royalty,
                              hqTiers: prev.royalty.hqTiers.map((item, idx) =>
                                idx === index ? { ...item, percentage: event.target.value } : item
                              ),
                            },
                          }))
                        }
                        required
                      />
                    </label>
                    <div className="flex items-end justify-end">
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() =>
                          setNewFranchise((prev) => ({
                            ...prev,
                            royalty: removeRoyaltyTier(prev.royalty, index),
                          }))
                        }
                        disabled={newFranchise.royalty.hqTiers.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Franchise-sourced royalty (%)</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={newFranchise.royalty.franchisePercentage}
                  onChange={(event) =>
                    setNewFranchise((prev) => ({
                      ...prev,
                      royalty: {
                        ...prev.royalty,
                        franchisePercentage: event.target.value,
                      },
                    }))
                  }
                />
                <span className="text-xs text-gray-500">
                  Applied to deals sourced directly by the franchisee (e.g. referrals, local marketing).
                </span>
              </label>
            </div>
            <div className="grid gap-3 rounded border border-dashed border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Onboarding checklist</div>
                  <p className="text-xs text-gray-500">
                    Track key milestones needed before a franchise can take live payments.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() =>
                    alert(
                      "Stripe Connect onboarding placeholder – integration will hand off to Stripe Hosted onboarding in a later iteration."
                    )
                  }
                >
                  Launch Stripe flow
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">KYC verification</span>
                  <select
                    className="input"
                    value={newFranchise.onboarding.kycStatus}
                    onChange={(event) =>
                      updateNewOnboarding({ kycStatus: event.target.value as FranchiseOnboardingStatus })
                    }
                  >
                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-500">
                    {ONBOARDING_STATUS_OPTIONS.find((option) => option.value === newFranchise.onboarding.kycStatus)?.description}
                  </span>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Stripe Connect onboarding</span>
                  <select
                    className="input"
                    value={newFranchise.onboarding.stripeAccountStatus}
                    onChange={(event) =>
                      updateNewOnboarding({
                        stripeAccountStatus: event.target.value as FranchiseOnboardingStatus,
                      })
                    }
                  >
                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-500">
                    Mark as completed once Stripe confirms the account is onboarded.
                  </span>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Bank details</span>
                  <select
                    className="input"
                    value={newFranchise.onboarding.bankStatus}
                    onChange={(event) =>
                      updateNewOnboarding({ bankStatus: event.target.value as FranchiseOnboardingStatus })
                    }
                  >
                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Legal documents</span>
                  <select
                    className="input"
                    value={newFranchise.onboarding.legalStatus}
                    onChange={(event) =>
                      updateNewOnboarding({ legalStatus: event.target.value as FranchiseOnboardingStatus })
                    }
                  >
                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={newFranchise.onboarding.chargesEnabled}
                  onChange={(event) => updateNewOnboarding({ chargesEnabled: event.target.checked })}
                />
                <span>Stripe indicates charges are enabled for this account.</span>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Onboarding notes</span>
                <textarea
                  className="input"
                  rows={2}
                  value={typeof newFranchise.onboarding.notes === "string" ? newFranchise.onboarding.notes : ""}
                  onChange={(event) => updateNewOnboarding({ notes: event.target.value })}
                  placeholder="KYC checklist, outstanding documents, etc."
                />
              </label>
              <p className="text-xs text-amber-600">
                A franchise should only move to <span className="font-medium">Active</span> once KYC and Stripe onboarding
                are complete and charges are enabled.
              </p>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Notes</span>
              <textarea
                className="input"
                rows={3}
                value={newFranchise.notes}
                onChange={(event) => setNewFranchise({ ...newFranchise, notes: event.target.value })}
                placeholder="Launch plan, onboarding checklist, marketing commitments…"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => {
                  resetFranchiseForm();
                  setShowCreateFranchise(false);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-sm">
                Save franchise
              </button>
            </div>
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Franchise</th>
                <th className="p-2">Status</th>
                <th className="p-2">Contact</th>
                <th className="p-2">Stripe</th>
                <th className="p-2">Onboarding</th>
                <th className="p-2">Territories</th>
                <th className="p-2">Members</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {franchises.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-gray-500">
                    No franchises created yet.
                  </td>
                </tr>
              ) : (
                franchises.map((franchise) => {
                  const territoryCount = territoryByFranchise.get(franchise.id)?.length ?? 0;
                  const memberCount = membersByFranchise.get(franchise.id)?.length ?? 0;
                  const editing = editingFranchiseId === franchise.id;
                  const activationReady = canActivateFranchise(franchise.onboarding);
                  const editingActivationReady = editing
                    ? canActivateFranchise(editingFranchise.onboarding)
                    : false;
                  const pendingSteps = [
                    franchise.onboarding.kycStatus === "completed" ? null : "KYC",
                    franchise.onboarding.stripeAccountStatus === "completed" ? null : "Stripe",
                    franchise.onboarding.bankStatus === "completed" ? null : "Bank",
                    franchise.onboarding.legalStatus === "completed" ? null : "Legal",
                    franchise.onboarding.chargesEnabled ? null : "Charges",
                  ].filter(Boolean) as string[];
                  const royaltyConfig = franchise.royalty?.hqTiers?.length
                    ? franchise.royalty
                    : defaultFranchiseRoyaltyConfig();
                  const hqScale = royaltyConfig.hqTiers
                    .map((tier) => describeRoyaltyTier(tier))
                    .join(" → ");
                  const franchiseDirect = typeof royaltyConfig.franchiseSourcedPercentage === "number"
                    ? royaltyConfig.franchiseSourcedPercentage
                    : defaultFranchiseRoyaltyConfig().franchiseSourcedPercentage;
                  const quickbooksConnected = quickBooksConfigConnected(franchise.quickbooks);
                  const quickbooksEnvironmentLabel =
                    franchise.quickbooks?.environment === "sandbox" ? "Sandbox" : "Production";
                  return (
                    <tr key={franchise.id} className="border-t align-top">
                      <td className="p-2 font-medium">
                        <div>{franchise.name}</div>
                        <div className="text-xs text-gray-500">Code: {franchise.code}</div>
                      </td>
                      <td className="p-2 capitalize">{franchise.status}</td>
                      <td className="p-2 text-sm">
                        {franchise.contactEmail && <div>{franchise.contactEmail}</div>}
                        {franchise.contactPhone && <div>{franchise.contactPhone}</div>}
                      </td>
                      <td className="p-2 text-xs">
                        {franchise.stripeAccountId ? (
                          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">
                            {franchise.stripeAccountId}
                          </code>
                        ) : (
                          <span className="text-gray-500">Pending</span>
                        )}
                        {typeof franchise.platformFee === "number" && (
                          <div className="text-xs text-gray-500">Platform fee: {franchise.platformFee}%</div>
                        )}
                        {hqScale && (
                          <div className="text-xs text-gray-500">HQ: {hqScale}</div>
                        )}
                        <div className="text-xs text-gray-500">Franchise-sourced: {franchiseDirect}%</div>
                        <div className="mt-1 flex items-center gap-1 text-[11px]">
                          <span
                            className={clsx(
                              "inline-flex items-center rounded px-1.5 py-0.5 font-semibold uppercase",
                              quickbooksConnected
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-800"
                            )}
                          >
                            QB
                          </span>
                          <span className="text-gray-600">
                            {quickbooksConnected
                              ? `Connected · ${quickbooksEnvironmentLabel}`
                              : "Credentials pending"}
                          </span>
                        </div>
                      </td>
                      <td className="p-2 text-xs">
                        <div>KYC: {onboardingStatusLabel(franchise.onboarding.kycStatus)}</div>
                        <div>Stripe: {onboardingStatusLabel(franchise.onboarding.stripeAccountStatus)}</div>
                        <div>Bank: {onboardingStatusLabel(franchise.onboarding.bankStatus)}</div>
                        <div>Legal: {onboardingStatusLabel(franchise.onboarding.legalStatus)}</div>
                        <div>Charges: {franchise.onboarding.chargesEnabled ? "Enabled" : "Pending"}</div>
                        {activationReady ? (
                          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-emerald-600">
                            Ready to activate
                          </div>
                        ) : (
                          <>
                            {pendingSteps.length > 0 && (
                              <div className="mt-1 text-[10px] tracking-wide text-amber-600">
                                Awaiting: {pendingSteps.join(", ")}
                              </div>
                            )}
                            {franchise.status === "active" && (
                              <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-red-600">
                                Review onboarding blockers
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-2">{territoryCount}</td>
                      <td className="p-2">{memberCount}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => startEditFranchise(franchise)}
                          >
                            Edit
                          </button>
                        </div>
                        {editing && (
                          <form className="mt-3 grid gap-2 rounded border p-2" onSubmit={handleUpdateFranchise}>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Name</span>
                              <input
                                className="input"
                                value={editingFranchise.name}
                                onChange={(event) =>
                                  setEditingFranchise({ ...editingFranchise, name: event.target.value })
                                }
                                required
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Code</span>
                              <input
                                className="input"
                                value={editingFranchise.code}
                                onChange={(event) =>
                                  setEditingFranchise({ ...editingFranchise, code: event.target.value })
                                }
                                required
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Status</span>
                              <select
                                className="input"
                                value={editingFranchise.status}
                                onChange={(event) =>
                                  setEditingFranchise({
                                    ...editingFranchise,
                                    status: event.target.value as FranchiseStatus,
                                  })
                                }
                              >
                                {FRANCHISE_STATUSES.map((status) => (
                                  <option key={status.value} value={status.value}>
                                    {status.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Contact email</span>
                              <input
                                className="input"
                                value={editingFranchise.contactEmail}
                                onChange={(event) =>
                                  setEditingFranchise({
                                    ...editingFranchise,
                                    contactEmail: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Contact phone</span>
                              <input
                                className="input"
                                value={editingFranchise.contactPhone}
                                onChange={(event) =>
                                  setEditingFranchise({
                                    ...editingFranchise,
                                    contactPhone: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Stripe account</span>
                              <input
                                className="input"
                                value={editingFranchise.stripeAccountId}
                                onChange={(event) =>
                                  setEditingFranchise({
                                    ...editingFranchise,
                                    stripeAccountId: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Platform fee (%)</span>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                step="0.1"
                                value={editingFranchise.platformFee}
                                onChange={(event) =>
                                  setEditingFranchise({
                                    ...editingFranchise,
                                    platformFee: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <div className="grid gap-2 rounded border border-dashed border-gray-200 p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wide">QuickBooks</span>
                                <span
                                  className={clsx(
                                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                                    quickBooksStateConnected(editingFranchise.quickbooks)
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-amber-100 text-amber-800"
                                  )}
                                >
                                  {quickBooksStateConnected(editingFranchise.quickbooks) ? "Connected" : "Pending"}
                                </span>
                              </div>
                              <label className="grid gap-1 text-[11px]">
                                <span className="font-medium">Environment</span>
                                <select
                                  className="input"
                                  value={editingFranchise.quickbooks.environment}
                                  onChange={(event) =>
                                    updateEditingQuickBooks({
                                      environment: event.target.value as QuickBooksState["environment"],
                                    })
                                  }
                                >
                                  <option value="production">Production</option>
                                  <option value="sandbox">Sandbox</option>
                                </select>
                              </label>
                              <label className="grid gap-1 text-[11px]">
                                <span className="font-medium">Realm ID</span>
                                <input
                                  className="input"
                                  value={editingFranchise.quickbooks.realmId}
                                  onChange={(event) => updateEditingQuickBooks({ realmId: event.target.value })}
                                />
                              </label>
                              <label className="grid gap-1 text-[11px]">
                                <span className="font-medium">Client ID</span>
                                <input
                                  className="input"
                                  value={editingFranchise.quickbooks.clientId}
                                  onChange={(event) => updateEditingQuickBooks({ clientId: event.target.value })}
                                />
                              </label>
                              <label className="grid gap-1 text-[11px]">
                                <span className="font-medium">Client secret</span>
                                <input
                                  className="input"
                                  type="password"
                                  value={editingFranchise.quickbooks.clientSecret}
                                  onChange={(event) => updateEditingQuickBooks({ clientSecret: event.target.value })}
                                />
                              </label>
                              <label className="grid gap-1 text-[11px]">
                                <span className="font-medium">Refresh token</span>
                                <input
                                  className="input"
                                  type="password"
                                  value={editingFranchise.quickbooks.refreshToken}
                                  onChange={(event) => updateEditingQuickBooks({ refreshToken: event.target.value })}
                                />
                              </label>
                              <p className="text-[10px] text-gray-500">
                                Credentials sync invoices directly to the franchisee&apos;s QuickBooks company.
                              </p>
                            </div>
                            <div className="grid gap-2 rounded border border-dashed border-gray-200 p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wide">Royalty configuration</span>
                                <button
                                  type="button"
                                  className="btn btn-xs"
                                  onClick={() =>
                                    setEditingFranchise((prev) => ({
                                      ...prev,
                                      royalty: appendRoyaltyTier(prev.royalty),
                                    }))
                                  }
                                >
                                  Add HQ tier
                                </button>
                              </div>
                              <div className="grid gap-2">
                                {editingFranchise.royalty.hqTiers.map((tier, index) => (
                                  <div key={tier.id} className="grid gap-2 rounded border border-gray-200 p-2 sm:grid-cols-4">
                                    <label className="grid gap-1 text-xs">
                                      <span className="font-medium">From order #</span>
                                      <input
                                        className="input"
                                        inputMode="numeric"
                                        value={tier.minOrder}
                                        onChange={(event) =>
                                          setEditingFranchise((prev) => ({
                                            ...prev,
                                            royalty: {
                                              ...prev.royalty,
                                              hqTiers: prev.royalty.hqTiers.map((item, idx) =>
                                                idx === index ? { ...item, minOrder: event.target.value } : item
                                              ),
                                            },
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="grid gap-1 text-xs">
                                      <span className="font-medium">Through order #</span>
                                      <input
                                        className="input"
                                        inputMode="numeric"
                                        value={tier.maxOrder}
                                        onChange={(event) =>
                                          setEditingFranchise((prev) => ({
                                            ...prev,
                                            royalty: {
                                              ...prev.royalty,
                                              hqTiers: prev.royalty.hqTiers.map((item, idx) =>
                                                idx === index ? { ...item, maxOrder: event.target.value } : item
                                              ),
                                            },
                                          }))
                                        }
                                        placeholder="Leave blank for 6th+"
                                      />
                                    </label>
                                    <label className="grid gap-1 text-xs">
                                      <span className="font-medium">Royalty %</span>
                                      <input
                                        className="input"
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        value={tier.percentage}
                                        onChange={(event) =>
                                          setEditingFranchise((prev) => ({
                                            ...prev,
                                            royalty: {
                                              ...prev.royalty,
                                              hqTiers: prev.royalty.hqTiers.map((item, idx) =>
                                                idx === index ? { ...item, percentage: event.target.value } : item
                                              ),
                                            },
                                          }))
                                        }
                                      />
                                    </label>
                                    <div className="flex items-end justify-end">
                                      <button
                                        type="button"
                                        className="btn btn-xs btn-outline"
                                        onClick={() =>
                                          setEditingFranchise((prev) => ({
                                            ...prev,
                                            royalty: removeRoyaltyTier(prev.royalty, index),
                                          }))
                                        }
                                        disabled={editingFranchise.royalty.hqTiers.length <= 1}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <label className="grid gap-1 text-xs">
                                <span className="font-medium">Franchise-sourced royalty (%)</span>
                                <input
                                  className="input"
                                  type="number"
                                  min="0"
                                  step="0.1"
                                  value={editingFranchise.royalty.franchisePercentage}
                                  onChange={(event) =>
                                    setEditingFranchise((prev) => ({
                                      ...prev,
                                      royalty: {
                                        ...prev.royalty,
                                        franchisePercentage: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                            </div>
                            <div className="grid gap-2 rounded border border-dashed border-gray-200 p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold uppercase tracking-wide">Onboarding</span>
                                <button
                                  type="button"
                                  className="btn btn-xs"
                                  onClick={() =>
                                    alert(
                                      "Stripe Connect onboarding placeholder – integration will hand off to Stripe Hosted onboarding in a later iteration."
                                    )
                                  }
                                >
                                  Launch Stripe flow
                                </button>
                              </div>
                              <div className="grid gap-2">
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">KYC verification</span>
                                  <select
                                    className="input"
                                    value={editingFranchise.onboarding.kycStatus}
                                    onChange={(event) =>
                                      updateEditingOnboarding({
                                        kycStatus: event.target.value as FranchiseOnboardingStatus,
                                      })
                                    }
                                  >
                                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">Stripe Connect</span>
                                  <select
                                    className="input"
                                    value={editingFranchise.onboarding.stripeAccountStatus}
                                    onChange={(event) =>
                                      updateEditingOnboarding({
                                        stripeAccountStatus: event.target.value as FranchiseOnboardingStatus,
                                      })
                                    }
                                  >
                                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">Bank details</span>
                                  <select
                                    className="input"
                                    value={editingFranchise.onboarding.bankStatus}
                                    onChange={(event) =>
                                      updateEditingOnboarding({
                                        bankStatus: event.target.value as FranchiseOnboardingStatus,
                                      })
                                    }
                                  >
                                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">Legal documents</span>
                                  <select
                                    className="input"
                                    value={editingFranchise.onboarding.legalStatus}
                                    onChange={(event) =>
                                      updateEditingOnboarding({
                                        legalStatus: event.target.value as FranchiseOnboardingStatus,
                                      })
                                    }
                                  >
                                    {ONBOARDING_STATUS_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5"
                                    checked={editingFranchise.onboarding.chargesEnabled}
                                    onChange={(event) => updateEditingOnboarding({ chargesEnabled: event.target.checked })}
                                  />
                                  <span>Charges enabled</span>
                                </label>
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">Onboarding notes</span>
                                  <textarea
                                    className="input"
                                    rows={2}
                                    value={
                                      typeof editingFranchise.onboarding.notes === "string"
                                        ? editingFranchise.onboarding.notes
                                        : ""
                                    }
                                    onChange={(event) => updateEditingOnboarding({ notes: event.target.value })}
                                  />
                                </label>
                                <div className="rounded bg-gray-100 p-2 text-[11px] text-gray-600">
                                  <div>
                                    Activation readiness: {editingActivationReady ? "✅ Ready" : "🚧 Incomplete"}
                                  </div>
                                  {!editingActivationReady && (
                                    <div className="mt-1">
                                      Ensure KYC + Stripe Connect are approved and charges are enabled before setting the
                                      status to Active.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Notes</span>
                              <textarea
                                className="input"
                                rows={2}
                                value={editingFranchise.notes}
                                onChange={(event) =>
                                  setEditingFranchise({ ...editingFranchise, notes: event.target.value })
                                }
                              />
                            </label>
                            <div className="flex justify-end gap-2">
                              <button type="button" className="btn btn-xs btn-outline" onClick={cancelEditFranchise}>
                                Close
                              </button>
                              <button type="submit" className="btn btn-xs">
                                Save
                              </button>
                            </div>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
              </table>
            </div>
          </div>
      </section>
      )}

      {activeTab === "territories" && (
        <section className="grid gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Territories</h2>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowCreateTerritory((value) => !value)}
            >
              {showCreateTerritory ? "Close" : "New territory"}
            </button>
          </div>
          <div className="grid gap-4">
            {showCreateTerritory && (
              <form className="grid gap-3 rounded border p-4" onSubmit={handleCreateTerritory}>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Franchise</span>
                  <select
                    className="input"
                    value={newTerritory.franchiseId}
                    onChange={(event) => setNewTerritory({ ...newTerritory, franchiseId: event.target.value })}
                    required
                  >
                    <option value="">Select franchise…</option>
                    {franchises.map((franchise) => (
                      <option key={franchise.id} value={franchise.id}>
                        {franchise.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Label</span>
                    <input
                      className="input"
                      value={newTerritory.label}
                      onChange={(event) => setNewTerritory({ ...newTerritory, label: event.target.value })}
                      placeholder="Manchester city core"
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Type</span>
                    <select
                      className="input"
                      value={newTerritory.type}
                      onChange={(event) => setNewTerritory({ ...newTerritory, type: event.target.value as "postal" | "radius" })}
                    >
                      {TERRITORY_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {newTerritory.type === "postal" ? (
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Postcodes (one per line)</span>
                    <textarea
                      className="input"
                      rows={4}
                      value={newTerritory.postalCodes}
                      onChange={(event) => setNewTerritory({ ...newTerritory, postalCodes: event.target.value })}
                      placeholder="M1\nM2\nM3"
                      required
                    />
                  </label>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Latitude</span>
                      <input
                        className="input"
                        value={newTerritory.centerLat}
                        onChange={(event) => setNewTerritory({ ...newTerritory, centerLat: event.target.value })}
                        placeholder="53.4808"
                        required
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Longitude</span>
                      <input
                        className="input"
                        value={newTerritory.centerLng}
                        onChange={(event) => setNewTerritory({ ...newTerritory, centerLng: event.target.value })}
                        placeholder="-2.2426"
                        required
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Radius (km)</span>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        step="0.5"
                        value={newTerritory.radiusKm}
                        onChange={(event) => setNewTerritory({ ...newTerritory, radiusKm: event.target.value })}
                        placeholder="25"
                        required
                      />
                    </label>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newTerritory.exclusive}
                    onChange={(event) => setNewTerritory({ ...newTerritory, exclusive: event.target.checked })}
                  />
                  Exclusive lock for this territory
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Service categories</span>
                  <select
                    multiple
                    className="input min-h-[120px]"
                    value={newTerritory.categories}
                    onChange={(event) =>
                      setNewTerritory({
                        ...newTerritory,
                        categories: Array.from(event.target.selectedOptions).map((option) => option.value),
                      })
                    }
                  >
                    {categoryOptions.length === 0 ? (
                      <option value="" disabled>
                        No categories available
                      </option>
                    ) : (
                      categoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))
                    )}
                  </select>
                  <span className="text-xs text-gray-500">
                    Hold Ctrl/Command to select multiple categories. Leave empty if unrestricted.
                  </span>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Monthly license fee (£/mo)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newTerritory.licenseFee}
                    onChange={(event) => setNewTerritory({ ...newTerritory, licenseFee: event.target.value })}
                    placeholder="0"
                  />
                  <span className="text-xs text-gray-500">Leave blank to keep the territory free.</span>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Notes</span>
                  <textarea
                    className="input"
                    rows={2}
                    value={newTerritory.notes}
                    onChange={(event) => setNewTerritory({ ...newTerritory, notes: event.target.value })}
                    placeholder="Paid ads radius, special restrictions, partner agreements…"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      resetTerritoryForm();
                      setShowCreateTerritory(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-sm">
                    Save territory
                  </button>
                </div>
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm border">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="p-2">Territory</th>
                <th className="p-2">Franchise</th>
                <th className="p-2">Exclusive</th>
                <th className="p-2">Summary</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {territories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-gray-500">
                    No territories configured.
                  </td>
                </tr>
              ) : (
                territories.map((territory) => {
                  const franchise = franchiseMap.get(territory.franchiseId);
                  const editing = editingTerritoryId === territory.id;
                  const territoryCategories = territory.categories.map((categoryId) => ({
                    id: categoryId,
                    name: categoryMap.get(categoryId)?.name || categoryId,
                  }));
                  const formattedLicense =
                    typeof territory.licenseFee === "number"
                      ? gbpFormatter.format(territory.licenseFee)
                      : null;

                  return (
                    <tr key={territory.id} className="border-t align-top">
                      <td className="p-2 font-medium">{territory.label}</td>
                      <td className="p-2">{franchise ? franchise.name : territory.franchiseId}</td>
                      <td className="p-2">{territory.exclusive ? "Yes" : "No"}</td>
                      <td className="p-2 text-xs text-gray-600">
                        <div className="grid gap-2">
                          <div>{territorySummary(territory)}</div>
                          {territoryCategories.length > 0 && (
                            <div>
                              <span className="text-[11px] font-semibold uppercase text-gray-500">
                                Categories
                              </span>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {territoryCategories.map((category) => (
                                  <span
                                    key={`${territory.id}-${category.id}`}
                                    className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700"
                                  >
                                    {category.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div>
                            <span className="text-[11px] font-semibold uppercase text-gray-500">
                              License fee
                            </span>
                            <div className="mt-0.5 text-gray-700">
                              {formattedLicense ? `${formattedLicense} / month` : "Free territory"}
                            </div>
                          </div>
                          <TerritoryMap territory={territory} className="mt-1" height={160} />
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => startEditTerritory(territory)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-outline"
                            onClick={() => removeTerritory(territory)}
                          >
                            Remove
                          </button>
                        </div>
                        {editing && (
                          <form className="mt-3 grid gap-2 rounded border p-2" onSubmit={handleUpdateTerritory}>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Label</span>
                              <input
                                className="input"
                                value={editingTerritory.label}
                                onChange={(event) =>
                                  setEditingTerritory({ ...editingTerritory, label: event.target.value })
                                }
                                required
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Franchise</span>
                              <select
                                className="input"
                                value={editingTerritory.franchiseId}
                                onChange={(event) =>
                                  setEditingTerritory({ ...editingTerritory, franchiseId: event.target.value })
                                }
                              >
                                {franchises.map((franchiseOption) => (
                                  <option key={franchiseOption.id} value={franchiseOption.id}>
                                    {franchiseOption.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Type</span>
                              <select
                                className="input"
                                value={editingTerritory.type}
                                onChange={(event) =>
                                  setEditingTerritory({
                                    ...editingTerritory,
                                    type: event.target.value as "postal" | "radius",
                                  })
                                }
                              >
                                {TERRITORY_TYPES.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {editingTerritory.type === "postal" ? (
                              <label className="grid gap-1 text-xs">
                                <span className="font-medium">Postcodes (one per line)</span>
                                <textarea
                                  className="input"
                                  rows={3}
                                  value={editingTerritory.postalCodes}
                                  onChange={(event) =>
                                    setEditingTerritory({
                                      ...editingTerritory,
                                      postalCodes: event.target.value,
                                    })
                                  }
                                  required
                                />
                              </label>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-3">
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">Latitude</span>
                                  <input
                                    className="input"
                                    value={editingTerritory.centerLat}
                                    onChange={(event) =>
                                      setEditingTerritory({
                                        ...editingTerritory,
                                        centerLat: event.target.value,
                                      })
                                    }
                                    required
                                  />
                                </label>
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">Longitude</span>
                                  <input
                                    className="input"
                                    value={editingTerritory.centerLng}
                                    onChange={(event) =>
                                      setEditingTerritory({
                                        ...editingTerritory,
                                        centerLng: event.target.value,
                                      })
                                    }
                                    required
                                  />
                                </label>
                                <label className="grid gap-1 text-xs">
                                  <span className="font-medium">Radius (km)</span>
                                  <input
                                    className="input"
                                    type="number"
                                    min="1"
                                    step="0.5"
                                    value={editingTerritory.radiusKm}
                                    onChange={(event) =>
                                      setEditingTerritory({
                                        ...editingTerritory,
                                        radiusKm: event.target.value,
                                      })
                                    }
                                    required
                                  />
                                </label>
                              </div>
                            )}
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={editingTerritory.exclusive}
                                onChange={(event) =>
                                  setEditingTerritory({
                                    ...editingTerritory,
                                    exclusive: event.target.checked,
                                  })
                                }
                              />
                              Exclusive lock
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Service categories</span>
                              <select
                                multiple
                                className="input min-h-[120px]"
                                value={editingTerritory.categories}
                                onChange={(event) =>
                                  setEditingTerritory({
                                    ...editingTerritory,
                                    categories: Array.from(event.target.selectedOptions).map((option) => option.value),
                                  })
                                }
                              >
                                {categoryOptions.length === 0 ? (
                                  <option value="" disabled>
                                    No categories available
                                  </option>
                                ) : (
                                  categoryOptions.map((category) => (
                                    <option key={category.id} value={category.id}>
                                      {category.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Monthly license fee (£/mo)</span>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={editingTerritory.licenseFee}
                                onChange={(event) =>
                                  setEditingTerritory({
                                    ...editingTerritory,
                                    licenseFee: event.target.value,
                                  })
                                }
                                placeholder="0"
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="font-medium">Notes</span>
                              <textarea
                                className="input"
                                rows={2}
                                value={editingTerritory.notes}
                                onChange={(event) =>
                                  setEditingTerritory({ ...editingTerritory, notes: event.target.value })
                                }
                              />
                            </label>
                            <div className="flex justify-end gap-2">
                              <button type="button" className="btn btn-xs btn-outline" onClick={cancelEditTerritory}>
                                Close
                              </button>
                              <button type="submit" className="btn btn-xs">
                                Save
                              </button>
                            </div>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
          </div>
        </section>
      )}

      {activeTab === "members" && (
        <section className="grid gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Members & assignments</h2>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowCreateMember((value) => !value)}
            >
              {showCreateMember ? "Close" : "New assignment"}
            </button>
          </div>
          <div className="grid gap-4">
            {showCreateMember && (
              <form className="grid gap-3 rounded border p-4" onSubmit={handleCreateMember}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Franchise</span>
                    <select
                      className="input"
                      value={newMember.franchiseId}
                      onChange={(event) => setNewMember({ ...newMember, franchiseId: event.target.value })}
                      required
                    >
                      <option value="">Select franchise…</option>
                      {franchises.map((franchise) => (
                        <option key={franchise.id} value={franchise.id}>
                          {franchise.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">User</span>
                    <select
                      className="input"
                      value={newMember.userId}
                      onChange={(event) => setNewMember({ ...newMember, userId: event.target.value })}
                      required
                    >
                      <option value="">Select user…</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.displayName} ({user.email})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Role</span>
                  <select
                    className="input"
                    value={newMember.role}
                    onChange={(event) => setNewMember({ ...newMember, role: event.target.value as FranchiseMemberRole })}
                  >
                    {MEMBER_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-500">
                    {MEMBER_ROLES.find((role) => role.value === newMember.role)?.description}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newMember.primary}
                    onChange={(event) => setNewMember({ ...newMember, primary: event.target.checked })}
                  />
                  Primary assignment (updates the user profile to use this franchise by default)
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      setShowCreateMember(false);
                      setNewMember({ franchiseId: "", userId: "", role: "franchisee", primary: false });
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-sm">
                    Save assignment
                  </button>
                </div>
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm border">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-2">User</th>
                    <th className="p-2">Franchise</th>
                    <th className="p-2">Role</th>
                    <th className="p-2">Primary</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-gray-500">
                        No member assignments yet.
                      </td>
                    </tr>
                  ) : (
                    members.map((member) => {
                      const user = userMap.get(member.userId);
                      const franchise = franchiseMap.get(member.franchiseId);
                      return (
                        <tr key={member.id} className="border-t">
                          <td className="p-2">
                            <div className="font-medium">{user?.displayName || user?.email || member.userId}</div>
                            <div className="text-xs text-gray-500">{user?.email}</div>
                          </td>
                          <td className="p-2">{franchise ? franchise.name : member.franchiseId}</td>
                          <td className="p-2 capitalize">{member.role}</td>
                          <td className="p-2">{member.primary ? "Yes" : "No"}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              className="btn btn-xs btn-outline"
                              onClick={() => removeMember(member)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
