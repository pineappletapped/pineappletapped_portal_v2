"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";

import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import { auth, db, functions } from "@/lib/firebase";

interface OrgOption {
  id: string;
  name: string;
}

interface EmailRecord {
  id: string;
  orgId: string | null;
  orgName: string | null;
  from: string;
  to: string[];
  subject: string;
  body: string;
  status: string | null;
  createdAt: Date | null;
}

const PROJECT_EMAIL_LIMIT = 25;

const createLocalId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (err) {
      console.warn("crypto.randomUUID failed, falling back to Math.random", err);
    }
  }
  return `local-${Math.random().toString(36).slice(2, 11)}`;
};

const normaliseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value) {
    const potential = value as { toDate?: () => Date; toMillis?: () => number };
    if (typeof potential.toDate === "function") {
      try {
        const result = potential.toDate();
        return result instanceof Date && !Number.isNaN(result.getTime()) ? result : null;
      } catch (err) {
        console.warn("Failed to convert Firestore timestamp with toDate", err);
      }
    }
    if (typeof potential.toMillis === "function") {
      try {
        const millis = potential.toMillis();
        if (typeof millis === "number" && Number.isFinite(millis)) {
          return new Date(millis);
        }
      } catch (err) {
        console.warn("Failed to convert Firestore timestamp with toMillis", err);
      }
    }
  }
  return null;
};

const formatDateTime = (value: Date | null): string => {
  if (!value) return "—";
  return value.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Map<string, T>();
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.set(item.id, item);
    }
  }
  return Array.from(seen.values());
};

function createEmailRecord(raw: Record<string, any>, orgLookup: Map<string, string>): EmailRecord {
  const orgId = typeof raw.orgId === "string" && raw.orgId.trim().length > 0 ? raw.orgId : null;
  const toValues = Array.isArray(raw.to)
    ? raw.to
    : typeof raw.to === "string" && raw.to.trim().length > 0
    ? [raw.to.trim()]
    : [];

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : raw.__id ?? createLocalId(),
    orgId,
    orgName: orgId ? orgLookup.get(orgId) ?? null : null,
    from: typeof raw.from === "string" ? raw.from : "",
    to: toValues,
    subject: typeof raw.subject === "string" && raw.subject.trim().length > 0 ? raw.subject : "(no subject)",
    body: typeof raw.body === "string" ? raw.body : "",
    status: typeof raw.status === "string" ? raw.status : null,
    createdAt: normaliseDate(raw.createdAt ?? raw.sentAt ?? raw.receivedAt ?? raw.updatedAt ?? null),
  };
}

