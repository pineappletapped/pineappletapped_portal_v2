"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { httpsCallable } from "firebase/functions";
import { Product } from "@/lib/products";
import { ensureFirebase } from "@/lib/firebase";
import { useLeadSourceTag } from "@/hooks/useLeadSourceTag";

interface VariationSummary {
  id: string;
  label: string;
}

interface ProductQuoteRequestDialogProps {
  product: Product;
  open: boolean;
  onClose: () => void;
  variation?: VariationSummary | null;
}

type QuoteStatus = "idle" | "sending" | "success";

export default function ProductQuoteRequestDialog({
  product,
  open,
  onClose,
  variation,
}: ProductQuoteRequestDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const { value: leadSource } = useLeadSourceTag(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [projectName, setProjectName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueLocation, setVenueLocation] = useState("");
  const [requirements, setRequirements] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [status, setStatus] = useState<QuoteStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab" && dialogRef.current) {
        const node = dialogRef.current;
        const focusable = Array.from(
          node.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("data-focus-guard"));
        if (focusable.length === 0) {
          event.preventDefault();
          node.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
          return;
        }
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setError(null);
      return;
    }
  }, [open]);

  const note = useMemo(() => {
    const parts: string[] = [];
    if (variation?.label) {
      parts.push(`Package: ${variation.label}`);
    }
    if (venueName.trim()) {
      parts.push(`Venue: ${venueName.trim()}`);
    }
    if (venueLocation.trim()) {
      parts.push(venueLocation.trim());
    }
    if (requirements.trim()) {
      parts.push(`Requirements: ${requirements.trim()}`);
    }
    return parts.length > 0 ? parts.join(" | ") : null;
  }, [variation, venueName, venueLocation, requirements]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      const { functions } = await ensureFirebase();
      if (!functions) {
        throw new Error("Quote service is currently unavailable.");
      }
      const callable = httpsCallable(functions, "quote_request_public");
      const payload: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        company: company.trim() || null,
        projectName: projectName.trim() || null,
        productionPeriod: eventDate.trim() || null,
        eventDate: eventDate.trim() || null,
        venueName: venueName.trim() || null,
        venueLocation: venueLocation.trim() || null,
        requirements: requirements.trim() || null,
        customRequest: additionalNotes.trim() || null,
        originProductId: product.id,
        quoteMode: "product",
        salesMode: "quote",
        leadSource,
      };
      const item: Record<string, unknown> = {
        productId: product.id,
      };
      if (variation?.id) {
        item.variationId = variation.id;
      }
      if (variation?.label) {
        item.variationName = variation.label;
      }
      if (note) {
        item.note = note;
      }
      payload.items = [item];
      await callable(payload);
      setStatus("success");
      setName("");
      setEmail("");
      setCompany("");
      setProjectName("");
      setEventDate("");
      setVenueName("");
      setVenueLocation("");
      setRequirements("");
      setAdditionalNotes("");
    } catch (err) {
      console.error("Failed to submit quote request", err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Failed to submit quote request. Please try again."
      );
      setStatus("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-quote-title"
        className="w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="product-quote-title" className="text-lg font-semibold">
              Request a bespoke quote
            </h2>
            <p className="text-sm text-gray-600">
              Share a few details and the Pineapple Tapped team will follow up with a tailored proposal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm"
            aria-label="Close quote form"
          >
            Close
          </button>
        </div>
        {status === "success" ? (
          <div className="mt-6 grid gap-3 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            <p className="font-medium">Thanks! We have your request.</p>
            <p>
              Our team will review the details and be in touch shortly to shape the perfect package for {product.name}.
            </p>
            <button type="button" className="btn btn-sm w-fit" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
            {error && (
              <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Your name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Email</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Company (optional)</span>
              <input
                className="input"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Project name (optional)</span>
              <input
                className="input"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Event or shoot date</span>
              <input
                className="input"
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Venue name</span>
                <input
                  className="input"
                  value={venueName}
                  onChange={(event) => setVenueName(event.target.value)}
                  placeholder="e.g. Grand Conference Hall"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Venue location</span>
                <input
                  className="input"
                  value={venueLocation}
                  onChange={(event) => setVenueLocation(event.target.value)}
                  placeholder="City, region or address"
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Tell us about your requirements</span>
              <textarea
                className="input min-h-[120px]"
                value={requirements}
                onChange={(event) => setRequirements(event.target.value)}
                required
                placeholder="Share the scale, deliverables or special considerations we should know about"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Additional notes (optional)</span>
              <textarea
                className="input min-h-[80px]"
                value={additionalNotes}
                onChange={(event) => setAdditionalNotes(event.target.value)}
                placeholder="Share any extra context or budget guidance"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className={clsx("btn", status === "sending" && "opacity-75")}
                disabled={status === "sending"}
              >
                {status === "sending" ? "Sending…" : "Send request"}
              </button>
              {variation?.label && (
                <span className="text-xs text-gray-600">
                  Selected package: {variation.label}
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
