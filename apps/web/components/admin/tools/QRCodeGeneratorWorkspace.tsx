"use client";

import Image from "next/image";
import { useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";

import PortalHero from "@/components/PortalHero";

interface GeneratedCode {
  id: string;
  url: string;
  label: string;
  size: number;
  foreground: string;
  background: string;
  dataUrl: string;
  createdAt: number;
}

const MAX_HISTORY = 8;
const DEFAULT_SIZE = 512;
const DEFAULT_FOREGROUND = "#111827";
const DEFAULT_BACKGROUND = "#ffffff";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80) || "qr-code";
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    console.warn("Unable to parse URL", error);
    return url;
  }
}

export default function QRCodeGeneratorWorkspace() {
  const [linkInput, setLinkInput] = useState("");
  const [label, setLabel] = useState("");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [foreground, setForeground] = useState(DEFAULT_FOREGROUND);
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  const [activeCode, setActiveCode] = useState<GeneratedCode | null>(null);
  const [history, setHistory] = useState<GeneratedCode[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedUrl = useMemo(() => {
    const trimmed = linkInput.trim();
    if (!trimmed) return null;
    try {
      return new URL(trimmed);
    } catch (err) {
      return null;
    }
  }, [linkInput]);

  const codesGenerated = history.length.toString();

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsedUrl) {
      setError("Enter a valid URL including https://");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const canonicalUrl = parsedUrl.toString();
      const trimmedLabel = label.trim();
      const dataUrl = await QRCode.toDataURL(canonicalUrl, {
        width: size,
        margin: 1,
        color: {
          dark: foreground,
          light: background,
        },
        errorCorrectionLevel: "H",
      });

      const code: GeneratedCode = {
        id: createId(),
        url: canonicalUrl,
        label: trimmedLabel,
        size,
        foreground,
        background,
        dataUrl,
        createdAt: Date.now(),
      };

      setActiveCode(code);
      setLinkInput(canonicalUrl);
      setLabel(trimmedLabel);
      setHistory((previous) => {
        const next = [code, ...previous.filter((item) => item.url !== code.url)];
        return next.slice(0, MAX_HISTORY);
      });
    } catch (generationError) {
      console.error("Failed to generate QR code", generationError);
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Unable to generate QR code"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!activeCode) return;

    const downloadNameSource = activeCode.label || getHostname(activeCode.url) || "qr-code";
    const fileName = `${slugify(downloadNameSource)}.png`;
    const link = document.createElement("a");
    link.href = activeCode.dataUrl;
    link.download = fileName;
    link.click();
  };

  return (
    <div className="grid gap-8">
      <PortalHero
        eyebrow="Marketing tools"
        title="QR code generator"
        description="Create branded QR codes for campaign assets, downloadable resources, and franchise activations."
        quickActions={[
          {
            href: "#generator",
            label: "Create a new code",
            description: "Enter your target link and branding",
          },
          ...(activeCode
            ? [
                {
                  onClick: handleDownload,
                  label: "Download PNG",
                  description: "Save the current QR code",
                },
              ]
            : []),
        ]}
        metrics={[
          { label: "Codes this session", value: codesGenerated },
          {
            label: "Active size",
            value: `${activeCode?.size ?? size}px`,
          },
        ]}
        backgroundClass="bg-emerald-600"
      />

      <section id="generator" className="card space-y-6 p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">Generate a QR code</h2>
          <p className="text-sm text-gray-600">
            Paste a full URL, adjust the styling, then download a ready-to-share PNG for your marketing materials.
          </p>
        </header>

        <form className="grid gap-6" onSubmit={handleGenerate}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900" htmlFor="qr-link">
                Destination link
              </label>
              <input
                id="qr-link"
                type="url"
                required
                placeholder="https://"
                className="input"
                value={linkInput}
                onChange={(event) => setLinkInput(event.target.value)}
              />
              <p className="text-xs text-gray-500">
                Include the full URL including https:// so the code routes correctly.
              </p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900" htmlFor="qr-label">
                Friendly label (optional)
              </label>
              <input
                id="qr-label"
                type="text"
                className="input"
                placeholder="Campaign name or usage"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
              <p className="text-xs text-gray-500">
                We use this label for quick reference and file naming.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900" htmlFor="qr-size">
                Size (pixels)
              </label>
              <input
                id="qr-size"
                type="number"
                min={192}
                max={1024}
                step={32}
                className="input"
                value={size}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (Number.isNaN(parsed)) {
                    setSize(DEFAULT_SIZE);
                    return;
                  }
                  setSize(Math.min(1024, Math.max(192, parsed)));
                }}
              />
              <p className="text-xs text-gray-500">Larger sizes suit print collateral.</p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900" htmlFor="qr-foreground">
                Foreground colour
              </label>
              <input
                id="qr-foreground"
                type="color"
                className="h-10 w-full cursor-pointer rounded border border-gray-200 bg-white"
                value={foreground}
                onChange={(event) => setForeground(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-gray-900" htmlFor="qr-background">
                Background colour
              </label>
              <input
                id="qr-background"
                type="color"
                className="h-10 w-full cursor-pointer rounded border border-gray-200 bg-white"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="btn-primary"
              disabled={isGenerating}
            >
              {isGenerating ? "Generating…" : activeCode ? "Generate another" : "Generate QR code"}
            </button>

            {activeCode && (
              <button type="button" className="btn-secondary" onClick={handleDownload}>
                Download PNG
              </button>
            )}

            <p className="text-xs text-gray-500">
              We store your recent codes locally so you can revisit and download them again.
            </p>
          </div>
        </form>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="card space-y-6 p-6">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">Preview</h2>
            <p className="text-sm text-gray-600">
              Use the preview to confirm scannability and colour contrast before you share the asset.
            </p>
          </header>

          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            {activeCode ? (
              <>
                <Image
                  src={activeCode.dataUrl}
                  alt={`QR code for ${activeCode.url}`}
                  width={activeCode.size}
                  height={activeCode.size}
                  unoptimized
                  className="h-auto max-h-[420px] w-full max-w-[320px] rounded-lg bg-white p-4 shadow-sm"
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-900">
                    {activeCode.label || activeCode.url}
                  </p>
                  <p className="text-xs text-gray-500">Generated {formatDate(activeCode.createdAt)}</p>
                </div>
              </>
            ) : (
              <div className="space-y-3 text-sm text-gray-500">
                <p>No code generated yet.</p>
                <p>Fill in the form to produce a QR code and we&apos;ll display it here.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="card space-y-4 p-6">
          <header className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">Recent codes</h2>
            <p className="text-sm text-gray-600">Quickly reopen previously generated QR codes.</p>
          </header>

          {history.length === 0 ? (
            <p className="text-sm text-gray-500">Codes you generate in this session will appear here.</p>
          ) : (
            <ul className="space-y-3">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCode(item);
                      setLinkInput(item.url);
                      setLabel(item.label);
                      setSize(item.size);
                      setForeground(item.foreground);
                      setBackground(item.background);
                    }}
                    className="flex flex-1 items-center gap-3 text-left transition hover:text-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                  >
                    <Image
                      src={item.dataUrl}
                      alt="QR code thumbnail"
                      width={48}
                      height={48}
                      unoptimized
                      className="h-12 w-12 rounded bg-white p-1 shadow"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {item.label || item.url}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(item.createdAt)}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary whitespace-nowrap"
                    onClick={() => {
                      setActiveCode(item);
                      setLinkInput(item.url);
                      setLabel(item.label);
                      setSize(item.size);
                      setForeground(item.foreground);
                      setBackground(item.background);
                      const link = document.createElement("a");
                      link.href = item.dataUrl;
                      link.download = `${slugify(item.label || getHostname(item.url))}.png`;
                      link.click();
                    }}
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </section>
    </div>
  );
}
