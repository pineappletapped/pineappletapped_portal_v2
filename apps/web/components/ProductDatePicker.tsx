"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";

export type ProductAvailabilityStatus =
  | "available"
  | "pending"
  | "booked"
  | "unavailable";

interface Props {
  productId: string;
  selected: string | null;
  onSelect: (date: string) => void;
}

export default function ProductDatePicker({
  productId,
  selected,
  onSelect,
}: Props) {
  const today = new Date();
  const [view, setView] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [availability, setAvailability] = useState<Record<string, ProductAvailabilityStatus>>({});

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDocs(
          collection(db, "productAvailability", productId, "dates")
        );
        const map: Record<string, ProductAvailabilityStatus> = {};
        snap.forEach((doc) => {
          map[doc.id] = (doc.data().status as ProductAvailabilityStatus) || "available";
        });
        setAvailability(map);
      } catch (e) {
        // ignore if firestore not available
      }
    }
    load();
  }, [productId]);

  const y = view.getFullYear();
  const m = view.getMonth();

  const days = useMemo(() => {
    const first = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const arr: (number | null)[] = Array(first).fill(null);
    for (let d = 1; d <= total; d++) arr.push(d);
    return arr;
  }, [y, m]);

  const cellClasses = (status: ProductAvailabilityStatus, date: string) => {
    let base = "p-1 text-xs rounded";
    switch (status) {
      case "available":
        base += " bg-green-500 text-white";
        break;
      case "pending":
        base += " bg-yellow-400";
        break;
      case "booked":
        base += " bg-red-500 text-white cursor-not-allowed";
        break;
      default:
        base += " bg-gray-200 cursor-not-allowed";
    }
    if (selected === date) base += " ring-2 ring-orange";
    return base;
  };

  const handleSelect = (date: string, status: ProductAvailabilityStatus) => {
    if (status === "available" || status === "pending") {
      onSelect(date);
    }
  };

  return (
    <div className="max-w-xs text-xs">
      <div className="flex items-center justify-between mb-1">
        <button
          className="btn btn-xs"
          onClick={() =>
            setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))
          }
        >
          ‹
        </button>
        <span>
          {view.toLocaleString("default", { month: "long" })} {y}
        </span>
        <button
          className="btn btn-xs"
          onClick={() =>
            setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))
          }
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(
            2,
            "0"
          )}`;
          const status = availability[date] ?? "available";
          return (
            <button
              key={date}
              className={cellClasses(status, date)}
              onClick={() => handleSelect(date, status)}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
