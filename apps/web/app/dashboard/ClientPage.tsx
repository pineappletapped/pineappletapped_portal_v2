"use client";

import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  limit,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import Link from 'next/link';
import PortalContainer from '@/components/PortalContainer';

/**
 * Enhanced dashboard showing a unified overview of projects, orders, bookings,
 * recommendations and notifications. It also provides quick links to key
 * actions such as browsing services, starting a new project, booking a session
 * or viewing orders. Data is scoped to the current user and their
 * organisations.
 */
export default function DashboardPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [suggestedProjects, setSuggestedProjects] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [taskProjects, setTaskProjects] = useState<any[]>([]);
  const [taskFilter, setTaskFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        // Orders belonging to the user
        try {
          const oq = query(
            collection(db, 'orders'),
            where('userId', '==', user.uid),
            orderBy('createdAt', 'desc'),
            limit(5)
          );
          const oSnap = await getDocs(oq);
          setOrders(oSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (err) {
          console.warn('Failed to load orders', err);
        }
        // Bookings
        try {
          const bq = query(collection(db, 'bookings'), where('uid', '==', user.uid), limit(5));
          const bSnap = await getDocs(bq);
          setBookings(bSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (err) {
          console.warn('Failed to load bookings', err);
        }
        // Find org memberships
        try {
          const memSnap = await getDocs(query(collection(db, 'memberships'), where('userId', '==', user.uid)));
          const orgIds = memSnap.docs.map((m) => (m.data() as any).orgId);
          if (orgIds.length > 0) {
            // Projects for user orgs
            try {
              const pq = query(collection(db, 'projects'), where('orgId', 'in', orgIds));
              const pSnap = await getDocs(pq);
              const projDocs = pSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
              setProjects(projDocs.slice(0, 5));
              setTaskProjects(projDocs);
              // Load customer-facing tasks for these projects
              const allTasks: any[] = [];
              for (const p of projDocs) {
                const tq = query(
                  collection(db, 'projects', p.id, 'tasks'),
                  where('forCustomer', '==', true),
                  where('status', 'in', ['todo', 'in_progress', 'review']),
                  orderBy('createdAt', 'desc'),
                  limit(5)
                );
                const tSnap = await getDocs(tq);
                tSnap.docs.forEach((td) =>
                  allTasks.push({ id: td.id, projectId: p.id, projectName: p.name || 'Untitled', ...td.data() })
                );
              }
              allTasks.sort((a, b) => {
                const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
                const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
                return bTime - aTime;
              });
              setTasks(allTasks.slice(0, 5));
            } catch (err) {
              console.warn('Failed to load projects or tasks', err);
            }
            // Recommendations for orgs
            try {
              const recQ = query(collection(db, 'recommendations'), where('orgId', 'in', orgIds), limit(3));
              const recSnap = await getDocs(recQ);
              setRecommendations(recSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            } catch (err) {
              console.warn('Failed to load recommendations', err);
            }
            // Remarketing suggestions from HQ
            try {
              const suggestionMap = new Map<string, any>();
              try {
                const directSnap = await getDocs(
                  query(
                    collection(db, 'remarketingSuggestions'),
                    where('audienceUserIds', 'array-contains', user.uid),
                    orderBy('createdAt', 'desc'),
                    limit(6)
                  )
                );
                directSnap.docs.forEach((docSnap) =>
                  suggestionMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as any) })
                );
              } catch (errDirect) {
                console.warn('Failed to load direct remarketing suggestions', errDirect);
              }
              const chunkSize = 10;
              for (let index = 0; index < orgIds.length; index += chunkSize) {
                const chunk = orgIds.slice(index, index + chunkSize);
                try {
                  const orgSnap = await getDocs(
                    query(
                      collection(db, 'remarketingSuggestions'),
                      where('targetOrgIds', 'array-contains-any', chunk),
                      limit(10)
                    )
                  );
                  orgSnap.docs.forEach((docSnap) =>
                    suggestionMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as any) })
                  );
                } catch (errOrg) {
                  console.warn('Failed to load organisation remarketing suggestions', errOrg);
                }
              }
              const allowedStatuses = new Set(['ready', 'draft', 'queued', 'researching', 'pending_review']);
              const suggestions = Array.from(suggestionMap.values()).filter((entry) => {
                const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
                const researchStatus = typeof entry.researchStatus === 'string' ? entry.researchStatus.toLowerCase() : '';
                return allowedStatuses.has(status) || allowedStatuses.has(researchStatus);
              });
              suggestions.sort((a, b) => {
                const aTime = a.createdAt?.toMillis
                  ? a.createdAt.toMillis()
                  : new Date(a.createdAt || 0).getTime();
                const bTime = b.createdAt?.toMillis
                  ? b.createdAt.toMillis()
                  : new Date(b.createdAt || 0).getTime();
                return bTime - aTime;
              });
              setSuggestedProjects(suggestions.slice(0, 6));
            } catch (err) {
              console.warn('Failed to prepare remarketing suggestions', err);
            }
            // Assets for these orgs
            try {
              const aQ = query(collection(db, 'assets'), where('orgId', 'in', orgIds), limit(5));
              const aSnap = await getDocs(aQ);
              setAssets(aSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            } catch (err) {
              console.warn('Failed to load assets', err);
            }
          }
        } catch (err) {
          console.warn('Failed to load memberships', err);
        }
        // Notifications for user
        try {
          const nSnap = await getDocs(query(collection(db, 'notifications'), where('userId', '==', user.uid), limit(5)));
          setNotifications(nSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (err) {
          console.warn('Failed to load notifications', err);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const completeTask = async (task: any) => {
    try {
      await updateDoc(doc(db, 'projects', task.projectId, 'tasks', task.id), { status: 'done' });
      const user = auth.currentUser;
      await addDoc(collection(db, 'taskHistory'), {
        projectId: task.projectId,
        taskId: task.id,
        action: 'update_status',
        fromStatus: task.status || null,
        toStatus: 'done',
        uid: user ? user.uid : null,
        createdAt: serverTimestamp(),
      });
      setTasks(tasks.filter((t) => t.id !== task.id));
    } catch (err) {
      console.warn('Failed to complete task', err);
    }
  };

  const metrics = [
    { label: 'Active projects', value: projects.length },
    { label: 'Open tasks', value: tasks.length },
    { label: 'Upcoming bookings', value: bookings.length },
    { label: 'New assets', value: assets.length },
  ];

  const quickActions = [
    {
      href: '/projects/new',
      label: 'Start a project',
      description: 'Brief our producers and outline deliverables.',
    },
    {
      href: '/bookings',
      label: 'Book a shoot',
      description: 'Secure production time that suits your team.',
    },
    {
      href: '/categories',
      label: 'Explore services',
      description: 'Browse packaged shoots and add-ons.',
    },
    {
      href: '/projects',
      label: 'View projects',
      description: 'Catch up on milestones and approvals.',
    },
    {
      href: '/analytics',
      label: 'Insights dashboard',
      description: 'Track campaign impact in real time.',
    },
    {
      href: '/emails',
      label: 'Shared inbox',
      description: 'Coordinate feedback with Pineapple Tapped.',
    },
    {
      href: '/orgs',
      label: 'Manage organisations',
      description: 'Switch teams or invite collaborators.',
    },
  ];

  const formatDate = (value: any) => {
    if (!value) return null;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
    }
    if (value?.toDate) {
      return value.toDate().toLocaleDateString();
    }
    if (value?.toMillis) {
      return new Date(value.toMillis()).toLocaleDateString();
    }
    return null;
  };

  if (loading) {
    return (
      <PortalContainer>
        <div className="py-16 flex justify-center">
          <p role="status" aria-live="polite" className="text-sm text-gray-600">
            Loading your workspace…
          </p>
        </div>
      </PortalContainer>
    );
  }

  return (
    <PortalContainer>
      <div className="space-y-10">
        <header className="rounded-3xl bg-slate-900 text-white p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3 max-w-2xl">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-300">Client portal</p>
              <h1 className="text-3xl sm:text-4xl font-semibold leading-tight">Your production HQ</h1>
              <p className="text-sm sm:text-base text-slate-200">
                Check project progress, review upcoming shoots, and discover new campaigns built around your brand goals.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-4 text-left sm:grid-cols-4">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-2xl bg-slate-800/60 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-400">{metric.label}</dt>
                  <dd className="mt-2 text-2xl font-semibold">{metric.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <nav aria-label="Quick actions" className="mt-6">
            <div className="flex flex-wrap gap-3">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group relative flex min-w-[200px] flex-1 flex-col justify-between gap-1 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <span className="text-sm font-semibold text-white group-hover:text-white">{action.label}</span>
                  <span className="text-xs text-slate-200 group-hover:text-slate-100">{action.description}</span>
                </Link>
              ))}
            </div>
          </nav>
        </header>

        <div className="grid gap-8 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-8">
            <section aria-labelledby="tasks-heading" className="card divide-y divide-gray-100 overflow-hidden rounded-3xl border border-gray-200">
              <div className="flex flex-wrap items-center justify-between gap-4 p-6">
                <div>
                  <h2 id="tasks-heading" className="text-lg font-semibold text-gray-900">
                    Tasks waiting on you
                  </h2>
                  <p className="text-sm text-gray-600">
                    Approve feedback, upload files, or mark deliverables complete to keep each timeline moving.
                  </p>
                </div>
                {tasks.length > 0 && (
                  <label className="flex flex-col text-xs text-gray-500">
                    Filter by project
                    <select
                      className="input mt-1 w-48"
                      value={taskFilter}
                      onChange={(e) => setTaskFilter(e.target.value)}
                    >
                      <option value="all">All projects</option>
                      {taskProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || 'Untitled'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="p-6">
                {tasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
                    Nothing needs your attention right now. We’ll surface new approvals and briefs here as soon as HQ updates a project.
                  </div>
                ) : (
                  <ul className="space-y-4" role="list">
                    {(taskFilter === 'all' ? tasks : tasks.filter((t) => t.projectId === taskFilter)).map((t) => (
                      <li key={t.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                          <p className="text-xs text-gray-500">{t.projectName}</p>
                          {t.dueDate && (
                            <p className="text-xs text-gray-500">Due {t.dueDate}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/projects/${t.projectId}/tasks`}
                            className="btn-sm"
                          >
                            View task
                          </Link>
                          <button
                            className="btn-sm"
                            onClick={() => completeTask(t)}
                            type="button"
                          >
                            Mark complete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section aria-labelledby="projects-heading" className="card rounded-3xl border border-gray-200 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 id="projects-heading" className="text-lg font-semibold text-gray-900">
                    Active projects
                  </h2>
                  <p className="text-sm text-gray-600">Jump back into briefs, deliverables, and approvals.</p>
                </div>
                <Link href="/projects" className="btn-sm">
                  View all projects
                </Link>
              </div>
              {projects.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
                  When your first project kicks off we’ll showcase each milestone and approval here.
                </p>
              ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {projects.map((p) => (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      className="flex flex-col justify-between gap-3 rounded-2xl border border-gray-200 p-4 transition hover:border-gray-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{p.name || 'Untitled project'}</p>
                        <p className="text-xs text-gray-500">Status: {p.status || 'draft'}</p>
                      </div>
                      {p.nextMilestone && (
                        <p className="text-xs text-gray-500">Next milestone: {p.nextMilestone}</p>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="orders-heading" className="card rounded-3xl border border-gray-200 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 id="orders-heading" className="text-lg font-semibold text-gray-900">
                    Orders & billing
                  </h2>
                  <p className="text-sm text-gray-600">Track fulfilment progress and pull receipts when you need them.</p>
                </div>
                <Link href="/orders" className="btn-sm">
                  View all orders
                </Link>
              </div>
              {orders.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
                  No orders yet. Once you check out or approve a proposal, we’ll summarise the fulfilment status here.
                </p>
              ) : (
                <ul className="mt-6 space-y-4" role="list">
                  {orders.map((o) => {
                    const createdOn = formatDate(o.createdAt);
                    return (
                      <li key={o.id} className="flex flex-col gap-3 rounded-2xl border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{o.projectName || `Order #${o.id.substring(0, 6)}`}</p>
                          <p className="text-xs text-gray-500">Status: {o.status || 'processing'}</p>
                          {createdOn && <p className="text-xs text-gray-500">Placed {createdOn}</p>}
                        </div>
                        <Link href={`/orders/${o.id}`} className="btn-sm">
                          View details
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="assets-heading" className="card rounded-3xl border border-gray-200 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 id="assets-heading" className="text-lg font-semibold text-gray-900">
                    Latest deliveries
                  </h2>
                  <p className="text-sm text-gray-600">Download approvals and final files the moment they land.</p>
                </div>
                <Link href="/projects" className="btn-sm">
                  Open asset library
                </Link>
              </div>
              {assets.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
                  Assets that are ready for review or download will appear here once production uploads them.
                </p>
              ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {assets.map((a) => (
                    <Link
                      key={a.id}
                      href={`/projects/${a.projectId}/assets/${a.id}`}
                      className="flex flex-col gap-2 rounded-2xl border border-gray-200 p-4 transition hover:border-gray-400 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      <p className="text-sm font-semibold text-gray-900">{a.name || 'Asset'}</p>
                      <p className="text-xs text-gray-500">Status: {a.status || 'draft'}</p>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-8">
            <section aria-labelledby="bookings-heading" className="card rounded-3xl border border-gray-200 p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="bookings-heading" className="text-lg font-semibold text-gray-900">
                    Upcoming bookings
                  </h2>
                  <p className="text-sm text-gray-600">Reschedule or add context before your crew arrives on site.</p>
                </div>
                <Link href="/bookings" className="btn-sm">
                  Manage
                </Link>
              </div>
              {bookings.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
                  When a session is confirmed you’ll see the call time, crew, and location details here.
                </p>
              ) : (
                <ul className="mt-6 space-y-4" role="list">
                  {bookings.map((b) => (
                    <li key={b.id} className="rounded-2xl border border-gray-200 p-4">
                      <p className="text-sm font-semibold text-gray-900">
                        {b.slot?.date} {b.slot?.start && `· ${b.slot.start}`}
                      </p>
                      <p className="text-xs text-gray-500">{b.status}</p>
                      {b.location && <p className="text-xs text-gray-500">Location: {b.location}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="upsell-heading" className="card rounded-3xl border border-gray-200 p-6">
              <div className="space-y-2">
                <h2 id="upsell-heading" className="text-lg font-semibold text-gray-900">
                  Growth opportunities
                </h2>
                <p className="text-sm text-gray-600">
                  Explore campaigns, remarketing ideas, and partner services tailored to your organisation.
                </p>
              </div>
              {suggestedProjects.length === 0 && recommendations.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
                  We’ll curate new opportunities for you once the team has reviewed your recent activity.
                </p>
              ) : (
                <div className="mt-6 space-y-5">
                  {suggestedProjects.slice(0, 4).map((suggestion) => {
                    const createdLabel = formatDate(suggestion.createdAt);
                    return (
                      <article key={suggestion.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <header className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-amber-700">
                          <span>{(suggestion.status || 'Draft').toString()}</span>
                          {createdLabel && <span>{createdLabel}</span>}
                        </header>
                        <h3 className="mt-2 text-sm font-semibold text-amber-900">
                          {suggestion.headline || suggestion.summary || 'New project idea'}
                        </h3>
                        {(suggestion.summary || suggestion.articleDraft) && (
                          <p className="mt-1 text-xs text-amber-800 line-clamp-4">
                            {suggestion.summary || suggestion.articleDraft}
                          </p>
                        )}
                        {suggestion.highlightProduct?.name && (
                          <p className="mt-2 text-[11px] text-amber-700">Featured: {suggestion.highlightProduct.name}</p>
                        )}
                      </article>
                    );
                  })}
                  {recommendations.slice(0, 3).map((rec) => (
                    <article key={rec.id} className="rounded-2xl border border-slate-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900">{rec.title}</h3>
                      <p className="mt-1 text-xs text-gray-600">{rec.body}</p>
                      {rec.cta && (
                        <Link href={rec.cta} className="mt-3 inline-flex text-xs font-semibold text-slate-900 underline">
                          Learn more
                        </Link>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="planner-heading" className="card rounded-3xl border border-gray-200 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 id="planner-heading" className="text-lg font-semibold text-gray-900">
                    Annual content planner
                  </h2>
                  <p className="text-sm text-gray-600">
                    Build campaign roadmaps, link deliverables to services, and brief HQ in a single workspace.
                  </p>
                </div>
                <Link href="/dashboard/content-planner" className="btn-sm">
                  Open planner
                </Link>
              </div>
              <ul className="mt-6 space-y-2 text-xs text-gray-600">
                <li>• Connect initiatives to active Pineapple Tapped products and pricing.</li>
                <li>• Capture stakeholder feedback with shared timelines and notes.</li>
                <li>• Generate AI storyboards to align creative teams quickly.</li>
              </ul>
            </section>

            <section aria-labelledby="notifications-heading" className="card rounded-3xl border border-gray-200 p-6">
              <div className="space-y-2">
                <h2 id="notifications-heading" className="text-lg font-semibold text-gray-900">
                  Notifications
                </h2>
                <p className="text-sm text-gray-600">Stay on top of approvals, comments, and milestone changes.</p>
              </div>
              {notifications.length === 0 ? (
                <p className="mt-6 rounded-2xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
                  No notifications right now. We’ll let you know as soon as there’s new activity.
                </p>
              ) : (
                <ul className="mt-6 space-y-4" role="list">
                  {notifications.map((n) => {
                    const createdLabel = formatDate(n.createdAt);
                    return (
                      <li key={n.id} className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-sm font-semibold text-gray-900">{n.message || n.body}</p>
                        {createdLabel && <p className="mt-1 text-xs text-gray-500">{createdLabel}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </PortalContainer>
  );
}