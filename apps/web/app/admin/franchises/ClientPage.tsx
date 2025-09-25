"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  canActivateFranchise,
  defaultFranchiseOnboarding,
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

function createOnboardingState() {
  return { ...defaultFranchiseOnboarding() };
}

type OnboardingState = ReturnType<typeof createOnboardingState>;

export default function AdminFranchisesPage() {
  const { allowed, loading: guardLoading } = useRoleGate("admin");
  const [loading, setLoading] = useState(true);
  const [franchises, setFranchises] = useState<Franchise[]>([]);
  const [territories, setTerritories] = useState<FranchiseTerritory[]>([]);
  const [members, setMembers] = useState<FranchiseMember[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const loadAll = useCallback(async (cancelRef?: { current: boolean }) => {
    const [franchiseSnap, territorySnap, memberSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "franchises")),
      getDocs(collection(db, "franchiseTerritories")),
      getDocs(collection(db, "franchiseMembers")),
      getDocs(collection(db, "users")),
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

    setFranchises(franchiseList);
    setTerritories(territoryList);
    setMembers(memberList);
    setUsers(userList.sort((a, b) => a.displayName.localeCompare(b.displayName)));
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
        notes: newTerritory.notes.trim() || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
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
        notes: editingTerritory.notes.trim() || null,
        updatedAt: serverTimestamp(),
      };
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

      <section className="grid gap-4">
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
      </section>

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
                  return (
                    <tr key={territory.id} className="border-t align-top">
                      <td className="p-2 font-medium">{territory.label}</td>
                      <td className="p-2">{franchise ? franchise.name : territory.franchiseId}</td>
                      <td className="p-2">{territory.exclusive ? "Yes" : "No"}</td>
                      <td className="p-2 text-xs text-gray-600">{territorySummary(territory)}</td>
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
      </section>

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
      </section>
    </div>
  );
}
