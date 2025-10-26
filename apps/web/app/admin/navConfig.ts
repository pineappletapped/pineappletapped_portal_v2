export interface AdminNavItem {
  label: string;
  href: string;
  exact?: boolean;
}

export interface AdminNavSection {
  title: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/admin', exact: true },
      { label: 'Analytics', href: '/admin/analytics' },
      { label: 'Login history', href: '/admin/login-history' },
      { label: 'Audit logs', href: '/admin/audit-logs' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Projects', href: '/admin/projects' },
      { label: 'Orders', href: '/admin/orders' },
      { label: 'Bookings', href: '/admin/bookings' },
      { label: 'Deliveries', href: '/admin/deliveries' },
      { label: 'Products', href: '/admin/products' },
      { label: 'Finance', href: '/admin/finance' },
    ],
  },
  {
    title: 'Enablement',
    items: [
      { label: 'Marketing', href: '/admin/marketing' },
      { label: 'Tools hub', href: '/admin/tools' },
      { label: 'AI management', href: '/admin/ai-management' },
      { label: 'Training', href: '/admin/training' },
      { label: 'Email templates', href: '/admin/email-templates' },
      { label: 'Voucher codes', href: '/admin/voucher-codes' },
    ],
  },
  {
    title: 'People & coverage',
    items: [
      { label: 'Team', href: '/admin/team' },
      { label: 'Franchises', href: '/admin/franchises' },
      { label: 'Insurance', href: '/admin/insurance' },
      { label: 'Clients', href: '/admin/users' },
    ],
  },
];
