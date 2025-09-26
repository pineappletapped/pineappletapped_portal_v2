"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

const PRIORITY_OPTIONS = [
  { value: "awareness", label: "Awareness" },
  { value: "engagement", label: "Engagement" },
  { value: "conversion", label: "Conversion" },
  { value: "mixed", label: "Full funnel" },
];

const REQUEST_STATUS_OPTIONS = [
  "requested",
  "researching",
  "quoted",
  "scheduled",
  "completed",
  "rejected",
];

const NARRATIVE_STATUS_OPTIONS = ["queued", "analysing", "ready", "failed"];

const DEFAULT_TEMPLATE_IDS = new Set([
  "thought-leadership-blitz",
  "product-launch-runway",
  "always-on-social-sprints",
]);

const FALLBACK_TEMPLATES: PlannerTemplate[] = [
  {
    id: "thought-leadership-blitz",
    label: "Thought leadership blitz",
    deliverables: "2x Blog posts, Webinar deck, Executive LinkedIn kit",
    budget: "4200",
    priority: "awareness",
    productIds: [],
    aiPrompt: null,
  },
  {
    id: "product-launch-runway",
    label: "Product launch runway",
    deliverables: "Launch video, Landing page copy, Email nurture (3), Paid social set",
    budget: "6100",
    priority: "conversion",
    productIds: [],
    aiPrompt: null,
  },
  {
    id: "always-on-social-sprints",
    label: "Always-on social sprints",
    deliverables: "4x Reels/TikToks, 12x Social captions, Influencer outreach",
    budget: "3600",
    priority: "engagement",
    productIds: [],
    aiPrompt: null,
  },
];

type PlannerTemplate = {
  id: string;
  label: string;
  deliverables: string;
  budget: string;
  priority: string;
  productIds: string[];
  aiPrompt?: string | null;
};

type ProductSummary = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
};

type ContentPlanRequestDoc = {
  id: string;
  userId: string | null;
  status: string;
  month: string | null;
  theme: string | null;
  deliverables: string | null;
  budget: number | null;
  priority: string | null;
  productIds: string[];
  note: string | null;
  adminNotes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  templateId: string | null;
};

type ContentPlanNarrativeDoc = {
  id: string;
  userId: string | null;
  status: string;
  narrative: string | null;
  storyBeats: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
};

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function normaliseTemplates(value: unknown): PlannerTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const templates: PlannerTemplate[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const data = entry as Record<string, unknown>;
    const id = typeof data.id === "string" && data.id ? data.id : randomId();
    const label = typeof data.label === "string" && data.label.trim() ? data.label.trim() : id;
    const deliverables = typeof data.deliverables === "string" ? data.deliverables : "";
    const budgetValue = data.budget;
    const budget = typeof budgetValue === "number" ? String(budgetValue) : typeof budgetValue === "string" ? budgetValue : "";
    const priority = typeof data.priority === "string" ? data.priority.toLowerCase() : "mixed";
    const productIds = Array.isArray(data.productIds)
      ? data.productIds.filter((item): item is string => typeof item === "string")
      : [];
    const aiPrompt = typeof data.aiPrompt === "string" ? data.aiPrompt : null;
    templates.push({ id, label, deliverables, budget, priority, productIds, aiPrompt });
  });
  return templates;
}

