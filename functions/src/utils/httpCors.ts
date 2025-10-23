import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

const HOSTED_APP_ORIGIN =
  'https://pineappletappedportal--pineapple-tapped---portal.europe-west4.hosted.app';

const parseEnvOrigins = (raw: string | undefined | null): string[] => {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const baseOrigins = [HOSTED_APP_ORIGIN, 'http://localhost:3000', 'http://localhost:5173'];

const allowedOriginsList = Array.from(
  new Set<string>([...baseOrigins, ...parseEnvOrigins(process.env.ALLOWED_CORS_ORIGINS)]),
);

const originLookup = new Map(allowedOriginsList.map((origin) => [origin.toLowerCase(), origin]));

const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization';
const ALLOW_METHODS = 'POST, OPTIONS';
const MAX_AGE_SECONDS = '3600';

export interface CorsPreparation {
  allowedOrigin: string | null;
  handled: boolean;
}

const resolveRequestedHeaders = (req: ExpressRequest): string | null => {
  const direct = req.get?.('access-control-request-headers');
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }

  const header = req.headers['access-control-request-headers'];
  if (typeof header === 'string' && header.trim()) {
    return header;
  }
  if (Array.isArray(header) && header.length > 0) {
    return header.join(', ');
  }

  return null;
};

const resolveOriginHeader = (req: ExpressRequest): string | null => {
  const direct = req.get?.('origin') ?? req.headers.origin;
  if (typeof direct === 'string') {
    return direct;
  }
  if (Array.isArray(direct) && direct.length > 0) {
    return direct[0] ?? null;
  }
  return null;
};

const resolveAllowedOrigin = (originHeader: string | null): string | null => {
  if (originHeader) {
    const match = originLookup.get(originHeader.trim().toLowerCase());
    if (match) {
      return match;
    }
  }

  return allowedOriginsList[0] ?? null;
};

export const prepareCorsResponse = (
  req: ExpressRequest,
  res: ExpressResponse,
  { allowCredentials = true }: { allowCredentials?: boolean } = {},
): CorsPreparation => {
  const originHeader = resolveOriginHeader(req);
  const allowedOrigin = resolveAllowedOrigin(originHeader);

  if (allowedOrigin) {
    res.set('Access-Control-Allow-Origin', allowedOrigin);
  }

  if (allowCredentials) {
    res.set('Access-Control-Allow-Credentials', 'true');
  }

  res.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.set('Access-Control-Max-Age', MAX_AGE_SECONDS);

  const requestedHeaders = resolveRequestedHeaders(req);
  res.set('Access-Control-Allow-Headers', requestedHeaders ?? DEFAULT_ALLOW_HEADERS);
  res.append('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return { allowedOrigin, handled: true };
  }

  return { allowedOrigin, handled: false };
};

export const allowedCorsOrigins = allowedOriginsList;
