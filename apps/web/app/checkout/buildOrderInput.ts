"use client";

import type { CartItem } from "@/lib/cart";

export interface OrganiserLineItem {
  productId: string;
  variation: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  role: "organiser" | "exhibitor";
}

export interface OrganiserSummaryEntry {
  key: string;
  organiserId: string | null;
  programEnabled: boolean;
  programProductIds: string[];
  commissionRate: number | null;
  minimumGuarantee: number | null;
  exhibitorProductId: string | null;
  exhibitorPrice: number | null;
  upsellVariationIds: string[];
  sources: string[];
  quantity: number;
  grossSubtotal: number;
  exhibitorSubtotal: number;
  organiserSubtotal: number;
  items: OrganiserLineItem[];
}

export interface OrderInputItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  category?: string | null;
  variation?: string | null;
  date?: string | null;
  modifiers?: unknown;
  location?: string | null;
  postalCode?: string | null;
  orderFormResponses?: unknown;
  timeSlot?: unknown;
  coverage?: unknown;
  exhibition?: unknown;
  rentalTotal?: number | null;
  kitStatus?: string | null;
  kitWarnings?: string[] | null;
  campaignBooking?: unknown;
  organiser?: unknown;
}

export interface OrderInputKitItem {
  id: string;
  name?: string | null;
  category?: string | null;
  start: string;
  end: string;
}

export interface CheckoutOrderInput {
  items: OrderInputItem[];
  kitItems: OrderInputKitItem[];
  rentalSubtotal: number;
  kitReservationStatus: "pending" | "confirmed";
  kitReservationWarnings: string[];
  userEmail: string;
  customerName: string;
  companyName: string | null;
  location: string | null;
  postalCode: string | null;
  projectName: string | null;
  voucher: string | null;
  leadSource: string;
  organisers: OrganiserSummaryEntry[];
}

interface CreateOrderInputParams {
  items: CartItem[];
  rentalTotal: number;
  userEmail: string;
  fallbackEmail: string;
  customerName: string;
  companyName: string;
  location: string;
  postalCode: string;
  projectName: string;
  voucher: string;
  leadSource: string;
}

const normaliseString = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

