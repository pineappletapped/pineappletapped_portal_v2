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
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const days = useMemo(() => {
    const first = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const arr: (number | null)[] = Array(first).fill(null);
    for (let d = 1; d <= total; d++) arr.push(d);
    return arr;
  }, [y, m]);

  const statusText: Record<ProductAvailabilityStatus, string> = {
    available: "Available",
    pending: "Pending confirmation",
    booked: "Booked",
    unavailable: "Unavailable",
  };

  const cellClasses = (status: ProductAvailabilityStatus, date: string) => {
    const isDisabled = status === "booked" || status === "unavailable";
    const base =
      "flex flex-col items-center justify-center rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange";
    const palette: Record<ProductAvailabilityStatus, string> = {
      available: "border-green-500 text-green-700 bg-green-50 hover:bg-green-100",
      pending: "border-amber-500 text-amber-700 bg-amber-50 hover:bg-amber-100",
      booked: "border-red-400 text-red-600 bg-red-50",
      unavailable: "border-gray-300 text-gray-500 bg-gray-100",
    };
    const disabled = isDisabled ? " cursor-not-allowed opacity-70" : "";
    const isSelected = selected === date ? " ring-2 ring-orange-500" : "";
    return `${base} ${palette[status]}${disabled}${isSelected}`;
  };

  const handleSelect = (date: string, status: ProductAvailabilityStatus) => {
    if (status === "available" || status === "pending") {
      onSelect(date);
    }
  };

  return (
    <div className="max-w-xs text-xs" role="group" aria-label="Select a production date">
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
      <div
        className="grid grid-cols-7 gap-1 text-[0.6rem] font-medium uppercase tracking-wide text-gray-500"
        aria-hidden
      >
        {dayLabels.map((day) => (
          <div key={day} className="text-center">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 mt-1" role="presentation">
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(
            2,
            "0"
          )}`;
          const status = availability[date] ?? "available";
          const isDisabled = status === "booked" || status === "unavailable";
          const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString(
            undefined,
            { weekday: "long", month: "long", day: "numeric", year: "numeric" }
          );
          return (
            <button
              key={date}
              type="button"
              className={cellClasses(status, date)}
              onClick={() => handleSelect(date, status)}
              aria-disabled={isDisabled}
              disabled={isDisabled}
              aria-pressed={selected === date ? true : undefined}
              aria-label={`${formattedDate} – ${statusText[status]}`}
            >
              <span className="text-sm font-medium">{d}</span>
              <span className="mt-0.5 text-[0.6rem] font-semibold">
                {statusText[status]}
              </span>
            </button>
          );
        })}
      </div>
      <ul className="mt-3 space-y-1" aria-label="Booking status legend">
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden />
          <span>Available – reserve immediately.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          <span>Pending confirmation – we’ll follow up if the slot changes.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
          <span>Booked – choose a different day.</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gray-400" aria-hidden />
          <span>Unavailable – this date can’t be scheduled.</span>
        </li>
      </ul>
    </div>
  );
}
