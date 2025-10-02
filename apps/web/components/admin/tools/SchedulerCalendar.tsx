"use client";

import { useMemo, useState, type DragEvent } from "react";

interface SchedulerCalendarVariant {
  platform: string;
  caption: string;
}

export interface SchedulerCalendarPost {
  id: string;
  organisationName: string | null;
  deliverableProductName: string | null;
  scheduledAt: Date | null;
  status: string;
  approvalState: string;
  variants: SchedulerCalendarVariant[];
}

interface SchedulerCalendarProps {
  posts: SchedulerCalendarPost[];
  loading?: boolean;
  onReschedule?: (postId: string, nextDate: Date | null) => void;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(date: Date) {
  const copy = startOfDay(date);
  const day = copy.getDay();
  const diff = (day + 6) % 7; // Monday start
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function endOfWeek(date: Date) {
  const copy = startOfWeek(date);
  copy.setDate(copy.getDate() + 6);
  return copy;
}

function buildMonthDays(reference: Date) {
  const firstOfMonth = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const lastOfMonth = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  const start = startOfWeek(firstOfMonth);
  const end = endOfWeek(lastOfMonth);
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildWeekDays(reference: Date) {
  const start = startOfWeek(reference);
  const days: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return days;
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export default function SchedulerCalendar({ posts, loading = false, onReschedule }: SchedulerCalendarProps) {
  const [view, setView] = useState<"month" | "week">("month");
  const [referenceDate, setReferenceDate] = useState(() => new Date());

  const visibleDays = useMemo(() => {
    return view === "month" ? buildMonthDays(referenceDate) : buildWeekDays(referenceDate);
  }, [view, referenceDate]);

  const unscheduledPosts = useMemo(() => posts.filter((post) => !post.scheduledAt), [posts]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, SchedulerCalendarPost[]>();
    visibleDays.forEach((day) => {
      map.set(startOfDay(day).toISOString(), []);
    });
    posts.forEach((post) => {
      if (!post.scheduledAt) return;
      const key = startOfDay(post.scheduledAt).toISOString();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(post);
    });
    map.forEach((entries) => {
      entries.sort((a, b) => {
        const aTime = a.scheduledAt?.getTime() ?? 0;
        const bTime = b.scheduledAt?.getTime() ?? 0;
        return aTime - bTime;
      });
    });
    return map;
  }, [posts, visibleDays]);

  function goToPrevious() {
    setReferenceDate((current) => {
      const next = new Date(current);
      if (view === "month") {
        next.setMonth(current.getMonth() - 1, 1);
      } else {
        next.setDate(current.getDate() - 7);
      }
      return next;
    });
  }

  function goToNext() {
    setReferenceDate((current) => {
      const next = new Date(current);
      if (view === "month") {
        next.setMonth(current.getMonth() + 1, 1);
      } else {
        next.setDate(current.getDate() + 7);
      }
      return next;
    });
  }

  function handleDrop(day: Date, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const postId = event.dataTransfer.getData("text/plain");
    if (!postId) return;
    const existing = posts.find((post) => post.id === postId);
    const base = startOfDay(day);
    if (existing?.scheduledAt) {
      base.setHours(existing.scheduledAt.getHours(), existing.scheduledAt.getMinutes(), 0, 0);
    } else {
      base.setHours(9, 0, 0, 0);
    }
    onReschedule?.(postId, base);
  }

  function handleDragStart(postId: string, event: DragEvent<HTMLElement>) {
    event.dataTransfer.setData("text/plain", postId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDropUnscheduled(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const postId = event.dataTransfer.getData("text/plain");
    if (!postId) return;
    onReschedule?.(postId, null);
  }

  const monthTitle = referenceDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
            onClick={goToPrevious}
          >
            ←
          </button>
          <button
            type="button"
            className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
            onClick={goToNext}
          >
            →
          </button>
          <span className="font-medium text-slate-800">{monthTitle}</span>
        </div>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className={`rounded px-3 py-1 ${view === "month" ? "bg-orange text-white" : "border border-slate-200"}`}
            onClick={() => setView("month")}
          >
            Month
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1 ${view === "week" ? "bg-orange text-white" : "border border-slate-200"}`}
            onClick={() => setView("week")}
          >
            Week
          </button>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading schedule…</p>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-7 gap-2">
            {visibleDays.map((day) => {
              const key = startOfDay(day).toISOString();
              const entries = postsByDay.get(key) ?? [];
              const isCurrentMonth = day.getMonth() === referenceDate.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-[160px] rounded border p-2 ${
                    isCurrentMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"
                  }`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(day, event)}
                >
                  <div className="flex items-center justify-between text-xs font-medium text-slate-700">
                    <span>{formatDayLabel(day)}</span>
                    <span>{entries.length}</span>
                  </div>
                  <div className="mt-2 grid gap-2">
                    {entries.map((post) => (
                      <div
                        key={post.id}
                        draggable
                        onDragStart={(event) => handleDragStart(post.id, event)}
                        className="cursor-move rounded border border-slate-200 bg-slate-50 p-2 text-xs shadow-sm"
                      >
                        <div className="font-semibold text-slate-800">
                          {post.deliverableProductName || post.organisationName || "Campaign"}
                        </div>
                        <div className="text-slate-500">
                          {post.scheduledAt?.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) || "TBC"}
                        </div>
                        <div className="text-[11px] uppercase tracking-wide text-slate-400">
                          {post.status} · {post.approvalState}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {post.variants.map((variant) => (
                            <span key={variant.platform} className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-600">
                              {variant.platform.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDropUnscheduled}
          >
            <div className="font-semibold text-slate-800">Unscheduled</div>
            {unscheduledPosts.length === 0 ? (
              <p className="text-xs text-slate-500">Drag posts here to remove scheduling.</p>
            ) : (
              <ul className="mt-2 grid gap-2 text-xs">
                {unscheduledPosts.map((post) => (
                  <li
                    key={post.id}
                    draggable
                    onDragStart={(event) => handleDragStart(post.id, event)}
                    className="cursor-move rounded border border-slate-200 bg-white p-2 shadow-sm"
                  >
                    <div className="font-semibold text-slate-800">
                      {post.deliverableProductName || post.organisationName || "Campaign"}
                    </div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                      {post.status} · {post.approvalState}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {post.variants.map((variant) => (
                        <span key={variant.platform} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                          {variant.platform.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
