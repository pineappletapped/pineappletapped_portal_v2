"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import clsx from "clsx";

import AdminWorkspaceLayout, { AdminSection } from "@/components/admin/AdminWorkspaceLayout";
import { ensureFirebase } from "@/lib/firebase";
import { adminListUsers } from "@/lib/admin";
import { useInsuranceRecords } from "@/hooks/useInsuranceRecords";
import {
  evaluateInsuranceAssignment,
  getCoverageStatusLabel,
  getCoverageStatusTone,
  timestampToDate,
  type AssignmentEvaluationContext,
  type InsuranceAcknowledgementRecord,
  type InsuranceAssignmentRecord,
  type InsuranceCoverageStatus,
  type InsurancePolicyRecord,
  type InsuranceTrainingRequirement,
} from "@/lib/insurance";
import { formatDistanceToNow, isValid } from "date-fns";

interface TrainingModuleOption {
  id: string;
  title: string;
}

interface UserOption {
  id: string;
  label: string;
}

interface FranchiseOption {
  id: string;
  name: string;
}

interface FranchiseMemberRecord {
  userId: string;
  role: string;
}

interface EditablePolicy extends Omit<InsurancePolicyRecord, "id"> {
  id?: string;
}

const emptyPolicy = (): EditablePolicy => ({
  id: undefined,
  name: "",
  coverageLevel: null,
  coverageLimit: null,
  description: "",
  coverageNotes: "",
  appliesToAllFranchises: false,
  appliesToAllTeam: false,
  activitiesCovered: [],
  activityValidations: [],
  attachments: [],
  trainingRequirements: [],
  acknowledgementRequirements: [],
  createdAt: null,
  updatedAt: null,
});

const toTextareaValue = (items: string[]): string => items.join("\n");
const fromTextareaValue = (value: string): string[] =>
  value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const statusBadge = (status: InsuranceCoverageStatus) => {
  const tone = getCoverageStatusTone(status);
  const toneClasses: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700",
    info: "bg-blue-100 text-blue-700",
    danger: "bg-rose-100 text-rose-700",
    muted: "bg-slate-200 text-slate-700",
    default: "bg-slate-100 text-slate-700",
  };
  return clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", toneClasses[tone]);
};

const toTrainingPayload = (requirement: InsuranceTrainingRequirement) => ({
  id: requirement.id,
  moduleId: requirement.moduleId,
  moduleTitle: requirement.moduleTitle,
  renewalDays: requirement.renewalDays ?? null,
});

