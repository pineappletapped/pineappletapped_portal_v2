'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FiBarChart2,
  FiBriefcase,
  FiCalendar,
  FiClipboard,
  FiFolder,
  FiGrid,
  FiHome,
  FiLayers,
  FiMail,
  FiMenu,
  FiSettings,
  FiShoppingBag,
  FiShield,
  FiUploadCloud,
  FiUsers,
  FiX,
} from 'react-icons/fi';
import clsx from 'clsx';
import Breadcrumbs from './Breadcrumbs';
import { auth, ensureFirebase } from '@/lib/firebase';

type IconComponent = (props: { className?: string }) => JSX.Element;

interface NavigationItem {
  label: string;
  href: string;
  icon: IconComponent;
  exact?: boolean;
}

interface NavigationSection {
  heading: string;
  items: NavigationItem[];
}

type QuickAction = {
  label: string;
  href: string;
  icon: IconComponent;
};

type PortalConfig = {
  id: string;
  match: (pathname: string) => boolean;
  badge: string;
  title: string;
  summary?: string;
  brandMark: string;
  sidebarTitle: string;
  sidebarSubtitle: string;
  sidebarCopy?: string;
  navigation?: NavigationSection[];
  quickActions?: QuickAction[];
  surface: 'card' | 'plain';
};

const CLIENT_SEGMENTS = [
  'dashboard',
  'projects',
  'orders',
  'bookings',
  'emails',
  'analytics',
  'orgs',
  'training',
  'tasks',
];

const isClientPath = (pathname: string) => {
  if (pathname === '/' || pathname === '') return true;
  return CLIENT_SEGMENTS.some((segment) =>
    pathname === `/${segment}` || pathname.startsWith(`/${segment}/`)
  );
};

const PORTAL_CONFIGS: PortalConfig[] = [
  {
    id: 'admin',
    match: (pathname) => pathname.startsWith('/admin'),
    badge: 'Admin workspace',
    title: 'Operations command centre',
    summary:
      'Coordinate production, monitor revenue, and keep every franchise aligned with Pineapple Tapped standards.',
    brandMark: 'PT',
    sidebarTitle: 'Pineapple Tapped',
    sidebarSubtitle: 'Admin Portal',
    sidebarCopy:
      'Steer fulfilment, tooling, and enablement initiatives for every client and franchise.',
    navigation: [
      {
        heading: 'Command',
        items: [
          { label: 'Overview', href: '/admin', icon: FiHome, exact: true },
          { label: 'Projects', href: '/admin/projects', icon: FiFolder },
          { label: 'Orders', href: '/admin/orders', icon: FiShoppingBag },
          { label: 'Bookings', href: '/admin/bookings', icon: FiCalendar },
          { label: 'Deliveries', href: '/admin/deliveries', icon: FiUploadCloud },
          { label: 'Analytics', href: '/admin/analytics', icon: FiBarChart2 },
        ],
      },
      {
        heading: 'Enablement',
        items: [
          { label: 'Tools hub', href: '/admin/tools', icon: FiGrid },
          { label: 'AI management', href: '/admin/ai-management', icon: FiSettings },
          { label: 'Training', href: '/admin/training', icon: FiLayers },
          { label: 'Marketing', href: '/admin/marketing', icon: FiClipboard },
          { label: 'Email templates', href: '/admin/email-templates', icon: FiMail },
        ],
      },
      {
        heading: 'People & coverage',
        items: [
          { label: 'Team', href: '/admin/team', icon: FiUsers },
          { label: 'Franchises', href: '/admin/franchises', icon: FiBriefcase },
          { label: 'Insurance', href: '/admin/insurance', icon: FiShield },
        ],
      },
    ],
    quickActions: [
      { label: 'Create proposal', href: '/admin/proposals', icon: FiClipboard },
      { label: 'Schedule production', href: '/admin/bookings', icon: FiCalendar },
      { label: 'Launch tools hub', href: '/admin/tools', icon: FiGrid },
    ],
    surface: 'plain',
  },
  {
    id: 'client',
    match: isClientPath,
    badge: 'Client workspace',
    title: 'Your production hub',
    summary:
      'Track projects, approve deliverables, and connect with the Pineapple Tapped team in real time.',
    brandMark: 'PT',
    sidebarTitle: 'Pineapple Tapped',
    sidebarSubtitle: 'Client Portal',
    sidebarCopy:
      'Navigate the services, insights, and collaboration tools that keep your brand growing.',
    navigation: [
      {
        heading: 'Work',
        items: [
          { label: 'Dashboard', href: '/dashboard', icon: FiHome, exact: true },
          { label: 'Projects', href: '/projects', icon: FiFolder },
          { label: 'Bookings', href: '/bookings', icon: FiCalendar },
        ],
      },
      {
        heading: 'Collaboration',
        items: [
          { label: 'Shared inbox', href: '/emails', icon: FiMail },
          { label: 'Analytics', href: '/analytics', icon: FiBarChart2 },
          { label: 'Content planner', href: '/dashboard/content-planner', icon: FiGrid },
          { label: 'Organisations', href: '/orgs', icon: FiUsers },
        ],
      },
    ],
    quickActions: [
      { label: 'Request new project', href: '/projects/new', icon: FiLayers },
      { label: 'Book a shoot', href: '/bookings', icon: FiCalendar },
      { label: 'Open shared inbox', href: '/emails', icon: FiMail },
    ],
    surface: 'card',
  },
];

