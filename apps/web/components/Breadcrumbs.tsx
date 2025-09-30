'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LABELS: Record<string, string> = {
  admin: 'Admin',
  dashboard: 'Dashboard',
  equipment: 'Equipment',
  products: 'Products',
  franchises: 'Franchises',
  franchise: 'Franchise Portal',
  marketing: 'Marketing',
  remarketing: 'Remarketing',
  affiliate: 'Affiliate Portal',
  affiliates: 'Affiliates',
  expo: 'Expo Capture',
  'expo-support': 'Expo Support',
  'expo-pages': 'Expo Lead Pages',
  exhibitions: 'Exhibitions',
  proposals: 'Proposals',
  quotes: 'Quotes',
  crm: 'CRM',
  orders: 'Orders',
  projects: 'Projects',
  'request-quote': 'Request Quote',
  'client-logos': 'Client Logos',
  analytics: 'Analytics',
  team: 'Team',
  contractors: 'Contractors',
  bookings: 'Bookings',
  'content-planner': 'Content Planner',
  workwear: 'Workwear Hub',
  'marketing-materials': 'Marketing Materials',
  training: 'Training',
  engagements: 'Engagement Log',
};

const HIDDEN_ROOT_SEGMENTS = new Set(['admin', 'dashboard', 'franchise', 'contractors', 'team']);

function formatSegment(seg: string): string {
  return LABELS[seg] ?? seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Breadcrumbs({
  items,
}: {
  items?: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const shouldAutoHide = !items && segments.length === 1 && HIDDEN_ROOT_SEGMENTS.has(segments[0]);
  const trail =
    items ??
    segments.map((seg, idx) => ({
      href: '/' + segments.slice(0, idx + 1).join('/'),
      label: formatSegment(seg),
    }));
  if (trail.length === 0 || shouldAutoHide) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500 sm:text-sm">
        {trail.map((item, idx) => {
          const isLast = idx === trail.length - 1;
          return (
            <li key={item.href} className="flex items-center gap-2">
              {isLast ? (
                <span className="text-gray-900" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="hover:text-gray-900">
                  {item.label}
                </Link>
              )}
              {!isLast ? <span className="text-gray-300">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

