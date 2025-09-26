"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";

interface RemarketingCampaign {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  targetGroups: string[];
  targetTags: string[];
  highlightProductId?: string | null;
  highlightProductName?: string | null;
  emailSubject?: string | null;
  emailPreview?: string | null;
  monthlySendDay?: number | null;
  lastRunAt?: Timestamp | null;
  nextRunAt?: Timestamp | null;
  lastRunSummary?: {
    processed?: number;
    suggestionsCreated?: number;
    monthKey?: string;
  } | null;
}

type RemarketingCampaignDoc = Omit<RemarketingCampaign, "id"> & Partial<Pick<RemarketingCampaign, "id">>;

interface RemarketingSuggestion {
  id: string;
  campaignId?: string;
  status: string;
  headline?: string | null;
  summary?: string | null;
  highlightProduct?: { id?: string | null; name?: string | null } | null;
  articleDraft?: string | null;
  emailSubject?: string | null;
  createdAt?: Timestamp | null;
  researchStatus?: string | null;
  targetClientId?: string | null;
  targetOrgIds?: string[] | null;
  campaignName?: string | null;
  emailOpenCount?: number | null;
  emailClickCount?: number | null;
  emailClickUrls?: Array<{ url?: string | null; count?: number | null }> | string[] | null;
  emailLastOpenedAt?: Timestamp | null;
  emailLastClickedAt?: Timestamp | null;
  emailSentAt?: Timestamp | null;
}

type RemarketingSuggestionDoc = Omit<RemarketingSuggestion, "id"> & Partial<Pick<RemarketingSuggestion, "id">>;

interface ProductSummary {
  id: string;
  name: string;
}

interface RemarketingQueueEntry {
  id: string;
  suggestionId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  clientId?: string | null;
  status?: string | null;
  scope?: string | null;
  monthKey?: string | null;
  emailSubject?: string | null;
  emailPreview?: string | null;
  audienceEmailsCount?: number | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastError?: string | null;
  lastAttemptAt?: Timestamp | null;
}

interface RemarketingEmailRecord {
  id: string;
  suggestionId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  headline?: string | null;
  summary?: string | null;
  emailSubject?: string | null;
  emailPreview?: string | null;
  status?: string | null;
  emailOpenCount?: number | null;
  emailClickCount?: number | null;
  emailClickUrls?: Array<{ url?: string | null; count?: number | null }> | string[] | null;
  emailLastOpenedAt?: Timestamp | null;
  emailLastClickedAt?: Timestamp | null;
  emailSentAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  targetClientId?: string | null;
  targetOrgIds?: string[] | null;
}

const GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: "clients", label: "Clients" },
  { value: "prospects", label: "Prospects" },
  { value: "lists", label: "Marketing Lists" },
];

const MAX_TAGS = 10;

function normaliseTagInput(input: string): string[] {
  const raw = input
    .split(/[\n,]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const unique = Array.from(new Set(raw));
  return unique.slice(0, MAX_TAGS);
}

function formatTimestamp(ts?: Timestamp | null): string {
  if (!ts) return "—";
  try {
    const date = ts.toDate();
    return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch (err) {
    return "—";
  }
}

function computeNextRunTimestamp(sendDay: number): Timestamp {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 9, 0, 0));
  base.setUTCMonth(base.getUTCMonth() + 1);
  const nextMonth = base.getUTCMonth();
  const nextYear = base.getUTCFullYear();
  const daysInMonth = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(1, Math.floor(sendDay || 1)), daysInMonth);
  base.setUTCDate(safeDay);
  return Timestamp.fromDate(base);
}

interface CampaignFormState {
  name: string;
  description: string;
  targetGroups: string[];
  tagInput: string;
  highlightProductId: string;
  emailSubject: string;
  emailPreview: string;
  monthlySendDay: number;
}

const INITIAL_FORM: CampaignFormState = {
  name: "",
  description: "",
  targetGroups: ["clients"],
  tagInput: "",
  highlightProductId: "",
  emailSubject: "",
  emailPreview: "",
  monthlySendDay: 1,
};

