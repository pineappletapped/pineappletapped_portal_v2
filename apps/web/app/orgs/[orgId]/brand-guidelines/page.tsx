"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import PortalContainer from "@/components/PortalContainer";
import PortalHero from "@/components/PortalHero";
import { auth, db, ensureFirebase, storage } from "@/lib/firebase";
import { extractUserRoles, hasRole } from "@/lib/roles";
import {
  BrandGuidelineColors,
  BrandGuidelinesState,
  DEFAULT_BRAND_GUIDELINES,
  parseBrandGuidelines,
  sanitiseBrandGuidelines,
} from "@/lib/brand-guidelines";

interface FeedbackState {
  message: string;
  tone: "success" | "error";
}

export default function OrgBrandGuidelinesPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params?.orgId;

  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("Organisation");
  const [guidelines, setGuidelines] = useState<BrandGuidelinesState>(DEFAULT_BRAND_GUIDELINES);
  const [brandUpdatedAt, setBrandUpdatedAt] = useState<Date | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [savingGuidelines, setSavingGuidelines] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;

    (async () => {
      try {
        await ensureFirebase();
        if (!active) return;

        const orgRef = doc(db, "orgs", orgId);
        const orgSnap = await getDoc(orgRef);
        if (!orgSnap.exists()) {
          throw new Error("Organisation not found");
        }

        const data = orgSnap.data() as any;
        setOrgName(data?.name || "Untitled organisation");
        if (typeof data?.brandLogoUrl === "string") {
          setLogoUrl(data.brandLogoUrl);
        } else {
          setLogoUrl("");
        }
        setGuidelines(parseBrandGuidelines(data?.brandGuidelines));
        if (data?.brandGuidelinesUpdatedAt?.toDate) {
          setBrandUpdatedAt(data.brandGuidelinesUpdatedAt.toDate());
        } else {
          setBrandUpdatedAt(null);
        }

        const currentUser = auth.currentUser;
        let nextCanEdit = false;
        if (currentUser) {
          const membershipRef = doc(db, "memberships", `${orgId}_${currentUser.uid}`);
          const membershipSnap = await getDoc(membershipRef);
          const membershipRole = membershipSnap.exists() ? membershipSnap.data()?.role : null;
          const userSnap = await getDoc(doc(db, "users", currentUser.uid));
          const roles = extractUserRoles(userSnap.data());
          const staffAccess = hasRole(roles, ["admin", "projects", "marketing"]);
          nextCanEdit = staffAccess || membershipRole === "client_admin";
        }
        if (active) {
          setCanEdit(nextCanEdit);
        }
      } catch (error) {
        console.error("Failed to load brand guidelines", error);
        if (active) {
          setFeedback({
            message: error instanceof Error ? error.message : "Failed to load brand guidelines.",
            tone: "error",
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [orgId]);

  const heroMetrics = useMemo(
    () => [
      {
        label: "Last updated",
        value: brandUpdatedAt ? brandUpdatedAt.toLocaleDateString() : "—",
      },
      {
        label: "Access",
        value: canEdit ? "Can edit" : "View only",
      },
    ],
    [brandUpdatedAt, canEdit],
  );

  const quickActions = useMemo(
    () =>
      orgId
        ? [
            {
              label: "Back to organisation",
              description: "Return to team workspace",
              href: `/orgs/${orgId}`,
            },
          ]
        : [],
    [orgId],
  );

  const handleLogoUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!orgId || !logoFile || !canEdit) return;
    try {
      setUploadingLogo(true);
      setFeedback(null);
      const key = `orgs/${orgId}/brand-guidelines/logo-${Date.now()}-${encodeURIComponent(logoFile.name)}`;
      const storageRef = ref(storage, key);
      await uploadBytes(storageRef, logoFile, { contentType: logoFile.type });
      const url = await getDownloadURL(storageRef);
      await setDoc(
        doc(db, "orgs", orgId),
        { brandLogoUrl: url, brandGuidelinesUpdatedAt: serverTimestamp() },
        { merge: true },
      );
      setLogoUrl(url);
      setLogoFile(null);
      setBrandUpdatedAt(new Date());
      setFeedback({ message: "Logo updated successfully.", tone: "success" });
    } catch (error: any) {
      console.error("Failed to upload logo", error);
      setFeedback({ message: error?.message || "Failed to upload logo.", tone: "error" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!orgId || !logoUrl || !canEdit) return;
    if (typeof window !== "undefined" && !window.confirm("Remove the current logo?")) {
      return;
    }
    try {
      setRemovingLogo(true);
      setFeedback(null);
      try {
        const url = new URL(logoUrl);
        const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
        await deleteObject(ref(storage, path));
      } catch (error) {
        console.warn("Could not remove stored logo file", error);
      }
      await setDoc(
        doc(db, "orgs", orgId),
        { brandLogoUrl: null, brandGuidelinesUpdatedAt: serverTimestamp() },
        { merge: true },
      );
      setLogoUrl("");
      setBrandUpdatedAt(new Date());
      setFeedback({
        message: "Logo removed. Upload a new file to refresh your workspace branding.",
        tone: "success",
      });
    } catch (error: any) {
      console.error("Failed to remove logo", error);
      setFeedback({ message: error?.message || "Failed to remove logo.", tone: "error" });
    } finally {
      setRemovingLogo(false);
    }
  };

  const saveGuidelines = async (event: FormEvent) => {
    event.preventDefault();
    if (!orgId || !canEdit) return;
    try {
      setSavingGuidelines(true);
      setFeedback(null);
      await setDoc(
        doc(db, "orgs", orgId),
        { brandGuidelines: sanitiseBrandGuidelines(guidelines), brandGuidelinesUpdatedAt: serverTimestamp() },
        { merge: true },
      );
      setBrandUpdatedAt(new Date());
      setFeedback({ message: "Brand guidelines saved.", tone: "success" });
    } catch (error: any) {
      console.error("Failed to save brand guidelines", error);
      setFeedback({ message: error?.message || "Failed to save brand guidelines.", tone: "error" });
    } finally {
      setSavingGuidelines(false);
    }
  };

  if (!orgId) {
    return (
      <PortalContainer>
        <div className="rounded-3xl border border-rose-100 bg-rose-50 p-6 text-sm text-rose-700">
          Organisation id missing.
        </div>
      </PortalContainer>
    );
  }

  if (loading) {
    return (
      <PortalContainer>
        <div className="grid gap-6">
          <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`brand-guidelines-loading-${index}`} className="h-36 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="grid gap-8">
        <PortalHero
          eyebrow="Brand"
          title={`${orgName} brand guidelines`}
          description="Keep every proposal, deliverable, and production aligned with the latest fonts, colours, and tone."
          metrics={heroMetrics}
          quickActions={quickActions}
        />

        {feedback ? (
          <div
            className={`rounded-2xl border p-4 text-sm ${
              feedback.tone === "error"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        {!canEdit ? (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-600">
            You have view-only access. Contact an organisation admin if you need to update these guidelines.
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm">
          <div className="grid gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Brand assets</h2>
                <p className="text-sm text-slate-500">Upload the primary logo your team should reference across projects.</p>
              </div>
            </div>
            <form onSubmit={handleLogoUpload} className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
              <div className="flex items-center justify-center">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="Brand logo"
                    width={120}
                    height={120}
                    className="h-24 w-24 rounded-2xl border border-slate-200 object-contain p-3"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-400">
                    No logo
                  </div>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Upload new logo
                  <input
                    className="mt-1"
                    type="file"
                    accept="image/*"
                    onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
                    disabled={!canEdit}
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="submit" className="btn btn-sm" disabled={!logoFile || uploadingLogo || !canEdit}>
                    {uploadingLogo ? "Uploading…" : "Upload"}
                  </button>
                  {logoUrl ? (
                    <button
                      type="button"
                      className="btn-outline btn-sm"
                      onClick={handleLogoRemove}
                      disabled={removingLogo || !canEdit}
                    >
                      {removingLogo ? "Removing…" : "Remove logo"}
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          </div>
        </section>

        <form onSubmit={saveGuidelines} className="grid gap-6">
          <section className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm">
            <div className="grid gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Typography</h2>
                <p className="text-sm text-slate-500">Specify the fonts for headings, body copy, and supporting accents.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Primary font
                  <input
                    className="input mt-1"
                    value={guidelines.fonts.primary}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, primary: event.target.value },
                      }))
                    }
                    placeholder="e.g. Poppins"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Secondary font
                  <input
                    className="input mt-1"
                    value={guidelines.fonts.secondary}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, secondary: event.target.value },
                      }))
                    }
                    placeholder="Optional supporting font"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Accent / display font
                  <input
                    className="input mt-1"
                    value={guidelines.fonts.accent}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, accent: event.target.value },
                      }))
                    }
                    placeholder="Optional for highlights"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500 md:col-span-2">
                  Heading style guidance
                  <textarea
                    className="input mt-1"
                    value={guidelines.fonts.headingStyle}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        fonts: { ...prev.fonts, headingStyle: event.target.value },
                      }))
                    }
                    placeholder="e.g. H1 Poppins Bold 40px, body copy Poppins Regular 16px"
                    disabled={!canEdit}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm">
            <div className="grid gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Colour palette</h2>
                <p className="text-sm text-slate-500">
                  Define the hex codes for your brand palette so every asset feels consistent.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Primary colour
                  <input
                    className="input mt-1"
                    value={guidelines.colors.primary}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, primary: event.target.value },
                      }))
                    }
                    placeholder="#215696"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Secondary colour
                  <input
                    className="input mt-1"
                    value={guidelines.colors.secondary}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, secondary: event.target.value },
                      }))
                    }
                    placeholder="#E8793B"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Accent colour
                  <input
                    className="input mt-1"
                    value={guidelines.colors.accent}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, accent: event.target.value },
                      }))
                    }
                    placeholder="#89CFF0"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Neutral colour
                  <input
                    className="input mt-1"
                    value={guidelines.colors.neutral}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, neutral: event.target.value },
                      }))
                    }
                    placeholder="#F0F4F8"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500 md:col-span-2">
                  Highlight colour
                  <input
                    className="input mt-1"
                    value={guidelines.colors.highlight}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, highlight: event.target.value },
                      }))
                    }
                    placeholder="#FFFFFF"
                    disabled={!canEdit}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-5">
                {(
                  ["primary", "secondary", "accent", "neutral", "highlight"] as (keyof BrandGuidelineColors)[]
                ).map((key) => {
                  const label = key.charAt(0).toUpperCase() + key.slice(1);
                  const value = guidelines.colors[key];
                  return (
                    <div key={key} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 text-center">
                      <div
                        className="mx-auto mb-3 h-14 w-14 rounded-full border border-slate-200"
                        style={{ background: value }}
                      />
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                      <p className="mt-1 text-xs font-medium text-slate-600">{value || "—"}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm">
            <div className="grid gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Voice &amp; tone</h2>
                <p className="text-sm text-slate-500">
                  Summarise how your brand should sound in proposals, messaging, and project updates.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Voice principles
                  <textarea
                    className="input mt-1"
                    value={guidelines.voice.voicePrinciples}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        voice: { ...prev.voice, voicePrinciples: event.target.value },
                      }))
                    }
                    placeholder="Strategic • Professional • Clear"
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tone principles
                  <textarea
                    className="input mt-1"
                    value={guidelines.voice.tonePrinciples}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        voice: { ...prev.voice, tonePrinciples: event.target.value },
                      }))
                    }
                    placeholder="Confident • Approachable • Engaging"
                    disabled={!canEdit}
                  />
                </label>
              </div>
              <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                Elevator pitch
                <textarea
                  className="input mt-1"
                  value={guidelines.voice.elevatorPitch}
                  onChange={(event) =>
                    setGuidelines((prev) => ({
                      ...prev,
                      voice: { ...prev.voice, elevatorPitch: event.target.value },
                    }))
                  }
                  placeholder="Summarise your brand promise in one or two sentences."
                  disabled={!canEdit}
                />
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm">
            <div className="grid gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Imagery guidance</h2>
                <p className="text-sm text-slate-500">
                  Describe photography, illustration, or graphic guidelines your team should follow.
                </p>
              </div>
              <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
                Imagery notes
                <textarea
                  className="input mt-1"
                  value={guidelines.imagery.notes}
                  onChange={(event) =>
                    setGuidelines((prev) => ({
                      ...prev,
                      imagery: { ...prev.imagery, notes: event.target.value },
                    }))
                  }
                  placeholder="Bright, collaborative photography with real teams in action."
                  disabled={!canEdit}
                />
              </label>
            </div>
          </section>

          <div className="flex justify-end">
            <button type="submit" className="btn" disabled={!canEdit || savingGuidelines}>
              {savingGuidelines ? "Saving…" : "Save guidelines"}
            </button>
          </div>
        </form>
      </div>
    </PortalContainer>
  );
}
