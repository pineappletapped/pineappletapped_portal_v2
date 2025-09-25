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
import { db, auth, functions, httpsCallable } from '@/lib/firebase';
import Link from 'next/link';
import PortalContainer from '@/components/PortalContainer';
import ContentPlanPanel from '@/components/ContentPlanPanel';

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
        // Record login once per dashboard load. If the request fails it's non-blocking.
        try {
          if (functions && httpsCallable) {
            const call = httpsCallable(functions, 'recordLogin');
            await call({ timestamp: new Date().toISOString() });
          }
        } catch (err) {
          console.warn('Failed to record login', err);
        }
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

  if (loading) return <p>Loading…</p>;
  return (
    <PortalContainer>
      <div className="grid gap-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link href="/categories" className="card p-4 text-center hover:bg-gray-100">
          <div className="font-medium">Browse Products</div>
        </Link>
        <Link href="/projects/new" className="card p-4 text-center hover:bg-gray-100">
          <div className="font-medium">New Project</div>
        </Link>
        <Link href="/bookings" className="card p-4 text-center hover:bg-gray-100">
          <div className="font-medium">Book Session</div>
        </Link>
        <Link href="/projects" className="card p-4 text-center hover:bg-gray-100">
          <div className="font-medium">View Projects</div>
        </Link>
      </div>
      <ContentPlanPanel />
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {/* Customer Tasks */}
      <section className="card p-4">
        <h3 className="text-lg font-medium mb-2">Your Tasks</h3>
        {tasks.length === 0 ? (
          <p>No tasks.</p>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 mb-1">
              <label className="text-sm">Project:</label>
              <select
                className="input w-auto"
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              >
                <option value="all">All</option>
                {taskProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || 'Untitled'}
                  </option>
                ))}
              </select>
            </div>
            <ul className="grid gap-2">
              {(taskFilter === 'all'
                ? tasks
                : tasks.filter((t) => t.projectId === taskFilter)
              ).map((t) => (
                <li
                  key={t.id}
                  className="card p-3 flex justify-between items-start gap-2"
                >
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-sm text-gray-500">{t.projectName}</p>
                    {t.dueDate && (
                      <p className="text-xs text-gray-500">Due {t.dueDate}</p>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <Link
                      href={`/projects/${t.projectId}/tasks`}
                      className="btn-sm"
                    >
                      View
                    </Link>
                    <button
                      className="btn-sm"
                      onClick={() => completeTask(t)}
                    >
                      Complete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {/* Projects */}
      <section className="card p-4">
        <h3 className="text-lg font-medium mb-2">Recent Projects</h3>
        {projects.length === 0 ? <p>No projects.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="card p-4 hover:shadow-md transition flex flex-col gap-2"
              >
                <div className="font-medium">{p.name || 'Untitled'}</div>
                <div className="text-sm text-gray-500">{p.status || 'draft'}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
      {/* Orders */}
      <section className="card p-4">
        <h3 className="text-lg font-medium mb-2">Recent Orders</h3>
        {orders.length === 0 ? <p>No orders.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="card p-4 hover:shadow-md transition flex flex-col gap-2"
              >
                <div className="font-medium">
                  {o.projectName || `Order #${o.id.substring(0, 6)}`}
                </div>
                <div className="text-sm text-gray-500">{o.status}</div>
              </Link>
            ))}
          </div>
          )}
        </section>
      {/* Bookings */}
      <section className="card p-4">
        <h3 className="text-lg font-medium mb-2">My Bookings</h3>
        {bookings.length === 0 ? <p>No bookings.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bookings.map((b) => (
              <div
                key={b.id}
                className="card p-4 hover:shadow-md transition flex flex-col gap-2"
              >
                <div className="font-medium">{b.slot?.date} {b.slot?.start}-{b.slot?.end}</div>
                <div className="text-sm text-gray-500">{b.status}</div>
              </div>
            ))}
          </div>
        )}
      </section>
      {/* Recent Assets & Approvals */}
      <section className="card p-4">
        <h3 className="text-lg font-medium mb-2">Recent Assets</h3>
        {assets.length === 0 ? <p>No assets yet.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((a) => (
              <Link
                key={a.id}
                href={`/projects/${a.projectId}/assets/${a.id}`}
                className="card p-4 hover:shadow-md transition flex flex-col gap-2"
              >
                <div className="font-medium">{a.name || 'Asset'}</div>
                <div className="text-sm text-gray-500">{a.status || 'draft'}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
      {/* Recommendations */}
      <section className="card p-4">
        <h3 className="text-lg font-medium mb-2">Suggested Campaigns</h3>
        {recommendations.length === 0 ? <p>No suggestions at this time.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className="card p-4 hover:shadow-md transition flex flex-col gap-2"
              >
                <h3 className="font-medium">{rec.title}</h3>
                <p className="text-sm text-gray-700 flex-1">{rec.body}</p>
                {rec.cta && <Link href={rec.cta} className="btn-sm">Learn more</Link>}
              </div>
            ))}
          </div>
        )}
      </section>
      {/* Notifications */}
      <section className="card p-4">
        <h3 className="text-lg font-medium mb-2">Notifications</h3>
        {notifications.length === 0 ? <p>No notifications.</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {notifications.map((n) => (
              <div
                key={n.id}
                className="card p-4 hover:shadow-md transition flex flex-col gap-2"
              >
                <div className="font-medium">{n.message || n.body}</div>
                <div className="text-sm text-gray-500">{n.createdAt && n.createdAt.toDate && n.createdAt.toDate().toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </section>
      </div>
      </div>
    </PortalContainer>
  );
}