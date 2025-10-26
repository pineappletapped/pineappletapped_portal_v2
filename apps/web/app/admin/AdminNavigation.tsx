"use client";

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AdminNavSection } from './navConfig';

interface AdminNavigationProps {
  sections: AdminNavSection[];
}

const matchPath = (pathname: string | null, href: string, exact?: boolean) => {
  if (!pathname) {
    return false;
  }
  if (exact) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

export default function AdminNavigation({ sections }: AdminNavigationProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="space-y-8">
      {sections.map((section) => (
        <div key={section.title} className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {section.title}
          </p>
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = matchPath(pathname, item.href, item.exact);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={clsx(
                      'flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition',
                      active
                        ? 'bg-amber-100 text-amber-900 shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    )}
                  >
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
