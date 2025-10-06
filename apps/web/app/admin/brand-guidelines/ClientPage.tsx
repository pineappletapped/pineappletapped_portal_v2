"use client";

import NextImage from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { useRoleGate } from "@/hooks/useRoleGate";
import { ensureFirebase } from "@/lib/firebase";
import {
  BrandGuidelineLogoAsset,
  BrandGuidelinesState,
  DEFAULT_BRAND_GUIDELINES,
  parseBrandGuidelines,
  sanitiseBrandGuidelines,
} from "@/lib/brand-guidelines";

const createLogoId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `logo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = document.createElement("img");
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load logo preview"));
    image.src = src;
  });

type FeedbackState = { message: string; tone: "success" | "error" } | null;

export default function BrandGuidelinesPage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "marketing"]);
  const [loading, setLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [guidelines, setGuidelines] = useState<BrandGuidelinesState>(DEFAULT_BRAND_GUIDELINES);
  const [secondaryLogoFile, setSecondaryLogoFile] = useState<File | null>(null);
  const [secondaryLogoName, setSecondaryLogoName] = useState("");
  const [secondaryLogoNotes, setSecondaryLogoNotes] = useState("");
  const [uploadingSecondaryLogo, setUploadingSecondaryLogo] = useState(false);
  const [removingSecondaryLogoId, setRemovingSecondaryLogoId] = useState<string | null>(null);
  const [monochromeSourceFile, setMonochromeSourceFile] = useState<File | null>(null);
  const [monochromeGenerating, setMonochromeGenerating] = useState(false);
  const [monochromeVariants, setMonochromeVariants] = useState<{ white?: string; black?: string }>({});
  const [monochromeError, setMonochromeError] = useState<string | null>(null);
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
        const { db } = await ensureFirebase();
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

  const handleSecondaryLogoFileChange = (file: File | null) => {
    setSecondaryLogoFile(file);
    if (file && !secondaryLogoName.trim()) {
      const defaultName = file.name.replace(/\.[^/.]+$/, "");
      setSecondaryLogoName(defaultName);
    }
  };

  const persistGuidelinesSnapshot = async (next: BrandGuidelinesState) => {
    const { db } = await ensureFirebase();
    await setDoc(doc(db, "settings", "branding"), { brandGuidelines: sanitiseBrandGuidelines(next) }, { merge: true });
  };

  const convertImageToVariant = (image: HTMLImageElement, variant: "white" | "black"): string => {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      throw new Error("Logo must have a valid width and height.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to process logo. Try a different browser.");
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha === 0) {
        continue;
      }
      if (variant === "white") {
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 255;
      } else {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
      }
    }
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  };

  const generateMonochromeVariants = async (source: { file?: File | null; url?: string }) => {
    try {
      setMonochromeGenerating(true);
      setMonochromeError(null);
      setMonochromeVariants({});
      let dataUrl: string | null = null;
      if (source.file) {
        dataUrl = await readBlobAsDataUrl(source.file);
      } else if (source.url) {
        const response = await fetch(source.url);
        if (!response.ok) {
          throw new Error("Could not download the logo. Try uploading a file instead.");
        }
        const blob = await response.blob();
        dataUrl = await readBlobAsDataUrl(blob);
      }
      if (!dataUrl) {
        throw new Error("Select a logo file or upload a primary logo first.");
      }
      const image = await loadImageElement(dataUrl);
      const whiteVariant = convertImageToVariant(image, "white");
      const blackVariant = convertImageToVariant(image, "black");
      setMonochromeVariants({ white: whiteVariant, black: blackVariant });
    } catch (error: any) {
      console.error("Failed to generate monochrome logos", error);
      setMonochromeError(error?.message || "Unable to generate variants. Try a different file.");
    } finally {
      setMonochromeGenerating(false);
    }
  };

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
      const { db, storage } = await ensureFirebase();
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
      const { db, storage } = await ensureFirebase();
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

  const handleSecondaryLogoUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!secondaryLogoFile) return;
    try {
      setUploadingSecondaryLogo(true);
      setFeedback(null);
      const { db, storage } = await ensureFirebase();
      const key = `site/brand/secondary/logo-${Date.now()}-${encodeURIComponent(secondaryLogoFile.name)}`;
      const storageRef = ref(storage, key);
      await uploadBytes(storageRef, secondaryLogoFile, {
        contentType: secondaryLogoFile.type || "image/png",
      });
      const url = await getDownloadURL(storageRef);
      const newLogo: BrandGuidelineLogoAsset = {
        id: createLogoId(),
        name: secondaryLogoName.trim() || secondaryLogoFile.name,
        notes: secondaryLogoNotes.trim(),
        url,
        storagePath: key,
      };
      const nextGuidelines: BrandGuidelinesState = {
        ...guidelines,
        assets: {
          ...guidelines.assets,
          secondaryLogos: [...guidelines.assets.secondaryLogos, newLogo],
        },
      };
      setGuidelines(nextGuidelines);
      await persistGuidelinesSnapshot(nextGuidelines);
      setSecondaryLogoFile(null);
      setSecondaryLogoName("");
      setSecondaryLogoNotes("");
      setFeedback({ message: "Secondary logo uploaded.", tone: "success" });
    } catch (error: any) {
      console.error("Failed to upload secondary logo", error);
      setFeedback({ message: error?.message || "Failed to upload secondary logo.", tone: "error" });
    } finally {
      setUploadingSecondaryLogo(false);
    }
  };

  const handleSecondaryLogoRemove = async (logo: BrandGuidelineLogoAsset) => {
    if (!confirm("Remove this secondary logo?")) return;
    try {
      setRemovingSecondaryLogoId(logo.id);
      setFeedback(null);
      const { db, storage } = await ensureFirebase();
      if (logo.storagePath) {
        try {
          await deleteObject(ref(storage, logo.storagePath));
        } catch (error) {
          console.warn("Could not remove secondary logo from storage", error);
        }
      } else if (logo.url) {
        try {
          const url = new URL(logo.url);
          const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
          await deleteObject(ref(storage, path));
        } catch (error) {
          console.warn("Could not resolve storage path for secondary logo", error);
        }
      }
      const nextGuidelines: BrandGuidelinesState = {
        ...guidelines,
        assets: {
          ...guidelines.assets,
          secondaryLogos: guidelines.assets.secondaryLogos.filter((item) => item.id !== logo.id),
        },
      };
      setGuidelines(nextGuidelines);
      await persistGuidelinesSnapshot(nextGuidelines);
      setFeedback({ message: "Secondary logo removed.", tone: "success" });
    } catch (error: any) {
      console.error("Failed to remove secondary logo", error);
      setFeedback({ message: error?.message || "Failed to remove secondary logo.", tone: "error" });
    } finally {
      setRemovingSecondaryLogoId(null);
    }
  };

  const handleMonochromeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!monochromeSourceFile) {
      setMonochromeError("Choose a logo file to convert.");
      return;
    }
    await generateMonochromeVariants({ file: monochromeSourceFile });
  };

  const handleMonochromeFromPrimary = async () => {
    if (!logoUrl) {
      setMonochromeError("Upload your primary logo first or choose a file to convert.");
      return;
    }
    await generateMonochromeVariants({ url: logoUrl });
  };

  const saveGuidelines = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setSavingGuidelines(true);
      setFeedback(null);
      await persistGuidelinesSnapshot(guidelines);
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
          <p className="text-sm text-gray-600">
            Upload your primary logo, catalogue alternate versions, and instantly generate monochrome overlays for marketing and production teams.
          </p>
        </div>
        <form onSubmit={handleLogoUpload} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <NextImage
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
        <div className="grid gap-4 rounded-lg border border-gray-200/80 bg-gray-50/70 p-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Secondary logos</h3>
            <p className="mt-1 text-sm text-gray-600">
              Save monochrome icons, stacked versions, or campaign-specific marks with guidance for when to use them.
            </p>
          </div>
          {guidelines.assets.secondaryLogos.length ? (
            <ul className="grid gap-3">
              {guidelines.assets.secondaryLogos.map((asset) => (
                <li
                  key={asset.id}
                  className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                >
                  <div className="flex items-center justify-center">
                    <NextImage
                      src={asset.url}
                      alt={asset.name || "Secondary logo"}
                      width={88}
                      height={88}
                      className="h-20 w-20 rounded-lg border border-gray-200 object-contain p-2"
                    />
                  </div>
                  <div className="space-y-2 text-sm text-gray-700">
                    <div>
                      <p className="font-semibold text-gray-900">{asset.name || "Secondary logo"}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {asset.notes || "Add notes so teams know when this variation should be used."}
                      </p>
                    </div>
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="inline-flex text-xs font-semibold uppercase tracking-wide text-gray-500 underline decoration-gray-300 decoration-2 underline-offset-4"
                    >
                      Download PNG
                    </a>
                  </div>
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    onClick={() => handleSecondaryLogoRemove(asset)}
                    disabled={removingSecondaryLogoId === asset.id}
                  >
                    {removingSecondaryLogoId === asset.id ? "Removing…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-600">
              No alternate logos yet. Upload additional marks below to keep campaign assets consistent.
            </p>
          )}
          <form onSubmit={handleSecondaryLogoUpload} className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Logo file
                <input
                  className="mt-1"
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleSecondaryLogoFileChange(event.target.files?.[0] || null)}
                />
              </label>
              <div className="grid gap-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Display name
                  <input
                    className="input mt-1"
                    value={secondaryLogoName}
                    onChange={(event) => setSecondaryLogoName(event.target.value)}
                    placeholder="e.g. White icon"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Usage notes
                  <textarea
                    className="input mt-1"
                    rows={3}
                    value={secondaryLogoNotes}
                    onChange={(event) => setSecondaryLogoNotes(event.target.value)}
                    placeholder="When to use this version, background considerations, animation notes…"
                  />
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="submit" className="btn btn-sm" disabled={!secondaryLogoFile || uploadingSecondaryLogo}>
                {uploadingSecondaryLogo ? "Uploading…" : "Upload secondary logo"}
              </button>
              {secondaryLogoFile ? (
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => {
                    handleSecondaryLogoFileChange(null);
                    setSecondaryLogoName("");
                    setSecondaryLogoNotes("");
                  }}
                  disabled={uploadingSecondaryLogo}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </form>
        </div>
        <div className="grid gap-4 rounded-lg border border-gray-200/80 bg-gray-50/70 p-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Monochrome logo generator</h3>
            <p className="mt-1 text-sm text-gray-600">
              Create transparent all-white and all-black PNGs for video overlays and merchandise with one click.
            </p>
          </div>
          {monochromeError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">{monochromeError}</div>
          ) : null}
          <form onSubmit={handleMonochromeSubmit} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Choose logo file
              <input
                className="mt-1"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setMonochromeVariants({});
                  setMonochromeError(null);
                  setMonochromeSourceFile(event.target.files?.[0] || null);
                }}
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="submit" className="btn btn-sm" disabled={!monochromeSourceFile || monochromeGenerating}>
                {monochromeGenerating ? "Generating…" : "Generate variants"}
              </button>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={handleMonochromeFromPrimary}
                disabled={monochromeGenerating || !logoUrl}
              >
                Use saved primary logo
              </button>
            </div>
          </form>
          {monochromeVariants.white || monochromeVariants.black ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {monochromeVariants.white ? (
                <div className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 text-center">
                  <div className="flex h-28 items-center justify-center rounded-md bg-gray-900">
                    <NextImage
                      src={monochromeVariants.white}
                      alt="White logo preview"
                      width={220}
                      height={110}
                      unoptimized
                      className="max-h-20 w-auto object-contain"
                    />
                  </div>
                  <a
                    href={monochromeVariants.white}
                    download={`brand-white-logo.png`}
                    className="text-xs font-semibold uppercase tracking-wide text-gray-500 underline decoration-gray-300 decoration-2 underline-offset-4"
                  >
                    Download white PNG
                  </a>
                </div>
              ) : null}
              {monochromeVariants.black ? (
                <div className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 text-center">
                  <div className="flex h-28 items-center justify-center rounded-md bg-gray-100">
                    <NextImage
                      src={monochromeVariants.black}
                      alt="Black logo preview"
                      width={220}
                      height={110}
                      unoptimized
                      className="max-h-20 w-auto object-contain"
                    />
                  </div>
                  <a
                    href={monochromeVariants.black}
                    download={`brand-black-logo.png`}
                    className="text-xs font-semibold uppercase tracking-wide text-gray-500 underline decoration-gray-300 decoration-2 underline-offset-4"
                  >
                    Download black PNG
                  </a>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-gray-600">Upload a logo file or reuse the saved primary mark to create monochrome variants in seconds.</p>
          )}
        </div>
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
