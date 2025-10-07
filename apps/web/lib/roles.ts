export type RoleKey =
  | 'admin'
  | 'operations'
  | 'finance'
  | 'projects'
  | 'sales'
  | 'marketing'
  | 'organiser'
  | 'affiliate';

export type UserRoles = Partial<Record<RoleKey, boolean>>;

const GOD_ADMIN_UIDS = new Set<string>(['WK6WCuSueLN5M3Zq6D7WBbHyGPo1']);
const GOD_ADMIN_EMAILS = new Set<string>([
  'ryan@pineappletapped.com',
  'ryanadmin@pineappletapped.com',
]);

type IdentityLike = {
  id?: string | null | undefined;
  uid?: string | null | undefined;
  email?: string | null | undefined;
};

export interface RoleDefinition {
  key: RoleKey;
  label: string;
  description: string;
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: 'admin',
    label: 'Admin',
    description: 'Full access to all administrative tools and settings.',
  },
  {
    key: 'operations',
    label: 'Operations',
    description: 'Manage orders, products, modifiers, venues, equipment, and workflows.',
  },
  {
    key: 'finance',
    label: 'Finance',
    description: 'Access invoicing, expenses, and financial reporting features.',
  },
  {
    key: 'projects',
    label: 'Projects',
    description: 'Plan and track project delivery, tasks, and resource assignments.',
  },
  {
    key: 'sales',
    label: 'Sales & CRM',
    description: 'Manage CRM records, proposals, quotes, and commercial offers.',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    description: 'Control website content, email schedules, analytics, and brand assets.',
  },
  {
    key: 'organiser',
    label: 'Event organiser',
    description:
      'Unlock the organiser portal to manage exhibitor packages, booking slots, and partner revenue.',
  },
  {
    key: 'affiliate',
    label: 'Affiliate',
    description: 'Access the affiliate earnings portal and referral performance dashboards.',
  },
];

export const ROLE_LABELS: Record<RoleKey, string> = ROLE_DEFINITIONS.reduce(
  (acc, role) => {
    acc[role.key] = role.label;
    return acc;
  },
  {} as Record<RoleKey, string>
);

export const ROLE_KEYS = ROLE_DEFINITIONS.map((role) => role.key);

export const ADMIN_ROLE_KEYS: RoleKey[] = [
  'admin',
  'operations',
  'finance',
  'projects',
  'sales',
  'marketing',
];

export const PORTAL_ROLE_KEYS: RoleKey[] = ['affiliate', 'organiser'];

export function isGodAdmin(identity?: IdentityLike | null): boolean {
  if (!identity) {
    return false;
  }
  const { id, uid, email } = identity;
  if (uid && GOD_ADMIN_UIDS.has(uid)) {
    return true;
  }
  if (id && GOD_ADMIN_UIDS.has(id)) {
    return true;
  }
  if (email && GOD_ADMIN_EMAILS.has(email.toLowerCase())) {
    return true;
  }
  return false;
}

export function applyGodAdminRoles(
  roles: UserRoles,
  identity?: IdentityLike | null
): UserRoles {
  if (!isGodAdmin(identity) || roles.admin) {
    return roles;
  }
  return { ...roles, admin: true };
}

export function normalizeRoles(input: unknown): UserRoles {
  if (!input) {
    return {};
  }

  if (Array.isArray(input)) {
    return input.reduce((acc, key) => {
      if (ROLE_KEYS.includes(key as RoleKey)) {
        acc[key as RoleKey] = true;
      }
      return acc;
    }, {} as UserRoles);
  }

  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).reduce((acc, [key, value]) => {
      if (ROLE_KEYS.includes(key as RoleKey) && value === true) {
        acc[key as RoleKey] = true;
      }
      return acc;
    }, {} as UserRoles);
  }

  return {};
}

export function extractUserRoles(userDoc: any): UserRoles {
  const normalized = normalizeRoles(userDoc?.roles);
  const base = userDoc?.isStaff === true ? { ...normalized, admin: true } : normalized;
  return applyGodAdminRoles(base, userDoc);
}

export function hasRole(
  roles: UserRoles | null | undefined,
  required: RoleKey | RoleKey[]
): boolean {
  if (!roles) return false;
  if (roles.admin) return true;
  const requiredList = Array.isArray(required) ? required : [required];
  return requiredList.some((role) => roles[role]);
}

export function rolesToList(roles: UserRoles | null | undefined): RoleKey[] {
  if (!roles) return [];
  return ROLE_KEYS.filter((key) => roles[key]);
}

export function encodeRolesCookie(roles: UserRoles): string {
  return rolesToList(roles).join(',');
}

export function decodeRolesCookie(value: string | undefined | null): RoleKey[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is RoleKey => ROLE_KEYS.includes(part as RoleKey));
}

export function getDefaultAdminRoute(roles: UserRoles | null | undefined): string {
  if (!roles) return '/admin';
  if (roles.admin) return '/admin';
  if (roles.operations) return '/admin/orders';
  if (roles.finance) return '/admin/finance';
  if (roles.projects) return '/admin/projects';
  if (roles.sales) return '/admin/proposals';
  if (roles.marketing) return '/admin/analytics';
  if (roles.affiliate) return '/affiliate';
  if (roles.organiser) return '/organiser';
  return '/admin';
}
