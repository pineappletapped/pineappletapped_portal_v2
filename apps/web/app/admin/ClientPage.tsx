"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  const [tasks, setTasks] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      if (guardLoading || !allowed) return;

      // Load counts for quick metrics
      const [ordersSnap, projectsSnap, usersSnap, productsSnap, quotesSnap, proposalsSnap] = await Promise.all([
        getCountFromServer(collection(db, 'orders')),
        getCountFromServer(collection(db, 'projects')),
        getCountFromServer(collection(db, 'users')),
        getCountFromServer(collection(db, 'products')),
        getCountFromServer(query(collection(db, 'quoteRequests'), where('status', '==', 'pending'))),
        getCountFromServer(query(collection(db, 'proposals'), where('status', '==', 'sent'))),
      ]);
      setStats({
        orders: ordersSnap.data().count,
        projects: projectsSnap.data().count,
        users: usersSnap.data().count,
        products: productsSnap.data().count,
        quotesPending: quotesSnap.data().count,
        proposalsPending: proposalsSnap.data().count,
      });

      // Fetch a few recent tasks without requiring a collection group index
      const projSnap = await getDocs(
        query(collection(db, 'projects'), orderBy('createdAt', 'desc'), limit(5))
      );
      const taskResults: any[] = [];
      for (const p of projSnap.docs) {
        const tSnap = await getDocs(
          query(collection(db, 'projects', p.id, 'tasks'), orderBy('createdAt', 'desc'), limit(1))
        );
        tSnap.docs.forEach((d) => taskResults.push({ id: d.id, ...(d.data() as any) }));
      }
      taskResults.sort((a, b) => {
        const aTime = (a.createdAt as any)?.toMillis?.() || 0;
        const bTime = (b.createdAt as any)?.toMillis?.() || 0;
        return bTime - aTime;
      });
      setTasks(taskResults.slice(0, 5));
    })();
  }, [allowed, guardLoading]);
  if (guardLoading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to view the admin dashboard.</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Admin Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Orders" value={stats.orders} />
        <StatCard label="Projects" value={stats.projects} />
        <StatCard label="Clients" value={stats.users} />
        <StatCard label="Products" value={stats.products} />
        <StatCard label="Quotes Pending" value={stats.quotesPending} />
        <StatCard label="Proposals Pending" value={stats.proposalsPending} />
      </div>

      <section>
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

      <section>
        <h2 className="text-lg font-semibold mb-2">Quick Links</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: 'Orders & Projects',
              links: [
                { href: '/admin/orders', label: 'Manage Orders' },
                { href: '/admin/projects', label: 'Project Management' },
                { href: '/admin/workflows', label: 'Manage Workflows' },
                { href: '/admin/proposals', label: 'Quotes & Proposals' },
                { href: '/admin/availability', label: 'Manage Availability' },
              ],
            },
            {
              title: 'Products',
              links: [
                { href: '/admin/categories', label: 'Manage Categories' },
                { href: '/admin/products', label: 'Product Management' },
                { href: '/admin/modifiers', label: 'Manage Modifiers' },
                { href: '/admin/venues', label: 'Venue Library' },
              ],
            },
            {
              title: 'People',
              links: [
                { href: '/admin/users', label: 'CRM' },
                { href: '/admin/team', label: 'Manage Team' },
                { href: '/admin/join-team-steps', label: 'Join Team Form' },
              ],
            },
            {
              title: 'Brand & Content',
              links: [
                { href: '/admin/client-logos', label: 'Manage Client Logos' },
                { href: '/admin/website-design', label: 'Website Design' },
              ],
            },
            {
              title: 'Marketing',
              links: [
                { href: '/admin/voucher-codes', label: 'Voucher Management' },
                { href: '/admin/email-schedules', label: 'Email Schedules' },
              ],
            },
            {
              title: 'Policies & Docs',
              links: [
                { href: '/admin/agreements', label: 'Agreements & Policies' },
              ],
            },
            { title: 'Finance', links: [ { href: '/admin/finance', label: 'Finance & Expenses' } ] },
            { title: 'Reports', links: [ { href: '/admin/analytics', label: 'Analytics Dashboard' } ] },
            {
              title: 'Logs & Comms',
              links: [
                { href: '/admin/login-history', label: 'Login History' },
                { href: '/admin/messages', label: 'Messages' },
              ],
            },
            { title: 'Equipment', links: [ { href: '/admin/equipment', label: 'Equipment Register' } ] },
          ].map((group) => (
            <div key={group.title}>
              <h3 className="font-medium">{group.title}</h3>
              <ul className="mt-1 grid gap-1 list-disc list-inside">
                {group.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-orange">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 bg-slate-100 rounded-lg shadow">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}