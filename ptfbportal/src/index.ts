import { onRequest } from "firebase-functions/v2/https";

// Allow your hosted app + localhost for dev
const ALLOWED_ORIGINS = [
  "https://pineapple--pineapple-tapped---portal.europe-west4.hosted.app",
  "http://localhost:3000",
];

// Simple analytics endpoint with CORS handled by v2 "cors" option
export const analytics_track = onRequest(
  { region: "us-central1", cors: ALLOWED_ORIGINS },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      // Preflight (usually auto-handled, but this is fine too)
      return res.status(204).send("");
    }

    try {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : (req.body || {});
      // TODO: write to Firestore/BigQuery/etc.
      return res.status(200).json({ ok: true, received: body });
    } catch (e: any) {
      return res
        .status(500)
        .json({ ok: false, error: e?.message || "unknown error" });
    }
  }
);
