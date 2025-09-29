"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import Link from "next/link";
import { ensureFirebase } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";

interface ExpoLeadPageRecord {
  id: string;
  name: string;
  slug: string;
  eventName: string;
  headline: string;
  subheading: string;
  prizeDescription: string;
  onePagerUrl: string;
  emailSubject: string;
  emailBody: string;
  successHeadline: string;
  successMessage: string;
  consentText?: string;
  notificationEmails: string[];
  isActive: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

interface ExpoLeadPageForm {
  name: string;
  slug: string;
  eventName: string;
  headline: string;
  subheading: string;
  prizeDescription: string;
  onePagerUrl: string;
  emailSubject: string;
  emailBody: string;
  successHeadline: string;
  successMessage: string;
  consentText: string;
  notificationEmails: string;
  isActive: boolean;
}

const emptyForm: ExpoLeadPageForm = {
  name: "",
  slug: "",
  eventName: "",
  headline: "",
  subheading: "",
  prizeDescription: "",
  onePagerUrl: "",
  emailSubject: "Thanks for visiting Pineapple Tapped",
  emailBody:
    "Hi there,\n\nThanks for dropping by our stand today. Here's our one-pager so you can revisit the highlights and share them with your team. We'll be in touch shortly to see how we can help.\n\nTeam Pineapple Tapped",
  successHeadline: "Thanks for entering!",
  successMessage:
    "We\'ve emailed you a copy of our one-pager so you can dig in later. Keep an eye on your inbox for our prize draw winner announcement!",
  consentText: "I agree to be contacted by Pineapple Tapped about video and photo services.",
  notificationEmails: "",
  isActive: true,
};

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("Failed to convert timestamp", error);
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

const formatDateTime = (value: any): string => {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normaliseNotificationList = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

function resolveHeadingTag(level: HeadingLevel) {
  switch (level) {
    case "h2":
      return "h2";
    case "none":
      return null;
    default:
      return "h1";
  }
}

type HeadingLevel = "h1" | "h2" | "none";

export interface ExpoLeadCaptureManagerProps {
  heading?: string;
  description?: ReactNode;
  headingLevel?: HeadingLevel;
}

export default function ExpoLeadCaptureManager({
  heading = "Expo Lead Capture",
  description = (
    <p className="text-sm text-gray-600">
      Build iPad-friendly landing pages for each exhibition so captured leads sync into the CRM with the
      right event tags and automated follow-up emails.
    </p>
  ),
  headingLevel = "h1",
}: ExpoLeadCaptureManagerProps) {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "marketing"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<ExpoLeadPageRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpoLeadPageForm>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [origin, setOrigin] = useState("https://pineappletapped.com");
  const dbRef = useRef<Firestore | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const loadPages = useCallback(async (database?: Firestore | null) => {
    const firestore = database ?? dbRef.current;
    if (!firestore) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(firestore, "expoLeadPages"));
      const items: ExpoLeadPageRecord[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data() as Partial<ExpoLeadPageRecord> & {
            notificationEmails?: string[] | string;
            createdAt?: unknown;
            updatedAt?: unknown;
          };
          return {
            id: docSnap.id,
            name: typeof data.name === "string" && data.name.trim().length > 0 ? data.name : "Untitled",
            slug: typeof data.slug === "string" ? data.slug : "",
            eventName: typeof data.eventName === "string" ? data.eventName : "",
            headline: typeof data.headline === "string" ? data.headline : "",
            subheading: typeof data.subheading === "string" ? data.subheading : "",
            prizeDescription: typeof data.prizeDescription === "string" ? data.prizeDescription : "",
            onePagerUrl: typeof data.onePagerUrl === "string" ? data.onePagerUrl : "",
            emailSubject: typeof data.emailSubject === "string" ? data.emailSubject : "",
            emailBody: typeof data.emailBody === "string" ? data.emailBody : "",
            successHeadline:
              typeof data.successHeadline === "string" && data.successHeadline.trim().length > 0
                ? data.successHeadline
                : "Thanks for entering!",
            successMessage: typeof data.successMessage === "string" ? data.successMessage : "",
            consentText: typeof data.consentText === "string" ? data.consentText : "",
            notificationEmails: Array.isArray(data.notificationEmails)
              ? data.notificationEmails.filter((value): value is string => typeof value === "string")
              : normaliseNotificationList(typeof data.notificationEmails === "string" ? data.notificationEmails : ""),
            isActive: data.isActive !== false,
            createdAt: toDate(data.createdAt),
            updatedAt: toDate(data.updatedAt),
          } satisfies ExpoLeadPageRecord;
        })
        .sort((a, b) => {
          const aTime = a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
          const bTime = b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
          return bTime - aTime;
        });
      setPages(items);
    } catch (err) {
      console.error("Failed to load expo lead pages", err);
      setError("Unable to load expo lead capture pages. Please try again.");
      setPages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { db } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        if (!db) {
          throw new Error("Firestore is unavailable");
        }
        dbRef.current = db;
        await loadPages(db);
      } catch (err) {
        console.error("Initial expo lead page load failed", err);
        if (!cancelled) {
          setError("Unable to initialise expo lead capture. Please refresh the page.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPages]);

  useEffect(() => {
    if (!panelOpen) {
      setForm(emptyForm);
      setSlugTouched(false);
      return;
    }
    if (!selectedId) {
      setForm(emptyForm);
      setSlugTouched(false);
      return;
    }
    const page = pages.find((item) => item.id === selectedId);
    if (!page) {
      setForm(emptyForm);
      setSlugTouched(false);
      return;
    }
    setForm({
      name: page.name,
      slug: page.slug,
      eventName: page.eventName,
      headline: page.headline,
      subheading: page.subheading,
      prizeDescription: page.prizeDescription,
      onePagerUrl: page.onePagerUrl,
      emailSubject: page.emailSubject,
      emailBody: page.emailBody,
      successHeadline: page.successHeadline,
      successMessage: page.successMessage,
      consentText: page.consentText ?? "",
      notificationEmails: page.notificationEmails.join(", "),
      isActive: page.isActive,
    });
    setSlugTouched(page.slug.trim().length > 0);
  }, [pages, panelOpen, selectedId]);

  const selectedPage = useMemo(
    () => (panelOpen && selectedId ? pages.find((item) => item.id === selectedId) ?? null : null),
    [pages, panelOpen, selectedId]
  );

  const slugBase = useMemo(() => `${origin.replace(/\/$/, "")}/expo/`, [origin]);

  const updateForm = useCallback(<Key extends keyof ExpoLeadPageForm>(key: Key, value: ExpoLeadPageForm[Key]) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      updateForm("name", value);
      if (!slugTouched) {
        updateForm("slug", slugify(value));
      }
    },
    [slugTouched, updateForm]
  );

  const handleSlugChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSlugTouched(true);
      updateForm("slug", slugify(event.target.value));
    },
    [updateForm]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!dbRef.current) {
        setError("Firestore is not ready. Please refresh the page.");
        return;
      }
      setSaving(true);
      setError(null);
      const payload = {
        name: form.name.trim() || "Untitled",
        slug: form.slug.trim() || slugify(form.name || ""),
        eventName: form.eventName.trim(),
        headline: form.headline.trim(),
        subheading: form.subheading.trim(),
        prizeDescription: form.prizeDescription.trim(),
        onePagerUrl: form.onePagerUrl.trim(),
        emailSubject: form.emailSubject.trim(),
        emailBody: form.emailBody.trim(),
        successHeadline: form.successHeadline.trim() || "Thanks for entering!",
        successMessage: form.successMessage.trim(),
        consentText: form.consentText.trim(),
        notificationEmails: normaliseNotificationList(form.notificationEmails),
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
      };
      try {
        if (selectedId) {
          await updateDoc(doc(dbRef.current, "expoLeadPages", selectedId), payload);
        } else {
          await addDoc(collection(dbRef.current, "expoLeadPages"), {
            ...payload,
            createdAt: serverTimestamp(),
          });
        }
        await loadPages();
        setSlugTouched(payload.slug.length > 0);
      } catch (err) {
        console.error("Failed to save expo lead page", err);
        setError("Unable to save the landing page. Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [form, loadPages, selectedId]
  );

  const handleDelete = useCallback(async () => {
    if (!selectedId || !dbRef.current) {
      return;
    }
    if (!window.confirm("Are you sure you want to delete this landing page?")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteDoc(doc(dbRef.current, "expoLeadPages", selectedId));
      setSelectedId(null);
      await loadPages();
      setPanelOpen(false);
    } catch (err) {
      console.error("Failed to delete expo lead page", err);
      setError("Unable to delete the landing page. Please try again.");
    } finally {
      setDeleting(false);
    }
  }, [loadPages, selectedId]);

  const openCreatePanel = useCallback(() => {
    setSelectedId(null);
    setForm(emptyForm);
    setSlugTouched(false);
    setPanelOpen(true);
  }, []);

  const openEditPanel = useCallback((pageId: string) => {
    setSelectedId(pageId);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setSelectedId(null);
    setForm(emptyForm);
    setSlugTouched(false);
  }, []);

  useEffect(() => {
    setPortalTarget(typeof document !== "undefined" ? document.body : null);
  }, []);

  useEffect(() => {
    if (!panelOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanel();
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
  }, [closePanel, panelOpen]);

  if (guardLoading) {
    return <p>Checking access…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage exhibition landing pages.</p>;
  }

  const HeadingTag = resolveHeadingTag(headingLevel);

  const panel = !panelOpen
    ? null
    : (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-end">
          <button
            type="button"
            aria-label="Close landing page manager"
            className="absolute inset-0 bg-black/40"
            onClick={closePanel}
          />
          <aside
            role="dialog"
            aria-modal="true"
            className="ml-auto flex h-full w-full max-w-3xl flex-col bg-base-100 shadow-xl"
          >
            <header className="flex items-start justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">
                  {selectedId ? "Edit landing page" : "Create landing page"}
                </h2>
                <p className="text-sm text-gray-600">
                  Publish and manage exhibition microsites without leaving the orders workflow.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={closePanel}>
                Close
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
              <form className="grid gap-4" onSubmit={handleSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="form-control">
                    <span className="label-text">Internal name</span>
                    <input
                      type="text"
                      className="input input-bordered"
                      value={form.name}
                      onChange={handleNameChange}
                      placeholder="March Expo 2025"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Event name</span>
                    <input
                      type="text"
                      className="input input-bordered"
                      value={form.eventName}
                      onChange={(event) => updateForm("eventName", event.target.value)}
                      placeholder="Global Franchise Show"
                    />
                  </label>
                </div>

                <label className="form-control">
                  <span className="label-text">Slug / kiosk URL</span>
                  <div className="join">
                    <span className="join-item input input-bordered pointer-events-none select-none whitespace-nowrap">
                      {slugBase}
                    </span>
                    <input
                      type="text"
                      className="join-item input input-bordered"
                      value={form.slug}
                      onChange={handleSlugChange}
                      placeholder="franchise-show-2025"
                    />
                  </div>
                  <span className="label-text-alt text-gray-500">
                    We&apos;ll generate a QR code for this link so the stand team can surface it instantly.
                  </span>
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="form-control">
                    <span className="label-text">Headline</span>
                    <input
                      type="text"
                      className="input input-bordered"
                      value={form.headline}
                      onChange={(event) => updateForm("headline", event.target.value)}
                      placeholder="Win £500 of content creation"
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Subheading</span>
                    <input
                      type="text"
                      className="input input-bordered"
                      value={form.subheading}
                      onChange={(event) => updateForm("subheading", event.target.value)}
                      placeholder="Tell us about your marketing goals for 2025"
                    />
                  </label>
                </div>

                <label className="form-control">
                  <span className="label-text">Prize or incentive</span>
                  <textarea
                    className="textarea textarea-bordered"
                    value={form.prizeDescription}
                    onChange={(event) => updateForm("prizeDescription", event.target.value)}
                    placeholder="Free brand film, headshots or social content package"
                    rows={3}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text">One-pager URL</span>
                  <input
                    type="url"
                    className="input input-bordered"
                    value={form.onePagerUrl}
                    onChange={(event) => updateForm("onePagerUrl", event.target.value)}
                    placeholder="https://example.com/pineapple-tapped-one-pager.pdf"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="form-control">
                    <span className="label-text">Auto-email subject</span>
                    <input
                      type="text"
                      className="input input-bordered"
                      value={form.emailSubject}
                      onChange={(event) => updateForm("emailSubject", event.target.value)}
                    />
                  </label>
                  <label className="form-control">
                    <span className="label-text">Notification emails</span>
                    <input
                      type="text"
                      className="input input-bordered"
                      value={form.notificationEmails}
                      onChange={(event) => updateForm("notificationEmails", event.target.value)}
                      placeholder="expo@pineappletapped.com, events@pineappletapped.com"
                    />
                    <span className="label-text-alt text-gray-500">Separate addresses with commas.</span>
                  </label>
                </div>

                <label className="form-control">
                  <span className="label-text">Auto-email body</span>
                  <textarea
                    className="textarea textarea-bordered"
                    value={form.emailBody}
                    onChange={(event) => updateForm("emailBody", event.target.value)}
                    rows={6}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text">Success headline</span>
                  <input
                    type="text"
                    className="input input-bordered"
                    value={form.successHeadline}
                    onChange={(event) => updateForm("successHeadline", event.target.value)}
                    placeholder="Thanks for entering!"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Success message</span>
                  <textarea
                    className="textarea textarea-bordered"
                    value={form.successMessage}
                    onChange={(event) => updateForm("successMessage", event.target.value)}
                    rows={4}
                  />
                </label>

                <label className="form-control">
                  <span className="label-text">Consent checkbox copy</span>
                  <input
                    type="text"
                    className="input input-bordered"
                    value={form.consentText}
                    onChange={(event) => updateForm("consentText", event.target.value)}
                    placeholder="I agree to be contacted by Pineapple Tapped about video and photo services."
                  />
                </label>

                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(event) => updateForm("isActive", event.target.checked)}
                    />
                    Active on the expo listings page
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {selectedPage && selectedPage.slug ? (
                      <Link
                        href={`/expo/${selectedPage.slug}`}
                        className="btn btn-ghost btn-sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open public page
                      </Link>
                    ) : null}
                    {selectedId ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-rose-600"
                        onClick={handleDelete}
                        disabled={deleting}
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </button>
                    ) : null}
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                      {saving ? "Saving…" : selectedId ? "Save changes" : "Create landing page"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </aside>
        </div>
      );

  return (
    <div className="grid gap-6">
      {HeadingTag ? <HeadingTag className="text-xl font-semibold">{heading}</HeadingTag> : null}
      {description}

      <section className="rounded border p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Landing pages</h2>
            <p className="text-sm text-gray-600">
              Configure the experience prospects see at the stand and route entries into the CRM with event tags.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreatePanel}>
              Create landing page
            </button>
          </div>
        </div>

        {error && !panelOpen && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {loading ? (
          <p className="mt-4 text-sm text-gray-500">Loading landing pages…</p>
        ) : pages.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">No exhibition landing pages yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.id}>
                    <td className="font-medium">{page.name}</td>
                    <td>{page.eventName || "—"}</td>
                    <td>
                      <span className={`badge ${page.isActive ? "badge-success" : "badge-ghost"}`}>
                        {page.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{formatDateTime(page.updatedAt ?? page.createdAt)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        {page.slug ? (
                          <Link
                            href={`/expo/${page.slug}`}
                            className="btn btn-ghost btn-xs"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View
                          </Link>
                        ) : null}
                        <button type="button" className="btn btn-outline btn-xs" onClick={() => openEditPanel(page.id)}>
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {portalTarget ? createPortal(panel, portalTarget) : panel}
    </div>
  );
}
