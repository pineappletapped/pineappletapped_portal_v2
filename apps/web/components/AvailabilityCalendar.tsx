"use client";

import { useMemo, useState } from 'react';

export type AvailabilityStatus = "unavailable" | "available" | "partial" | "booked";

export interface AvailabilityStatusMeta {
  label: string;
  background: string;
  text?: string;
  description?: string;
}

export const AVAILABILITY_STATUS_META: Record<AvailabilityStatus, AvailabilityStatusMeta> = {
  unavailable: {
    label: "Unavailable",
    background: "bg-slate-500",
    text: "text-white",
    description: "Team member is not accepting work on this date.",
  },
  available: {
    label: "Available",
    background: "bg-emerald-500",
    text: "text-white",
    description: "Fully available for bookings.",
  },
  partial: {
    label: "Limited",
    background: "bg-amber-400",
    text: "text-slate-900",
    description: "Part-day availability or limited hours.",
  },
  booked: {
    label: "Booked",
    background: "bg-rose-500",
    text: "text-white",
    description: "Confirmed job scheduled for this date.",
  },
};

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
    const meta = AVAILABILITY_STATUS_META[status];
    return `${meta.background} ${meta.text ?? ""}`.trim();
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