const DEFAULT_CONFIG: PortalConfig = {
  id: 'default',
  match: () => true,
  badge: 'Workspace',
  title: 'Portal overview',
  summary: 'Manage your Pineapple Tapped workflows and content in one place.',
  brandMark: 'PT',
  sidebarTitle: 'Pineapple Tapped',
  sidebarSubtitle: 'Portal',
  sidebarCopy: 'Switch between teams and toolsets tailored to your role.',
  navigation: [],
  quickActions: [],
  surface: 'card',
};

function isItemActive(pathname: string, item: NavigationItem): boolean {
  if (item.exact) {
    return pathname === item.href;
  }
  if (item.href === '/') {
    return pathname === '/';
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function resolvePortalConfig(pathname: string): PortalConfig {
  return PORTAL_CONFIGS.find((config) => config.match(pathname)) ?? DEFAULT_CONFIG;
}

function getUserInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return initials || 'PT';
}

export default function PortalContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const portalConfig = useMemo(() => resolvePortalConfig(pathname), [pathname]);
  const navSections = useMemo(
    () => (portalConfig.navigation ?? []).filter((section) => section.items.length > 0),
    [portalConfig.navigation]
  );
  const hasNavigation = navSections.length > 0;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userName, setUserName] = useState<string>('Workspace member');
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        await ensureFirebase();
        if (auth && typeof auth.onAuthStateChanged === 'function') {
          unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
              setUserName(user.displayName || 'Workspace member');
              setUserEmail(user.email || null);
            } else {
              setUserName('Workspace member');
              setUserEmail(null);
            }
          });
        }
      } catch (error) {
        console.error('PortalContainer failed to load auth state', error);
      }
    })();
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const navContent = hasNavigation ? (
    <div className="flex h-full flex-col bg-white">
      <div className="space-y-4 border-b border-slate-200 px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange text-white text-lg font-semibold">
            {portalConfig.brandMark}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue/70">
              {portalConfig.sidebarTitle}
            </p>
            <p className="text-lg font-semibold text-charcoal">{portalConfig.sidebarSubtitle}</p>
          </div>
        </div>
        {portalConfig.sidebarCopy ? (
          <p className="text-sm text-slate-500">{portalConfig.sidebarCopy}</p>
        ) : null}
      </div>
      <nav className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
        {navSections.map((section) => (
          <div key={section.heading} className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.heading}
            </p>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const ItemIcon = item.icon;
                const active = isItemActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={clsx(
                        'flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-orange/10 text-orange'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-charcoal'
                      )}
                      onClick={() => setMobileNavOpen(false)}
                    >
                      <ItemIcon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  ) : null;

  const quickActions = portalConfig.quickActions ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {hasNavigation ? (
          <aside className="hidden w-72 flex-shrink-0 lg:block">{navContent}</aside>
        ) : null}
        <main className="flex-1 space-y-6">
          <div className="flex items-center justify-between lg:hidden">
            {hasNavigation ? (
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-charcoal shadow-sm"
              >
                <FiMenu className="h-4 w-4" />
                Menu
              </button>
            ) : (
              <span />
            )}
          </div>

          <header className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm ring-1 ring-white/60">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue/60">
                  {portalConfig.badge}
                </p>
                <h1 className="text-2xl font-semibold text-charcoal lg:text-3xl">{portalConfig.title}</h1>
                {portalConfig.summary ? (
                  <p className="max-w-2xl text-sm text-slate-600">{portalConfig.summary}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 shadow-inner ring-1 ring-slate-200">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange/15 text-sm font-semibold uppercase text-orange">
                  {getUserInitials(userName)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-charcoal">{userName}</p>
                  {userEmail ? (
                    <p className="text-xs text-slate-500">{userEmail}</p>
                  ) : (
                    <p className="text-xs text-slate-400">Signed in</p>
                  )}
                </div>
              </div>
            </div>
            {quickActions.length > 0 ? (
              <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {quickActions.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm font-medium text-charcoal shadow-sm transition hover:border-orange hover:bg-orange/5 hover:text-orange"
                    >
                      <span>{action.label}</span>
                      <ActionIcon className="h-4 w-4 text-slate-400 transition group-hover:text-orange" />
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </header>

          <div
            className={clsx(
              'space-y-6',
              portalConfig.surface === 'card' &&
                'rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm ring-1 ring-slate-200'
            )}
          >
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>

      {hasNavigation && mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="h-full w-72 max-w-xs bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <p className="text-sm font-semibold text-slate-500">Navigation</p>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:text-orange"
                aria-label="Close navigation"
              >
                <FiX className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{navContent}</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="h-full flex-1 bg-slate-900/50"
            aria-label="Close navigation backdrop"
          />
        </div>
      ) : null}
    </div>
  );
}
