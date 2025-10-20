import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {Request, Response} from "express";

// eslint-disable-next-line camelcase
export const analytics_track = onRequest(
  {region: "us-central1"},
  async (req: Request, res: Response) => {
    if (req.method === "OPTIONS") {
      res.status(405).send("");
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
