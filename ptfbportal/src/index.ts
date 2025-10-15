import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {Request, Response} from "express";

const isDev = process.env.NODE_ENV !== "production";

const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://pineapple--pineapple-tapped---portal.europe-west4.hosted.app",
  "https://pineappletappedportal--pineapple-tapped---portal.europe-west4.hosted.app",
  "https://ptfbportalbackend--pineapple-tapped---portal.us-central1.hosted.app",
  "https://pineapple-tapped---portal.web.app",
  "https://pineapple-tapped---portal.firebaseapp.com",
  "http://localhost:3000",
  "http://localhost:5173",
];

function normaliseEnvValue(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAllowedOrigins(value: string | undefined | null): string[] {
  const normalised = normaliseEnvValue(value);
  if (!normalised) {
    return [];
  }

  return normalised
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const configuredOrigins = new Set<string>([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...parseAllowedOrigins(process.env.SHARED_ALLOWED_ORIGINS),
  ...parseAllowedOrigins(process.env.NEXT_PUBLIC_SHARED_ALLOWED_ORIGINS),
  ...parseAllowedOrigins(process.env.FUNCTIONS_SHARED_ALLOWED_ORIGINS),
  ...parseAllowedOrigins(process.env.PORTAL_SHARED_ALLOWED_ORIGINS),
]);

if (isDev) {
  configuredOrigins.add("*");
}

const ALLOWED_ORIGINS = new Map<string, string>(
  Array.from(configuredOrigins, (origin) => [origin.toLowerCase(), origin]),
);

function resolveAllowedOrigin(origin: string | undefined): string | null {
  if (ALLOWED_ORIGINS.has("*")) {
    return "*";
  }

  if (!origin) {
    return null;
  }

  const trimmed = origin.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return null;
  }

  const canonical = ALLOWED_ORIGINS.get(trimmed.toLowerCase());
  return canonical ?? null;
}

/**
 * Set CORS headers for the response.
 * @param {Response} res HTTP response
 * @param {string=} origin Request origin
 */
function setCors(res: Response, origin?: string): string | null {
  const resolvedOrigin = resolveAllowedOrigin(origin);
  if (resolvedOrigin) {
    res.set("Access-Control-Allow-Origin", resolvedOrigin);
    // res.set("Access-Control-Allow-Credentials", "true");
    // (only if using cookies)
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
  return resolvedOrigin;
}

// eslint-disable-next-line camelcase
export const analytics_track = onRequest(
  {region: "us-central1"},
  async (req: Request, res: Response) => {
    const origin = req.headers.origin as string | undefined;
    const resolvedOrigin = setCors(res, origin);

    if (origin && !resolvedOrigin && !ALLOWED_ORIGINS.has("*")) {
      logger.warn("analytics_track blocked by CORS", {
        origin,
        method: req.method,
        path: req.originalUrl ?? req.url ?? "/analytics_track",
      });
    }

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    try {
      const body =
        typeof req.body === "string" ?
          JSON.parse(req.body || "{}") :
          req.body || {};
      logger.info("analytics_track", {body, ua: req.headers["user-agent"]});
      res.status(200).json({ok: true, received: body});
    } catch (e: unknown) {
      res.status(500).json({
        ok: false,
        error: (e as Error)?.message || "unknown error",
      });
    }
  },
);
