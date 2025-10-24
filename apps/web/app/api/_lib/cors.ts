const HOSTED_APP_ORIGIN =
  'https://pineappletappedportal--pineapple-tapped---portal.europe-west4.hosted.app';

const PRIMARY_FUNCTION_ORIGIN =
  'https://europe-west2-pineapple-tapped---portal.cloudfunctions.net';

const SECONDARY_FUNCTION_ORIGIN =
  'https://europe-west2-ptfbportalbackend.cloudfunctions.net';

const LOCAL_DEVELOPMENT_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization';
const ALLOW_METHODS = 'POST, OPTIONS';
const MAX_AGE_SECONDS = '3600';

const splitEnvList = (value?: string | null) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) ?? [];

const ALLOWED_ORIGINS = new Set<string>([
  HOSTED_APP_ORIGIN,
  PRIMARY_FUNCTION_ORIGIN,
  SECONDARY_FUNCTION_ORIGIN,
  ...LOCAL_DEVELOPMENT_ORIGINS,
  ...splitEnvList(process.env.NEXT_PUBLIC_ALLOWED_CORS_ORIGINS ?? process.env.ALLOWED_CORS_ORIGINS),
]);

const normaliseHeaderValue = (value: string | null) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveOrigin = (request: Request) => normaliseHeaderValue(request.headers.get('origin'));

const resolveRequestedHeaders = (request: Request) =>
  normaliseHeaderValue(request.headers.get('access-control-request-headers'));

export const buildCorsHeaders = (
  request: Request,
  { allowCredentials = true }: { allowCredentials?: boolean } = {},
): Headers => {
  const headers = new Headers();
  const origin = resolveOrigin(request);

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.append('Vary', 'Origin');

    if (allowCredentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }
  } else if (allowCredentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  headers.set('Access-Control-Max-Age', MAX_AGE_SECONDS);
  headers.set('Access-Control-Allow-Headers', resolveRequestedHeaders(request) ?? DEFAULT_ALLOW_HEADERS);

  return headers;
};

export const applyCorsHeaders = <T extends Response>(
  response: T,
  request: Request,
  options?: { allowCredentials?: boolean },
): T => {
  const corsHeaders = buildCorsHeaders(request, options);
  corsHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
};

export const allowedCorsOrigins = Array.from(ALLOWED_ORIGINS);
