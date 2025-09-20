"use client";

import { useEffect, useState } from "react";
import { Product } from "@/lib/products";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

interface ModifierOption {
  id: string;
  name: string;
  price: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  options: ModifierOption[];
}

export default function ProductModifierSummary({ product }: { product: Product }) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);

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
          return { id: g.id, name: g.name, options: opts } as ModifierGroup;
        })
        .filter((g) => g.options.length > 0);
      setGroups(filtered);
    }
    load();
  }, [product]);

  if (groups.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Available Options</h2>
      <div className="flex flex-wrap gap-4">
        {groups.map((g) => (
          <div key={g.id} className="border rounded p-3 min-w-[150px]">
            <p className="font-medium text-sm mb-1">{g.name}</p>
            <ul className="text-xs text-gray-700 list-disc pl-4 space-y-1">
              {g.options.map((o) => (
                <li key={o.id}>
                  {o.name}
                  {o.price ? ` (+£${o.price.toFixed(2)})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