const formatDate = (value: Date | null | undefined): string => {
  if (!value || !isValid(value)) return "—";
  return value.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

const formatRelative = (value: Date | null | undefined): string | null => {
  if (!value || !isValid(value)) return null;
  try {
    return formatDistanceToNow(value, { addSuffix: true });
  } catch (error) {
    console.error("Failed to format relative time", error);
    return null;
  }
};

const resolveTargetLabel = (
  assignment: InsuranceAssignmentRecord,
  users: Map<string, UserOption>,
  franchises: Map<string, FranchiseOption>
): string => {
  if (assignment.targetType === "user") {
    return users.get(assignment.targetId)?.label || assignment.targetId;
  }
  const franchise = franchises.get(assignment.targetId);
  if (!franchise) return assignment.targetId;
  return franchise.name;
};

const normalisePolicy = (policy: EditablePolicy): EditablePolicy => ({
  ...policy,
  name: policy.name.trim(),
  coverageLevel: policy.coverageLevel?.trim() || null,
  coverageLimit: policy.coverageLimit?.trim() || null,
  description: policy.description?.trim() || "",
  coverageNotes: policy.coverageNotes?.trim() || "",
  activitiesCovered: Array.from(new Set(policy.activitiesCovered.map((item) => item.trim()).filter(Boolean))),
  activityValidations: policy.activityValidations.map((validation) => ({
    ...validation,
    activity: validation.activity.trim(),
    notes: validation.notes?.trim() || null,
  })),
  attachments: policy.attachments.map((attachment) => ({
    ...attachment,
    label: attachment.label.trim(),
    fileName: attachment.fileName.trim(),
    description: attachment.description?.trim() || null,
    coverageLevel: attachment.coverageLevel?.trim() || null,
  })),
  trainingRequirements: policy.trainingRequirements.map((requirement) => ({
    ...requirement,
    moduleTitle: requirement.moduleTitle.trim(),
  })),
  acknowledgementRequirements: policy.acknowledgementRequirements.map((requirement) => ({
    ...requirement,
    label: requirement.label.trim(),
  })),
});

export default function InsuranceWorkspace() {
  const { loading, error, policies, assignments, acknowledgements, reload } = useInsuranceRecords();
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<EditablePolicy | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [isNewPolicy, setIsNewPolicy] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentSaving, setAssignmentSaving] = useState<string | null>(null);
  const [newTargetType, setNewTargetType] = useState<"user" | "franchise">("user");
  const [newTargetId, setNewTargetId] = useState<string>("");
  const [addingAssignment, setAddingAssignment] = useState(false);

  const [trainingModules, setTrainingModules] = useState<TrainingModuleOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [franchises, setFranchises] = useState<FranchiseOption[]>([]);
  const [membershipCache, setMembershipCache] = useState<Map<string, FranchiseMemberRecord[]>>(new Map());

  const userMap = useMemo(() => {
    const map = new Map<string, UserOption>();
    users.forEach((user) => map.set(user.id, user));
    return map;
  }, [users]);

  const franchiseMap = useMemo(() => {
    const map = new Map<string, FranchiseOption>();
    franchises.forEach((franchise) => map.set(franchise.id, franchise));
    return map;
  }, [franchises]);

  useEffect(() => {
    if (!loading && policies.length > 0 && !selectedPolicyId && !isNewPolicy) {
      setSelectedPolicyId(policies[0].id);
    }
  }, [loading, policies, selectedPolicyId, isNewPolicy]);

  useEffect(() => {
    if (isNewPolicy) return;
    if (!selectedPolicyId) {
      setEditingPolicy(null);
      return;
    }
    const policy = policies.find((item) => item.id === selectedPolicyId);
    if (policy) {
      setEditingPolicy({ ...policy });
    }
  }, [policies, selectedPolicyId, isNewPolicy]);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) return;
        const snap = await getDocs(query(collection(db, "trainingModules"), orderBy("title")));
        const modules = snap.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            title: typeof data.title === "string" && data.title.trim().length > 0 ? data.title.trim() : "Untitled module",
          } satisfies TrainingModuleOption;
        });
        setTrainingModules(modules);
      } catch (err) {
        console.error("Failed to load training modules", err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res: any = await adminListUsers();
        const hydrated: UserOption[] = (res.users || []).map((user: any) => ({
          id: user.id,
          label:
            (typeof user.fullName === "string" && user.fullName.trim()) ||
            (typeof user.displayName === "string" && user.displayName.trim()) ||
            user.email ||
            user.id,
        }));
        setUsers(hydrated);
      } catch (err) {
        console.error("Failed to load user list", err);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (!db) return;
        const snap = await getDocs(query(collection(db, "franchises"), orderBy("name")));
        const records = snap.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            name: typeof data.name === "string" && data.name.trim().length > 0 ? data.name.trim() : "Unnamed franchise",
          } satisfies FranchiseOption;
        });
        setFranchises(records);
      } catch (err) {
        console.error("Failed to load franchises", err);
      }
    })();
  }, []);

  const policyAssignments = useMemo(() => {
    if (!selectedPolicyId) return [] as InsuranceAssignmentRecord[];
    return assignments.filter((assignment) => assignment.policyId === selectedPolicyId);
  }, [assignments, selectedPolicyId]);

  const policyAcknowledgements = useMemo(() => {
    if (!selectedPolicyId) return [] as InsuranceAcknowledgementRecord[];
    return acknowledgements.filter((ack) => ack.policyId === selectedPolicyId);
  }, [acknowledgements, selectedPolicyId]);

  const handleCreatePolicy = useCallback(() => {
    setIsNewPolicy(true);
    setEditingPolicy(emptyPolicy());
    setSelectedPolicyId(null);
    setPolicyError(null);
  }, []);

  const handleSavePolicy = useCallback(async () => {
    if (!editingPolicy) return;
    const policyToSave = normalisePolicy(editingPolicy);
    if (!policyToSave.name) {
      setPolicyError("Provide a policy name before saving.");
      return;
    }
    if (policyToSave.trainingRequirements.some((requirement) => !requirement.moduleId)) {
      setPolicyError("Training requirements must reference modules.");
      return;
    }
    if (
      policyToSave.acknowledgementRequirements.some(
        (requirement) => !requirement.attachmentId || !policyToSave.attachments.some((attachment) => attachment.id === requirement.attachmentId)
      )
    ) {
      setPolicyError("Acknowledgements must reference existing attachments.");
      return;
    }

    setSavingPolicy(true);
    setPolicyError(null);
    try {
      const { db } = await ensureFirebase();
      if (!db) throw new Error("Firestore unavailable");
      if (!policyToSave.id || isNewPolicy) {
        const docRef = await addDoc(collection(db, "insurancePolicies"), {
          ...policyToSave,
          attachments: policyToSave.attachments.map((attachment) => ({
            ...attachment,
            lastUpdatedAt: attachment.lastUpdatedAt ?? new Date(),
          })),
          trainingRequirements: policyToSave.trainingRequirements.map(toTrainingPayload),
          acknowledgementRequirements: policyToSave.acknowledgementRequirements.map((requirement) => ({
            ...requirement,
            renewalDays: requirement.renewalDays ?? null,
          })),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSelectedPolicyId(docRef.id);
        setIsNewPolicy(false);
      } else {
        const docRef = doc(db, "insurancePolicies", policyToSave.id);
        await setDoc(
          docRef,
          {
            ...policyToSave,
            attachments: policyToSave.attachments.map((attachment) => ({
              ...attachment,
              lastUpdatedAt: attachment.lastUpdatedAt ?? new Date(),
            })),
            trainingRequirements: policyToSave.trainingRequirements.map(toTrainingPayload),
            acknowledgementRequirements: policyToSave.acknowledgementRequirements.map((requirement) => ({
              ...requirement,
              renewalDays: requirement.renewalDays ?? null,
            })),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await reload();
    } catch (err) {
      console.error("Failed to save insurance policy", err);
      setPolicyError(err instanceof Error ? err.message : "Unable to save policy.");
    } finally {
      setSavingPolicy(false);
    }
  }, [editingPolicy, isNewPolicy, reload]);

  const handleResetPolicy = useCallback(() => {
    setPolicyError(null);
    if (isNewPolicy) {
      setEditingPolicy(emptyPolicy());
      return;
    }
    if (!selectedPolicyId) {
      setEditingPolicy(null);
      return;
    }
    const original = policies.find((policy) => policy.id === selectedPolicyId);
    if (original) {
      setEditingPolicy({ ...original });
    }
  }, [isNewPolicy, policies, selectedPolicyId]);

  const handleUploadAttachment = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!editingPolicy) return;
      if (!editingPolicy.id || isNewPolicy) {
        setPolicyError("Save the policy before uploading attachments.");
        event.target.value = "";
        return;
      }
      const files = event.target.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      setAttachmentUploading(true);
      setPolicyError(null);
      try {
        const { storage } = await ensureFirebase();
        if (!storage) throw new Error("Storage unavailable");
        const storagePath = `insurancePolicies/${editingPolicy.id}/${Date.now()}-${file.name}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        setEditingPolicy((prev) =>
          prev
            ? {
                ...prev,
                attachments: [
                  ...prev.attachments,
                  {
                    id: `${prev.id}-attachment-${Date.now()}`,
                    label: file.name,
                    fileName: file.name,
                    url,
                    storagePath,
                    description: null,
                    requireAcknowledgement: false,
                    renewalDays: null,
                    coverageLevel: prev.coverageLevel,
                    lastUpdatedAt: new Date(),
                  },
                ],
              }
            : prev
        );
      } catch (err) {
        console.error("Failed to upload attachment", err);
        setPolicyError(err instanceof Error ? err.message : "Unable to upload attachment.");
      } finally {
        setAttachmentUploading(false);
        event.target.value = "";
      }
    },
    [editingPolicy, isNewPolicy]
  );

  const loadFranchiseMembers = useCallback(
    async (franchiseId: string): Promise<FranchiseMemberRecord[]> => {
      if (membershipCache.has(franchiseId)) {
        return membershipCache.get(franchiseId) ?? [];
      }
      try {
        const { db } = await ensureFirebase();
        if (!db) return [];
        const snap = await getDocs(query(collection(db, "franchiseMembers"), where("franchiseId", "==", franchiseId)));
        const members: FranchiseMemberRecord[] = snap.docs
          .map((docSnap) => docSnap.data() as Record<string, any>)
          .map((data) => ({
            userId: typeof data.userId === "string" ? data.userId : "",
            role: typeof data.role === "string" ? data.role : "",
          }))
          .filter((record) => record.userId);
        setMembershipCache((prev) => new Map(prev).set(franchiseId, members));
        return members;
      } catch (err) {
        console.error("Failed to load franchise members", err);
        return [];
      }
    },
    [membershipCache]
  );

  const evaluateAssignment = useCallback(
    async (assignment: InsuranceAssignmentRecord) => {
      if (!selectedPolicyId) return;
      const policy = policies.find((item) => item.id === selectedPolicyId);
      if (!policy) return;
      setAssignmentSaving(assignment.id);
      setAssignmentError(null);
      try {
        const { db } = await ensureFirebase();
        if (!db) throw new Error("Firestore unavailable");
        const trackedMemberIds =
          assignment.targetType === "user"
            ? [assignment.targetId]
            : assignment.trackedMemberIds.length > 0
              ? assignment.trackedMemberIds
              : (await loadFranchiseMembers(assignment.targetId)).map((member) => member.userId);

        const uniqueTracked = Array.from(new Set(trackedMemberIds.filter(Boolean)));

        const trainingMap: Record<string, Date | null> = {};
        const trainingNotes: Record<string, string> = {};

        if (uniqueTracked.length > 0 && policy.trainingRequirements.length > 0) {
          const { db } = await ensureFirebase();
          if (!db) throw new Error("Firestore unavailable");
          const moduleUserMap = new Map<string, { userId: string; lastViewedAt: Date | null }[]>();
          await Promise.all(
            uniqueTracked.map(async (userId) => {
              const snap = await getDocs(query(collection(db, "trainingModuleEngagements"), where("userId", "==", userId)));
              snap.docs.forEach((docSnap) => {
                const data = docSnap.data() as Record<string, any>;
                const moduleId = typeof data.moduleId === "string" ? data.moduleId : "";
                if (!moduleId) return;
                const lastViewedAt = timestampToDate((data.lastViewedAt as any) ?? (data.updatedAt as any) ?? null);
                if (!moduleUserMap.has(moduleId)) {
                  moduleUserMap.set(moduleId, []);
                }
                moduleUserMap.get(moduleId)!.push({ userId, lastViewedAt });
              });
            })
          );

          policy.trainingRequirements.forEach((requirement) => {
            const entries = moduleUserMap.get(requirement.moduleId) ?? [];
            const missingUsers = uniqueTracked.filter(
              (userId) => !entries.some((entry) => entry.userId === userId && entry.lastViewedAt)
            );
            const staleUsers = entries.filter((entry) => {
              if (!entry.lastViewedAt) return false;
              if (!requirement.renewalDays || requirement.renewalDays <= 0) return false;
              const expiry = new Date(entry.lastViewedAt);
              expiry.setDate(expiry.getDate() + requirement.renewalDays);
              return expiry <= new Date();
            });
            const notes: string[] = [];
            if (missingUsers.length > 0) {
              notes.push(`Pending: ${missingUsers.map((id) => userMap.get(id)?.label || id).join(", ")}`);
            }
            if (staleUsers.length > 0) {
              notes.push(`Expired: ${staleUsers.map((entry) => userMap.get(entry.userId)?.label || entry.userId).join(", ")}`);
            }
            trainingNotes[requirement.moduleId] = notes.join(" · ");
            const validDates = entries
              .map((entry) => entry.lastViewedAt)
              .filter((date): date is Date => date instanceof Date && isValid(date));
            if (validDates.length === 0) {
              trainingMap[requirement.moduleId] = null;
            } else if (assignment.targetType === "user") {
              trainingMap[requirement.moduleId] = validDates[0];
            } else {
              trainingMap[requirement.moduleId] = validDates.reduce((earliest, current) =>
                current < earliest ? current : earliest
              );
            }
          });
        }

        const acknowledgementNotes: Record<string, string> = {};
        const acknowledgementMap: Record<string, { acknowledgedAt: Date | null; expiresAt: Date | null }> = {};

        policy.acknowledgementRequirements.forEach((requirement) => {
          const ack = policyAcknowledgements.find(
            (item) =>
              item.attachmentId === requirement.attachmentId &&
              item.targetType === assignment.targetType &&
              item.targetId === assignment.targetId
          );
          if (ack) {
            acknowledgementMap[requirement.attachmentId] = {
              acknowledgedAt: ack.acknowledgedAt,
              expiresAt: ack.expiresAt,
            };
            const signer = userMap.get(ack.acknowledgedBy)?.label || ack.acknowledgedBy;
            const relative = formatRelative(ack.acknowledgedAt);
            acknowledgementNotes[requirement.attachmentId] = signer
              ? relative
                ? `${signer} ${relative}`
                : signer
              : relative ?? "Acknowledged";
          } else {
            acknowledgementNotes[requirement.attachmentId] = "Awaiting acknowledgement";
          }
        });

        const evaluationContext: AssignmentEvaluationContext = {
          training: trainingMap,
          acknowledgements: acknowledgementMap,
          manualOverride: assignment.manualOverride,
          requiresExternalPolicy: assignment.requiresExternalPolicy,
          externalPolicyExpiry: assignment.externalPolicyExpiry ?? null,
          trainingNotes,
          acknowledgementNotes,
        };

        const evaluation = evaluateInsuranceAssignment(policy, assignment, evaluationContext);
        await updateDoc(doc(db, "insuranceAssignments", assignment.id), {
          status: evaluation.status,
          expiresAt: evaluation.expiresAt ?? null,
          missingRequirements: evaluation.missing,
          lastEvaluatedAt: serverTimestamp(),
          evaluationNotes: evaluation.requirements
            .map((item) => `${item.label}: ${item.satisfied ? "ok" : item.context || "needs action"}`)
            .join(" | "),
        });
        await reload();
      } catch (err) {
        console.error("Failed to evaluate coverage", err);
        setAssignmentError(err instanceof Error ? err.message : "Unable to evaluate assignment.");
      } finally {
        setAssignmentSaving(null);
      }
    },
    [selectedPolicyId, policies, loadFranchiseMembers, policyAcknowledgements, userMap, reload]
  );

  const removeAssignment = useCallback(
    async (assignmentId: string) => {
      if (!confirm("Remove this coverage assignment?")) return;
      try {
        const { db } = await ensureFirebase();
        if (!db) throw new Error("Firestore unavailable");
        await deleteDoc(doc(db, "insuranceAssignments", assignmentId));
        await reload();
      } catch (err) {
        console.error("Failed to remove assignment", err);
        setAssignmentError(err instanceof Error ? err.message : "Unable to remove assignment.");
      }
    },
    [reload]
  );

  const updateAssignment = useCallback(
    async (assignmentId: string, updates: Record<string, unknown>) => {
      try {
        const { db } = await ensureFirebase();
        if (!db) throw new Error("Firestore unavailable");
        await updateDoc(doc(db, "insuranceAssignments", assignmentId), {
          ...updates,
          updatedAt: serverTimestamp(),
        });
        await reload();
      } catch (err) {
        console.error("Failed to update assignment", err);
        setAssignmentError(err instanceof Error ? err.message : "Unable to update assignment.");
      }
    },
    [reload]
  );

  const handleAddAssignment = useCallback(async () => {
    if (!selectedPolicyId) return;
    if (!newTargetId) {
      setAssignmentError("Choose a target before adding coverage.");
      return;
    }
    setAddingAssignment(true);
    setAssignmentError(null);
    try {
      const { db } = await ensureFirebase();
      if (!db) throw new Error("Firestore unavailable");
      await addDoc(collection(db, "insuranceAssignments"), {
        policyId: selectedPolicyId,
        targetType: newTargetType,
        targetId: newTargetId,
        status: "needs_action",
        missingRequirements: [],
        validatedActivities: [],
        trackedMemberIds: [],
        requiresExternalPolicy: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewTargetId("");
      await reload();
    } catch (err) {
      console.error("Failed to create assignment", err);
      setAssignmentError(err instanceof Error ? err.message : "Unable to create assignment.");
    } finally {
      setAddingAssignment(false);
    }
  }, [newTargetId, newTargetType, reload, selectedPolicyId]);

  const policyTitle = editingPolicy?.name || policies.find((policy) => policy.id === selectedPolicyId)?.name || "Insurance";

  return (
    <AdminWorkspaceLayout
      title="Insurance cover management"
      description={
        <>
          <p>
            Upload insurance policies, define the training and acknowledgement standards that maintain cover, and track who is
            cleared before assigning on-site work.
          </p>
          <p>
            Coverage automatically drops to &ldquo;needs action&rdquo; when requirements lapse so franchises and crew know when they need
            to refresh their documents or training modules.
          </p>
        </>
      }
      actions={
        <button type="button" className="btn btn-secondary" onClick={handleCreatePolicy}>
          New policy
        </button>
      }
    >
      <AdminSection
        title="Policy selection"
        description="Choose which policy to review or update. New policies appear immediately after saving."
      >
        {loading ? (
          <p className="text-sm text-gray-600">Loading policies…</p>
        ) : policies.length === 0 && !isNewPolicy ? (
          <p className="text-sm text-gray-600">
            No policies recorded yet. Create your first policy to upload documentation and define coverage rules.
          </p>
        ) : (
          <label className="flex flex-col gap-2 text-sm font-medium text-gray-700 md:w-1/2">
            Active policy
            <select
              className="input"
              value={selectedPolicyId ?? "__new"}
              onChange={(event) => {
                if (event.target.value === "__new") {
                  handleCreatePolicy();
                } else {
                  setSelectedPolicyId(event.target.value);
                  setIsNewPolicy(false);
                }
              }}
            >
              {policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name || policy.id}
                </option>
              ))}
              {isNewPolicy ? <option value="__new">New policy</option> : null}
            </select>
          </label>
        )}
      </AdminSection>

      {editingPolicy ? (
        <AdminSection
          title={`Edit ${policyTitle}`}
          description="Update policy metadata, upload attachments, and configure the standards that define coverage."
          footer={policyError ? <p className="text-red-600">{policyError}</p> : <p>Remember to save after making changes.</p>}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                Policy name
                <input
                  type="text"
                  className="input"
                  value={editingPolicy.name}
                  onChange={(event) => setEditingPolicy((prev) => prev && { ...prev, name: event.target.value })}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  Coverage level
                  <input
                    type="text"
                    className="input"
                    value={editingPolicy.coverageLevel ?? ""}
                    onChange={(event) =>
                      setEditingPolicy((prev) => prev && { ...prev, coverageLevel: event.target.value || null })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  Coverage limit
                  <input
                    type="text"
                    className="input"
                    value={editingPolicy.coverageLimit ?? ""}
                    onChange={(event) =>
                      setEditingPolicy((prev) => prev && { ...prev, coverageLimit: event.target.value || null })
                    }
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={editingPolicy.appliesToAllFranchises}
                    onChange={(event) =>
                      setEditingPolicy((prev) => prev && { ...prev, appliesToAllFranchises: event.target.checked })
                    }
                  />
                  Cover all franchises automatically
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={editingPolicy.appliesToAllTeam}
                    onChange={(event) =>
                      setEditingPolicy((prev) => prev && { ...prev, appliesToAllTeam: event.target.checked })
                    }
                  />
                  Cover all team members automatically
                </label>
              </div>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                Activities covered
                <textarea
                  className="input min-h-[120px]"
                  placeholder="Public liability, venue filming, drone operations…"
                  value={toTextareaValue(editingPolicy.activitiesCovered)}
                  onChange={(event) =>
                    setEditingPolicy((prev) => prev && { ...prev, activitiesCovered: fromTextareaValue(event.target.value) })
                  }
                />
                <span className="text-xs font-normal text-gray-500">
                  Separate each activity with a comma or new line so the portals can display them clearly.
                </span>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                Summary
                <textarea
                  className="input min-h-[160px]"
                  value={editingPolicy.description ?? ""}
                  onChange={(event) =>
                    setEditingPolicy((prev) => prev && { ...prev, description: event.target.value ?? "" })
                  }
                  placeholder="Describe the scope of cover and any key exclusions."
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                Coverage notes
                <textarea
                  className="input min-h-[120px]"
                  value={editingPolicy.coverageNotes ?? ""}
                  onChange={(event) =>
                    setEditingPolicy((prev) => prev && { ...prev, coverageNotes: event.target.value ?? "" })
                  }
                  placeholder="Internal guidance for HQ when deciding who can be covered."
                />
              </label>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Attachments</h3>
                  <label className="btn btn-secondary btn-xs">
                    {attachmentUploading ? "Uploading…" : "Upload"}
                    <input type="file" className="sr-only" onChange={handleUploadAttachment} disabled={attachmentUploading} />
                  </label>
                </div>
                {editingPolicy.attachments.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Save the policy, then upload PDF or image attachments so franchises and team members can download the policy
                    wording they must acknowledge.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {editingPolicy.attachments.map((attachment, index) => (
                      <li key={attachment.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{attachment.label}</p>
                            <p className="text-xs text-gray-500">{attachment.fileName}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Link href={attachment.url} className="btn btn-ghost btn-xs" target="_blank">
                              View
                            </Link>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-rose-600"
                              onClick={() =>
                                setEditingPolicy((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        attachments: prev.attachments.filter((_, itemIndex) => itemIndex !== index),
                                        acknowledgementRequirements: prev.acknowledgementRequirements.filter(
                                          (requirement) => requirement.attachmentId !== attachment.id
                                        ),
                                      }
                                    : prev
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <textarea
                          className="input mt-2 min-h-[80px]"
                          placeholder="Add context about what this document covers."
                          value={attachment.description ?? ""}
                          onChange={(event) =>
                            setEditingPolicy((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    attachments: prev.attachments.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, description: event.target.value ?? null } : item
                                    ),
                                  }
                                : prev
                            )
                          }
                        />
                        <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={attachment.requireAcknowledgement}
                              onChange={(event) =>
                                setEditingPolicy((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        attachments: prev.attachments.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? { ...item, requireAcknowledgement: event.target.checked }
                                            : item
                                        ),
                                      }
                                    : prev
                                )
                              }
                            />
                            Requires acknowledgement
                          </label>
                          <label className="flex items-center gap-2">
                            Renewal days
                            <input
                              type="number"
                              min={0}
                              className="input input-xs w-20"
                              value={attachment.renewalDays ?? ""}
                              onChange={(event) =>
                                setEditingPolicy((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        attachments: prev.attachments.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                renewalDays:
                                                  event.target.value === ""
                                                    ? null
                                                    : Number.parseInt(event.target.value, 10) || null,
                                              }
                                            : item
                                        ),
                                      }
                                    : prev
                                )
                              }
                            />
                          </label>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Training requirements</h3>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      setEditingPolicy((prev) =>
                        prev
                          ? {
                              ...prev,
                              trainingRequirements: [
                                ...prev.trainingRequirements,
                                {
                                  id: `training-${Date.now()}`,
                                  moduleId: trainingModules[0]?.id ?? "",
                                  moduleTitle: trainingModules[0]?.title ?? "Training module",
                                  renewalDays: 365,
                                },
                              ],
                            }
                          : prev
                      )
                    }
                  >
                    Add training
                  </button>
                </div>
                {editingPolicy.trainingRequirements.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Require franchises or team members to complete specific training modules before they appear as covered.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {editingPolicy.trainingRequirements.map((requirement, index) => (
                      <li key={requirement.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                          Training module
                          <select
                            className="input"
                            value={requirement.moduleId}
                            onChange={(event) =>
                              setEditingPolicy((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      trainingRequirements: prev.trainingRequirements.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              moduleId: event.target.value,
                                              moduleTitle:
                                                trainingModules.find((module) => module.id === event.target.value)?.title ||
                                                item.moduleTitle,
                                            }
                                          : item
                                      ),
                                    }
                                  : prev
                              )
                            }
                          >
                            <option value="">Select module…</option>
                            {trainingModules.map((module) => (
                              <option key={module.id} value={module.id}>
                                {module.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                          Renewal days
                          <input
                            type="number"
                            min={0}
                            className="input input-xs w-20"
                            value={requirement.renewalDays ?? ""}
                            onChange={(event) =>
                              setEditingPolicy((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      trainingRequirements: prev.trainingRequirements.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              renewalDays:
                                                event.target.value === ""
                                                  ? null
                                                  : Number.parseInt(event.target.value, 10) || null,
                                            }
                                          : item
                                      ),
                                    }
                                  : prev
                              )
                            }
                          />
                          <span className="text-xs text-gray-500">Leave blank for a one-off module.</span>
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs mt-3 text-rose-600"
                          onClick={() =>
                            setEditingPolicy((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    trainingRequirements: prev.trainingRequirements.filter((_, itemIndex) => itemIndex !== index),
                                  }
                                : prev
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Acknowledgements</h3>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      setEditingPolicy((prev) =>
                        prev
                          ? {
                              ...prev,
                              acknowledgementRequirements: [
                                ...prev.acknowledgementRequirements,
                                {
                                  id: `ack-${Date.now()}`,
                                  attachmentId: prev.attachments[0]?.id ?? "",
                                  label: prev.attachments[0]?.label ?? "Policy acknowledgement",
                                  renewalDays: prev.attachments[0]?.renewalDays ?? 365,
                                },
                              ],
                            }
                          : prev
                      )
                    }
                    disabled={editingPolicy.attachments.length === 0}
                  >
                    Add acknowledgement
                  </button>
                </div>
                {editingPolicy.acknowledgementRequirements.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    Tie attachments to acknowledgement deadlines so the portals remind franchises and team members to sign the
                    latest policy wording.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {editingPolicy.acknowledgementRequirements.map((requirement, index) => (
                      <li key={requirement.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                          Attachment
                          <select
                            className="input"
                            value={requirement.attachmentId}
                            onChange={(event) =>
                              setEditingPolicy((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      acknowledgementRequirements: prev.acknowledgementRequirements.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              attachmentId: event.target.value,
                                              label:
                                                prev.attachments.find((attachment) => attachment.id === event.target.value)?.label ||
                                                item.label,
                                            }
                                          : item
                                      ),
                                    }
                                  : prev
                              )
                            }
                          >
                            <option value="">Select attachment…</option>
                            {editingPolicy.attachments.map((attachment) => (
                              <option key={attachment.id} value={attachment.id}>
                                {attachment.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                          Renewal days
                          <input
                            type="number"
                            min={0}
                            className="input input-xs w-20"
                            value={requirement.renewalDays ?? ""}
                            onChange={(event) =>
                              setEditingPolicy((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      acknowledgementRequirements: prev.acknowledgementRequirements.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              renewalDays:
                                                event.target.value === ""
                                                  ? null
                                                  : Number.parseInt(event.target.value, 10) || null,
                                            }
                                          : item
                                      ),
                                    }
                                  : prev
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs mt-3 text-rose-600"
                          onClick={() =>
                            setEditingPolicy((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    acknowledgementRequirements: prev.acknowledgementRequirements.filter((_, itemIndex) =>
                                      itemIndex !== index
                                    ),
                                  }
                                : prev
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn" onClick={handleSavePolicy} disabled={savingPolicy}>
              {savingPolicy ? "Saving…" : "Save policy"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleResetPolicy}>
              Reset changes
            </button>
          </div>
        </AdminSection>
      ) : null}

      {selectedPolicyId ? (
        <AdminSection
          title="Coverage assignments"
          description="Review who is covered by this policy, evaluate compliance, and manage manual overrides."
          footer={assignmentError ? <p className="text-red-600">{assignmentError}</p> : null}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              Target type
              <select className="input" value={newTargetType} onChange={(event) => setNewTargetType(event.target.value as any)}>
                <option value="user">Team member</option>
                <option value="franchise">Franchise</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              Target
              <select className="input min-w-[240px]" value={newTargetId} onChange={(event) => setNewTargetId(event.target.value)}>
                <option value="">Select…</option>
                {(newTargetType === "user" ? users : franchises).map((option) => (
                  <option key={option.id} value={option.id}>
                    {"label" in option ? option.label : (option as FranchiseOption).name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={handleAddAssignment} disabled={addingAssignment}>
              {addingAssignment ? "Adding…" : "Add coverage"}
            </button>
          </div>

          {policyAssignments.length === 0 ? (
            <p className="text-sm text-gray-600">No coverage assigned yet. Add a team member or franchise to start tracking.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Target</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-left font-semibold">Expires</th>
                    <th className="px-3 py-2 text-left font-semibold">Missing</th>
                    <th className="px-3 py-2 text-left font-semibold">Manual override</th>
                    <th className="px-3 py-2 text-left font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {policyAssignments.map((assignment) => {
                    const targetLabel = resolveTargetLabel(assignment, userMap, franchiseMap);
                    return (
                      <tr key={assignment.id} className="bg-white">
                        <td className="px-3 py-3">
                          <div className="font-medium text-gray-900">{targetLabel}</div>
                          <div className="text-xs text-gray-500">{assignment.targetType === "user" ? "Team member" : "Franchise"}</div>
                          {assignment.lastEvaluatedAt ? (
                            <div className="text-xs text-gray-400">
                              Evaluated {formatRelative(assignment.lastEvaluatedAt) ?? "recently"}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <span className={statusBadge(assignment.status)}>{getCoverageStatusLabel(assignment.status)}</span>
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-700">{formatDate(assignment.expiresAt)}</td>
                        <td className="px-3 py-3 text-xs text-gray-600">
                          {assignment.missingRequirements.length === 0
                            ? "All requirements satisfied"
                            : assignment.missingRequirements.join(" • ")}
                        </td>
                        <td className="px-3 py-3">
                          <select
                            className="input input-xs"
                            value={assignment.manualOverride?.status ?? "auto"}
                            onChange={(event) =>
                              updateAssignment(assignment.id, {
                                manualOverride:
                                  event.target.value === "auto"
                                    ? null
                                    : {
                                        status: event.target.value,
                                        updatedAt: serverTimestamp(),
                                      },
                              })
                            }
                          >
                            <option value="auto">Automatic</option>
                            <option value="covered">Force covered</option>
                            <option value="external">External policy</option>
                            <option value="revoked">Revoked</option>
                          </select>
                        </td>
                        <td className="px-3 py-3 space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-xs"
                              onClick={() => evaluateAssignment(assignment)}
                              disabled={assignmentSaving === assignment.id}
                            >
                              {assignmentSaving === assignment.id ? "Checking…" : "Evaluate"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => removeAssignment(assignment.id)}
                            >
                              Remove
                            </button>
                          </div>
                          {assignment.requiresExternalPolicy ? (
                            <p className="text-xs text-gray-500">
                              External policy on file. Expiry {formatDate(assignment.externalPolicyExpiry)}.
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>
      ) : null}

      {error ? (
        <AdminSection tone="danger" title="Loading issue">
          <p className="text-sm text-rose-700">
            {error}. Refresh the page or try again later once the portal reconnects to Firebase.
          </p>
        </AdminSection>
      ) : null}
    </AdminWorkspaceLayout>
  );
}

