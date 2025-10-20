const DEFAULT_ALLOWED_HEADERS = [
    'authorization',
    'content-type',
    'x-client-version',
    'x-firebase-gmpid',
    'x-firebase-appcheck',
    'x-requested-with',
];
const DEFAULT_ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const DEFAULT_MAX_AGE_SECONDS = 3600;
const DEFAULT_ORIGIN_PATTERNS = [
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://*.pineapple-tapped---portal.europe-west4.hosted.app',
    'https://*.pineapple-tapped---portal.us-central1.hosted.app',
    'https://*.pineappletappedportal.web.app',
    'https://*.pineappletappedportal.firebaseapp.com',
    'https://*.pineappletapped.com',
    'https://*.pineapple-tapped.com',
];
const ORIGIN_ENV_KEYS = [
    'PORTAL_ALLOWED_ORIGINS',
    'PORTAL_ALLOWED_ORIGIN_PATTERNS',
    'SHARED_ALLOWED_ORIGINS',
    'NEXT_PUBLIC_SHARED_ALLOWED_ORIGINS',
    'FUNCTIONS_SHARED_ALLOWED_ORIGINS',
];
const defaultOrigins = new Set(DEFAULT_ORIGIN_PATTERNS.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0));
for (const key of ORIGIN_ENV_KEYS) {
    const raw = process.env[key];
    if (!raw) {
        continue;
    }
    for (const candidate of parseOriginList(raw)) {
        defaultOrigins.add(candidate);
    }
}
const BASE_ORIGIN_MATCHERS = compileOriginPatterns(Array.from(defaultOrigins));
function parseOriginList(value) {
    return value
        .split(/[\s,]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}
function defaultPortForProtocol(protocol) {
    switch (protocol) {
        case 'http:':
            return '80';
        case 'https:':
            return '443';
        default:
            return null;
    }
}
const ORIGIN_PATTERN_REGEX = /^(https?):\/\/([^/:]+)(?::(\*|\d+))?$/i;
function compileOriginPattern(pattern) {
    const trimmed = pattern.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed === '*') {
        return {
            raw: trimmed,
            test: () => true,
        };
    }
    const match = ORIGIN_PATTERN_REGEX.exec(trimmed);
    if (!match) {
        console.warn(`[cors] Ignoring invalid origin pattern "${pattern}"`);
        return null;
    }
    const protocol = `${match[1].toLowerCase()}:`;
    const hostPattern = match[2].toLowerCase();
    const portPattern = match[3] ?? '';
    const allowAnyPort = portPattern === '*';
    const isGlobalHostWildcard = hostPattern === '*';
    const isSubdomainWildcard = hostPattern.startsWith('*.');
    const wildcardSuffix = isSubdomainWildcard ? hostPattern.slice(2) : '';
    return {
        raw: trimmed,
        test: (originUrl) => {
            if (protocol !== '*' && originUrl.protocol !== protocol) {
                return false;
            }
            if (!allowAnyPort) {
                if (portPattern) {
                    if (originUrl.port !== portPattern) {
                        return false;
                    }
                }
                else {
                    const defaultPort = defaultPortForProtocol(originUrl.protocol);
                    if (originUrl.port && originUrl.port !== defaultPort) {
                        return false;
                    }
                }
            }
            const hostname = originUrl.hostname.toLowerCase();
            if (isGlobalHostWildcard) {
                return true;
            }
            if (isSubdomainWildcard) {
                if (hostname === wildcardSuffix) {
                    return true;
                }
                return hostname.endsWith(`.${wildcardSuffix}`);
            }
            return hostname === hostPattern;
        },
    };
}
function compileOriginPatterns(patterns) {
    const compiled = [];
    for (const pattern of patterns) {
        const matcher = compileOriginPattern(pattern);
        if (matcher) {
            compiled.push(matcher);
        }
    }
    return compiled;
}
function appendVaryHeader(res, value) {
    const existing = res.getHeader('Vary');
    if (!existing) {
        res.setHeader('Vary', value);
        return;
    }
    const header = Array.isArray(existing) ? existing.join(', ') : String(existing);
    const parts = header
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (!parts.includes(value)) {
        parts.push(value);
        res.setHeader('Vary', parts.join(', '));
    }
}
function resolveAllowedOrigin(originHeader, extraOrigins) {
    if (!originHeader) {
        return null;
    }
    const trimmed = originHeader.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') {
        return null;
    }
    let originUrl;
    try {
        originUrl = new URL(trimmed);
    }
    catch (error) {
        console.warn('[cors] Received malformed origin header', trimmed);
        return null;
    }
    if (extraOrigins && extraOrigins.length > 0) {
        const runtimeMatchers = compileOriginPatterns(extraOrigins);
        for (const matcher of runtimeMatchers) {
            if (matcher.test(originUrl)) {
                return trimmed;
            }
        }
    }
    for (const matcher of BASE_ORIGIN_MATCHERS) {
        if (matcher.test(originUrl)) {
            return trimmed;
        }
    }
    return null;
}
function buildHeaderValue(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))).join(',');
}
export const CALLABLE_CORS_ORIGINS = true;
export function runCorsCheck(req, res, options = {}) {
    const allowCredentials = options.allowCredentials ?? true;
    const allowedHeaders = options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS;
    const allowedMethods = options.allowedMethods ?? DEFAULT_ALLOWED_METHODS;
    const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    const originHeader = req.get('origin') ?? req.get('Origin') ?? null;
    const allowedOrigin = resolveAllowedOrigin(originHeader, options.additionalOrigins);
    if (originHeader && !allowedOrigin) {
        const requestPath = req.originalUrl ?? req.url ?? '[unknown]';
        console.warn('[cors] Blocked request from disallowed origin', originHeader, req.method, requestPath);
        return { allowed: false, handled: false, origin: originHeader };
    }
    if (allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        if (allowCredentials) {
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        appendVaryHeader(res, 'Origin');
    }
    const requestedHeaders = req.get('Access-Control-Request-Headers');
    if (requestedHeaders) {
        res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
        appendVaryHeader(res, 'Access-Control-Request-Headers');
    }
    else {
        res.setHeader('Access-Control-Allow-Headers', buildHeaderValue(allowedHeaders));
    }
    const requestedMethod = req.get('Access-Control-Request-Method');
    if (requestedMethod) {
        res.setHeader('Access-Control-Allow-Methods', requestedMethod);
    }
    else {
        res.setHeader('Access-Control-Allow-Methods', buildHeaderValue(allowedMethods));
    }
    if (options.exposeHeaders && options.exposeHeaders.length > 0) {
        res.setHeader('Access-Control-Expose-Headers', buildHeaderValue(options.exposeHeaders));
    }
    res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return { allowed: true, handled: true, origin: allowedOrigin };
    }
    return { allowed: true, handled: false, origin: allowedOrigin };
}
export async function withCors(req, res, handler, options = {}) {
    const corsResult = runCorsCheck(req, res, options);
    if (!corsResult.allowed) {
        if (!corsResult.handled) {
            res.status(403).json({ error: 'Origin not allowed', code: 'cors-not-allowed' });
        }
        return;
    }
    if (corsResult.handled) {
        return;
    }
    await handler();
}
