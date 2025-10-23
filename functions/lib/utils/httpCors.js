const HOSTED_APP_ORIGIN = 'https://pineappletappedportal--pineapple-tapped---portal.europe-west4.hosted.app';
const parseEnvOrigins = (raw) => {
    if (!raw) {
        return [];
    }
    return raw
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
};
const baseOrigins = [HOSTED_APP_ORIGIN, 'http://localhost:3000', 'http://localhost:5173'];
const allowedOriginsList = Array.from(new Set([...baseOrigins, ...parseEnvOrigins(process.env.ALLOWED_CORS_ORIGINS)]));
const originLookup = new Map(allowedOriginsList.map((origin) => [origin.toLowerCase(), origin]));
const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization';
const ALLOW_METHODS = 'POST, OPTIONS';
const MAX_AGE_SECONDS = '3600';
const resolveRequestedHeaders = (req) => {
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
const resolveOriginHeader = (req) => {
    const headerValue = req.get?.('origin');
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue;
    }
    const header = req.headers.origin;
    if (typeof header === 'string' && header.trim()) {
        return header;
    }
    if (Array.isArray(header) && header.length > 0) {
        return header[0] ?? null;
    }
    return null;
};
const TRUSTED_HOST_FRAGMENTS = [
    'pineapple-tapped---portal',
    'pineappletappedportal--pineapple-tapped---portal',
];
const isTrustedHostedOrigin = (origin) => {
    try {
        const { hostname } = new URL(origin);
        const lowerHost = hostname.toLowerCase();
        return TRUSTED_HOST_FRAGMENTS.some((fragment) => lowerHost.includes(fragment));
    }
    catch (_a) {
        return false;
    }
};
const resolveAllowedOrigin = (originHeader) => {
    if (originHeader) {
        const trimmed = originHeader.trim();
        if (!trimmed) {
            return null;
        }
        const lookup = originLookup.get(trimmed.toLowerCase());
        if (lookup) {
            return lookup;
        }
        if (isTrustedHostedOrigin(trimmed)) {
            return trimmed;
        }
        return null;
    }
    return allowedOriginsList[0] ?? null;
};
export const prepareCorsResponse = (req, res, { allowCredentials = true } = {}) => {
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
