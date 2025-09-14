import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

const ALLOWED_ORIGINS = new Set<string>([
  "https://pineapple--pineapple-tapped---portal.europe-west4.hosted.app",
  "http://localhost:3000",
]);

function setCors(res: any, origin?: string) {
  const allowAny = ALLOWED_ORIGINS.has("*");
  const ok = allowAny || (origin && ALLOWED_ORIGINS.has(origin));
  if (ok) {
    res.setHeader("Access-Control-Allow-Origin", allowAny ? "*" : origin!);
    // res.setHeader("Access-Control-Allow-Credentials", "true"); // only if using cookies
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export const analytics_track = onRequest({ region: "us-central1" }, async (req, res) => {
  const origin = req.headers.origin as string | undefined;
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    logger.info("analytics_track", { body, ua: req.headers["user-agent"] });
    return res.status(200).json({ ok: true, received: body });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "unknown error" });
  }
});
