"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import PortalContainer from '@/components/PortalContainer';
import PortalHero from '@/components/PortalHero';
import { db } from '@/lib/firebase';
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { useRoleGate } from '@/hooks/useRoleGate';

/**
 * Admin Dashboard
 *
 * Presents links to various admin management pages. Only staff users should see this.
 */
export default function AdminPage() {
  const { allowed, loading: guardLoading } = useRoleGate('admin');
  const [stats, setStats] = useState({
    orders: 0,
    projects: 0,
    users: 0,
    products: 0,
    quotesPending: 0,
    proposalsPending: 0,
  });
  const [trends, setTrends] = useState<TrendSnapshots>({
    orders: null,
    projects: null,
    quotes: null,
    proposals: null,
  });
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  const heroMetrics = [
    { label: 'Orders', value: stats.orders },
    { label: 'Projects', value: stats.projects },
    { label: 'Quotes pending', value: stats.quotesPending },
    { label: 'Proposals pending', value: stats.proposalsPending },
  ];

  const primaryShortcuts = [
    {
      label: 'Project management',
      description: 'Coordinate bookings, milestones, and delivery tasks.',
      href: '/admin/projects',
    },
    {
      label: 'Manage orders',
      description: 'Review fulfilment status and payment progress.',
      href: '/admin/orders',
    },
    {
      label: 'CRM',
      description: 'Access client records and contact preferences.',
      href: '/admin/users',
    },
    {
      label: 'Quotes & proposals',
      description: 'Draft, approve, and track proposal workflows.',
      href: '/admin/proposals',
    },
    {
      label: 'Manage availability',
      description: 'Plan staffing, logistics, and routing coverage.',
      href: '/admin/availability',
    },
  ];

  const heroActions = primaryShortcuts;
  useEffect(() => {
    if (guardLoading || !allowed) return;

    let active = true;

    (async () => {
      try {
        // Load counts for quick metrics
        const [
          ordersSnap,
          projectsSnap,
          usersSnap,
          productsSnap,
          quotesSnap,
          proposalsSnap,
        ] = await Promise.all([
          getCountFromServer(collection(db, 'orders')),
          getCountFromServer(collection(db, 'projects')),
          getCountFromServer(collection(db, 'users')),
          getCountFromServer(collection(db, 'products')),
          getCountFromServer(query(collection(db, 'quoteRequests'), where('status', '==', 'pending'))),
          getCountFromServer(query(collection(db, 'proposals'), where('status', '==', 'sent'))),
        ]);

        if (!active) return;

        const nextStats = {
          orders: ordersSnap.data().count,
          projects: projectsSnap.data().count,
          users: usersSnap.data().count,
          products: productsSnap.data().count,
          quotesPending: quotesSnap.data().count,
          proposalsPending: proposalsSnap.data().count,
        };
        setStats(nextStats);

        const newAlerts: DashboardAlert[] = [];
        if (nextStats.quotesPending > QUOTE_WARNING_THRESHOLD) {
          newAlerts.push({
            id: 'quotes-warning',
            message: `Quote follow-up backlog is high (${nextStats.quotesPending} pending).`,
          });
        }
        if (nextStats.proposalsPending > PROPOSAL_WARNING_THRESHOLD) {
          newAlerts.push({
            id: 'proposals-warning',
            message: `There are ${nextStats.proposalsPending} proposals awaiting action.`,
          });
        }
        setAlerts(newAlerts);

        // Fetch history for trend visualisation (last WEEKS_TO_REVIEW weeks)
        const now = new Date();
        const [ordersHistorySnap, projectsHistorySnap, quotesHistorySnap, proposalsHistorySnap] =
          await Promise.all([
            getDocs(
              query(
                collection(db, 'orders'),
                orderBy('createdAt', 'desc'),
                limit(WEEKS_TO_REVIEW * HISTORY_PAGE_SIZE)
              )
            ),
            getDocs(
              query(
                collection(db, 'projects'),
                orderBy('createdAt', 'desc'),
                limit(WEEKS_TO_REVIEW * HISTORY_PAGE_SIZE)
              )
            ),
            getDocs(
              query(
                collection(db, 'quoteRequests'),
                orderBy('createdAt', 'desc'),
                limit(WEEKS_TO_REVIEW * HISTORY_PAGE_SIZE)
              )
            ),
            getDocs(
              query(
                collection(db, 'proposals'),
                orderBy('createdAt', 'desc'),
                limit(WEEKS_TO_REVIEW * HISTORY_PAGE_SIZE)
              )
            ),
          ]);

        if (!active) return;

        setTrends({
          orders: computeTrendSnapshot(ordersHistorySnap.docs, now),
          projects: computeTrendSnapshot(projectsHistorySnap.docs, now),
          quotes: computeTrendSnapshot(quotesHistorySnap.docs, now),
          proposals: computeTrendSnapshot(proposalsHistorySnap.docs, now),
        });

        // Fetch a few recent tasks without requiring a collection group index
        const projSnap = await getDocs(
          query(collection(db, 'projects'), orderBy('createdAt', 'desc'), limit(5))
        );
        if (!active) return;

        const taskResults: any[] = [];
        for (const p of projSnap.docs) {
          const tSnap = await getDocs(
            query(collection(db, 'projects', p.id, 'tasks'), orderBy('createdAt', 'desc'), limit(1))
          );
          if (!active) return;
          tSnap.docs.forEach((d) => taskResults.push({ id: d.id, ...(d.data() as any) }));
        }
        if (!active) return;

        taskResults.sort((a, b) => {
          const aTime = extractTimestamp(a.createdAt);
          const bTime = extractTimestamp(b.createdAt);
          return bTime - aTime;
        });
        setTasks(taskResults.slice(0, 5));
      } catch (error) {
        console.error('Failed to load admin dashboard data', error);
        if (!active) return;
        setAlerts((prev) =>
          prev.length
            ? prev
            : [
                {
                  id: 'load-error',
                  message: 'Unable to load trend data. Please refresh to retry.',
                },
              ]
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading]);
  if (guardLoading) {
    return (
      <PortalContainer>
        <div className="py-16 text-center text-sm text-gray-500">Preparing admin workspace…</div>
      </PortalContainer>
    );
  }
  if (!allowed) {
    return (
      <PortalContainer>
        <p className="py-16 text-center text-sm text-gray-600">
          You do not have permission to view the admin dashboard.
        </p>
      </PortalContainer>
    );
  }
  return (
    <PortalContainer>
      <div className="space-y-10">
        <PortalHero
          eyebrow="Admin portal"
          title="Production HQ oversight"
          description="Monitor orders, unlock analytics, and coordinate teams across the Pineapple Tapped network."
          backgroundClass="bg-stone-900"
          metrics={heroMetrics}
          quickActions={heroActions}
        />

        <div className="space-y-6">
          {alerts.length > 0 && (
            <div className="rounded-3xl border border-amber-300 bg-amber-50 p-6">
              <div className="flex items-start gap-3">
                <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <h2 className="font-semibold text-amber-900">Attention needed</h2>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">
                    {alerts.map((alert) => (
                      <li key={alert.id} className="leading-snug">
                        • {alert.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Orders" value={stats.orders} trend={trends.orders} trendLabel="Orders/week" />
            <StatCard
              label="Projects"
              value={stats.projects}
              trend={trends.projects}
              trendLabel="Projects/week"
            />
            <StatCard label="Clients" value={stats.users} />
            <StatCard label="Products" value={stats.products} />
            <StatCard
              label="Quotes Pending"
              value={stats.quotesPending}
              trend={trends.quotes}
              trendLabel="New quotes/week"
              warning={stats.quotesPending > QUOTE_WARNING_THRESHOLD}
            />
            <StatCard
              label="Proposals Pending"
              value={stats.proposalsPending}
              trend={trends.proposals}
              trendLabel="Proposals/week"
              warning={stats.proposalsPending > PROPOSAL_WARNING_THRESHOLD}
            />
          </div>

          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Recent Tasks</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-gray-500">No tasks found.</p>
            ) : (
              <ul className="divide-y rounded border">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between p-2">
                    <span>{t.title}</span>
                    <span className="text-sm capitalize text-gray-500">{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Quick Links</h2>
            <p className="text-sm text-gray-500">
              Jump straight into the most common admin workflows.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {primaryShortcuts.map((shortcut) => (
                <Link
                  key={shortcut.href}
                  href={shortcut.href}
                  className="group flex flex-col justify-between rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:border-orange-300 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
                >
                  <span className="text-sm font-semibold text-gray-900 group-hover:text-orange-600">
                    {shortcut.label}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">{shortcut.description}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PortalContainer>
  );
}

function StatCard({
  label,
  value,
  trend,
  trendLabel,
  warning,
}: {
  label: string;
  value: number;
  trend?: TrendSnapshot | null;
  trendLabel?: string;
  warning?: boolean;
}) {
  const deltaPercent = typeof trend?.deltaPercent === 'number' ? trend.deltaPercent : null;
  const deltaPositive = (deltaPercent ?? 0) >= 0;
  const isNeutralChange = deltaPercent !== null && Math.abs(deltaPercent) < 0.1;
  return (
    <div
      className={`p-4 rounded-lg shadow border transition-colors ${
        warning
          ? 'border-amber-400 bg-amber-50'
          : 'border-transparent bg-slate-100 hover:border-slate-200'
      }`}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {trend && trend.series.length > 0 && (
        <div className="mt-3">
          {trendLabel && <p className="text-xs text-gray-500">{trendLabel}</p>}
          <Sparkline data={trend.series} positive={deltaPositive} neutral={isNeutralChange} />
          {deltaPercent !== null && (
            <p
              className={`mt-1 text-xs font-medium ${
                isNeutralChange ? 'text-slate-500' : deltaPositive ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {isNeutralChange ? '—' : deltaPositive ? '▲' : '▼'} {Math.abs(deltaPercent).toFixed(1)}% vs previous week
            </p>
          )}
        </div>
      )}
      {warning && (
        <p className="mt-2 text-xs font-medium text-amber-700">Follow up recommended</p>
      )}
    </div>
  );
}

function Sparkline({
  data,
  positive,
  neutral,
}: {
  data: number[];
  positive?: boolean;
  neutral?: boolean;
}) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = data.length === 1 ? 0 : (index / (data.length - 1)) * 100;
      const normalized = (value - min) / range;
      const y = 100 - normalized * 100;
      return `${x},${Number.isFinite(y) ? y : 50}`;
    })
    .join(' ');

  const strokeColor = neutral ? '#64748B' : positive ? '#059669' : '#DC2626';

  return (
    <svg viewBox="0 0 100 100" className="mt-1 h-12 w-full">
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

type TrendSnapshot = {
  series: number[];
  delta: number;
  deltaPercent: number;
};

type TrendSnapshots = {
  orders: TrendSnapshot | null;
  projects: TrendSnapshot | null;
  quotes: TrendSnapshot | null;
  proposals: TrendSnapshot | null;
};

type DashboardAlert = {
  id: string;
  message: string;
};

const WEEKS_TO_REVIEW = 8;
const HISTORY_PAGE_SIZE = 100;
const QUOTE_WARNING_THRESHOLD = 10;
const PROPOSAL_WARNING_THRESHOLD = 15;

function computeTrendSnapshot(docs: Array<{ data: () => Record<string, any> }>, now: Date): TrendSnapshot {
  const series = bucketDocsIntoWeeks(docs, now, WEEKS_TO_REVIEW);
  const last = series[series.length - 1] ?? 0;
  const previous = series.length > 1 ? series[series.length - 2] : 0;
  const delta = last - previous;
  const deltaPercent = previous === 0 ? (last > 0 ? 100 : 0) : (delta / previous) * 100;
  return { series, delta, deltaPercent };
}

function bucketDocsIntoWeeks(
  docs: Array<{ data: () => Record<string, any> }>,
  now: Date,
  weekCount: number
): number[] {
  const buckets = new Array(weekCount).fill(0);
  const latestWeekStart = startOfWeek(now);
  const earliestWeekStart = new Date(latestWeekStart);
  earliestWeekStart.setDate(earliestWeekStart.getDate() - (weekCount - 1) * 7);
  const earliestMs = earliestWeekStart.getTime();

  docs.forEach((docSnap) => {
    const data = docSnap.data();
    const createdAt = extractTimestamp(
      data?.createdAt ??
        data?.created_at ??
        data?.sentAt ??
        data?.sent_at ??
        data?.submittedAt ??
        data?.submitted_at
    );
    if (!createdAt) return;

    const weekStart = startOfWeek(new Date(createdAt));
    const bucketIndex = Math.floor((weekStart.getTime() - earliestMs) / WEEK_IN_MS);
    if (bucketIndex < 0 || bucketIndex >= weekCount) return;
    buckets[bucketIndex] += 1;
  });

  return buckets;
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day + 6) % 7; // shift so Monday is the first day
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

function extractTimestamp(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value.toDate === 'function') {
    return value.toDate()?.getTime?.() ?? 0;
  }
  return 0;
}