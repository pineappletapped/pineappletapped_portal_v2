"use client";

import NextImage from "next/image";
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

  const persistGuidelinesSnapshot = async (next: BrandGuidelinesState) => {
    if (!orgId) return;
    await ensureFirebase();
    await setDoc(
      doc(db, "orgs", orgId),
      { brandGuidelines: sanitiseBrandGuidelines(next), brandGuidelinesUpdatedAt: serverTimestamp() },
      { merge: true },
    );
    setBrandUpdatedAt(new Date());
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

  const handleSecondaryLogoFileChange = (file: File | null) => {
    setSecondaryLogoFile(file);
    if (file && !secondaryLogoName.trim()) {
      const defaultName = file.name.replace(/\.[^/.]+$/, "");
      setSecondaryLogoName(defaultName);
    }
  };

  const handleSecondaryLogoUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!orgId || !canEdit || !secondaryLogoFile) return;
    try {
      setUploadingSecondaryLogo(true);
      setFeedback(null);
      const fileName = secondaryLogoFile.name;
      const key = `orgs/${orgId}/brand-guidelines/secondary/logo-${Date.now()}-${encodeURIComponent(fileName)}`;
      const storageRef = ref(storage, key);
      await uploadBytes(storageRef, secondaryLogoFile, {
        contentType: secondaryLogoFile.type || "image/png",
      });
      const url = await getDownloadURL(storageRef);
      const newLogo: BrandGuidelineLogoAsset = {
        id: createLogoId(),
        name: secondaryLogoName.trim() || fileName,
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
    if (!orgId || !canEdit) return;
    if (typeof window !== "undefined" && !window.confirm("Remove this secondary logo?")) {
      return;
    }
    try {
      setRemovingSecondaryLogoId(logo.id);
      setFeedback(null);
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
    if (!orgId || !canEdit) return;
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
                <p className="text-sm text-slate-500">
                  Upload your primary logo, store alternate marks, and generate ready-to-use monochrome versions for overlays.
                </p>
              </div>
            </div>
            <form onSubmit={handleLogoUpload} className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
              <div className="flex items-center justify-center">
                {logoUrl ? (
                  <NextImage
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
            <div className="grid gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Secondary logos</h3>
                  <p className="text-sm text-slate-500">
                    Store alternate marks, monochrome icons, or vertical layouts with usage notes for the team.
                  </p>
                </div>
              </div>
              {guidelines.assets.secondaryLogos.length ? (
                <ul className="grid gap-3">
                  {guidelines.assets.secondaryLogos.map((asset) => (
                    <li
                      key={asset.id}
                      className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                    >
                      <div className="flex items-center justify-center">
                        <NextImage
                          src={asset.url}
                          alt={asset.name || "Secondary logo"}
                          width={96}
                          height={96}
                          className="h-20 w-20 rounded-xl border border-slate-200 object-contain p-2"
                        />
                      </div>
                      <div className="space-y-2 text-sm text-slate-700">
                        <div>
                          <p className="font-semibold text-slate-900">{asset.name || "Secondary logo"}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {asset.notes || "Add usage notes so production knows when to pick this version."}
                          </p>
                        </div>
                        <a
                          href={asset.url}
                          target="_blank"
                          rel="noreferrer"
                          download
                          className="inline-flex text-xs font-semibold uppercase tracking-wide text-slate-500 underline decoration-slate-300 decoration-2 underline-offset-4"
                        >
                          Download PNG
                        </a>
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          className="btn-outline btn-sm"
                          onClick={() => handleSecondaryLogoRemove(asset)}
                          disabled={removingSecondaryLogoId === asset.id}
                        >
                          {removingSecondaryLogoId === asset.id ? "Removing…" : "Remove"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  No secondary logos yet. Upload additional marks below to give the production team more options.
                </p>
              )}
              {canEdit ? (
                <form onSubmit={handleSecondaryLogoUpload} className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Logo file
                      <input
                        className="mt-1"
                        type="file"
                        accept="image/*"
                        onChange={(event) => handleSecondaryLogoFileChange(event.target.files?.[0] || null)}
                        disabled={!canEdit}
                      />
                    </label>
                    <div className="grid gap-3">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Display name
                        <input
                          className="input mt-1"
                          value={secondaryLogoName}
                          onChange={(event) => setSecondaryLogoName(event.target.value)}
                          placeholder="e.g. Monochrome icon"
                          disabled={!canEdit}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Usage notes
                        <textarea
                          className="input mt-1"
                          rows={3}
                          value={secondaryLogoNotes}
                          onChange={(event) => setSecondaryLogoNotes(event.target.value)}
                          placeholder="When to choose this logo, background requirements, animation notes…"
                          disabled={!canEdit}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="submit"
                      className="btn btn-sm"
                      disabled={!secondaryLogoFile || uploadingSecondaryLogo || !canEdit}
                    >
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
              ) : null}
            </div>
            <div className="grid gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Monochrome logo generator</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Instantly convert a colour logo into all-white or all-black PNGs with preserved transparency for video overlays.
                </p>
              </div>
              {monochromeError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">{monochromeError}</div>
              ) : null}
              <form onSubmit={handleMonochromeSubmit} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                    <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-center">
                      <div className="flex h-32 items-center justify-center rounded-xl bg-slate-900/95">
                        <NextImage
                          src={monochromeVariants.white}
                          alt="White logo preview"
                          width={240}
                          height={120}
                          unoptimized
                          className="max-h-24 w-auto object-contain"
                        />
                      </div>
                      <a
                        href={monochromeVariants.white}
                        download={`${orgName.toLowerCase().replace(/\s+/g, '-') || 'logo'}-white.png`}
                        className="text-xs font-semibold uppercase tracking-wide text-slate-500 underline decoration-slate-300 decoration-2 underline-offset-4"
                      >
                        Download white PNG
                      </a>
                    </div>
                  ) : null}
                  {monochromeVariants.black ? (
                    <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-center">
                      <div className="flex h-32 items-center justify-center rounded-xl bg-slate-100">
                        <NextImage
                          src={monochromeVariants.black}
                          alt="Black logo preview"
                          width={240}
                          height={120}
                          unoptimized
                          className="max-h-24 w-auto object-contain"
                        />
                      </div>
                      <a
                        href={monochromeVariants.black}
                        download={`${orgName.toLowerCase().replace(/\s+/g, '-') || 'logo'}-black.png`}
                        className="text-xs font-semibold uppercase tracking-wide text-slate-500 underline decoration-slate-300 decoration-2 underline-offset-4"
                      >
                        Download black PNG
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Upload a logo file or reuse your saved primary logo to create monochrome overlays in seconds.
                </p>
              )}
            </div>
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