export function createOrderInput({
  items,
  rentalTotal,
  userEmail,
  fallbackEmail,
  customerName,
  companyName,
  location,
  postalCode,
  projectName,
  voucher,
  leadSource,
}: CreateOrderInputParams): CheckoutOrderInput {
  type OrganiserLineRole = "organiser" | "exhibitor";
  type OrganiserAccumulator = {
    key: string;
    organiserId: string | null;
    programEnabled: boolean;
    programProductIds: Set<string>;
    commissionRate: number | null;
    minimumGuarantee: number | null;
    exhibitorProductId: string | null;
    exhibitorPrice: number | null;
    upsellVariationIds: Set<string>;
    sources: Set<string>;
    quantity: number;
    grossSubtotal: number;
    exhibitorSubtotal: number;
    organiserSubtotal: number;
    items: OrganiserLineItem[];
  };

  const organiserMap = new Map<string, OrganiserAccumulator>();

  const itemPayload = items.map<OrderInputItem>((item) => {
    const warnings = Array.isArray(item.kitWarnings)
      ? item.kitWarnings
          .map((warning) => (typeof warning === "string" ? warning.trim() : ""))
          .filter((warning) => warning.length > 0)
      : [];

    const campaignBooking = item.campaignBooking
      ? {
          projectId: item.campaignBooking.projectId,
          bookingId: item.campaignBooking.bookingId,
          slotId: item.campaignBooking.slotId,
          slotLabel: item.campaignBooking.slotLabel,
          slotStartAt: item.campaignBooking.slotStartAt ?? null,
          slotEndAt: item.campaignBooking.slotEndAt ?? null,
          priceClass: item.campaignBooking.priceClass ?? null,
          priceAdjustment: item.campaignBooking.priceAdjustment ?? 0,
        }
      : null;

    const organiser = item.organiser
      ? {
          organiserId: item.organiser.organiserId ?? null,
          minimumGuarantee: item.organiser.minimumGuarantee ?? null,
          exhibitorProductId: item.organiser.exhibitorProductId ?? null,
          exhibitorPrice: item.organiser.exhibitorPrice ?? null,
          upsellVariationIds: item.organiser.upsellVariationIds ?? [],
          commissionRate: item.organiser.commissionRate ?? null,
          programEnabled: item.organiser.programEnabled === true,
          programKey:
            typeof item.organiser.programKey === "string" &&
            item.organiser.programKey.trim().length > 0
              ? item.organiser.programKey.trim()
              : item.organiser.organiserId
                ? item.organiser.organiserId
                : null,
          programProductId: item.organiser.programProductId ?? null,
          source:
            typeof item.organiser.source === "string" &&
            item.organiser.source.trim().length > 0
              ? item.organiser.source.trim()
              : null,
        }
      : null;

    if (organiser) {
      const keyParts = [organiser.organiserId || "unknown"];
      if (organiser.programKey) {
        keyParts.push(organiser.programKey);
      }
      const organiserKey = keyParts.join(":");
      if (!organiserMap.has(organiserKey)) {
        organiserMap.set(organiserKey, {
          key: organiserKey,
          organiserId: organiser.organiserId,
          programEnabled: organiser.programEnabled,
          programProductIds: new Set(
            organiser.programProductId ? [organiser.programProductId] : [],
          ),
          commissionRate: organiser.commissionRate,
          minimumGuarantee: organiser.minimumGuarantee,
          exhibitorProductId: organiser.exhibitorProductId,
          exhibitorPrice: organiser.exhibitorPrice,
          upsellVariationIds: new Set(organiser.upsellVariationIds ?? []),
          sources: new Set(organiser.source ? [organiser.source] : []),
          quantity: 0,
          grossSubtotal: 0,
          exhibitorSubtotal: 0,
          organiserSubtotal: 0,
          items: [],
        });
      }

      const accumulator = organiserMap.get(organiserKey)!;
      accumulator.quantity += item.quantity;
      accumulator.grossSubtotal += item.price * item.quantity;
      const exhibitorLineTotal = organiser.exhibitorPrice
        ? organiser.exhibitorPrice * item.quantity
        : 0;
      accumulator.exhibitorSubtotal += exhibitorLineTotal;
      accumulator.organiserSubtotal += accumulator.grossSubtotal - exhibitorLineTotal;

      const role: OrganiserLineRole = organiser.exhibitorProductId ? "exhibitor" : "organiser";
      accumulator.items.push({
        productId: item.id,
        variation: item.variation ?? null,
        quantity: item.quantity,
        unitPrice: item.price,
        lineTotal: item.price * item.quantity,
        role,
      });

      if (organiser.programProductId) {
        accumulator.programProductIds.add(organiser.programProductId);
      }
      if (organiser.upsellVariationIds) {
        organiser.upsellVariationIds.forEach((id) => {
          if (typeof id === "string" && id.trim().length > 0) {
            accumulator.upsellVariationIds.add(id.trim());
          }
        });
      }
      if (organiser.source) {
        accumulator.sources.add(organiser.source);
      }
    }

    return {
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      category: item.category ?? null,
      variation: item.variation ?? null,
      date: item.date,
      modifiers: item.modifiers ?? [],
      location: item.location ?? null,
      postalCode: item.postalCode ?? null,
      orderFormResponses: item.orderFormResponses ?? null,
      timeSlot: item.timeSlot ?? null,
      coverage: item.coverage ?? null,
      exhibition: item.exhibition ?? null,
      rentalTotal: item.rentalTotal ?? null,
      kitStatus: item.kitStatus ?? null,
      kitWarnings: warnings,
      campaignBooking,
      organiser,
    } satisfies OrderInputItem;
  });

  const kitItemsPayload: OrderInputKitItem[] = items.flatMap((item) => item.kitItems || []);
  const kitReservationStatus: "pending" | "confirmed" = items.some(
    (item) => item.kitStatus === "pending",
  )
    ? "pending"
    : "confirmed";
  const kitReservationWarnings = Array.from(
    new Set(
      items.flatMap((item) =>
        Array.isArray(item.kitWarnings)
          ? item.kitWarnings
              .map((warning) => (typeof warning === "string" ? warning.trim() : ""))
              .filter((warning) => warning.length > 0)
          : [],
      ),
    ),
  );

  const organiserSummary: OrganiserSummaryEntry[] = Array.from(organiserMap.values()).map(
    (entry) => ({
      key: entry.key,
      organiserId: entry.organiserId,
      programEnabled: entry.programEnabled,
      programProductIds: Array.from(entry.programProductIds),
      commissionRate: entry.commissionRate,
      minimumGuarantee: entry.minimumGuarantee,
      exhibitorProductId: entry.exhibitorProductId,
      exhibitorPrice: entry.exhibitorPrice,
      upsellVariationIds: Array.from(entry.upsellVariationIds),
      sources: Array.from(entry.sources),
      quantity: entry.quantity,
      grossSubtotal: entry.grossSubtotal,
      exhibitorSubtotal: entry.exhibitorSubtotal,
      organiserSubtotal: entry.organiserSubtotal,
      items: entry.items,
    }),
  );

  const email = normaliseString(userEmail) || normaliseString(fallbackEmail);

  return {
    items: itemPayload,
    kitItems: kitItemsPayload,
    rentalSubtotal: rentalTotal,
    kitReservationStatus,
    kitReservationWarnings,
    userEmail: email,
    customerName: customerName,
    companyName: normaliseString(companyName) || null,
    location: normaliseString(location) || null,
    postalCode: normaliseString(postalCode) || null,
    projectName: normaliseString(projectName) || null,
    voucher: normaliseString(voucher) || null,
    leadSource,
    organisers: organiserSummary,
  };
}

export interface CheckoutPricingSnapshot {
  productTotal: number;
  rentalTotal: number;
  voucherDiscount: number;
  discountPercent: number;
  discountAmount: number;
  subtotal: number;
  vat: number;
  grandTotal: number;
  hasZeroBalance?: boolean;
  voucherCode?: string | null;
}

export const createIntentPayload = (
  input: CheckoutOrderInput,
  pricing: CheckoutPricingSnapshot,
): string =>
  JSON.stringify({
    order: {
      ...input,
      items: input.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        price: item.price,
        lineTotal: Number.isFinite(item.price * item.quantity)
          ? Number((item.price * item.quantity).toFixed(2))
          : item.price,
        rentalTotal: item.rentalTotal,
        modifiers: item.modifiers,
        kitStatus: item.kitStatus,
        kitWarnings: item.kitWarnings,
        variation: item.variation,
        date: item.date,
        location: item.location,
        postalCode: item.postalCode,
        orderFormResponses: item.orderFormResponses,
        coverage: item.coverage,
        timeSlot: item.timeSlot,
        exhibition: item.exhibition,
        campaignBooking: item.campaignBooking,
        organiser: item.organiser,
      })),
      kitItems: input.kitItems.map((kit) => ({
        id: kit.id,
        name: kit.name ?? null,
        category: kit.category ?? null,
        start: kit.start,
        end: kit.end,
      })),
      kitReservationStatus: input.kitReservationStatus,
      kitReservationWarnings: input.kitReservationWarnings,
      organisers: input.organisers,
    },
    pricing,
  });
