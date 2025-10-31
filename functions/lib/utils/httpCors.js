import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PORTAL_DEFAULT_CORS_ORIGINS } = require('../../shared/config/hosting.js');
const parseEnvOrigins = (raw) => raw
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0) ?? [];
const ALLOW_ORIGINS = new Set([
    ...PORTAL_DEFAULT_CORS_ORIGINS,
    ...parseEnvOrigins(process.env.ALLOWED_CORS_ORIGINS),
]);
const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization';
const ALLOW_METHODS = 'POST, OPTIONS';
const MAX_AGE_SECONDS = '3600';
const normaliseHeaderValue = (value) => {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(value)) {
        const joined = value
            .map((part) => part?.toString().trim())
            .filter(Boolean)
            .join(', ');
        return joined.length > 0 ? joined : null;
    }
    return null;
};
const resolveRequestedHeaders = (req) => normaliseHeaderValue(req.get?.('access-control-request-headers') ?? req.headers['access-control-request-headers']);
const resolveOriginHeader = (req) => normaliseHeaderValue(req.get?.('origin') ?? req.headers.origin);
const resolveAllowedOrigin = (originHeader) => {
    if (!originHeader) {
        return null;
    }
    const trimmed = originHeader.trim();
    if (!trimmed) {
        return null;
    }
    return ALLOW_ORIGINS.has(trimmed) ? trimmed : null;
};
export const prepareCorsResponse = (req, res, { allowCredentials = true } = {}) => {
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
