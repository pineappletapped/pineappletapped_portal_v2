"use client";

import { useMemo, useState } from 'react';

export type AvailabilityStatus = "unavailable" | "available" | "partial" | "booked";

const next: Record<AvailabilityStatus, AvailabilityStatus> = {
  unavailable: "available",
  available: "partial",
  partial: "booked",
  booked: "unavailable",
};

interface Props {
  availability: Record<string, AvailabilityStatus>;
  onChange: (date: string, status: AvailabilityStatus) => void;
}

export default function AvailabilityCalendar({ availability, onChange }: Props) {
  const today = new Date();
  const [view, setView] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const y = view.getFullYear();
  const m = view.getMonth();

  const days = useMemo(() => {
    const first = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const arr: (number | null)[] = Array(first).fill(null);
    for (let d = 1; d <= total; d++) arr.push(d);
    return arr;
  }, [y, m]);

  const cellClasses = (status: AvailabilityStatus) => {
    switch (status) {
      case "available":
        return "bg-green-500 text-white";
      case "partial":
        return "bg-yellow-400";
      case "booked":
        return "bg-red-500 text-white";
      default:
        return "bg-black text-white";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-sm">
        <button
          className="btn-sm"
          onClick={() =>
            setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))
          }
        >
          ‹
        </button>
        <span>
          {view.toLocaleString('default', { month: 'long' })} {y}
        </span>
        <button
          className="btn-sm"
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
          const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const status = availability[date] ?? 'unavailable';
          return (
            <button
              key={date}
              className={`p-2 text-sm rounded ${cellClasses(status)}`}
              onClick={() => onChange(date, next[status])}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

