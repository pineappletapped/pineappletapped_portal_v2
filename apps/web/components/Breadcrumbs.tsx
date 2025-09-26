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
};

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
  const trail =
    items ??
    segments.map((seg, idx) => ({
      href: '/' + segments.slice(0, idx + 1).join('/'),
      label: formatSegment(seg),
    }));
  if (trail.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-sm breadcrumbs mb-4">
      <ul>
        {trail.map((item, idx) => {
          const isLast = idx === trail.length - 1;
          return (
            <li key={item.href}>
              {isLast ? (
                <span className="font-semibold">{item.label}</span>
              ) : (
                <Link
                  href={item.href}
                  className="text-blue-600 hover:underline"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

