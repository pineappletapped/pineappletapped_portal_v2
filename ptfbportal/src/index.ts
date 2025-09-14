import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {Request, Response} from "express";

const ALLOWED_ORIGINS = new Set<string>([
  "https://pineapple--pineapple-tapped---portal.europe-west4.hosted.app",
  "https://ptfbportalbackend--pineapple-tapped---portal.us-central1.hosted.app",
  "http://localhost:3000",
]);

/**
 * Set CORS headers for the response.
 * @param {Response} res HTTP response
 * @param {string=} origin Request origin
 */
function setCors(res: Response, origin?: string) {
  const allowAny = ALLOWED_ORIGINS.has("*");
  const ok = allowAny || (origin && ALLOWED_ORIGINS.has(origin));
  if (ok) {
    res.setHeader("Access-Control-Allow-Origin", allowAny ? "*" : origin!);
    // res.setHeader("Access-Control-Allow-Credentials", "true");
    // (only if using cookies)
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
}

// eslint-disable-next-line camelcase
export const analytics_track = onRequest(
  {region: "us-central1"},
  async (req: Request, res: Response) => {
    const origin = req.headers.origin as string | undefined;
    setCors(res, origin);

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
