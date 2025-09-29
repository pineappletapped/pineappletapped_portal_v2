"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Product, ProductModifierSelection } from "@/lib/products";
import { useCart } from "@/lib/cart";
import { db, functions } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import ProductDatePicker from "./ProductDatePicker";

interface ModifierOption {
  id: string;
  name: string;
  price: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  multiple: boolean;
  options: ModifierOption[];
}

interface Props {
  product: Product;
  variationId?: string;
  basePrice: number;
  onClose: () => void;
}

const DRONE_STANDARD_ID = "drone_compliance";

type FunctionsError = {
  code: string;
  message: string;
  details?: unknown;
};

const isFunctionsError = (error: unknown): error is FunctionsError => {
  if (!error || typeof error !== "object") return false;
  if (!("code" in error)) return false;
  const code = (error as any).code;
  return typeof code === "string" && code.length > 0;
};

export default function AddToCartWizard({
  product,
  variationId,
  basePrice,
  onClose,
}: Props) {
  if ((product.salesMode ?? "ecommerce") === "quote") {
    throw new Error("Quote-only products cannot be added to the cart.");
  }
  const { add } = useCart();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(0);
  const [date, setDate] = useState<string | null>(
    product.category === "exhibition-videography" ? product.eventDate ?? null : null
  );
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [liveMessage, setLiveMessage] = useState("Add this product to your cart");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const handleDateSelect = (value: string) => {
    setDate(value);
    setConflicts([]);
    setError(null);
    const spokenDate = new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    setLiveMessage(`Selected ${spokenDate} for production`);
  };

  useEffect(() => {
    async function load() {
      if (!product.modifiers || product.modifiers.length === 0) {
        setGroups([]);
        return;
      }
      const groupIds = Array.from(new Set(product.modifiers.map((m) => m.groupId)));
      const snaps = await Promise.all(
        groupIds.map((id) => getDoc(doc(db, "modifiers", id)))
      );
      const groupsData: ModifierGroup[] = snaps
        .filter((s) => s.exists())
        .map((s) => ({ id: s.id, ...(s.data() as any) })) as any;
      const filtered = groupsData
        .map((g) => {
          const opts = g.options
            .filter((o: any) =>
              product.modifiers?.some((m) => m.groupId === g.id && m.optionId === o.id)
            )
            .map((o: any) => {
              const override = product.modifiers?.find(
                (m) => m.groupId === g.id && m.optionId === o.id
              );
              return { id: o.id, name: o.name, price: override?.price ?? o.price };
            });
          return { ...g, options: opts } as ModifierGroup;
        })
        .filter((g) => g.options.length > 0);
      setGroups(filtered);
    }
    load();
  }, [product]);

  const totalSteps = groups.length + 1; // final step for date
  const currentGroup = step < groups.length ? groups[step] : null;
  const stepLabel = currentGroup
    ? `Choose ${currentGroup.multiple ? "one or more" : "an"} option for ${currentGroup.name}`
    : "Confirm the production date";

  useEffect(() => {
    setLiveMessage(`Step ${step + 1} of ${totalSteps}: ${stepLabel}`);
  }, [step, totalSteps, stepLabel]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const dialogNode = dialogRef.current;
    dialogNode?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab" && dialogNode) {
        const focusable = Array.from(
          dialogNode.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("data-focus-guard"));

        if (focusable.length === 0) {
          event.preventDefault();
          dialogNode.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const isShift = event.shiftKey;
        const active = document.activeElement as HTMLElement;

        if (!isShift && active === last) {
          event.preventDefault();
          first.focus();
        } else if (isShift && active === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const toggle = (group: ModifierGroup, optionId: string, checked: boolean) => {
    setError(null);
    setSelected((prev) => {
      const current = prev[group.id] || [];
      if (group.multiple) {
        const next = checked
          ? [...current, optionId]
          : current.filter((id) => id !== optionId);
        return { ...prev, [group.id]: next };
      }
      return { ...prev, [group.id]: checked ? [optionId] : [] };
    });
  };

  const next = () => setStep((s) => Math.min(s + 1, totalSteps - 1));
  const back = () => {
    if (step === 0) onClose();
    else setStep((s) => s - 1);
  };

  const handleFinish = async () => {
    setError(null);
    setConflicts([]);
    const selections: ProductModifierSelection[] = [];
    let adj = 0;
    groups.forEach((g) => {
      const ids = selected[g.id] || [];
      ids.forEach((id) => {
        const opt = g.options.find((o) => o.id === id);
        if (opt) {
          selections.push({ groupId: g.id, optionId: id, price: opt.price });
          adj += opt.price || 0;
        }
      });
    });
    const price = basePrice + adj;
    if (!date) {
      setError("Select a production date to continue.");
      setLiveMessage("Production date required before adding to cart");
      return;
    }
    setSubmitting(true);
    setLiveMessage("Checking equipment availability");
    try {
      const reserve = httpsCallable(functions, "reserveKit");
      const res: any = await reserve({ productId: product.id, date });
      const { conflicts = [], kitItems = [], rentalTotal = 0 } = res.data || {};
      if (conflicts.length > 0) {
        const conflictNames = conflicts
          .map((c: any) => (c && (c.name || c.id)) || "Unavailable item")
          .filter(Boolean);
        setConflicts(conflictNames);
        setError("Some equipment is already reserved on the selected date.");
        setLiveMessage("Equipment conflicts found for the selected date");
        setSubmitting(false);
        return;
      }
      add({
        id: product.id,
        name: product.name,
        price,
        date,
        variation: variationId,
        modifiers: selections,
        kitItems,
        rentalTotal,
      });
      setLiveMessage("Added to cart");
      setSubmitting(false);
      onClose();
    } catch (err) {
      console.error(err);
      setSubmitting(false);
      if (isFunctionsError(err) && err.code === "failed-precondition") {
        const details = (err as FunctionsError).details as any;
        const missingStandards = Array.isArray(details?.missingStandards)
          ? details.missingStandards.filter(
              (value: unknown): value is string => typeof value === "string"
            )
          : [];
        if (missingStandards.includes(DRONE_STANDARD_ID)) {
          setError(
            "Drone coverage isn't available yet because no registered kit meets the drone compliance standard. Please upload pilot licences and insurance on your equipment before trying again."
          );
          setLiveMessage("Drone compliance missing – reservation blocked");
          return;
        }
        if (missingStandards.length > 0) {
          setError(
            "We need equipment that meets the required standards before this package can be scheduled. Update your kit register or contact the operations team."
          );
          setLiveMessage("Missing required equipment standards");
          return;
        }
      }
      setError("We couldn't reserve the equipment right now. Try again in a moment.");
      setLiveMessage("Reservation failed");
    }
  };

  const dateStep = step === totalSteps - 1;
  const canNext = currentGroup
    ? (selected[currentGroup.id] || []).length > 0
    : !!date;

  const descriptionIds = useMemo(() => {
    const ids = ["wizard-description"];
    if (error) ids.push("wizard-error");
    if (conflicts.length > 0) ids.push("wizard-conflicts");
    return ids.join(" ");
  }, [error, conflicts]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        aria-describedby={descriptionIds}
        tabIndex={-1}
        className="bg-white p-6 rounded-lg shadow-xl max-w-lg w-full space-y-5 focus:outline-none"
      >
        <div className="sr-only" aria-live="polite">
          {liveMessage}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="wizard-title" className="text-lg font-semibold">
              Add {product.name} to your cart
            </h2>
            <p id="wizard-description" className="mt-1 text-sm text-gray-600">
              Step {step + 1} of {totalSteps}. {stepLabel}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close add to cart dialog"
          >
            Close
          </button>
        </div>
        {currentGroup ? (
          <div className="space-y-2">
            <p className="font-semibold">{currentGroup.name}</p>
            {currentGroup.options.map((o) => {
              const ids = selected[currentGroup.id] || [];
              const checked = ids.includes(o.id);
              return (
                <label
                  key={o.id}
                  className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm hover:border-gray-300 focus-within:border-orange-400"
                >
                  <input
                    type={currentGroup.multiple ? "checkbox" : "radio"}
                    name={`mod-${currentGroup.id}`}
                    checked={checked}
                    onChange={(e) => toggle(currentGroup, o.id, e.target.checked)}
                  />
                  <span>
                    {o.name}
                    {o.price ? ` (+£${o.price.toFixed(2)})` : ""}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="font-semibold">Production Date</p>
            {product.category !== "exhibition-videography" ? (
              <ProductDatePicker
                productId={product.id}
                selected={date}
                onSelect={handleDateSelect}
              />
            ) : product.eventDate ? (
              <p className="text-sm">
                {new Date(product.eventDate).toLocaleDateString()}
              </p>
            ) : (
              <p className="text-sm">To be confirmed</p>
            )}
          </div>
        )}
        {error && (
          <div
            id="wizard-error"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p id="wizard-conflicts" className="font-medium">
              The following items are unavailable on {date}:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {conflicts.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <p className="mt-2">
              Choose a different date or adjust your selections to continue.
            </p>
          </div>
        )}
        <div className="flex justify-between pt-2">
          <button className="btn btn-sm" onClick={back}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {dateStep ? (
            <button
              className="btn btn-sm"
              disabled={!date || submitting}
              onClick={handleFinish}
            >
              {submitting ? "Adding…" : "Add to Cart"}
            </button>
          ) : (
            <button
              className="btn btn-sm"
              disabled={!canNext}
              onClick={next}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

