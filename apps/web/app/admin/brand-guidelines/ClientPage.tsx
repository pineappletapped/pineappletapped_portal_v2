"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { useRoleGate } from "@/hooks/useRoleGate";
import { db, storage } from "@/lib/firebase";
import {
  BrandGuidelinesState,
  DEFAULT_BRAND_GUIDELINES,
  parseBrandGuidelines,
  sanitiseBrandGuidelines,
} from "@/lib/brand-guidelines";

type FeedbackState = { message: string; tone: "success" | "error" } | null;

export default function BrandGuidelinesPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "marketing"]);
  const [loading, setLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [guidelines, setGuidelines] = useState<BrandGuidelinesState>(DEFAULT_BRAND_GUIDELINES);
  const [savingGuidelines, setSavingGuidelines] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  useEffect(() => {
    if (guardLoading) return;
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "branding"));
          if (snap.exists()) {
            const data = snap.data() as any;
            if (typeof data?.logoUrl === "string") {
              setLogoUrl(data.logoUrl);
            }
            setGuidelines(parseBrandGuidelines(data?.brandGuidelines));
          }
      } catch (error) {
        console.error("Failed to load brand guidelines", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  const colorPreview = useMemo(
    () => [
      { label: "Primary", value: guidelines.colors.primary },
      { label: "Secondary", value: guidelines.colors.secondary },
      { label: "Accent", value: guidelines.colors.accent },
      { label: "Neutral", value: guidelines.colors.neutral },
      { label: "Highlight", value: guidelines.colors.highlight },
    ],
    [guidelines.colors],
  );

  const handleLogoUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!logoFile) return;
    try {
      setUploadingLogo(true);
      const key = `site/brand/${Date.now()}-${logoFile.name}`;
      const storageRef = ref(storage, key);
      await uploadBytes(storageRef, logoFile, { contentType: logoFile.type });
      const url = await getDownloadURL(storageRef);
      await setDoc(doc(db, "settings", "branding"), { logoUrl: url }, { merge: true });
      setLogoUrl(url);
      setLogoFile(null);
      setFeedback({ message: "Logo updated successfully.", tone: "success" });
    } catch (error: any) {
      console.error("Failed to upload logo", error);
      setFeedback({ message: error?.message || "Failed to upload logo.", tone: "error" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!logoUrl) return;
    if (!confirm("Remove the current logo?")) return;
    try {
      setRemovingLogo(true);
      try {
        const url = new URL(logoUrl);
        const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
        await deleteObject(ref(storage, path));
      } catch (error) {
        console.warn("Could not remove logo file from storage", error);
      }
      await setDoc(doc(db, "settings", "branding"), { logoUrl: null }, { merge: true });
      setLogoUrl("");
      setFeedback({
        message: "Logo removed. Upload a new one to update the site header.",
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
    try {
      setSavingGuidelines(true);
      setFeedback(null);
      await setDoc(
        doc(db, "settings", "branding"),
        { brandGuidelines: sanitiseBrandGuidelines(guidelines) },
        { merge: true },
      );
      setFeedback({ message: "Brand guidelines saved.", tone: "success" });
    } catch (error: any) {
      console.error("Failed to save brand guidelines", error);
      setFeedback({ message: error?.message || "Failed to save brand guidelines.", tone: "error" });
    } finally {
      setSavingGuidelines(false);
    }
  };

  if (guardLoading || loading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to manage brand guidelines.</p>;
  }

  return (
    <div className="grid gap-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Brand &amp; Content</p>
        <h1 className="text-2xl font-semibold text-gray-900">Brand guidelines</h1>
        <p className="text-sm text-gray-600">
          Centralise your logo, colour palette, typography, and voice so that proposals, marketing, and automation stay on-brand.
        </p>
      </div>

      {feedback ? (
        <div
          className={`rounded-lg p-3 text-sm ${
            feedback.tone === "error"
              ? "border border-rose-200 bg-rose-50 text-rose-900"
              : "border border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <section className="card grid gap-4 p-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Brand assets</h2>
          <p className="text-sm text-gray-600">Upload your primary logo for use across the portal.</p>
        </div>
        <form onSubmit={handleLogoUpload} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Brand logo"
                width={96}
                height={96}
                className="h-20 w-20 rounded-lg border border-gray-200 object-contain p-2"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-gray-300 text-xs text-gray-400">
                No logo
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Upload new logo
              <input
                className="mt-1"
                type="file"
                accept="image/*"
                onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="submit" className="btn btn-sm" disabled={!logoFile || uploadingLogo}>
                {uploadingLogo ? "Uploading…" : "Upload"}
              </button>
              {logoUrl ? (
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={handleLogoRemove}
                  disabled={removingLogo}
                >
                  {removingLogo ? "Removing…" : "Remove logo"}
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      <form onSubmit={saveGuidelines} className="card grid gap-6 p-5">
        <section className="grid gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Typography</h2>
            <p className="text-sm text-gray-600">
              Specify the fonts used for headings, body copy, and supporting accents.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-gray-500">
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
              />
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-gray-500 md:col-span-2">
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
              />
            </label>
          </div>
        </section>

        <section className="grid gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Colour palette</h2>
            <p className="text-sm text-gray-600">
              Define the hex codes for your brand palette. These colours will appear in marketing tools and proposal templates.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                { key: "primary", label: "Primary" },
                { key: "secondary", label: "Secondary" },
                { key: "accent", label: "Accent" },
                { key: "neutral", label: "Neutral" },
                { key: "highlight", label: "Highlight" },
              ] as const
            ).map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 p-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                <span>{label} colour</span>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-16 cursor-pointer rounded border border-gray-200"
                    value={(guidelines.colors as any)[key]}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, [key]: event.target.value },
                      }))
                    }
                  />
                  <input
                    className="input w-28"
                    value={(guidelines.colors as any)[key]}
                    onChange={(event) =>
                      setGuidelines((prev) => ({
                        ...prev,
                        colors: { ...prev.colors, [key]: event.target.value },
                      }))
                    }
                  />
                </div>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {colorPreview.map((swatch) => (
              <div
                key={swatch.label}
                className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 p-3 text-xs"
              >
                <div
                  className="h-12 w-20 rounded-md border border-gray-200"
                  style={{ backgroundColor: swatch.value }}
                />
                <span className="font-semibold text-gray-700">{swatch.label}</span>
                <span className="font-mono text-gray-500">{swatch.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Voice &amp; tone</h2>
              <p className="text-sm text-gray-600">
                Document the pillars that define how Pineapple Tapped sounds across touchpoints.
              </p>
            </div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Core voice principles
              <textarea
                className="input mt-1"
                value={guidelines.voice.voicePrinciples}
                onChange={(event) =>
                  setGuidelines((prev) => ({
                    ...prev,
                    voice: { ...prev.voice, voicePrinciples: event.target.value },
                  }))
                }
                rows={3}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Tone guidance
              <textarea
                className="input mt-1"
                value={guidelines.voice.tonePrinciples}
                onChange={(event) =>
                  setGuidelines((prev) => ({
                    ...prev,
                    voice: { ...prev.voice, tonePrinciples: event.target.value },
                  }))
                }
                rows={3}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Elevator pitch / positioning
              <textarea
                className="input mt-1"
                value={guidelines.voice.elevatorPitch}
                onChange={(event) =>
                  setGuidelines((prev) => ({
                    ...prev,
                    voice: { ...prev.voice, elevatorPitch: event.target.value },
                  }))
                }
                rows={3}
              />
            </label>
          </div>
          <div className="grid gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Imagery &amp; graphics</h2>
              <p className="text-sm text-gray-600">
                Summarise the desired photography style, graphic treatments, and usage notes.
              </p>
            </div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Imagery guidance
              <textarea
                className="input mt-1"
                value={guidelines.imagery.notes}
                onChange={(event) =>
                  setGuidelines((prev) => ({
                    ...prev,
                    imagery: { notes: event.target.value },
                  }))
                }
                rows={8}
              />
            </label>
          </div>
        </section>

        <div className="flex justify-end">
          <button type="submit" className="btn" disabled={savingGuidelines}>
            {savingGuidelines ? "Saving…" : "Save guidelines"}
          </button>
        </div>
      </form>
    </div>
  );
}
