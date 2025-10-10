"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
  type QueryConstraint,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import Link from "next/link";
import { ensureFirebase } from "@/lib/firebase";

interface ExpoLeadRecord {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  company: string | null;
  eventName: string | null;
  eventSlug: string | null;
  createdAt: Date | null;
  lastFollowUpAt: Date | null;
}

type TimeFilter = "today" | "week" | "month" | "all";

type Variant = "admin" | "franchise";

export interface ExpoLeadOutreachManagerProps {
  heading?: string;
  description?: ReactNode;
  variant?: Variant;
  className?: string;
}

const DEFAULT_TEMPLATE = `Hi {{firstName}},

It was great chatting with you at {{eventName}}. I'd love to keep the conversation going and learn more about how Pineapple Tapped can support your upcoming projects.

Here is a quick summary of what we talked about:
- {{company}}
- Next steps we suggested: {{nextSteps}}

Let me know a good time for a follow-up call, or feel free to reply with any questions.

Best,
The Pineapple Tapped team`;

const TOKEN_HINTS: { token: string; description: string }[] = [
  { token: "{{firstName}}", description: "Lead's first name" },
  { token: "{{eventName}}", description: "Landing page event name" },
  { token: "{{company}}", description: "Company provided on the form" },
  { token: "{{nextSteps}}", description: "Free text you can replace with your notes" },
];

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as any).toDate === "function") {
    try {
      return (value as any).toDate();
    } catch (error) {
      console.warn("Failed to convert Firestore timestamp", error);
      return null;
    }
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const formatDateTime = (value: Date | null): string => {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
};

const normaliseEventKey = (slug: string | null, name: string | null): string | null => {
  if (slug && slug.trim()) {
    return slug.trim().toLowerCase();
  }
  if (name && name.trim()) {
    return name.trim().toLowerCase();
  }
  return null;
};

const applyTemplate = (template: string, lead: ExpoLeadRecord): string => {
  const replacements: Record<string, string> = {
    firstname: lead.firstName || "",
    lastname: lead.lastName || "",
    eventname: lead.eventName || "",
    company: lead.company || "",
    nextsteps: "",
  };

  return template.replace(/{{\s*(firstName|lastName|eventName|company|nextSteps)\s*}}/gi, (_, key: string) => {
    const normalised = key.replace(/\s+/g, "").toLowerCase();
    return replacements[normalised] ?? "";
  });
};

async function fetchExpoLeads(db: Firestore, constraints: QueryConstraint[] = []): Promise<ExpoLeadRecord[]> {
  const snap = await getDocs(
    query(collection(db, "expoLeads"), orderBy("createdAt", "desc"), ...constraints, limit(500))
  );
  return snap.docs.map((docSnap) => {
    const data = docSnap.data() as Record<string, any>;
    return {
      id: docSnap.id,
      firstName: typeof data.firstName === "string" ? data.firstName : "",
      lastName: typeof data.lastName === "string" ? data.lastName : "",
      email: typeof data.email === "string" ? data.email : "",
      phone: typeof data.phone === "string" ? data.phone : null,
      company: typeof data.company === "string" ? data.company : null,
      eventName: typeof data.eventName === "string" ? data.eventName : null,
      eventSlug: typeof data.eventSlug === "string" ? data.eventSlug : typeof data.slug === "string" ? data.slug : null,
      createdAt: toDate(data.createdAt),
      lastFollowUpAt: toDate(data.lastFollowUpAt),
    } satisfies ExpoLeadRecord;
  });
}

export default function ExpoLeadOutreachManager({
  heading = "Expo lead outreach",
  description,
  variant = "admin",
  className,
}: ExpoLeadOutreachManagerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<ExpoLeadRecord[]>([]);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(variant === "franchise" ? "today" : "week");
  const [search, setSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [composeFeedback, setComposeFeedback] = useState<string | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  const refreshLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { db } = await ensureFirebase();
      if (!db) {
        throw new Error("Firestore is unavailable");
      }
      const items = await fetchExpoLeads(db);
      setLeads(items);
    } catch (err) {
      console.error("Failed to load expo leads", err);
      setError("Unable to load expo leads. Please refresh the page.");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshLeads();
      } catch (err) {
        if (!cancelled) {
          console.error("Initial expo lead load failed", err);
          setError("Unable to load expo leads. Please refresh the page.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLeads]);

  useEffect(() => {
    setPortalTarget(typeof document !== "undefined" ? document.body : null);
  }, []);

  const composeLead = useMemo(() => (selectedLeadId ? leads.find((lead) => lead.id === selectedLeadId) ?? null : null), [
    leads,
    selectedLeadId,
  ]);

  useEffect(() => {
    if (!composeLead) {
      setComposeSubject("");
      setComposeBody("");
      setComposeFeedback(null);
      setComposeError(null);
      return;
    }
    const defaultSubject = composeLead.eventName
      ? `Great to meet you at ${composeLead.eventName}`
      : "Great to meet you at the show";
    const defaultBody = applyTemplate(DEFAULT_TEMPLATE, composeLead);
    setComposeSubject(defaultSubject);
    setComposeBody(defaultBody);
    setComposeFeedback(null);
    setComposeError(null);
  }, [composeLead]);

  useEffect(() => {
    if (!selectedLeadId) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedLeadId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    let originalOverflow: string | undefined;
    if (typeof document !== "undefined") {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (typeof document !== "undefined") {
        document.body.style.overflow = originalOverflow ?? "";
      }
    };
  }, [selectedLeadId]);

  const filteredLeads = useMemo(() => {
    const now = new Date();
    const searchTerm = search.trim().toLowerCase();
    const filterByTime = (lead: ExpoLeadRecord) => {
      if (timeFilter === "all") return true;
      const created = lead.createdAt;
      if (!created) return false;
      const msInDay = 24 * 60 * 60 * 1000;
      const diff = now.getTime() - created.getTime();
      if (timeFilter === "today") {
        return diff < msInDay && created.getDate() === now.getDate();
      }
      if (timeFilter === "week") {
        return diff < msInDay * 7;
      }
      if (timeFilter === "month") {
        return diff < msInDay * 30;
      }
      return true;
    };

    return leads
      .filter((lead) => {
        if (eventFilter === "all") {
          return true;
        }
        const key = normaliseEventKey(lead.eventSlug, lead.eventName);
        return key === eventFilter;
      })
      .filter(filterByTime)
      .filter((lead) => {
        if (!searchTerm) return true;
        return (
          lead.firstName.toLowerCase().includes(searchTerm) ||
          lead.lastName.toLowerCase().includes(searchTerm) ||
          lead.email.toLowerCase().includes(searchTerm) ||
          (lead.company ?? "").toLowerCase().includes(searchTerm)
        );
      });
  }, [eventFilter, leads, search, timeFilter]);

  const eventOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    leads.forEach((lead) => {
      const key = normaliseEventKey(lead.eventSlug, lead.eventName);
      if (!key) {
        return;
      }
      const label = lead.eventName || lead.eventSlug || "Untitled event";
      const existing = map.get(key);
      if (existing) {
        map.set(key, { label: existing.label, count: existing.count + 1 });
      } else {
        map.set(key, { label, count: 1 });
      }
    });
    return Array.from(map.entries())
      .map(([value, meta]) => ({ value, label: `${meta.label} (${meta.count})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [leads]);

  const closeCompose = useCallback(() => {
    setSelectedLeadId(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (!composeLead) {
      return;
    }
    const trimmedSubject = composeSubject.trim();
    const trimmedBody = composeBody.trim();
    if (!trimmedSubject) {
      setComposeError("Add a subject before sending.");
      setComposeFeedback(null);
      return;
    }
    if (!trimmedBody) {
      setComposeError("Write your follow-up message before sending.");
      setComposeFeedback(null);
      return;
    }

    setSending(true);
    setComposeError(null);
    setComposeFeedback(null);
    try {
      const services = await ensureFirebase();
      if (!services.functions || (services.functions as any).__isPlaceholder) {
        throw new Error("Cloud Functions are unavailable");
      }
      const callable = httpsCallable(services.functions, "expo_lead_sendFollowUp");
      await callable({ leadId: composeLead.id, subject: trimmedSubject, body: trimmedBody });
      setComposeFeedback("Follow-up email sent successfully.");
      setLeads((prev) =>
        prev.map((lead) => (lead.id === composeLead.id ? { ...lead, lastFollowUpAt: new Date() } : lead))
      );
    } catch (err: any) {
      console.error("Failed to send expo lead follow-up", err);
      const message =
        typeof err?.message === "string" && err.message
          ? err.message
          : "We couldn't send that follow-up just now. Please try again.";
      setComposeError(message);
    } finally {
      setSending(false);
    }
  }, [composeBody, composeLead, composeSubject]);

  const composePanel = !composeLead
    ? null
    : (
        <div className="fixed inset-0 z-[80] flex items-stretch justify-end">
          <button
            type="button"
            aria-label="Close follow-up composer"
            className="absolute inset-0 bg-gray-900/60"
            onClick={closeCompose}
          />
          <aside
            role="dialog"
            aria-modal="true"
            className="relative z-[1] ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between border-b border-base-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">Personalise follow-up</h2>
                <p className="text-sm text-gray-600">
                  Tailor the outreach message before sending it to {composeLead.firstName}.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={closeCompose}>
                Close
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="mb-4 rounded-lg bg-slate-50 p-4 text-sm text-gray-700">
                <p className="font-medium">Available tokens</p>
                <ul className="mt-2 space-y-1">
                  {TOKEN_HINTS.map((token) => (
                    <li key={token.token}>
                      <span className="font-mono text-xs text-gray-600">{token.token}</span> – {token.description}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-4">
                <label className="form-control">
                  <span className="label-text">Subject</span>
                  <input
                    type="text"
                    className="input input-bordered"
                    value={composeSubject}
                    onChange={(event) => setComposeSubject(event.target.value)}
                    placeholder="Great to meet you at the show"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Message</span>
                  <textarea
                    className="textarea textarea-bordered min-h-[220px]"
                    value={composeBody}
                    onChange={(event) => setComposeBody(event.target.value)}
                  />
                </label>
                {composeError && <p className="text-sm text-red-600">{composeError}</p>}
                {composeFeedback && <p className="text-sm text-green-600">{composeFeedback}</p>}
              </div>
            </div>
            <footer className="flex items-center justify-between gap-4 border-t border-base-200 px-6 py-4">
              <div className="text-sm text-gray-600">
                Sent automatically when captured. Use this space to send a tailored follow-up.
              </div>
              <button type="button" className="btn btn-primary" onClick={handleSend} disabled={sending}>
                {sending ? "Sending…" : "Send follow-up"}
              </button>
            </footer>
          </aside>
        </div>
      );

  const wrapperClassName = clsx("rounded-2xl border border-base-200 bg-white shadow-sm", className);

  const defaultDescription =
    description ?? (
      <p className="text-sm text-gray-600">
        Review leads captured on the landing pages and send personal follow-ups that reference your stand conversations.
      </p>
    );

  return (
    <section className={wrapperClassName}>
      <div className="flex flex-col gap-2 border-b border-base-200 p-6">
        <h2 className="text-lg font-semibold">{heading}</h2>
        {defaultDescription}
      </div>
      <div className="space-y-4 p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="form-control w-full max-w-xs lg:w-48">
              <span className="label-text text-xs uppercase tracking-wide text-gray-500">Event</span>
              <select
                className="select select-bordered select-sm"
                value={eventFilter}
                onChange={(event) => setEventFilter(event.target.value)}
              >
                <option value="all">All events</option>
                {eventOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control w-full max-w-xs lg:w-40">
              <span className="label-text text-xs uppercase tracking-wide text-gray-500">Captured</span>
              <select
                className="select select-bordered select-sm"
                value={timeFilter}
                onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
              >
                <option value="today">Today</option>
                <option value="week">Last 7 days</option>
                <option value="month">Last 30 days</option>
                <option value="all">All time</option>
              </select>
            </label>
            <label className="form-control w-full max-w-xs">
              <span className="label-text text-xs uppercase tracking-wide text-gray-500">Search</span>
              <input
                type="search"
                className="input input-bordered input-sm"
                placeholder="Name, email or company"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={refreshLeads} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link href="/crm" className="btn btn-ghost btn-sm">
              Open CRM
            </Link>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-500">Loading captured leads…</p>
        ) : filteredLeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-base-200 p-8 text-center">
            <p className="text-sm text-gray-500">
              No leads match your filters yet. Adjust the filters or capture a new lead at your next event.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full min-w-[880px] text-sm">
              <thead>
                <tr>
                  <th className="w-1/4">Lead</th>
                  <th className="w-1/4">Event</th>
                  <th className="w-32">Captured</th>
                  <th className="w-32">Last follow-up</th>
                  <th className="w-32 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => {
                  const awaitingFollowUp = !lead.lastFollowUpAt;
                  return (
                    <tr key={lead.id}>
                      <td>
                        <div className="space-y-1">
                          <div className="font-medium">
                            {lead.firstName} {lead.lastName}
                          </div>
                          <div className="text-xs text-gray-500">{lead.email}</div>
                          {lead.company && <div className="text-xs text-gray-500">{lead.company}</div>}
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1">
                          <div>{lead.eventName || lead.eventSlug || "Untitled event"}</div>
                          {lead.eventSlug && (
                            <div className="text-xs text-gray-500">Slug: {lead.eventSlug}</div>
                          )}
                        </div>
                      </td>
                      <td>{formatDateTime(lead.createdAt)}</td>
                      <td>
                        <span
                          className={clsx(
                            "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                            awaitingFollowUp
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                          )}
                        >
                          {awaitingFollowUp ? "Awaiting follow-up" : formatDateTime(lead.lastFollowUpAt)}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            onClick={() => setSelectedLeadId(lead.id)}
                          >
                            Personalise
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {portalTarget ? createPortal(composePanel, portalTarget) : composePanel}
    </section>
  );
}
