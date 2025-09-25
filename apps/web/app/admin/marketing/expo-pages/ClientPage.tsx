"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
} from "react";
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

export default function AdminExpoLeadPagesPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "marketing"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<ExpoLeadPageRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpoLeadPageForm>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dbRef = useRef<Firestore | null>(null);

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
        console.error("Initial load of expo pages failed", err);
        if (!cancelled) {
          setError("Unable to initialise expo lead pages. Please refresh the page.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPages]);

  const resetForm = useCallback(() => {
    setSelectedId(null);
    setForm(emptyForm);
    setSlugTouched(false);
  }, []);

  const startEditing = useCallback((record: ExpoLeadPageRecord) => {
    setSelectedId(record.id);
    setSlugTouched(true);
    setForm({
      name: record.name,
      slug: record.slug,
      eventName: record.eventName,
      headline: record.headline,
      subheading: record.subheading,
      prizeDescription: record.prizeDescription,
      onePagerUrl: record.onePagerUrl,
      emailSubject: record.emailSubject,
      emailBody: record.emailBody,
      successHeadline: record.successHeadline || "Thanks for entering!",
      successMessage:
        record.successMessage ||
        "We\'ve emailed you a copy of our one-pager so you can dig in later. Keep an eye on your inbox for our prize draw winner announcement!",
      consentText: record.consentText || emptyForm.consentText,
      notificationEmails: record.notificationEmails.join(", "),
      isActive: record.isActive,
    });
  }, []);

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextName = event.target.value;
      setForm((prev) => ({ ...prev, name: nextName, slug: slugTouched ? prev.slug : slugify(nextName) }));
    },
    [slugTouched]
  );

  const handleSlugChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSlugTouched(true);
    setForm((prev) => ({ ...prev, slug: slugify(event.target.value) }));
  }, []);

  const updateForm = useCallback(<K extends keyof ExpoLeadPageForm>(key: K, value: ExpoLeadPageForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const savePage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const firestore = dbRef.current;
      if (!firestore) {
        setError("Firestore is not ready. Please refresh the page.");
        return;
      }

      const problems: string[] = [];
      const trimmedName = form.name.trim();
      const trimmedSlug = slugify(form.slug || form.name);
      if (!trimmedName) {
        problems.push("Name is required.");
      }
      if (!trimmedSlug) {
        problems.push("Slug is required.");
      }
      if (!form.eventName.trim()) {
        problems.push("Event name is required.");
      }
      if (!form.headline.trim()) {
        problems.push("Headline is required.");
      }
      if (!form.onePagerUrl.trim()) {
        problems.push("One-pager URL is required.");
      }
      if (!form.emailSubject.trim()) {
        problems.push("Email subject is required.");
      }
      if (!form.emailBody.trim()) {
        problems.push("Email body is required.");
      }

      if (problems.length > 0) {
        setError(problems.join(" \u2022 "));
        return;
      }

      setSaving(true);
      setError(null);

      const payload = {
        name: trimmedName,
        slug: trimmedSlug,
        eventName: form.eventName.trim(),
        headline: form.headline.trim(),
        subheading: form.subheading.trim(),
        prizeDescription: form.prizeDescription.trim(),
        onePagerUrl: form.onePagerUrl.trim(),
        emailSubject: form.emailSubject.trim(),
        emailBody: form.emailBody.trim(),
        successHeadline: form.successHeadline.trim(),
        successMessage: form.successMessage.trim(),
        consentText: form.consentText.trim(),
        notificationEmails: normaliseNotificationList(form.notificationEmails),
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
      };

      try {
        if (selectedId) {
          await updateDoc(doc(firestore, "expoLeadPages", selectedId), payload);
          setPages((prev) =>
            prev.map((page) =>
              page.id === selectedId
                ? {
                    ...page,
                    ...payload,
                    notificationEmails: payload.notificationEmails,
                    updatedAt: new Date(),
                  }
                : page
            )
          );
        } else {
          const docRef = await addDoc(collection(firestore, "expoLeadPages"), {
            ...payload,
            createdAt: serverTimestamp(),
          });
          await loadPages();
          setSelectedId(docRef.id);
        }
        setError(null);
      } catch (err) {
        console.error("Failed to save expo lead page", err);
        setError("Could not save the page. Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [form, loadPages, selectedId]
  );

  const deletePage = useCallback(async () => {
    if (!selectedId) {
      return;
    }
    const firestore = dbRef.current;
    if (!firestore) {
      setError("Firestore is not ready. Please refresh the page.");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Delete this expo page? This can\'t be undone.")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteDoc(doc(firestore, "expoLeadPages", selectedId));
      await loadPages();
      resetForm();
    } catch (err) {
      console.error("Failed to delete expo page", err);
      setError("Could not delete the page. Please try again.");
    } finally {
      setDeleting(false);
    }
  }, [loadPages, resetForm, selectedId]);

  const selectedPage = useMemo(() => pages.find((page) => page.id === selectedId) ?? null, [pages, selectedId]);

  const previewPath = selectedId ? `/expo/${form.slug || ""}` : form.slug ? `/expo/${form.slug}` : null;

  if (guardLoading) {
    return <p>Checking permissions…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage expo lead capture pages.</p>;
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Expo lead capture pages</h1>
          <p className="text-sm text-gray-600">
            Create landing pages for tablet lead capture at shows and automatically send one-pagers to entrants.
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => loadPages()} disabled={loading}>
          Refresh
        </button>
      </div>

      {error && <div className="alert alert-warning">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
        <div className="card border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Pages</h2>
            <button className="btn btn-xs" onClick={resetForm}>
              New page
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-gray-600">Loading…</p>
          ) : pages.length === 0 ? (
            <p className="text-sm text-gray-600">No expo pages yet. Create your first landing page.</p>
          ) : (
            <ul className="grid gap-2">
              {pages.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => startEditing(page)}
                    className={`w-full text-left px-3 py-2 rounded border ${
                      selectedId === page.id
                        ? "border-orange-400 bg-orange-50 text-orange-700"
                        : "border-slate-200 hover:border-orange-200"
                    }`}
                  >
                    <span className="font-medium">{page.name}</span>
                    <p className="text-xs text-gray-500">/{page.slug}</p>
                    <p className="text-xs text-gray-400">Updated {formatDateTime(page.updatedAt || page.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card border border-slate-200 p-6">
          <form className="grid gap-4" onSubmit={savePage}>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Internal name</label>
                <input className="input" value={form.name} onChange={handleNameChange} required />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Slug</label>
                <input className="input" value={form.slug} onChange={handleSlugChange} required />
                <p className="text-xs text-gray-500">Displayed at /expo/{form.slug || "slug"}</p>
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium">Event name</label>
              <input
                className="input"
                value={form.eventName}
                onChange={(event) => updateForm("eventName", event.target.value)}
                required
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Headline</label>
                <input
                  className="input"
                  value={form.headline}
                  onChange={(event) => updateForm("headline", event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Subheading</label>
                <input
                  className="input"
                  value={form.subheading}
                  onChange={(event) => updateForm("subheading", event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium">Prize draw / incentive copy</label>
              <textarea
                className="input"
                rows={3}
                value={form.prizeDescription}
                onChange={(event) => updateForm("prizeDescription", event.target.value)}
              />
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium">One-pager URL</label>
              <input
                className="input"
                type="url"
                value={form.onePagerUrl}
                onChange={(event) => updateForm("onePagerUrl", event.target.value)}
                required
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Success headline</label>
                <input
                  className="input"
                  value={form.successHeadline}
                  onChange={(event) => updateForm("successHeadline", event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Consent text</label>
                <input
                  className="input"
                  value={form.consentText}
                  onChange={(event) => updateForm("consentText", event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium">Success message</label>
              <textarea
                className="input"
                rows={4}
                value={form.successMessage}
                onChange={(event) => updateForm("successMessage", event.target.value)}
              />
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium">Auto-reply email subject</label>
              <input
                className="input"
                value={form.emailSubject}
                onChange={(event) => updateForm("emailSubject", event.target.value)}
                required
              />
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium">Auto-reply email body</label>
              <textarea
                className="input"
                rows={6}
                value={form.emailBody}
                onChange={(event) => updateForm("emailBody", event.target.value)}
                required
              />
              <p className="text-xs text-gray-500">Use {'{{firstName}}'} to personalise the greeting.</p>
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-medium">Notification emails</label>
              <input
                className="input"
                value={form.notificationEmails}
                onChange={(event) => updateForm("notificationEmails", event.target.value)}
                placeholder="Comma separated (e.g. franchise@example.com, hq@example.com)"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox"
                checked={form.isActive}
                onChange={(event) => updateForm("isActive", event.target.checked)}
              />
              Page is active
            </label>

            <div className="flex flex-wrap gap-3 items-center">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save page"}
              </button>
              {selectedId && (
                <button type="button" className="btn btn-outline" onClick={deletePage} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              )}
              {previewPath && (
                <Link href={previewPath} target="_blank" className="btn btn-ghost btn-sm">
                  View landing page
                </Link>
              )}
            </div>

            {selectedPage && (
              <p className="text-xs text-gray-500">
                Created {formatDateTime(selectedPage.createdAt)} • Updated {formatDateTime(selectedPage.updatedAt)}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
