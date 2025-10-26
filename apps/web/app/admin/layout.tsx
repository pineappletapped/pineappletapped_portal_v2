import type { ReactNode } from 'react';
import AdminNavigation from './AdminNavigation';
import { ADMIN_NAV_SECTIONS } from './navConfig';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:flex-row lg:gap-12 lg:px-8">
        <aside className="lg:w-72 lg:flex-none">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Admin workspace</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Control centre</h1>
            <p className="mt-3 text-sm text-slate-600">
              Navigate the tools that keep bookings, production, and franchise operations running smoothly.
            </p>
            <div className="mt-6">
              <AdminNavigation sections={ADMIN_NAV_SECTIONS} />
            </div>
          </div>
        </aside>
        <main className="flex-1 min-w-0 space-y-8 pb-12">
          {children}
        </main>
      </div>
    </div>
  );
}