export default function ContentPlannerManager() {
  const [templates, setTemplates] = useState<PlannerTemplate[]>([]);
  const [initialTemplates, setInitialTemplates] = useState<PlannerTemplate[]>([]);
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [requests, setRequests] = useState<ContentPlanRequestDoc[]>([]);
  const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});
  const [requestStatuses, setRequestStatuses] = useState<Record<string, string>>({});
  const [updatingRequest, setUpdatingRequest] = useState<string | null>(null);
  const [narratives, setNarratives] = useState<ContentPlanNarrativeDoc[]>([]);
  const [narrativeStatusEdits, setNarrativeStatusEdits] = useState<Record<string, string>>({});
  const [updatingNarrative, setUpdatingNarrative] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (templates.length !== initialTemplates.length) return true;
    const serialise = (items: PlannerTemplate[]) =>
      items
        .map((item) =>
          JSON.stringify({
            ...item,
            productIds: [...item.productIds].sort(),
          })
        )
        .sort()
        .join("|");
    return serialise(templates) !== serialise(initialTemplates);
  }, [initialTemplates, templates]);

  useEffect(() => {
    const ref = doc(db, "contentPlanPresets", "global");
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          const fallback = FALLBACK_TEMPLATES.map((template) => ({
            ...template,
            productIds: [...template.productIds],
          }));
          setTemplates(fallback);
          setInitialTemplates(fallback);
          return;
        }
        const data = snapshot.data() as DocumentData;
        const parsed = normaliseTemplates(data.templates);
        const nextTemplates = (parsed.length > 0 ? parsed : FALLBACK_TEMPLATES).map((template) => ({
          ...template,
          productIds: [...template.productIds],
        }));
        setTemplates(nextTemplates);
        setInitialTemplates(nextTemplates);
      },
      (error) => {
        console.warn("Failed to load content plan templates", error);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "products"));
        if (!active) return;
        const list: ProductSummary[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          const priceCandidate = (
            (typeof data.price === "number" && data.price) ||
            (typeof data.basePrice === "number" && data.basePrice) ||
            (typeof data.startingPrice === "number" && data.startingPrice) ||
            null
          );
          return {
            id: docSnap.id,
            name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled product",
            category: typeof data.category === "string" ? data.category : null,
            price: priceCandidate,
          };
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
      } catch (error) {
        console.warn("Failed to load products", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const q = query(collection(db, "contentPlanRequests"), orderBy("createdAt", "desc"), limit(50));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ContentPlanRequestDoc[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const createdAt = data.createdAt?.toDate?.() ?? null;
          const updatedAt = data.updatedAt?.toDate?.() ?? createdAt;
          return {
            id: docSnap.id,
            userId: typeof data.userId === "string" ? data.userId : null,
            status: typeof data.status === "string" ? data.status : "requested",
            month: typeof data.month === "string" ? data.month : null,
            theme: typeof data.theme === "string" ? data.theme : null,
            deliverables: typeof data.deliverables === "string" ? data.deliverables : null,
            budget: typeof data.budget === "number" ? data.budget : null,
            priority: typeof data.priority === "string" ? data.priority : null,
            productIds: Array.isArray(data.productIds)
              ? data.productIds.filter((item: unknown): item is string => typeof item === "string")
              : [],
            note: typeof data.note === "string" ? data.note : null,
            adminNotes: typeof data.adminNotes === "string" ? data.adminNotes : null,
            createdAt,
            updatedAt,
            templateId: typeof data.templateId === "string" ? data.templateId : null,
          };
        });
        setRequests(list);
      },
      (error) => {
        console.warn("Failed to load planner requests", error);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "contentPlanNarratives"), orderBy("createdAt", "desc"), limit(20));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ContentPlanNarrativeDoc[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const createdAt = data.createdAt?.toDate?.() ?? null;
          const updatedAt = data.updatedAt?.toDate?.() ?? createdAt;
          return {
            id: docSnap.id,
            userId: typeof data.userId === "string" ? data.userId : null,
            status: typeof data.status === "string" ? data.status : "queued",
            narrative: typeof data.narrative === "string" ? data.narrative : null,
            storyBeats: Array.isArray(data.storyBeats)
              ? data.storyBeats.filter((item: unknown): item is string => typeof item === "string")
              : [],
            createdAt,
            updatedAt,
          };
        });
        setNarratives(list);
      },
      (error) => {
        console.warn("Failed to load planner narratives", error);
      }
    );
    return () => unsubscribe();
  }, []);

  const saveTemplates = async () => {
    setSavingTemplates(true);
    try {
      const ref = doc(db, "contentPlanPresets", "global");
      await setDoc(
        ref,
        {
          templates: templates.map((template) => ({
            id: template.id,
            label: template.label,
            deliverables: template.deliverables,
            budget: template.budget,
            priority: template.priority,
            productIds: template.productIds,
            aiPrompt: template.aiPrompt ?? null,
          })),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Failed to save templates", error);
    } finally {
      setSavingTemplates(false);
    }
  };

  const addTemplate = () => {
    const identifier = randomId();
    setTemplates((prev) => [
      ...prev,
      {
        id: identifier,
        label: "New campaign",
        deliverables: "",
        budget: "",
        priority: "mixed",
        productIds: [],
        aiPrompt: null,
      },
    ]);
  };

  const updateTemplate = (id: string, key: keyof PlannerTemplate, value: string | string[] | null) => {
    setTemplates((prev) =>
      prev.map((template) =>
        template.id === id
          ? {
              ...template,
              [key]: key === "productIds" && Array.isArray(value)
                ? value
                : key === "aiPrompt"
                ? value
                : typeof value === "string"
                ? value
                : template[key],
            }
          : template
      )
    );
  };

  const removeTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((template) => template.id !== id));
  };

  const productOptions = useMemo(() => products, [products]);

  const handleRequestUpdate = async (request: ContentPlanRequestDoc) => {
    setUpdatingRequest(request.id);
    try {
      const ref = doc(db, "contentPlanRequests", request.id);
      await updateDoc(ref, {
        status: requestStatuses[request.id] || request.status,
        adminNotes: requestNotes[request.id] ?? request.adminNotes ?? null,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update request", error);
    } finally {
      setUpdatingRequest(null);
    }
  };

  const handleNarrativeUpdate = async (narrative: ContentPlanNarrativeDoc) => {
    setUpdatingNarrative(narrative.id);
    try {
      const ref = doc(db, "contentPlanNarratives", narrative.id);
      const status = narrativeStatusEdits[narrative.id] || narrative.status;
      await updateDoc(ref, {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Failed to update narrative", error);
    } finally {
      setUpdatingNarrative(null);
    }
  };

  return (
    <div className="grid gap-6">
      <section className="card border p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Planner templates</h2>
            <p className="text-sm text-gray-600">
              Update the pre-built campaign recipes that appear in the client portal planner. Tie each template to active products
              and provide AI prompts to shape storyboards.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-xs" onClick={addTemplate}>
              Add template
            </button>
            <button type="button" className="btn-xs btn-primary" onClick={saveTemplates} disabled={!isDirty || savingTemplates}>
              {savingTemplates ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
        {templates.length === 0 ? (
          <p className="text-sm text-gray-500">No templates configured yet. Add your first to get started.</p>
        ) : (
          <div className="grid gap-4">
            {templates.map((template, index) => (
              <div key={template.id} className="rounded border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Template {index + 1}</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>ID: {template.id}</span>
                    {!DEFAULT_TEMPLATE_IDS.has(template.id) ? (
                      <button type="button" className="text-red-600" onClick={() => removeTemplate(template.id)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Label</span>
                    <input
                      className="input"
                      value={template.label}
                      onChange={(event) => updateTemplate(template.id, "label", event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Budget hint ($)</span>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="100"
                      value={template.budget}
                      onChange={(event) => updateTemplate(template.id, "budget", event.target.value)}
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Deliverables</span>
                  <textarea
                    className="input min-h-[80px]"
                    value={template.deliverables}
                    onChange={(event) => updateTemplate(template.id, "deliverables", event.target.value)}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Priority</span>
                    <select
                      className="input"
                      value={template.priority}
                      onChange={(event) => updateTemplate(template.id, "priority", event.target.value)}
                    >
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">Linked products</span>
                    <select
                      className="input"
                      value=""
                      onChange={(event) => {
                        const productId = event.target.value;
                        if (!productId) return;
                        updateTemplate(template.id, "productIds", [
                          ...template.productIds.filter((id) => id !== productId),
                          productId,
                        ]);
                      }}
                    >
                      <option value="">Add product…</option>
                      {productOptions.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {template.productIds.length === 0 ? (
                    <span className="text-gray-400">No products attached</span>
                  ) : (
                    template.productIds.map((productId) => {
                      const product = productOptions.find((item) => item.id === productId);
                      return (
                        <span key={productId} className="inline-flex items-center gap-2 rounded bg-gray-100 px-2 py-1">
                          {product ? (
                            <Link href={`/products/${product.id}`} className="hover:underline">
                              {product.name}
                            </Link>
                          ) : (
                            <span>{productId}</span>
                          )}
                          <button
                            type="button"
                            aria-label="Remove product"
                            onClick={() =>
                              updateTemplate(
                                template.id,
                                "productIds",
                                template.productIds.filter((id) => id !== productId)
                              )
                            }
                            className="text-gray-500 hover:text-gray-700"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })
                  )}
                </div>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">AI storyboard prompt</span>
                  <textarea
                    className="input min-h-[60px]"
                    value={template.aiPrompt ?? ""}
                    onChange={(event) => updateTemplate(template.id, "aiPrompt", event.target.value)}
                    placeholder="Optional: provide additional guidance for narrative generation"
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Custom idea requests</h2>
          <p className="text-sm text-gray-600">
            Review bespoke briefs raised from the client portal and keep statuses aligned with quoting workflows.
          </p>
        </div>
        {requests.length === 0 ? (
          <p className="text-sm text-gray-500">No open requests yet.</p>
        ) : (
          <div className="grid gap-4">
            {requests.map((request) => (
              <div key={request.id} className="rounded border p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                  <span>Request ID: {request.id}</span>
                  {request.userId ? <span>User: {request.userId}</span> : null}
                  {request.createdAt ? <span>Created: {request.createdAt.toLocaleString()}</span> : null}
                </div>
                <div className="grid gap-2 text-sm">
                  <p className="font-medium">{request.month || "Unscheduled"}</p>
                  {request.theme ? <p className="text-gray-600">{request.theme}</p> : null}
                  {request.deliverables ? (
                    <p className="text-xs text-gray-500">Deliverables: {request.deliverables}</p>
                  ) : null}
                  {request.budget ? (
                    <p className="text-xs text-gray-500">Budget hint: ${request.budget.toLocaleString()}</p>
                  ) : null}
                  {request.note ? <p className="text-xs text-gray-500">Client brief: {request.note}</p> : null}
                  {request.templateId ? (
                    <p className="text-xs text-gray-400">Origin template: {request.templateId}</p>
                  ) : null}
                  {request.productIds.length > 0 ? (
                    <p className="text-xs text-gray-500">
                      Products: {request.productIds.join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="font-medium text-xs">Status</span>
                    <select
                      className="input"
                      value={requestStatuses[request.id] || request.status}
                      onChange={(event) =>
                        setRequestStatuses((prev) => ({ ...prev, [request.id]: event.target.value }))
                      }
                    >
                      {REQUEST_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="font-medium text-xs">Internal notes</span>
                    <textarea
                      className="input min-h-[60px]"
                      value={requestNotes[request.id] ?? request.adminNotes ?? ""}
                      onChange={(event) =>
                        setRequestNotes((prev) => ({ ...prev, [request.id]: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-xs"
                  onClick={() => handleRequestUpdate(request)}
                  disabled={updatingRequest === request.id}
                >
                  {updatingRequest === request.id ? "Updating…" : "Update request"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card border p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">AI narrative queue</h2>
          <p className="text-sm text-gray-600">
            Track and triage storyboard drafts generated from the planner. Update statuses once the editorial team has reviewed or
            refined the output.
          </p>
        </div>
        {narratives.length === 0 ? (
          <p className="text-sm text-gray-500">No narrative drafts yet.</p>
        ) : (
          <div className="grid gap-4">
            {narratives.map((narrative) => (
              <div key={narrative.id} className="rounded border p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                  <span>Narrative ID: {narrative.id}</span>
                  {narrative.userId ? <span>User: {narrative.userId}</span> : null}
                  {narrative.createdAt ? <span>Created: {narrative.createdAt.toLocaleString()}</span> : null}
                </div>
                {narrative.narrative ? (
                  <p className="text-sm text-gray-700">{narrative.narrative}</p>
                ) : (
                  <p className="text-xs text-gray-500">Waiting for narrative content.</p>
                )}
                {narrative.storyBeats.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-gray-500 space-y-1">
                    {narrative.storyBeats.map((beat) => (
                      <li key={beat}>{beat}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="font-medium text-xs">Status</span>
                    <select
                      className="input"
                      value={narrativeStatusEdits[narrative.id] || narrative.status}
                      onChange={(event) =>
                        setNarrativeStatusEdits((prev) => ({ ...prev, [narrative.id]: event.target.value }))
                      }
                    >
                      {NARRATIVE_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-1">
                    <span className="font-medium text-xs">Last updated</span>
                    <span className="text-xs text-gray-500">
                      {narrative.updatedAt ? narrative.updatedAt.toLocaleString() : "—"}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-xs"
                  onClick={() => handleNarrativeUpdate(narrative)}
                  disabled={updatingNarrative === narrative.id}
                >
                  {updatingNarrative === narrative.id ? "Updating…" : "Update narrative"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
