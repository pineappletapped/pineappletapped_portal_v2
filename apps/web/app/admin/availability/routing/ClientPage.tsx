"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { AdjustmentsHorizontalIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

import { useRoleGate } from "@/hooks/useRoleGate";
import { ensureFirebase } from "@/lib/firebase";
import {
  DEFAULT_KIT_ROUTING_SETTINGS,
  ROUTING_STAGE_META,
  cloneKitRoutingSettings,
  parseKitRoutingSettings,
  resolveStageLabel,
  sanitiseKitRoutingSettings,
  type KitRoutingSettings,
  type RoutingStageConfig,
} from "@/lib/kit-routing";

type FlowKey = "franchiseFlow" | "hqFlow";

type FeedbackState = { tone: "success" | "error"; message: string } | null;

const FLOW_META: Record<FlowKey, { title: string; description: string; coverageExample: string | null }> = {
  franchiseFlow: {
    title: "Franchise-first routing",
    description:
      "Used when a booking is tied to a franchise territory. Steps run in order until a stage succeeds or everything falls back to manual review.",
    coverageExample: "Manchester Franchise",
  },
  hqFlow: {
    title: "HQ routing",
    description:
      "Used when no franchise coverage is specified. Optimise how HQ allocates kit and whether reservations auto-confirm or require approval.",
    coverageExample: "HQ Operations",
  },
};

const FLOW_ORDER: FlowKey[] = ["franchiseFlow", "hqFlow"];

