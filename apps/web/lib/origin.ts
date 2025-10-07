const ENV_ORIGIN_CANDIDATES: Array<string | undefined | null> = [
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.NEXT_PUBLIC_WEBAPP_URL,
  process.env.NEXT_PUBLIC_BASE_URL,
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.NEXT_PUBLIC_VERCEL_URL,
  process.env.SITE_URL,
  process.env.WEBAPP_URL,
  process.env.BASE_URL,
  process.env.VERCEL_URL,
];

function normaliseOrigin(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withProtocol = /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch (error) {
    return null;
  }
}

const ENV_ORIGIN = ENV_ORIGIN_CANDIDATES.map(normaliseOrigin).find(
  (origin): origin is string => Boolean(origin)
);

function isLocalHostname(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }
  const value = hostname.trim().toLowerCase();
  return (
    value === "localhost" ||
    value === "::1" ||
    value.startsWith("127.") ||
    value.startsWith("0.0.0.0")
  );
}

function pickOrigin(candidate: string | null, allowLocalhost: boolean): string | null {
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if (!allowLocalhost && isLocalHostname(url.hostname)) {
      return null;
    }
    return url.origin;
  } catch (error) {
    return null;
  }
}

function resolveFromHeaders(
  headers: Headers | null | undefined,
  allowLocalhost: boolean
): string | null {
  if (!headers) {
    return null;
  }
  const forwardedHost = headers.get("x-forwarded-host");
  const hostHeader = forwardedHost ?? headers.get("host");
  if (!hostHeader) {
    return null;
  }
  const host = hostHeader.split(",")[0]?.trim();
  if (!host) {
    return null;
  }
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedPort = headers.get("x-forwarded-port")?.split(",")[0]?.trim();
  const lowerHost = host.toLowerCase();
  const portMatch = lowerHost.match(/:(\d+)$/);
  const explicitPort = portMatch ? portMatch[1] : null;
  const port = forwardedPort || explicitPort;
  let scheme = forwardedProto;
  if (!scheme) {
    if (port === "443") {
      scheme = "https";
    } else if (port === "80") {
      scheme = "http";
    }
  }
  if (!scheme) {
    if (
      lowerHost.startsWith("localhost") ||
      lowerHost.startsWith("127.") ||
      lowerHost.startsWith("0.0.0.0") ||
      lowerHost.startsWith("[::1")
    ) {
      scheme = "http";
    } else {
      scheme = explicitPort && explicitPort !== "443" ? "http" : "https";
    }
  }
  return pickOrigin(`${scheme}://${host}`, allowLocalhost);
}

export interface OriginRequestLike {
  headers?: Headers | null;
  nextUrl?: { origin?: string | null } | null;
  url?: string | null;
}

export interface ResolveOriginOptions {
  request?: OriginRequestLike | null;
  allowLocalhost?: boolean;
}

export function resolveAppOrigin(options?: ResolveOriginOptions): string | null {
  const allowLocalhost =
    options?.allowLocalhost ?? process.env.NODE_ENV !== "production";

  if (ENV_ORIGIN) {
    const origin = pickOrigin(ENV_ORIGIN, true);
    if (origin) {
      return origin;
    }
  }

  const request = options?.request;
  if (request) {
    const fromHeaders = resolveFromHeaders(request.headers ?? null, allowLocalhost);
    if (fromHeaders) {
      return fromHeaders;
    }
    const nextUrlOrigin = request.nextUrl?.origin ?? null;
    const originFromNextUrl = pickOrigin(nextUrlOrigin, allowLocalhost);
    if (originFromNextUrl) {
      return originFromNextUrl;
    }
    const originFromUrl = pickOrigin(request.url ?? null, allowLocalhost);
    if (originFromUrl) {
      return originFromUrl;
    }
  }

  if (typeof window !== "undefined" && window.location) {
    const { origin, hostname } = window.location;
    if (!origin) {
      return null;
    }
    if (!allowLocalhost && isLocalHostname(hostname)) {
      return null;
    }
    return origin;
  }

  return null;
}

export function buildAppUrl(
  path: string,
  options?: ResolveOriginOptions & {
    params?: Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>>;
  }
): URL {
  const fallbackOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:3000";
  const origin = resolveAppOrigin(options) ?? fallbackOrigin;
  const url = new URL(path, origin);
  if (options?.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      if (Array.isArray(value)) {
        url.searchParams.delete(key);
        value.forEach((item) => {
          url.searchParams.append(key, String(item));
        });
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }
  return url;
}
