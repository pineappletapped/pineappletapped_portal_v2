import type { NextApiRequest, NextApiResponse } from "next";

import { allowedCorsOrigins } from "@/app/api/_lib/cors";

const ALLOW_METHODS = "POST, OPTIONS";
const DEFAULT_ALLOW_HEADERS = "Content-Type, Authorization";
const MAX_AGE_SECONDS = "3600";

const allowedOrigins = new Set(allowedCorsOrigins);

const normaliseHeader = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === "string" && entry.trim().length > 0)?.trim();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
};

export const applyApiCors = (
  req: NextApiRequest,
  res: NextApiResponse,
  { allowCredentials = true }: { allowCredentials?: boolean } = {},
) => {
  const origin = normaliseHeader(req.headers.origin);

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (allowCredentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  } else if (allowCredentials) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  const requestedHeaders = normaliseHeader(req.headers["access-control-request-headers"]);
  res.setHeader("Access-Control-Allow-Headers", requestedHeaders ?? DEFAULT_ALLOW_HEADERS);
  res.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
  res.setHeader("Access-Control-Max-Age", MAX_AGE_SECONDS);
};

export const handleOptions = (req: NextApiRequest, res: NextApiResponse) => {
  applyApiCors(req, res);
  res.status(204).end();
};