export default function RoutingWorkflowPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["projects", "operations", "admin"]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<KitRoutingSettings>(() => cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS));
  const [baseline, setBaseline] = useState<KitRoutingSettings>(() => cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS));
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    let isCancelled = false;
    (async () => {
      try {
        setLoading(true);
        setFeedback(null);
        setError(null);
        const { db } = await ensureFirebase();
        if (!db) throw new Error("Firestore is unavailable. Please reload the page.");
        const snap = await getDoc(doc(db, "settings", "kitRouting"));
        const parsed = snap.exists()
          ? parseKitRoutingSettings(snap.data())
          : cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS);
        if (isCancelled) return;
        setDraft(cloneKitRoutingSettings(parsed));
        setBaseline(cloneKitRoutingSettings(parsed));
        setUpdatedAt(parsed.updatedAt ?? null);
      } catch (err: any) {
        console.error("Failed to load kit routing settings", err);
        if (!isCancelled) {
          setError(err?.message || "We couldn't load the current routing workflow. Try again.");
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [allowed, guardLoading]);

  const dirty = useMemo(() => {
    const current = JSON.stringify(sanitiseKitRoutingSettings(draft));
    const original = JSON.stringify(sanitiseKitRoutingSettings(baseline));
    return current !== original;
  }, [baseline, draft]);

  const flowWarnings = useMemo(() => {
    return FLOW_ORDER.map((flowKey) => ({
      flowKey,
      hasActiveStage: draft[flowKey].some((stage) => stage.enabled),
    }));
  }, [draft]);

  const handleDragEnd = (result: DropResult) => {
    const { destination, source } = result;
    if (!destination) return;
    if (destination.droppableId !== source.droppableId) return;
    if (destination.index === source.index) return;
    const flowKey = source.droppableId as FlowKey;
    setDraft((current) => {
      const nextFlow = [...current[flowKey]];
      const [moved] = nextFlow.splice(source.index, 1);
      nextFlow.splice(destination.index, 0, moved);
      return { ...current, [flowKey]: nextFlow };
    });
  };

  const updateStage = (flowKey: FlowKey, index: number, updates: Partial<RoutingStageConfig>) => {
    setDraft((current) => {
      const flow = current[flowKey].map((stage, idx) => (idx === index ? { ...stage, ...updates } : stage));
      return { ...current, [flowKey]: flow };
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setFeedback(null);
      setError(null);
      const { db } = await ensureFirebase();
      if (!db) throw new Error("Firestore is unavailable. Please try again.");
      const payload = sanitiseKitRoutingSettings(draft);
      const timestamp = new Date().toISOString();
      await setDoc(doc(db, "settings", "kitRouting"), { ...payload, updatedAt: timestamp }, { merge: true });
      const parsed = parseKitRoutingSettings({ ...payload, updatedAt: timestamp });
      setBaseline(cloneKitRoutingSettings(parsed));
      setDraft(cloneKitRoutingSettings(parsed));
      setUpdatedAt(timestamp);
      setFeedback({ tone: "success", message: "Routing workflow saved." });
    } catch (err: any) {
      console.error("Failed to save kit routing settings", err);
      setFeedback({ tone: "error", message: err?.message || "We couldn't save your changes. Try again." });
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    if (typeof window !== "undefined" && !window.confirm("Reset routing to the default franchise → HQ order?")) {
      return;
    }
    const defaults = cloneKitRoutingSettings(DEFAULT_KIT_ROUTING_SETTINGS);
    setDraft(defaults);
    setFeedback({ tone: "success", message: "Restored the default routing order." });
  };

  if (guardLoading || loading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to adjust routing logic.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Availability</p>
        <h1 className="text-2xl font-semibold text-slate-900">Routing workflow</h1>
        <p className="text-sm text-slate-600">
          Visualise how kit reservations cascade between franchise teams and HQ, adjust stage order, and decide when bookings
          auto-confirm versus waiting for manual approval.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <AdjustmentsHorizontalIcon className="h-4 w-4" /> Drag stages to reorder the flow
          </span>
          <span className="inline-flex items-center gap-1">
            <ArrowPathIcon className="h-4 w-4" /> Toggle auto-confirm or manual checks per stage
          </span>
        </div>
      </div>

      {feedback ? (
        <div
          className={clsx(
            "rounded-xl border p-4 text-sm",
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900",
          )}
        >
          {feedback.message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div>
      ) : null}

      {flowWarnings.some((warning) => !warning.hasActiveStage) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          At least one routing flow has no enabled stages. Enable a stage or reset to defaults so reservations have a fallback
          path.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn-outline btn-sm" onClick={resetToDefaults} disabled={saving}>
          Reset to defaults
        </button>
        <Link href="/admin/availability" className="btn-ghost btn-sm">
          Back to availability
        </Link>
        {updatedAt ? (
          <span className="text-xs text-slate-500">Last updated {formatTimestamp(updatedAt)}</span>
        ) : (
          <span className="text-xs text-slate-500">Using default workflow</span>
        )}
        {dirty ? <span className="text-xs font-medium text-orange-600">Unsaved changes</span> : null}
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid gap-6 lg:grid-cols-2">
          {FLOW_ORDER.map((flowKey) => (
            <section key={flowKey} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <header className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{FLOW_META[flowKey].title}</h2>
                    <p className="text-sm text-slate-600">{FLOW_META[flowKey].description}</p>
                  </div>
                  <span
                    className={clsx(
                      "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
                      flowWarnings.find((warning) => warning.flowKey === flowKey)?.hasActiveStage
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800",
                    )}
                  >
                    {flowWarnings.find((warning) => warning.flowKey === flowKey)?.hasActiveStage
                      ? "Has active stages"
                      : "No stages enabled"}
                  </span>
                </div>
              </header>
              <Droppable droppableId={flowKey} type="stage">
                {(dropProvided) => (
                  <ol ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="mt-6 space-y-6">
                    {draft[flowKey].map((stage, index) => (
                      <StageCard
                        key={`${flowKey}-${stage.key}`}
                        dragId={`${flowKey}-${stage.key}`}
                        index={index}
                        stage={stage}
                        total={draft[flowKey].length}
                        flowKey={flowKey}
                        coverageExample={FLOW_META[flowKey].coverageExample}
                        updateStage={updateStage}
                      />
                    ))}
                    {dropProvided.placeholder}
                  </ol>
                )}
              </Droppable>
            </section>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}

interface StageCardProps {
  dragId: string;
  stage: RoutingStageConfig;
  index: number;
  total: number;
  flowKey: FlowKey;
  coverageExample: string | null;
  updateStage: (flowKey: FlowKey, index: number, updates: Partial<RoutingStageConfig>) => void;
}

function StageCard({
  dragId,
  stage,
  index,
  total,
  flowKey,
  coverageExample,
  updateStage,
}: StageCardProps) {
  const meta = ROUTING_STAGE_META[stage.key];
  const previewLabel = resolveStageLabel(stage, {
    coverageLabel: coverageExample,
    fallback: meta.defaultLabel,
  });

  return (
    <Draggable draggableId={dragId} index={index}>
      {(dragProvided, dragSnapshot) => (
        <li className="grid grid-cols-[auto_1fr] gap-4">
          <div className="flex flex-col items-center">
            <button
              type="button"
              {...dragProvided.dragHandleProps}
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500",
                dragSnapshot.isDragging
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600",
              )}
              aria-label={`Drag ${meta.name} stage`}
            >
              {index + 1}
            </button>
            {index < total - 1 ? <span className="mt-2 h-full w-px flex-1 bg-slate-200" aria-hidden="true" /> : null}
          </div>
          <div
            ref={dragProvided.innerRef}
            {...dragProvided.draggableProps}
            className={clsx(
              "rounded-2xl border p-5 shadow-sm transition",
              stage.enabled ? "border-slate-200 bg-white" : "border-dashed border-slate-300 bg-slate-50 opacity-75",
              dragSnapshot.isDragging ? "ring-2 ring-blue-500 ring-offset-2" : "",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{meta.name}</p>
                <input
                  type="text"
                  value={stage.label}
                  onChange={(event) => updateStage(flowKey, index, { label: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder={meta.defaultLabel}
                />
                {meta.tokenHint ? <p className="text-xs text-slate-500">{meta.tokenHint}</p> : null}
              </div>
              <span
                className={clsx(
                  "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
                  stage.autoConfirm ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
                )}
              >
                {stage.autoConfirm ? "Auto-confirms" : "Needs confirmation"}
              </span>
            </div>

            <div className="mt-4 space-y-4">
              <textarea
                value={stage.description}
                onChange={(event) => updateStage(flowKey, index, { description: event.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={3}
                placeholder={meta.defaultDescription}
              />

              <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={stage.enabled}
                    onChange={(event) => updateStage(flowKey, index, { enabled: event.target.checked })}
                  />
                  <span>Enable stage</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={stage.requiresKit}
                    onChange={(event) => updateStage(flowKey, index, { requiresKit: event.target.checked })}
                  />
                  <span>Check kit automatically</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={stage.autoConfirm}
                    onChange={(event) => updateStage(flowKey, index, { autoConfirm: event.target.checked })}
                  />
                  <span>Auto-confirm bookings</span>
                </label>
              </div>

              <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-slate-700">Kit scope:</span> {meta.ownerScope}
                </p>
                <p>
                  <span className="font-semibold text-slate-700">Preview label:</span> {previewLabel}
                </p>
                <p className="sm:col-span-2">{meta.summary}</p>
              </div>
            </div>
          </div>
        </li>
      )}
    </Draggable>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString(undefined, { dateStyle: "medium" })} ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