export default function EmailsClientPage() {
  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [messages, setMessages] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cancelled) return;
      if (!firebaseUser) {
        setOrgOptions([]);
        setMessages([]);
        setLoading(false);
        setError("Sign in to view the shared inbox.");
        return;
      }

      setLoading(true);
      setError(null);
      setFeedback(null);

      try {
        const membershipSnap = await getDocs(
          query(collection(db, "memberships"), where("userId", "==", firebaseUser.uid))
        );

        const orgIds = membershipSnap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, any>;
            const orgId = data.orgId;
            return typeof orgId === "string" && orgId.trim().length > 0 ? orgId.trim() : null;
          })
          .filter((value): value is string => Boolean(value));

        const uniqueOrgIds = Array.from(new Set(orgIds));
        const orgLookup = new Map<string, string>();

        if (uniqueOrgIds.length > 0) {
          await Promise.all(
            uniqueOrgIds.map(async (orgId) => {
              try {
                const orgSnap = await getDoc(doc(db, "orgs", orgId));
                if (orgSnap.exists()) {
                  const data = orgSnap.data() as Record<string, any>;
                  const name =
                    (typeof data.name === "string" && data.name.trim().length > 0 && data.name.trim()) ||
                    (typeof data.displayName === "string" && data.displayName.trim().length > 0 && data.displayName.trim()) ||
                    null;
                  if (name) {
                    orgLookup.set(orgId, name);
                  }
                }
              } catch (orgError) {
                console.warn("Failed to load organisation", orgId, orgError);
              }
            })
          );
        }

        const collectedMessages: EmailRecord[] = [];

        await Promise.all(
          uniqueOrgIds.map(async (orgId) => {
            try {
              const inboxSnapshot = await getDocs(
                query(
                  collection(db, "emails"),
                  where("orgId", "==", orgId),
                  orderBy("createdAt", "desc"),
                  limit(PROJECT_EMAIL_LIMIT)
                )
              );
              inboxSnapshot.docs.forEach((docSnap) =>
                collectedMessages.push(
                  createEmailRecord({ id: docSnap.id, ...docSnap.data() }, orgLookup)
                )
              );
            } catch (inboxError: any) {
              console.error("Shared inbox fetch failed", inboxError);
              if (inboxError?.code === "failed-precondition" || inboxError?.code === "permission-denied") {
                setError(
                  "We couldn't load shared inbox messages for your organisation. Please confirm Firestore indexes and permissions."
                );
              }
            }
          })
        );

        if (firebaseUser.email) {
          try {
            const outboundSnapshot = await getDocs(
              query(
                collection(db, "emails"),
                where("from", "==", firebaseUser.email),
                orderBy("createdAt", "desc"),
                limit(20)
              )
            );
            outboundSnapshot.docs.forEach((docSnap) =>
              collectedMessages.push(
                createEmailRecord({ id: docSnap.id, ...docSnap.data() }, orgLookup)
              )
            );
          } catch (outboundError) {
            console.warn("Failed to load outbound emails", outboundError);
          }
        }

        const deduped = dedupeById(collectedMessages);
        deduped.sort((a, b) => {
          const aTime = a.createdAt ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });

        if (!cancelled) {
          const sortedOrgOptions = uniqueOrgIds
            .map((orgId) => ({ id: orgId, name: orgLookup.get(orgId) ?? "Untitled organisation" }))
            .sort((a, b) => a.name.localeCompare(b.name));
          setOrgOptions(sortedOrgOptions);
          if (sortedOrgOptions.length === 1) {
            setSelectedOrgId(sortedOrgOptions[0].id);
          }
          setMessages(deduped);
        }
      } catch (err: any) {
        console.error("Shared inbox initialisation failed", err);
        if (!cancelled) {
          setError(
            err?.message ||
              "We couldn't load the shared inbox. Refresh the page or contact your Pineapple Tapped producer."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const inboxDescription = useMemo(() => {
    if (messages.length === 0) {
      return "Coordinate approvals, timelines, and production updates without leaving the portal.";
    }
    return "Stay across approvals, shoot updates, and notifications captured by the Pineapple Tapped shared inbox.";
  }, [messages.length]);

  const sendDisabled = sending || !to.trim() || !subject.trim() || !body.trim();

  const handleSend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setError(null);

    const user = auth.currentUser;
    if (!user) {
      setError("Sign in to send a message.");
      return;
    }

    setSending(true);
    try {
      const payload = {
        orgId: selectedOrgId || null,
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
      };
      const callable = httpsCallable(functions, "emails_send");
      const response = await callable(payload);
      const id =
        (response?.data && typeof (response.data as any).id === "string"
          ? (response.data as any).id
          : null) || `local-${Date.now()}`;

      const orgLookup = new Map(orgOptions.map((option) => [option.id, option.name] as const));
      const newMessage: EmailRecord = {
        id,
        orgId: selectedOrgId || null,
        orgName: selectedOrgId ? orgLookup.get(selectedOrgId) ?? null : null,
        from: user.email ?? "",
        to: [to.trim()],
        subject: subject.trim(),
        body: body.trim(),
        status: "sent",
        createdAt: new Date(),
      };

      setMessages((prev) => [newMessage, ...prev]);
      setTo("");
      setSubject("");
      setBody("");
      setFeedback("Message sent via Pineapple Tapped shared inbox.");
    } catch (err: any) {
      console.error("Failed to send email", err);
      setError(
        err?.message ||
          "We couldn't send that message. Double-check the details and try again, or email your producer directly."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <PortalContainer>
      <div className="space-y-10">
        <PortalHero
          eyebrow="Client portal"
          title="Shared inbox"
          description={inboxDescription}
          backgroundClass="bg-indigo-950"
          metrics={[
            { label: "Recent messages", value: messages.length },
            { label: "Organisations", value: orgOptions.length },
          ]}
          quickActions={[
            {
              label: "Start a new thread",
              description: "Send an email to your Pineapple Tapped team.",
              onClick: () => {
                const form = document.getElementById("shared-inbox-form");
                form?.scrollIntoView({ behavior: "smooth", block: "start" });
              },
            },
            {
              label: "View projects",
              description: "Jump to milestones and approvals.",
              href: "/projects",
            },
            {
              label: "Contact support",
              description: "Prefer a direct conversation? Reach out to HQ.",
              href: "/contact",
            },
          ]}
        />

        <div className="grid gap-6 rounded-3xl border border-slate-200 bg-slate-50/60 p-6 text-sm text-slate-700">
          <p className="font-medium text-slate-900">How this inbox works</p>
          <p>
            Messages shown here sync with the Pineapple Tapped shared inbox. Replies use the
            <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs text-slate-700">emails_send</code>
            Cloud Function, so anything you send is delivered through the same Gmail/Workspace channel used by your producers.
          </p>
          <p>
            When the Pineapple Tapped team logs call summaries or forwards updates from production, the messages appear once
            they&rsquo;re recorded in Firestore. You can keep collaborating from your email client as usual, or stay within the
            portal to maintain a full history against each organisation.
          </p>
        </div>

        <section aria-labelledby="shared-inbox-compose" id="shared-inbox-form" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="shared-inbox-compose" className="text-xl font-semibold text-slate-900">
                Compose a message
              </h2>
              <p className="text-sm text-slate-600">
                Send a note to your Pineapple Tapped production team. They&rsquo;ll receive it in the shared inbox alongside other
                project threads.
              </p>
            </div>
            <Link
              href="/projects"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              View projects
            </Link>
          </div>

          <form
            onSubmit={handleSend}
            className="grid gap-4 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm"
          >
            {orgOptions.length > 1 && (
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Which organisation is this for?</span>
                <select
                  value={selectedOrgId}
                  onChange={(event) => setSelectedOrgId(event.target.value)}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="">General enquiry</option>
                  {orgOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">To</span>
              <input
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="producer@pineappletapped.com"
                required
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Shoot feedback or production update"
                required
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Message</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Share approvals, questions, or context for your producers."
                required
                rows={6}
                className="rounded-3xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={sendDisabled}
                className="inline-flex items-center justify-center rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                {sending ? "Sending…" : "Send message"}
              </button>
              {feedback && <p className="text-sm text-emerald-600">{feedback}</p>}
            </div>
          </form>
        </section>

        <section aria-labelledby="shared-inbox-activity" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="shared-inbox-activity" className="text-xl font-semibold text-slate-900">
                Latest activity
              </h2>
              <p className="text-sm text-slate-600">
                Messages are grouped by the organisation they belong to. Use the project links to jump straight into the related
                work.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {loading ? "Syncing…" : `${messages.length} messages`}
            </p>
          </div>

          {error && (
            <div className="rounded-3xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-24 animate-pulse rounded-3xl border border-slate-200 bg-slate-100/80"
                />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-600">
              Nothing here yet. Once your Pineapple Tapped team shares production updates or you send a message, the thread will
              appear instantly.
            </div>
          ) : (
            <div className="grid gap-4">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">
                        {message.orgName || "General"}
                      </p>
                      <h3 className="text-lg font-semibold text-slate-900">{message.subject}</h3>
                    </div>
                    <time className="text-sm text-slate-500" dateTime={message.createdAt?.toISOString()}>
                      {formatDateTime(message.createdAt)}
                    </time>
                  </div>

                  <div className="grid gap-1 text-sm text-slate-600">
                    <p>
                      <span className="font-medium text-slate-700">From:</span> {message.from || "Shared inbox"}
                    </p>
                    {message.to.length > 0 && (
                      <p>
                        <span className="font-medium text-slate-700">To:</span> {message.to.join(", ")}
                      </p>
                    )}
                    {message.status && (
                      <p className="uppercase tracking-[0.3em] text-xs text-slate-400">
                        {message.status}
                      </p>
                    )}
                  </div>

                  {message.body && (
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{message.body}</p>
                  )}

                  <div className="flex flex-wrap gap-3 pt-2">
                    <Link
                      href="/projects"
                      className="inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                    >
                      Open related projects
                    </Link>
                    <Link
                      href="/contact"
                      className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      Contact HQ
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </PortalContainer>
  );
}

