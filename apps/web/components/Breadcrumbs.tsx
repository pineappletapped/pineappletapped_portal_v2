'use client';

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import MuiBreadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

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
  'risk-assessments': 'Risk & Safety',
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
  'ai-management': 'AI Management',
  'email-templates': 'Email Templates',
  emails: 'Shared inbox',
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
    <MuiBreadcrumbs separator={<NavigateNextIcon fontSize="small" color="disabled" />} aria-label="Breadcrumb">
      {trail.map((item, idx) => {
        const isLast = idx === trail.length - 1;
        if (isLast) {
          return (
            <Typography key={item.href} color="text.primary" fontWeight={600}>
              {item.label}
            </Typography>
          );
        }
        return (
          <Link
            key={item.href}
            component={NextLink}
            href={item.href}
            underline="hover"
            color="text.secondary"
            sx={{ fontWeight: 500 }}
          >
            {item.label}
          </Link>
        );
      })}
    </MuiBreadcrumbs>
  );
}
