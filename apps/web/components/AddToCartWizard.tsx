"use client";

import { useEffect, useState } from "react";
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

export default function AddToCartWizard({
  product,
  variationId,
  basePrice,
  onClose,
}: Props) {
  const { add } = useCart();
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [step, setStep] = useState(0);
  const [date, setDate] = useState<string | null>(
    product.category === "exhibition-videography" ? product.eventDate ?? null : null
  );

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

  const toggle = (group: ModifierGroup, optionId: string, checked: boolean) => {
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
    if (!date) return;
    try {
      const reserve = httpsCallable(functions, "reserveKit");
      const res: any = await reserve({ productId: product.id, date });
      const { conflicts = [], kitItems = [], rentalTotal = 0 } = res.data || {};
      if (conflicts.length > 0) {
        alert(
          `Unavailable equipment: ${conflicts
            .map((c: any) => c.name || c.id)
            .join(", ")}`
        );
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
      onClose();
    } catch (err) {
      console.error(err);
      alert("Could not reserve equipment");
    }
  };

  const dateStep = step === totalSteps - 1;
  const canNext = currentGroup
    ? (selected[currentGroup.id] || []).length > 0
    : !!date;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded max-w-md w-full space-y-4">
        {currentGroup ? (
          <div className="space-y-2">
            <p className="font-semibold">{currentGroup.name}</p>
            {currentGroup.options.map((o) => {
              const ids = selected[currentGroup.id] || [];
              const checked = ids.includes(o.id);
              return (
                <label key={o.id} className="flex items-center gap-2 text-sm">
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
                onSelect={setDate}
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
        <div className="flex justify-between pt-2">
          <button className="btn btn-sm" onClick={back}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {dateStep ? (
            <button
              className="btn btn-sm"
              disabled={!date}
              onClick={handleFinish}
            >
              Add to Cart
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

