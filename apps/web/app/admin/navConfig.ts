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
    title: 'Orders & Projects',
    items: [
      { label: 'Manage Orders', href: '/admin/orders' },
      { label: 'Project Management', href: '/admin/projects' },
      { label: 'Manage Workflows', href: '/admin/workflows' },
      { label: 'Quotes & Proposals', href: '/admin/proposals' },
      { label: 'Risk Assessments & SOPs', href: '/admin/risk-assessments' },
      { label: 'Manage Availability', href: '/admin/availability' },
      { label: 'Routing Workflow', href: '/admin/availability/routing' },
    ],
  },
  {
    title: 'Products',
    items: [
      { label: 'Manage Categories', href: '/admin/categories' },
      { label: 'Product Management', href: '/admin/products' },
      { label: 'Manage Modifiers', href: '/admin/modifiers' },
      { label: 'Venue Library', href: '/admin/venues' },
    ],
  },
  {
    title: 'Storage',
    items: [{ label: 'Storage Automation', href: '/admin/storage' }],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Production Tools', href: '/admin/tools' },
      { label: 'QR Code Generator', href: '/admin/tools/qr-code-generator' },
      { label: 'AI Management', href: '/admin/ai-management' },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'CRM', href: '/admin/users' },
      { label: 'Manage Team', href: '/admin/team' },
      { label: 'Join Team Form', href: '/admin/join-team-steps' },
      { label: 'Franchise Network', href: '/admin/franchises' },
      { label: 'Training Library', href: '/admin/training' },
    ],
  },
  {
    title: 'Brand & Content',
    items: [
      { label: 'Brand Guidelines', href: '/admin/brand-guidelines' },
      { label: 'Manage Client Logos', href: '/admin/client-logos' },
      { label: 'Blog Management', href: '/admin/blog' },
      { label: 'Website Design', href: '/admin/website-design' },
      { label: 'Email Templates', href: '/admin/email-templates' },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { label: 'Exhibitions', href: '/admin/exhibitions' },
      { label: 'Content Planner', href: '/admin/marketing/content-planner' },
      { label: 'Remarketing', href: '/admin/marketing/remarketing' },
      { label: 'Affiliate Programme', href: '/admin/marketing/affiliates' },
      { label: 'Voucher Management', href: '/admin/voucher-codes' },
      { label: 'Email Schedules', href: '/admin/email-schedules' },
      { label: 'HQ Social Manager', href: '/admin/social-manager' },
    ],
  },
  {
    title: 'Policies & Docs',
    items: [{ label: 'Agreements & Policies', href: '/admin/agreements' }],
  },
  {
    title: 'Finance',
    items: [{ label: 'Finance & Expenses', href: '/admin/finance' }],
  },
  {
    title: 'Reports',
    items: [{ label: 'Analytics Dashboard', href: '/admin/analytics' }],
  },
  {
    title: 'Logs & Comms',
    items: [
      { label: 'Audit Logs', href: '/admin/audit-logs' },
      { label: 'Login History', href: '/admin/login-history' },
      { label: 'Messages', href: '/admin/messages' },
    ],
  },
  {
    title: 'Equipment',
    items: [{ label: 'Equipment Register', href: '/admin/equipment' }],
  },
];