export default function RemarketingManager() {
  const { allowed, loading: guardLoading } = useRoleGate(["marketing", "admin"]);
  const [campaigns, setCampaigns] = useState<RemarketingCampaign[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [form, setForm] = useState<CampaignFormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<RemarketingSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [queueItems, setQueueItems] = useState<RemarketingQueueEntry[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [historyItems, setHistoryItems] = useState<RemarketingEmailRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [outboxTab, setOutboxTab] = useState<"queue" | "sent">("queue");
  const [queueSearch, setQueueSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  useEffect(() => {
    if (guardLoading || !allowed) return;
    const campaignsQuery = query(collection(db, "remarketingCampaigns"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(campaignsQuery, (snapshot) => {
      const nextCampaigns: RemarketingCampaign[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as RemarketingCampaignDoc | undefined;
        const { id: dataId, ...rest } = data ?? ({} as RemarketingCampaignDoc);
        return {
          ...rest,
          id: dataId ?? docSnap.id,
        } as RemarketingCampaign;
      });
      setCampaigns(nextCampaigns);
      setSelectedCampaignId((current) => {
        if (current) return current;
        return nextCampaigns.length > 0 ? nextCampaigns[0].id : null;
      });
    });
    return () => unsubscribe();
  }, [allowed, guardLoading]);

  useEffect(() => {
    if (guardLoading || !allowed) return;
    (async () => {
      try {
        const productSnap = await getDocs(query(collection(db, "products"), orderBy("name"), limit(100)));
        setProducts(
          productSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            name: ((docSnap.data() as any).name as string) || "Untitled Product",
          }))
        );
      } catch (err) {
        console.warn("Failed to load products for remarketing manager", err);
      }
    })();
  }, [allowed, guardLoading]);

  useEffect(() => {
    if (!selectedCampaignId || guardLoading || !allowed) {
      setSuggestions([]);
      return;
    }
    setSuggestionsLoading(true);
    const suggestionQuery = query(
      collection(db, "remarketingSuggestions"),
      where("campaignId", "==", selectedCampaignId),
      orderBy("createdAt", "desc"),
      limit(25)
    );
    const unsubscribe = onSnapshot(suggestionQuery, (snapshot) => {
      const filtered: RemarketingSuggestion[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as RemarketingSuggestionDoc | undefined;
        const { id: dataId, ...rest } = data ?? ({} as RemarketingSuggestionDoc);
        return {
          ...rest,
          id: dataId ?? docSnap.id,
        } as RemarketingSuggestion;
      });
      setSuggestions(filtered);
      setSuggestionsLoading(false);
    });
    return () => unsubscribe();
  }, [selectedCampaignId, allowed, guardLoading]);

  useEffect(() => {
    if (guardLoading || !allowed) {
      return;
    }
    setQueueLoading(true);
    const queueQuery = query(
      collection(db, "remarketingQueue"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const unsubscribe = onSnapshot(
      queueQuery,
      (snapshot) => {
        const nextItems: RemarketingQueueEntry[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            suggestionId: data.suggestionId ?? null,
            campaignId: data.campaignId ?? null,
            campaignName: data.campaignName ?? null,
            clientId: data.clientId ?? null,
            status: data.status ?? null,
            scope: data.scope ?? null,
            monthKey: data.monthKey ?? null,
            emailSubject: data.emailSubject ?? null,
            emailPreview: data.emailPreview ?? null,
            audienceEmailsCount:
              typeof data.audienceEmailsCount === "number" ? data.audienceEmailsCount : null,
            createdAt: data.createdAt ?? null,
            updatedAt: data.updatedAt ?? null,
            lastError: data.lastError ?? null,
            lastAttemptAt: data.lastAttemptAt ?? null,
          };
        });
        setQueueItems(nextItems);
        setQueueLoading(false);
      },
      (error) => {
        console.error("Failed to load remarketing queue", error);
        setQueueLoading(false);
      }
    );
    return () => unsubscribe();
  }, [allowed, guardLoading]);

  useEffect(() => {
    if (guardLoading || !allowed) {
      return;
    }
    setHistoryLoading(true);
    const historyQuery = query(
      collection(db, "remarketingSuggestions"),
      where("status", "==", "sent"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    const unsubscribe = onSnapshot(
      historyQuery,
      (snapshot) => {
        const nextItems: RemarketingEmailRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            suggestionId: docSnap.id,
            campaignId: data.campaignId ?? null,
            campaignName: data.campaignName ?? null,
            headline: data.headline ?? null,
            summary: data.summary ?? null,
            emailSubject: data.emailSubject ?? null,
            emailPreview: data.emailPreview ?? null,
            status: data.status ?? null,
            emailOpenCount: typeof data.emailOpenCount === "number" ? data.emailOpenCount : null,
            emailClickCount:
              typeof data.emailClickCount === "number" ? data.emailClickCount : null,
            emailClickUrls: Array.isArray(data.emailClickUrls) ? data.emailClickUrls : null,
            emailLastOpenedAt: data.emailLastOpenedAt ?? null,
            emailLastClickedAt: data.emailLastClickedAt ?? null,
            emailSentAt: data.emailSentAt ?? null,
            createdAt: data.createdAt ?? null,
            updatedAt: data.updatedAt ?? null,
            targetClientId: data.targetClientId ?? null,
            targetOrgIds: Array.isArray(data.targetOrgIds) ? data.targetOrgIds : null,
          };
        });
        setHistoryItems(nextItems);
        setHistoryLoading(false);
      },
      (error) => {
        console.error("Failed to load remarketing email history", error);
        setHistoryLoading(false);
      }
    );
    return () => unsubscribe();
  }, [allowed, guardLoading]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId]
  );

  const filteredQueue = useMemo(() => {
    const search = queueSearch.trim().toLowerCase();
    const source = queueItems;
    if (!search) {
      return source;
    }
    return source.filter((item) => {
      const haystack = [
        item.emailSubject,
        item.emailPreview,
        item.campaignName,
        item.campaignId,
        item.status,
        item.monthKey,
        item.clientId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [queueItems, queueSearch]);

  const filteredHistory = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    const source = historyItems;
    if (!search) {
      return source;
    }
    return source.filter((item) => {
      const haystack = [
        item.emailSubject,
        item.summary,
        item.headline,
        item.campaignName,
        item.campaignId,
        item.status,
        item.targetClientId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [historyItems, historySearch]);

  if (guardLoading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view remarketing settings.</p>;

  const handleChange = <K extends keyof CampaignFormState>(key: K, value: CampaignFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError("Campaign name is required.");
      return;
    }
    const tags = normaliseTagInput(form.tagInput);
    const product = products.find((p) => p.id === form.highlightProductId);
    const nextRun = computeNextRunTimestamp(form.monthlySendDay || 1);
    setSaving(true);
    try {
      await addDoc(collection(db, "remarketingCampaigns"), {
        name: trimmedName,
        description: form.description.trim() || null,
        active: true,
        targetGroups: form.targetGroups,
        targetTags: tags,
        highlightProductId: form.highlightProductId || null,
        highlightProductName: product?.name ?? null,
        emailSubject: form.emailSubject.trim() || null,
        emailPreview: form.emailPreview.trim() || null,
        monthlySendDay: Math.max(1, Math.min(28, Math.floor(form.monthlySendDay || 1))),
        lastRunAt: null,
        nextRunAt: nextRun,
        lastRunSummary: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setForm(INITIAL_FORM);
    } catch (err) {
      console.error("Failed to create remarketing campaign", err);
      setError("Failed to create campaign. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleCampaignActive = async (campaign: RemarketingCampaign) => {
    try {
      await updateDoc(doc(db, "remarketingCampaigns", campaign.id), {
        active: !campaign.active,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to toggle campaign", campaign.id, err);
    }
  };

  const deleteCampaign = async (campaign: RemarketingCampaign) => {
    const confirmDelete = window.confirm(
      `Delete campaign “${campaign.name}”? Previous suggestions will be retained.`
    );
    if (!confirmDelete) return;
    try {
      await deleteDoc(doc(db, "remarketingCampaigns", campaign.id));
      if (selectedCampaignId === campaign.id) {
        setSelectedCampaignId(null);
      }
    } catch (err) {
      console.error("Failed to delete campaign", campaign.id, err);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Remarketing Automation</h1>
        <p className="text-sm text-slate-600">
          Configure the monthly Gemini-assisted follow-up sweep that drafts suggested projects, emails,
          and portal cards for engaged clients and prospects.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-4 space-y-4">
          <h2 className="text-lg font-medium">Create Campaign</h2>
          <p className="text-sm text-slate-600">
            Choose audiences and an anchor product. The cron job will generate follow-up ideas each month
            and surface them to both the CRM and client portal.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium">Campaign Name</label>
              <input
                type="text"
                className="input input-bordered w-full mt-1"
                value={form.name}
                onChange={(event) => handleChange("name", event.target.value)}
                placeholder="Q1 Prospect Nurture"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Internal Notes</label>
              <textarea
                className="textarea textarea-bordered w-full mt-1"
                value={form.description}
                onChange={(event) => handleChange("description", event.target.value)}
                placeholder="Focus on highlighting video retainers and retarget dormant clients."
                rows={3}
              />
            </div>
            <div>
              <span className="block text-sm font-medium">Target Groups</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {GROUP_OPTIONS.map((option) => {
                  const checked = form.targetGroups.includes(option.value);
                  return (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={checked}
                        onChange={(event) => {
                          const next = new Set(form.targetGroups);
                          if (event.target.checked) {
                            next.add(option.value);
                          } else {
                            next.delete(option.value);
                          }
                          if (next.size === 0) {
                            next.add("clients");
                          }
                          handleChange("targetGroups", Array.from(next));
                        }}
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Tag Filters</label>
              <textarea
                className="textarea textarea-bordered w-full mt-1"
                value={form.tagInput}
                onChange={(event) => handleChange("tagInput", event.target.value)}
                placeholder="Enter tags, segments or list codes (comma or newline separated)"
                rows={2}
              />
              <p className="text-xs text-slate-500 mt-1">
                Leave blank to include everyone in the selected groups. Up to {MAX_TAGS} tags supported.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium">Anchor Product</label>
              <select
                className="select select-bordered w-full mt-1"
                value={form.highlightProductId}
                onChange={(event) => handleChange("highlightProductId", event.target.value)}
              >
                <option value="">Select a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Email Subject (optional)</label>
              <input
                type="text"
                className="input input-bordered w-full mt-1"
                value={form.emailSubject}
                onChange={(event) => handleChange("emailSubject", event.target.value)}
                placeholder="Fresh campaign idea for you"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Email Preview Line (optional)</label>
              <input
                type="text"
                className="input input-bordered w-full mt-1"
                value={form.emailPreview}
                onChange={(event) => handleChange("emailPreview", event.target.value)}
                placeholder="We mapped a project that ties directly to your goals."
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Send Day</label>
              <input
                type="number"
                min={1}
                max={28}
                className="input input-bordered w-full mt-1"
                value={form.monthlySendDay}
                onChange={(event) => handleChange("monthlySendDay", Number(event.target.value) || 1)}
              />
              <p className="text-xs text-slate-500 mt-1">
                Recurring on this day each month (UTC). The automation prepares drafts at 09:00.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" className="btn btn-primary w-full" disabled={saving}>
              {saving ? "Creating…" : "Create Campaign"}
            </button>
          </form>
        </section>

        <div className="space-y-6 lg:col-span-2">
          <section className="card p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-medium">Remarketing Campaigns</h2>
              <span className="text-xs text-slate-500">{campaigns.length} configured</span>
            </div>
            {campaigns.length === 0 ? (
              <p className="text-sm text-slate-600">No remarketing campaigns yet. Create your first one to begin.</p>
            ) : (
              <div className="space-y-3">
                {campaigns.map((campaign) => {
                  const isSelected = selectedCampaignId === campaign.id;
                  return (
                    <article
                      key={campaign.id}
                      className={`border rounded-lg p-4 transition ${
                        isSelected ? "border-orange-400 bg-orange-50" : "border-slate-200 bg-white hover:border-orange-300"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-1">
                          <button
                            type="button"
                            className="text-left"
                            onClick={() => setSelectedCampaignId(campaign.id)}
                          >
                            <h3 className="font-semibold text-slate-900">{campaign.name}</h3>
                            {campaign.description && (
                              <p className="text-sm text-slate-600">{campaign.description}</p>
                            )}
                          </button>
                          <p className="text-xs text-slate-500">
                            {campaign.targetGroups.length > 0 ? campaign.targetGroups.join(", ") : "All contacts"}
                            {campaign.targetTags?.length ? ` • tags: ${campaign.targetTags.join(", ")}` : ""}
                          </p>
                          <p className="text-xs text-slate-500">
                            Next run: {formatTimestamp(campaign.nextRunAt ?? null)} • Last run: {formatTimestamp(campaign.lastRunAt ?? null)}
                          </p>
                          {campaign.lastRunSummary && (
                            <p className="text-xs text-slate-500">
                              Processed {campaign.lastRunSummary.processed ?? 0} contacts → {campaign.lastRunSummary.suggestionsCreated ?? 0} suggestions
                              {campaign.lastRunSummary.monthKey ? ` (${campaign.lastRunSummary.monthKey})` : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              campaign.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {campaign.active ? "Active" : "Paused"}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="btn btn-xs"
                              onClick={() => toggleCampaignActive(campaign)}
                            >
                              {campaign.active ? "Pause" : "Resume"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost text-red-500"
                              onClick={() => deleteCampaign(campaign)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {selectedCampaign && (
            <section className="card p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-medium">Recent Suggestions</h2>
                <span className="text-xs text-slate-500">
                  {suggestionsLoading ? "Loading…" : `${suggestions.length} shown`}
                </span>
              </div>
              {suggestions.length === 0 ? (
                <p className="text-sm text-slate-600">No suggestions generated for this campaign yet.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {suggestions.map((suggestion) => (
                    <article key={suggestion.id} className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-medium uppercase tracking-wide">{suggestion.status || "draft"}</span>
                        <span>{formatTimestamp(suggestion.createdAt ?? null)}</span>
                      </div>
                      <h3 className="font-semibold text-slate-900 text-sm">
                        {suggestion.headline || suggestion.summary || "Untitled suggestion"}
                      </h3>
                      {suggestion.summary && (
                        <p className="text-sm text-slate-600 line-clamp-4">{suggestion.summary}</p>
                      )}
                      {suggestion.highlightProduct?.name && (
                        <p className="text-xs text-slate-500">Product: {suggestion.highlightProduct.name}</p>
                      )}
                      <p className="text-xs text-slate-500">
                        Research: {suggestion.researchStatus || "pending"}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <section className="card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Remarketing Email Outbox</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`btn btn-xs sm:btn-sm ${
                outboxTab === "queue" ? "btn-primary" : "btn-ghost"
              }`}
              onClick={() => setOutboxTab("queue")}
            >
              Queue ({queueItems.length})
            </button>
            <button
              type="button"
              className={`btn btn-xs sm:btn-sm ${
                outboxTab === "sent" ? "btn-primary" : "btn-ghost"
              }`}
              onClick={() => setOutboxTab("sent")}
            >
              Sent ({historyItems.length})
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600 sm:max-w-2xl">
            Monitor queued remarketing emails to prevent spikes and audit delivered outreach with
            open and click activity for compliance.
          </p>
          <input
            type="search"
            className="input input-bordered w-full sm:w-64"
            placeholder={outboxTab === "queue" ? "Search queued emails…" : "Search sent emails…"}
            value={outboxTab === "queue" ? queueSearch : historySearch}
            onChange={(event) =>
              outboxTab === "queue"
                ? setQueueSearch(event.target.value)
                : setHistorySearch(event.target.value)
            }
          />
        </div>
        {outboxTab === "queue" ? (
          queueLoading ? (
            <p className="text-sm text-slate-600">Loading queue…</p>
          ) : filteredQueue.length === 0 ? (
            <p className="text-sm text-slate-600">No remarketing emails are currently queued.</p>
          ) : (
            <div className="space-y-3">
              {filteredQueue.map((item) => {
                const matchesSelection =
                  !!selectedCampaignId && item.campaignId === selectedCampaignId;
                return (
                  <article
                    key={item.id}
                    className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-medium uppercase tracking-wide">
                        {item.status || "pending"}
                      </span>
                      <span>{`Queued ${formatTimestamp(item.createdAt ?? null)}`}</span>
                    </div>
                    <h3 className="font-semibold text-slate-900 text-sm">
                      {item.emailSubject || "Draft follow-up email"}
                    </h3>
                    {item.emailPreview && (
                      <p className="text-sm text-slate-600 line-clamp-3">{item.emailPreview}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      {item.campaignName && <span>Campaign: {item.campaignName}</span>}
                      {item.monthKey && <span>Period: {item.monthKey}</span>}
                      {typeof item.audienceEmailsCount === "number" && (
                        <span>Audience emails: {item.audienceEmailsCount}</span>
                      )}
                      {matchesSelection && (
                        <span className="text-orange-600 font-medium">Selected campaign</span>
                      )}
                    </div>
                    {(item.updatedAt || item.lastAttemptAt) && (
                      <p className="text-xs text-slate-500">
                        Last touched {formatTimestamp(item.updatedAt ?? item.lastAttemptAt ?? null)}
                      </p>
                    )}
                    {item.lastError && (
                      <p className="text-xs text-red-600">Last error: {item.lastError}</p>
                    )}
                  </article>
                );
              })}
            </div>
          )
        ) : historyLoading ? (
          <p className="text-sm text-slate-600">Loading sent email history…</p>
        ) : filteredHistory.length === 0 ? (
          <p className="text-sm text-slate-600">No sent remarketing emails recorded.</p>
        ) : (
          <div className="space-y-3">
            {filteredHistory.map((record) => {
              const matchesSelection =
                !!selectedCampaignId && record.campaignId === selectedCampaignId;
              const openCount = typeof record.emailOpenCount === "number" ? record.emailOpenCount : 0;
              const clickCount =
                typeof record.emailClickCount === "number" ? record.emailClickCount : 0;
              const clickDetails = Array.isArray(record.emailClickUrls)
                ? (record.emailClickUrls as Array<any>)
                    .map((entry) => {
                      if (!entry) return null;
                      if (typeof entry === "string") {
                        return { url: entry, count: null };
                      }
                      if (typeof entry === "object") {
                        const urlValue =
                          typeof entry.url === "string" && entry.url.trim().length > 0
                            ? entry.url.trim()
                            : null;
                        if (!urlValue) return null;
                        const countValue =
                          typeof entry.count === "number" && entry.count >= 0
                            ? entry.count
                            : null;
                        return { url: urlValue, count: countValue };
                      }
                      return null;
                    })
                    .filter((value): value is { url: string; count: number | null } => Boolean(value))
                : [];
              return (
                <article
                  key={record.id}
                  className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-medium uppercase tracking-wide">
                      {record.status || "sent"}
                    </span>
                    <span>
                      Sent {formatTimestamp(record.emailSentAt ?? record.createdAt ?? null)}
                    </span>
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm">
                    {record.emailSubject || record.headline || "Remarketing email"}
                  </h3>
                  {record.summary && (
                    <p className="text-sm text-slate-600 line-clamp-3">{record.summary}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    {record.campaignName && <span>Campaign: {record.campaignName}</span>}
                    {matchesSelection && (
                      <span className="text-orange-600 font-medium">Selected campaign</span>
                    )}
                    <span>Opens: {openCount}</span>
                    <span>Clicks: {clickCount}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    {record.emailLastOpenedAt && (
                      <span>Last opened {formatTimestamp(record.emailLastOpenedAt)}</span>
                    )}
                    {record.emailLastClickedAt && (
                      <span>Last click {formatTimestamp(record.emailLastClickedAt)}</span>
                    )}
                  </div>
                  {clickDetails.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-medium text-slate-600">Clicked links</p>
                      <ul className="space-y-1 text-xs text-blue-600 break-all">
                        {clickDetails.map((detail, index) => (
                          <li key={`${record.id}-click-${index}`}>
                            <span>{detail.url}</span>
                            {typeof detail.count === "number" && (
                              <span className="text-slate-500"> ({detail.count} clicks)</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
