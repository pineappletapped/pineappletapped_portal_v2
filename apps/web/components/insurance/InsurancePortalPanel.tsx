"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  Timestamp,
  type DocumentData,
} from "firebase/firestore";

import {
  getCoverageStatusLabel,
  getCoverageStatusTone,
  parseInsuranceAcknowledgementDoc,
  parseInsuranceAssignmentDoc,
  parseInsurancePolicyDoc,
  type InsuranceAcknowledgementRecord,
  type InsuranceAssignmentRecord,
  type InsurancePolicyRecord,
  type InsuranceCoverageStatus,
} from "@/lib/insurance";
import { ensureFirebase } from "@/lib/firebase";

interface InsurancePortalPanelProps {
  targetType: "user" | "franchise";
  targetId: string;
  heading?: string;
  description?: string;
}

interface PortalAssignment {
  assignment: InsuranceAssignmentRecord;
  policy: InsurancePolicyRecord | null;
  acknowledgements: Map<string, InsuranceAcknowledgementRecord>;
}

const badgeClass = (status: InsuranceCoverageStatus) => {
  const tone = getCoverageStatusTone(status);
  const mapping: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700",
    info: "bg-blue-100 text-blue-700",
    danger: "bg-rose-100 text-rose-700",
    muted: "bg-slate-200 text-slate-700",
    default: "bg-slate-100 text-slate-700",
  };
  return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${mapping[tone] ?? mapping.default}`;
};

const sortAssignments = (entries: PortalAssignment[]): PortalAssignment[] => {
  return entries.slice().sort((a, b) => {
    const aName = a.policy?.name ?? "";
    const bName = b.policy?.name ?? "";
    return aName.localeCompare(bName);
  });
};

const buildAckKey = (policyId: string, attachmentId: string) => `${policyId}:${attachmentId}`;

export default function InsurancePortalPanel({
  targetType,
  targetId,
  heading = "Insurance cover",
  description = "Review HQ cover, download policy documents, and acknowledge updates so we can keep you insured.",
}: InsurancePortalPanelProps) {
  const [assignments, setAssignments] = useState<PortalAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ackLoading, setAckLoading] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    setError(null);
    try {
      const { db } = await ensureFirebase();
      if (!db) throw new Error("Firestore is unavailable");

      const assignmentQuery = query(
        collection(db, "insuranceAssignments"),
        where("targetType", "==", targetType),
        where("targetId", "==", targetId)
      );
      const [assignmentSnap, policySnap, acknowledgementSnap] = await Promise.all([
        getDocs(assignmentQuery),
        getDocs(collection(db, "insurancePolicies")),
        getDocs(
          query(
            collection(db, "insuranceAcknowledgements"),
            where("targetType", "==", targetType),
            where("targetId", "==", targetId)
          )
        ),
      ]);

      const policies = new Map<string, InsurancePolicyRecord>();
      policySnap.docs.forEach((docSnap) => {
        policies.set(docSnap.id, parseInsurancePolicyDoc(docSnap.id, docSnap.data() as Record<string, unknown>));
      });

      const acknowledgements = new Map<string, InsuranceAcknowledgementRecord>();
      acknowledgementSnap.docs.forEach((docSnap) => {
        const acknowledgement = parseInsuranceAcknowledgementDoc(docSnap.id, docSnap.data() as DocumentData);
        acknowledgements.set(buildAckKey(acknowledgement.policyId, acknowledgement.attachmentId), acknowledgement);
      });

      const portalAssignments: PortalAssignment[] = assignmentSnap.docs.map((docSnap) => {
        const assignment = parseInsuranceAssignmentDoc(docSnap.id, docSnap.data() as DocumentData);
        return {
          assignment,
          policy: policies.get(assignment.policyId) ?? null,
          acknowledgements,
        } satisfies PortalAssignment;
      });

      setAssignments(sortAssignments(portalAssignments));
    } catch (err) {
      console.error("Failed to load insurance records", err);
      setError(err instanceof Error ? err.message : "Unable to load insurance records right now.");
    } finally {
      setLoading(false);
    }
  }, [targetId, targetType]);

  useEffect(() => {
    loadRecords().catch((err) => console.error("Failed to bootstrap insurance panel", err));
  }, [loadRecords]);

  const acknowledge = useCallback(
    async (assignment: InsuranceAssignmentRecord, attachmentId: string, renewalDays: number | null | undefined) => {
      setAckLoading(`${assignment.id}:${attachmentId}`);
      try {
        const { db, auth } = await ensureFirebase();
        if (!db) throw new Error("Firestore is unavailable");
        const uid = auth?.currentUser?.uid ?? "unknown";
        const docId = `${targetType}_${targetId}_${attachmentId}`;
        const expiresAt = renewalDays && renewalDays > 0
          ? Timestamp.fromDate(new Date(Date.now() + renewalDays * 24 * 60 * 60 * 1000))
          : null;
        await setDoc(
          doc(db, "insuranceAcknowledgements", docId),
          {
            policyId: assignment.policyId,
            attachmentId,
            targetType,
            targetId,
            acknowledgedBy: uid,
            acknowledgedAt: serverTimestamp(),
            expiresAt,
          },
          { merge: true }
        );
        await loadRecords();
      } catch (err) {
        console.error("Failed to acknowledge policy", err);
        setError(err instanceof Error ? err.message : "Unable to record acknowledgement. Try again later.");
      } finally {
        setAckLoading(null);
      }
    },
    [loadRecords, targetId, targetType]
  );

  const assignmentsWithPolicies = useMemo(() => assignments.filter((item) => item.policy), [assignments]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">{heading}</h2>
        <p className="text-sm text-slate-600">{description}</p>
      </header>
      {loading ? (
        <p className="text-sm text-slate-500">Loading insurance records…</p>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : assignmentsWithPolicies.length === 0 ? (
        <p className="text-sm text-slate-500">No insurance policies are linked to your account yet.</p>
      ) : (
        <div className="space-y-4">
          {assignmentsWithPolicies.map(({ assignment, policy, acknowledgements }) => {
            if (!policy) return null;
            const missing = assignment.missingRequirements;
            return (
              <article key={assignment.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{policy.name}</h3>
                    <p className="text-xs text-slate-500">
                      {policy.coverageLevel ? `${policy.coverageLevel} cover` : "Insurance"}
                      {policy.coverageLimit ? ` • ${policy.coverageLimit}` : ""}
                    </p>
                  </div>
                  <span className={badgeClass(assignment.status)}>{getCoverageStatusLabel(assignment.status)}</span>
                </div>
                {policy.description ? (
                  <p className="mt-2 text-sm text-slate-600">{policy.description}</p>
                ) : null}

                {policy.activitiesCovered.length > 0 ? (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activities covered</h4>
                    <p className="mt-1 text-sm text-slate-600">{policy.activitiesCovered.join(', ')}</p>
                  </div>
                ) : null}

                {missing.length > 0 ? (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                    <h4 className="font-semibold">Action needed</h4>
                    <ul className="mt-1 list-disc pl-4">
                      {missing.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {policy.attachments.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Policy documents</h4>
                    <ul className="space-y-2">
                      {policy.attachments.map((attachment) => (
                        <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900">{attachment.label}</span>
                            {attachment.description ? (
                              <span className="text-xs text-slate-500">{attachment.description}</span>
                            ) : null}
                          </div>
                          <Link href={attachment.url} className="btn btn-ghost btn-xs" target="_blank">
                            View
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {policy.acknowledgementRequirements.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Required acknowledgements
                    </h4>
                    <ul className="space-y-2">
                      {policy.acknowledgementRequirements.map((requirement) => {
                        const ack = acknowledgements.get(buildAckKey(policy.id, requirement.attachmentId)) ?? null;
                        const attachment = policy.attachments.find((item) => item.id === requirement.attachmentId) ?? null;
                        const acknowledgedAt = ack?.acknowledgedAt ?? null;
                        const expiresAt = ack?.expiresAt ?? null;
                        const isExpired = expiresAt ? expiresAt <= new Date() : false;
                        const isComplete = acknowledgedAt && !isExpired;
                        const loadingKey = `${assignment.id}:${requirement.attachmentId}`;
                        return (
                          <li key={requirement.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold text-slate-900">{requirement.label}</p>
                                <p className="text-xs text-slate-500">
                                  {requirement.renewalDays
                                    ? `Renew every ${requirement.renewalDays} days`
                                    : "One-off acknowledgement"}
                                  {acknowledgedAt
                                    ? ` • Acknowledged ${acknowledgedAt.toLocaleDateString()}`
                                    : ""}
                                  {isExpired ? " • Expired" : ""}
                                </p>
                                {attachment ? (
                                  <Link href={attachment.url} className="text-xs font-semibold text-blue-600 hover:underline" target="_blank">
                                    View {attachment.label}
                                  </Link>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2">
                                {isComplete ? (
                                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                                    Acknowledged
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-xs"
                                    onClick={() => acknowledge(assignment, requirement.attachmentId, requirement.renewalDays ?? null)}
                                    disabled={ackLoading === loadingKey}
                                  >
                                    {ackLoading === loadingKey ? "Saving…" : "Acknowledge"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

