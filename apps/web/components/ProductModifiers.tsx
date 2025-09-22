"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { Product, ProductModifierSelection } from "@/lib/products";

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

export default function ProductModifiers({
  product,
  onChange,
}: {
  product: Product;
  onChange: (
    selections: ProductModifierSelection[],
    priceAdj: number,
    complete: boolean,
    label: string
  ) => void;
}) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  useEffect(() => {
    async function load() {
      const configuredModifiers = Array.isArray(product.modifiers)
        ? product.modifiers
        : [];
      const groupIds = (product.modifierGroups?.length
        ? product.modifierGroups
        : Array.from(new Set(configuredModifiers.map((m) => m.groupId))))
        .filter((id) =>
          configuredModifiers.some((modifier) => modifier.groupId === id)
        );
      if (groupIds.length === 0) {
        setGroups([]);
        onChange([], 0, true, "");
        return;
      }
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
              configuredModifiers.some(
                (m) => m.groupId === g.id && m.optionId === o.id
              )
            )
            .map((o: any) => {
              const override = configuredModifiers.find(
                (m) => m.groupId === g.id && m.optionId === o.id
              );
              return { id: o.id, name: o.name, price: override?.price ?? o.price };
            });
          return { ...g, options: opts } as ModifierGroup;
        })
        .filter((g) => g.options.length > 0);
      setGroups(filtered);
      setSelected({});
      onChange([], 0, filtered.length === 0, "");
    }
    load();
  }, [product, onChange]);

  useEffect(() => {
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
    const complete = groups.every((g) => (selected[g.id] || []).length > 0);
    const labels: string[] = [];
    selections.forEach((sel) => {
      const g = groups.find((gr) => gr.id === sel.groupId);
      const o = g?.options.find((op) => op.id === sel.optionId);
      if (g && o) labels.push(`${g.name}: ${o.name}`);
    });
    onChange(selections, adj, complete, labels.join(", "));
  }, [selected, groups, onChange]);

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

  if (groups.length === 0) return null;

  return (
    <div className="grid gap-4">
      {groups.map((g) => (
        <div key={g.id} className="border p-4 rounded grid gap-2">
          <p className="font-medium">{g.name}</p>
          {g.options.map((o) => {
            const ids = selected[g.id] || [];
            const checked = ids.includes(o.id);
            return (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input
                  type={g.multiple ? "checkbox" : "radio"}
                  name={`mod-${g.id}`}
                  checked={checked}
                  onChange={(e) => toggle(g, o.id, e.target.checked)}
                />
                <span>
                  {o.name}
                  {o.price ? ` (+£${o.price.toFixed(2)})` : ""}
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

