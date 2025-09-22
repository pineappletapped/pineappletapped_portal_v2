'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ensureFirebase } from '@/lib/firebase';
import { extractUserRoles, hasRole } from '@/lib/roles';
import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

type AnalyticsEventRecord = {
  id: string;
  path?: string;
  referrer?: string;
  visitorId?: string;
  uid?: string;
  userName?: string;
  createdAt?: { toDate?: () => Date } | null;
  [key: string]: any;
};

const toDateInputValue = (date: Date) => {
  const tzOffset = date.getTimezoneOffset() * 60_000;
  const localISOTime = new Date(date.getTime() - tzOffset).toISOString();
  return localISOTime.split('T')[0] ?? '';
};

const parseDateRange = (start: string, end: string) => {
  const startDate = start ? new Date(`${start}T00:00:00`) : null;
  const endDate = end ? new Date(`${end}T23:59:59.999`) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  if (startDate > endDate) {
    return null;
  }
  return { startDate, endDate };
};

export default function AnalyticsClientPage() {
  const [canAccess, setCanAccess] = useState<boolean | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [firestore, setFirestore] = useState<Firestore | null>(null);
  const [events, setEvents] = useState<AnalyticsEventRecord[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedReferrer, setSelectedReferrer] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    return toDateInputValue(start);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { auth, db } = await ensureFirebase();
        if (cancelled) {
          return;
        }

        if (!auth || typeof auth.onAuthStateChanged !== 'function' || !db) {
          throw new Error('Firebase auth or database is unavailable.');
        }

        setFirestore(db);

        unsubscribe = auth.onAuthStateChanged(async (user: User | null) => {
          if (cancelled) {
            return;
          }

          if (!user) {
            setCanAccess(false);
            setAuthLoading(false);
            return;
          }

          try {
            const { doc, getDoc } = await import('firebase/firestore');
            const me = await getDoc(doc(db, 'users', user.uid));
            const data = me.data() as Record<string, any> | undefined;
            const roles = extractUserRoles(data);
            const allowed = hasRole(roles, ['admin', 'marketing']);
            setCanAccess(allowed);
          } catch (error) {
            console.error('Failed to verify analytics access roles', error);
            setCanAccess(false);
          } finally {
            if (!cancelled) {
              setAuthLoading(false);
            }
          }
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to initialise Firebase for analytics dashboard', error);
          setCanAccess(false);
          setAuthLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const dateRange = useMemo(() => parseDateRange(startDate, endDate), [startDate, endDate]);

  useEffect(() => {
    if (canAccess !== true) {
      return;
    }
    if (!firestore) {
      return;
    }
    if (!dateRange) {
      setEvents([]);
      return;
    }

    let active = true;
    setFetching(true);
    setFetchError(null);

    (async () => {
      try {
        const { collection, getDocs, query, where, orderBy, Timestamp } = await import('firebase/firestore');
        const startTs = Timestamp.fromDate(dateRange.startDate);
        const endTs = Timestamp.fromDate(dateRange.endDate);
        const q = query(
          collection(firestore, 'analyticsEvents'),
          where('createdAt', '>=', startTs),
          where('createdAt', '<=', endTs),
          orderBy('createdAt', 'desc'),
        );
        const snap = await getDocs(q);
        if (!active) return;
        const allEvents: AnalyticsEventRecord[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          allEvents.push({ id: docSnap.id, ...data });
        });
        allEvents.sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime?.() ?? 0;
          const bTime = b.createdAt?.toDate?.()?.getTime?.() ?? 0;
          return bTime - aTime;
        });
        setEvents(allEvents);
      } catch (err) {
        console.error('Failed to load analytics events', err);
        if (!active) return;
        setEvents([]);
        setFetchError('Unable to load analytics for the selected range.');
      } finally {
        if (active) {
          setFetching(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [dateRange, canAccess, firestore]);

  const topPages = useMemo(() => {
    const counts: Record<string, { views: number; visitors: Set<string> }> = {};
    events.forEach((event) => {
      if (!event.path) return;
      if (!counts[event.path]) {
        counts[event.path] = { views: 0, visitors: new Set<string>() };
      }
      counts[event.path].views += 1;
      const visitorKey = event.visitorId || event.uid || 'anonymous';
      counts[event.path].visitors.add(visitorKey);
    });
    return Object.entries(counts)
      .map(([path, info]) => ({ path, views: info.views, uniques: info.visitors.size }))
      .sort((a, b) => b.views - a.views);
  }, [events]);

  const topReferrers = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach((event) => {
      const key = event.referrer || 'Direct / Unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([referrer, count]) => ({ referrer, count }))
      .sort((a, b) => b.count - a.count);
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (selectedPath && event.path !== selectedPath) {
        return false;
      }
      const eventReferrer = event.referrer || 'Direct / Unknown';
      if (selectedReferrer && eventReferrer !== selectedReferrer) {
        return false;
      }
      return true;
    });
  }, [events, selectedPath, selectedReferrer]);

  const summaryRows = useMemo(() => {
    const counts: Record<string, { views: number; visitors: Set<string> }> = {};
    filteredEvents.forEach((event) => {
      if (!event.path) return;
      if (!counts[event.path]) {
        counts[event.path] = { views: 0, visitors: new Set<string>() };
      }
      counts[event.path].views += 1;
      const visitorKey = event.visitorId || event.uid || 'anonymous';
      counts[event.path].visitors.add(visitorKey);
    });
    return Object.entries(counts)
      .map(([path, info]) => ({ path, views: info.views, uniques: info.visitors.size }))
      .sort((a, b) => b.views - a.views);
  }, [filteredEvents]);

  const recentEvents = useMemo(() => filteredEvents.slice(0, 100), [filteredEvents]);

  const handleExportCsv = useCallback(() => {
    if (!filteredEvents.length) return;
    const header = ['Timestamp', 'Path', 'Referrer', 'Visitor ID', 'User ID', 'User Name'];
    const rows = filteredEvents.map((event) => {
      const createdAt = event.createdAt?.toDate?.();
      return [
        createdAt ? createdAt.toISOString() : '',
        event.path ?? '',
        event.referrer ?? '',
        event.visitorId ?? '',
        event.uid ?? '',
        event.userName ?? '',
      ];
    });
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics-${startDate}-to-${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [endDate, filteredEvents, startDate]);

  const hasActiveFilters = Boolean(selectedPath || selectedReferrer);

  if (authLoading || (canAccess && fetching && !events.length)) {
    return <p>Loading…</p>;
  }
  if (!canAccess) return <p>You do not have permission to view analytics.</p>;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold">Analytics Dashboard</h1>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={!filteredEvents.length}
          className="rounded border border-slate-300 px-3 py-1 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Export CSV
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
          Start date
          <input
            type="date"
            className="rounded border border-slate-300 px-3 py-2 text-base"
            value={startDate}
            max={endDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
          End date
          <input
            type="date"
            className="rounded border border-slate-300 px-3 py-2 text-base"
            value={endDate}
            min={startDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
      </div>

      {fetchError && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{fetchError}</p>
      )}

      {!dateRange && (
        <p className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700">
          Select a valid date range to view analytics.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">Quick filters</h2>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => { setSelectedPath(null); setSelectedReferrer(null); }}
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium text-slate-600">Top pages</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {topPages.slice(0, 6).map((page) => (
                <button
                  type="button"
                  key={page.path}
                  onClick={() => setSelectedPath((prev) => (prev === page.path ? null : page.path))}
                  className={`rounded border px-2 py-1 text-xs font-medium transition ${selectedPath === page.path ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
                >
                  {page.path} ({page.views})
                </button>
              ))}
              {!topPages.length && <p className="text-sm text-slate-500">No page views in range.</p>}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-600">Top referrers</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {topReferrers.slice(0, 6).map((ref) => (
                <button
                  type="button"
                  key={ref.referrer}
                  onClick={() => setSelectedReferrer((prev) => (prev === ref.referrer ? null : ref.referrer))}
                  className={`rounded border px-2 py-1 text-xs font-medium transition ${selectedReferrer === ref.referrer ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
                >
                  {ref.referrer} ({ref.count})
                </button>
              ))}
              {!topReferrers.length && <p className="text-sm text-slate-500">No referrers captured.</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Page performance</h2>
        <div className="overflow-x-auto rounded border">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="border-b bg-slate-50 text-sm text-slate-600">
                <th className="p-2 font-medium">Page</th>
                <th className="p-2 font-medium">Views</th>
                <th className="p-2 font-medium">Unique Visitors</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.path} className="border-b last:border-b-0">
                  <td className="p-2 text-sm">{row.path}</td>
                  <td className="p-2 text-sm">{row.views}</td>
                  <td className="p-2 text-sm">{row.uniques}</td>
                </tr>
              ))}
              {!summaryRows.length && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-sm text-slate-500">
                    {fetching ? 'Loading analytics…' : 'No analytics events match the selected filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recent visits</h2>
        <div className="overflow-x-auto rounded border">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b bg-slate-50 text-sm text-slate-600">
                <th className="p-2 font-medium">User</th>
                <th className="p-2 font-medium">Page</th>
                <th className="p-2 font-medium">Referrer</th>
                <th className="p-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((event) => {
                const createdAt = event.createdAt?.toDate?.();
                const referrer = event.referrer || 'Direct / Unknown';
                return (
                  <tr key={event.id} className="border-b last:border-b-0">
                    <td className="p-2 text-sm">{event.userName || event.uid || event.visitorId || 'Anonymous'}</td>
                    <td className="p-2 text-sm">{event.path || '—'}</td>
                    <td className="p-2 text-sm">{referrer}</td>
                    <td className="p-2 text-sm">{createdAt ? createdAt.toLocaleString() : ''}</td>
                  </tr>
                );
              })}
              {!recentEvents.length && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-sm text-slate-500">
                    {fetching ? 'Loading analytics…' : 'No recent visits recorded for this selection.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
