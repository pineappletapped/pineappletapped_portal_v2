"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { httpsCallable, type Functions } from "firebase/functions";
import { ensureFirebase } from "@/lib/firebase";

interface ExpoLeadPage {
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
  consentText: string;
  notificationEmails: string[];
  isActive: boolean;
}

interface Props {
  slug: string;
}

export default function ExpoLeadCapturePage({ slug }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<ExpoLeadPage | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const dbRef = useRef<Firestore | null>(null);
  const functionsRef = useRef<Functions | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { db, functions } = await ensureFirebase();
        if (cancelled) {
          return;
        }
        if (!db) {
          throw new Error("Firestore unavailable");
        }
        dbRef.current = db;
        functionsRef.current = functions ?? null;
        const snap = await getDocs(
          query(collection(db, "expoLeadPages"), where("slug", "==", slug), limit(1))
        );
        if (cancelled) {
          return;
        }
        if (snap.empty) {
          setError("We couldn't find this expo lead page. Please ask the team for the latest link.");
          setPage(null);
        } else {
          const data = snap.docs[0].data() as Record<string, any>;
          if (data.isActive === false) {
            setError("This expo page is no longer active. Please contact the team for assistance.");
            setPage(null);
          } else {
            setPage({
              id: snap.docs[0].id,
              name: (data.name as string) || "Expo",
              slug,
              eventName: (data.eventName as string) || "",
              headline: (data.headline as string) || "Win big with Pineapple Tapped",
              subheading: (data.subheading as string) || "",
              prizeDescription: (data.prizeDescription as string) || "",
              onePagerUrl: (data.onePagerUrl as string) || "",
              emailSubject: (data.emailSubject as string) || "",
              emailBody: (data.emailBody as string) || "",
              successHeadline: (data.successHeadline as string) || "Thanks for entering!",
              successMessage: (data.successMessage as string) || "",
              consentText:
                (data.consentText as string) ||
                "I agree to be contacted by Pineapple Tapped about services and prize draw updates.",
              notificationEmails: Array.isArray(data.notificationEmails)
                ? (data.notificationEmails as string[])
                : [],
              isActive: data.isActive !== false,
            });
            setError(null);
          }
        }
      } catch (err) {
        console.error("Failed to load expo landing page", err);
        if (!cancelled) {
          setError("We couldn't load the expo page just now. Please refresh or try again later.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const resetFeedback = useCallback(() => {
    if (status !== "idle") {
      setStatus("idle");
    }
    if (validationErrors.length) {
      setValidationErrors([]);
    }
    if (feedbackMessage) {
      setFeedbackMessage(null);
    }
  }, [feedbackMessage, status, validationErrors.length]);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      resetFeedback();
      const problems: string[] = [];
      if (!firstName.trim()) {
        problems.push("Please add your first name.");
      }
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        problems.push("Please provide your email address so we can send the one-pager.");
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        problems.push("That email address doesn't look valid. Please double-check it.");
      }
      if (!consent) {
        problems.push("Please confirm you're happy for us to follow up about the prize draw.");
      }
      if (!page) {
        problems.push("This expo page isn't available right now.");
      }
      if (problems.length > 0) {
        setValidationErrors(problems);
        setStatus("error");
        return;
      }
      const callableFunctions = functionsRef.current;
      if (!callableFunctions) {
        setFeedbackMessage("Submissions are unavailable at the moment. Please try again shortly.");
        setStatus("error");
        return;
      }
      setStatus("submitting");
      try {
        const callable = httpsCallable(callableFunctions, "expo_lead_submit");
        await callable({
          pageId: page?.id,
          slug,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: trimmedEmail,
          phone: phone.trim() || null,
          company: company.trim() || null,
          consent: true,
        });
        setStatus("success");
        setFeedbackMessage(page?.successMessage || "Thanks! We'll be in touch soon.");
        setFirstName("");
        setLastName("");
        setEmail("");
        setPhone("");
        setCompany("");
        setConsent(false);
      } catch (err) {
        console.error("Failed to submit expo lead", err);
        setStatus("error");
        setFeedbackMessage("We couldn't submit your entry just now. Please try again in a moment.");
      }
    },
    [company, consent, email, firstName, lastName, page, phone, resetFeedback, slug]
  );

  const heroBackground = useMemo(() => {
    if (!page) {
      return "bg-orange-100";
    }
    return "bg-gradient-to-br from-orange-100 via-white to-amber-100";
  }, [page]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading expo page…</p>
      </div>
    );
  }

  if (error && !page) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold mb-3">Expo page unavailable</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500">
            You can email <a href="mailto:hello@pineappletapped.com" className="text-orange-600">hello@pineappletapped.com</a>
            {" "}for help.
          </p>
        </div>
      </div>
    );
  }

  if (!page) {
    return null;
  }

  const showFeedback = status === "success" || status === "error";
  const hasErrors = validationErrors.length > 0 || (status === "error" && !!feedbackMessage);

  return (
    <div className={`min-h-screen ${heroBackground}`}>
      <div className="max-w-3xl mx-auto py-12 px-4 lg:py-16">
        <div className="bg-white/90 backdrop-blur shadow-xl rounded-2xl border border-orange-100 p-8 grid gap-8">
          <header className="grid gap-3 text-center">
            <p className="text-sm uppercase tracking-[0.2em] text-orange-500">{page.eventName}</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">{page.headline}</h1>
            {page.subheading && <p className="text-lg text-gray-600">{page.subheading}</p>}
            {page.prizeDescription && (
              <div className="mx-auto max-w-xl rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
                {page.prizeDescription}
              </div>
            )}
          </header>

          {showFeedback && (
            <div
              className={`rounded-md border p-4 text-sm ${
                hasErrors
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {status === "success" && (
                <div className="grid gap-2">
                  <h2 className="text-lg font-semibold">{page.successHeadline || "Thanks for entering!"}</h2>
                  <p>{feedbackMessage}</p>
                </div>
              )}
              {hasErrors && (
                <div className="grid gap-2">
                  {feedbackMessage && <p className="font-medium">{feedbackMessage}</p>}
                  {validationErrors.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1">
                      {validationErrors.map((msg) => (
                        <li key={msg}>{msg}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {status !== "success" && (
            <form className="grid gap-4" onSubmit={submit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium">First name</label>
                  <input
                    className="input"
                    value={firstName}
                    onChange={(event) => {
                      resetFeedback();
                      setFirstName(event.target.value);
                    }}
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">Last name</label>
                  <input
                    className="input"
                    value={lastName}
                    onChange={(event) => {
                      resetFeedback();
                      setLastName(event.target.value);
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-1">
                <label className="text-sm font-medium">Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    resetFeedback();
                    setEmail(event.target.value);
                  }}
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label className="text-sm font-medium">Phone</label>
                  <input
                    className="input"
                    value={phone}
                    onChange={(event) => {
                      resetFeedback();
                      setPhone(event.target.value);
                    }}
                    placeholder="Optional"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-sm font-medium">Company</label>
                  <input
                    className="input"
                    value={company}
                    onChange={(event) => {
                      resetFeedback();
                      setCompany(event.target.value);
                    }}
                    placeholder="Optional"
                  />
                </div>
              </div>

              <label className="flex items-start gap-3 text-sm text-gray-600">
                <input
                  type="checkbox"
                  className="checkbox mt-1"
                  checked={consent}
                  onChange={(event) => {
                    resetFeedback();
                    setConsent(event.target.checked);
                  }}
                  required
                />
                <span>{page.consentText}</span>
              </label>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={status === "submitting"}
              >
                {status === "submitting" ? "Submitting…" : "Enter prize draw"}
              </button>
            </form>
          )}

          <footer className="text-xs text-gray-500 text-center">
            <p>
              Questions? Email {" "}
              <a href="mailto:hello@pineappletapped.com" className="text-orange-600">
                hello@pineappletapped.com
              </a>{" "}
              or visit pineappletapped.com
            </p>
            {page.onePagerUrl && (
              <p>
                Prefer a direct link? <a href={page.onePagerUrl} className="text-orange-600">Download the one-pager</a>
              </p>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
