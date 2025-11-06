import { NextResponse, type NextRequest } from 'next/server';

type RoleKey = 'admin' | 'operations' | 'finance' | 'projects' | 'sales' | 'marketing';

const ROLE_KEYS = new Set<RoleKey>(['admin', 'operations', 'finance', 'projects', 'sales', 'marketing']);

const ROUTE_ROLE_RULES: { pattern: RegExp; roles: RoleKey[] | null }[] = [
  { pattern: /^\/admin\/?$/, roles: ['admin'] },
  { pattern: /^\/admin\/login-history/, roles: ['admin'] },
  { pattern: /^\/admin\/team/, roles: ['admin'] },
  { pattern: /^\/admin\/finance/, roles: ['finance'] },
  { pattern: /^\/admin\/orders/, roles: ['operations'] },
  { pattern: /^\/admin\/products/, roles: ['operations'] },
  { pattern: /^\/admin\/modifiers/, roles: ['operations'] },
  { pattern: /^\/admin\/venues/, roles: ['operations'] },
  { pattern: /^\/admin\/workflows/, roles: ['operations'] },
  { pattern: /^\/admin\/availability/, roles: ['projects', 'operations'] },
  { pattern: /^\/admin\/projects/, roles: ['projects'] },
  { pattern: /^\/admin\/voucher-codes/, roles: ['sales'] },
  { pattern: /^\/admin\/users/, roles: ['sales'] },
  { pattern: /^\/admin\/agreements/, roles: ['admin'] },
  { pattern: /^\/admin\/categories/, roles: ['marketing'] },
  { pattern: /^\/admin\/website-design/, roles: ['marketing'] },
  { pattern: /^\/admin\/analytics/, roles: ['marketing'] },
  { pattern: /^\/admin\/client-logos/, roles: ['marketing'] },
  { pattern: /^\/admin\/email-schedules/, roles: ['marketing'] },
];

const assetBaseUrl = (() => {
  const raw = process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim();
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    return url;
  } catch (error) {
    return null;
  }
})();

function buildAssetTarget(pathname: string, search: string): URL | null {
  if (!assetBaseUrl) {
    return null;
  }

  const trimmedPath = pathname.replace(/^\/+/u, '');
  if (!trimmedPath) {
    return null;
  }

  const target = new URL(trimmedPath, assetBaseUrl);
  if (search) {
    target.search = search;
  }

  return target;
}

function maybeRedirectStaticAsset(request: NextRequest): NextResponse | null {
  if (!assetBaseUrl) {
    return null;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null;
  }

  const { pathname, search } = request.nextUrl;
  if (!pathname.startsWith('/_next/static/') && !pathname.startsWith('/public/')) {
    return null;
  }

  const target = buildAssetTarget(pathname, search);
  if (!target || target.href === request.url) {
    return null;
  }

  return NextResponse.redirect(target, 307);
}

function decodeRolesCookie(value: string | undefined): Set<RoleKey> {
  if (!value) return new Set();
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    // ignore malformed encoding
  }
  const roles = new Set<RoleKey>();
  decoded
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      if (ROLE_KEYS.has(part as RoleKey)) {
        roles.add(part as RoleKey);
      }
    });
  return roles;
}

function getRequiredRoles(pathname: string): RoleKey[] | null {
  for (const rule of ROUTE_ROLE_RULES) {
    if (rule.pattern.test(pathname)) {
      return rule.roles;
    }
  }
  return null;
}

function hasRequiredRole(roles: Set<RoleKey>, required: RoleKey[] | null): boolean {
  if (!roles.size) return false;
  if (roles.has('admin')) return true;
  if (!required || required.length === 0) return true;
  return required.some((role) => roles.has(role));
}

export function middleware(req: NextRequest) {
  const staticRedirect = maybeRedirectStaticAsset(req);
  if (staticRedirect) {
    return staticRedirect;
  }

  if (!req.nextUrl.pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const uid = req.cookies.get('uid')?.value;
  if (!uid) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const rolesCookie = req.cookies.get('roles')?.value;
  const roles = decodeRolesCookie(rolesCookie);
  const requiredRoles = getRequiredRoles(req.nextUrl.pathname);
  if (!hasRequiredRole(roles, requiredRoles)) {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/(_next/static/:path*)', '/public/:path*', '/admin/:path*'],
};
