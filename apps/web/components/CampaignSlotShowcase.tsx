"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";

import { Product } from "@/lib/products";
import { db } from "@/lib/firebase";
import { getPriceForTier } from "@/lib/pricing";

interface CampaignSlotShowcaseProps {
  product: Product;
}

interface CampaignSlotRecord {
  id: string;
  label: string;
  startAt: string | null;
  endAt: string | null;
  capacity: number;
  booked: number;
  priceClass: string | null;
  priceAdjustment: number;
  notes: string;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

const slotWindowFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function parseSlotDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSlotWindow(slot: CampaignSlotRecord): string {
  const start = parseSlotDate(slot.startAt);
  const end = parseSlotDate(slot.endAt);
  if (start && end) {
    return `${slotWindowFormatter.format(start)} – ${slotWindowFormatter.format(end)}`;
  }
  if (start) {
    return slotWindowFormatter.format(start);
  }
  if (end) {
    return `Ends ${slotWindowFormatter.format(end)}`;
  }
  return slot.label;
}

export default function CampaignSlotShowcase({ product }: CampaignSlotShowcaseProps) {
  const campaignConfig = product.campaignBooking;
  const [slots, setSlots] = useState<CampaignSlotRecord[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const basePrice = useMemo(() => getPriceForTier(product.price, product.priceTiers ?? null, 1), [product]);
  const priceAdjustments = useMemo(() => {
    const map = new Map<string, number>();
    const raw = campaignConfig?.priceClassAdjustments ?? {};
    Object.entries(raw).forEach(([key, value]) => {
      if (typeof key !== "string") {
        return;
      }
      const numeric = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }
      map.set(key.trim().toLowerCase(), numeric);
    });
    return map;
  }, [campaignConfig?.priceClassAdjustments]);

  useEffect(() => {
    if (!campaignConfig?.projectId || !campaignConfig.bookingId) {
      setSlots([]);
      setStatus("idle");
      setError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      setError(null);
      try {
        const bookingRef = doc(
          db,
          "projects",
          campaignConfig.projectId,
          "projectBookings",
          campaignConfig.bookingId
        );
        const [bookingSnap, responsesSnap] = await Promise.all([
          getDoc(bookingRef),
          getDocs(collection(bookingRef, "responses")),
        ]);
        if (!bookingSnap.exists()) {
          throw new Error("Campaign schedule is not available.");
        }
        const raw = (bookingSnap.data() as Record<string, any>) ?? {};
        const slotResponses = new Map<string, number>();
        responsesSnap.forEach((docSnap) => {
          const data = (docSnap.data() as Record<string, any>) ?? {};
          const slotId =
            typeof data.slotId === "string" && data.slotId.trim().length > 0 ? data.slotId.trim() : null;
          if (!slotId) {
            return;
          }
          const statusValue =
            typeof data.status === "string" && data.status.trim().length > 0
              ? data.status.trim().toLowerCase()
              : "pending";
          if (statusValue === "cancelled" || statusValue === "declined") {
            return;
          }
          slotResponses.set(slotId, (slotResponses.get(slotId) ?? 0) + 1);
        });
        const slotsInput: any[] = Array.isArray(raw.slots) ? raw.slots : [];
        const parsedSlots: CampaignSlotRecord[] = slotsInput
          .map((slot, index) => {
            if (!slot || typeof slot !== "object") {
              return null;
            }
            const id =
              typeof slot.id === "string" && slot.id.trim().length > 0
                ? slot.id.trim()
                : `${campaignConfig.bookingId}-slot-${index + 1}`;
            const label =
              typeof slot.label === "string" && slot.label.trim().length > 0
                ? slot.label.trim()
                : `Slot ${index + 1}`;
            const startAt = typeof slot.startAt === "string" ? slot.startAt : null;
            const endAt = typeof slot.endAt === "string" ? slot.endAt : null;
            let capacity = 1;
            if (typeof slot.capacity === "number" && Number.isFinite(slot.capacity)) {
              capacity = Math.max(1, Math.round(slot.capacity));
            } else if (typeof slot.capacity === "string") {
              const parsedCapacity = Number.parseInt(slot.capacity, 10);
              if (Number.isFinite(parsedCapacity)) {
                capacity = Math.max(1, Math.round(parsedCapacity));
              }
            }
            const priceClass =
              typeof slot.priceClass === "string" && slot.priceClass.trim().length > 0
                ? slot.priceClass.trim()
                : null;
            const priceAdjustment =
              priceClass && priceAdjustments.has(priceClass.toLowerCase())
                ? priceAdjustments.get(priceClass.toLowerCase()) ?? 0
                : 0;
            const notes = typeof slot.notes === "string" ? slot.notes : "";
            const booked = slotResponses.get(id) ?? 0;
            return {
              id,
              label,
              startAt,
              endAt,
              capacity,
              booked,
              priceClass,
              priceAdjustment,
              notes,
            } satisfies CampaignSlotRecord;
          })
          .filter((slot): slot is CampaignSlotRecord => Boolean(slot));
        if (!cancelled) {
          setSlots(parsedSlots);
          setStatus("success");
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load campaign slots", err);
        setSlots([]);
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unable to load campaign availability.");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [campaignConfig?.bookingId, campaignConfig?.projectId, priceAdjustments]);

  if (!campaignConfig) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Campaign availability</h2>
        <p className="mt-2 text-sm text-gray-600">
          This campaign is being finalised. Check back soon for a full list of available slots.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Available campaign slots</h2>
      <p className="mt-1 text-sm text-gray-600">
        Review the current schedule before booking. Pricing reflects the base package plus any slot-specific
        adjustments.
      </p>
      {status === "loading" ? (
        <p className="mt-4 text-sm text-gray-500">Loading availability…</p>
      ) : status === "error" && error ? (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      ) : slots.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No public slots are available right now. Please check back later or contact the team for bespoke options.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {slots.map((slot) => {
            const remaining = Math.max(slot.capacity - slot.booked, 0);
            const slotPrice = basePrice + slot.priceAdjustment;
            return (
              <li key={slot.id} className="rounded-md border border-gray-200 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{slot.label}</p>
                    <p className="text-xs text-gray-600">{formatSlotWindow(slot)}</p>
                    {slot.notes && <p className="text-xs text-gray-500">{slot.notes}</p>}
                  </div>
                  <div className="text-sm text-right font-semibold text-gray-900">
                    {GBP.format(slotPrice)}
                    {slot.priceClass && (
                      <span className="block text-xs font-normal text-gray-500">{slot.priceClass}</span>
                    )}
                  </div>
                </div>
                <p className={`mt-2 text-xs ${remaining > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {remaining > 0
                    ? `${remaining} of ${slot.capacity} spaces available`
                    : "Fully booked"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
