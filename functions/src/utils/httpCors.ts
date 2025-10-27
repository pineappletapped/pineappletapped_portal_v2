import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

const HOSTED_APP_ORIGIN =
  'https://pineappletappedportal--pineapple-tapped---portal.europe-west4.hosted.app';

const PRIMARY_FUNCTION_ORIGINS = [
  'https://europe-west2-pineapple-tapped---portal.cloudfunctions.app',
  'https://europe-west2-pineapple-tapped---portal.cloudfunctions.net',
];

const SECONDARY_FUNCTION_ORIGINS = [
  'https://europe-west2-ptfbportalbackend.cloudfunctions.app',
  'https://europe-west2-ptfbportalbackend.cloudfunctions.net',
];

const LOCAL_DEVELOPMENT_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

const parseEnvOrigins = (raw: string | undefined | null): string[] =>
  raw
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0) ?? [];

const ALLOW_ORIGINS = new Set<string>([
  HOSTED_APP_ORIGIN,
  ...PRIMARY_FUNCTION_ORIGINS,
  ...SECONDARY_FUNCTION_ORIGINS,
  ...LOCAL_DEVELOPMENT_ORIGINS,
  ...parseEnvOrigins(process.env.ALLOWED_CORS_ORIGINS),
]);

const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization';
const ALLOW_METHODS = 'POST, OPTIONS';
const MAX_AGE_SECONDS = '3600';

const normaliseHeaderValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const joined = value.map((part) => part?.toString().trim()).filter(Boolean).join(', ');
    return joined.length > 0 ? joined : null;
  }
  return null;
};

const resolveRequestedHeaders = (req: ExpressRequest): string | null =>
  normaliseHeaderValue(
    req.get?.('access-control-request-headers') ?? req.headers['access-control-request-headers'],
  );

const resolveOriginHeader = (req: ExpressRequest): string | null =>
  normaliseHeaderValue(req.get?.('origin') ?? req.headers.origin);

const resolveAllowedOrigin = (originHeader: string | null): string | null => {
  if (!originHeader) {
    return null;
  }

  const trimmed = originHeader.trim();
  if (!trimmed) {
    return null;
  }

  return ALLOW_ORIGINS.has(trimmed) ? trimmed : null;
};

export interface CorsPreparation {
  allowedOrigin: string | null;
  handled: boolean;
}

export const prepareCorsResponse = (
  req: ExpressRequest,
  res: ExpressResponse,
  { allowCredentials = true }: { allowCredentials?: boolean } = {},
): CorsPreparation => {
  const allowedOrigin = resolveAllowedOrigin(resolveOriginHeader(req));

  if (allowedOrigin) {
    res.set('Access-Control-Allow-Origin', allowedOrigin);
    res.append('Vary', 'Origin');
  }

  if (allowCredentials) {
    res.set('Access-Control-Allow-Credentials', 'true');
  }

  res.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.set('Access-Control-Max-Age', MAX_AGE_SECONDS);
  res.set('Access-Control-Allow-Headers', resolveRequestedHeaders(req) ?? DEFAULT_ALLOW_HEADERS);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return { allowedOrigin, handled: true };
  }

  return { allowedOrigin, handled: false };
};

export const allowedCorsOrigins = Array.from(ALLOW_ORIGINS);
