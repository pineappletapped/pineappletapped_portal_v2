import type { NextApiRequest, NextApiResponse } from "next";

import {
  HttpFunctionInvocationError,
  invokeHttpFunction,
} from "@/lib/httpFunctions";

import { applyApiCors, handleOptions } from "./_utils/cors";

const extractBearerToken = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  const token = match?.[1]?.trim();
  return token?.length ? token : null;
};

const normaliseBody = (body: unknown): Record<string, unknown> => {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
};

const sendJson = (res: NextApiResponse, status: number, payload: Record<string, unknown>) => {
  res.status(status).json(payload);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    handleOptions(req, res);
    return;
  }

  applyApiCors(req, res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    sendJson(res, 405, { error: "Method not allowed", code: "method-not-allowed" });
    return;
  }

  const body = normaliseBody(req.body);
  const bearerHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization ?? null;
  const idToken = extractBearerToken(bearerHeader);
  const hostHeader =
    (Array.isArray(req.headers["x-forwarded-host"]) ? req.headers["x-forwarded-host"][0] : req.headers["x-forwarded-host"]) ??
    (Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host) ??
    null;

  try {
    const result = await invokeHttpFunction<Record<string, unknown> | null>("createOrder", {
      body,
      idToken,
      includeOverrides: false,
      allowRelativeFallback: false,
      host: hostHeader,
    });

    const payload =
      result && result.payload && typeof result.payload === "object"
        ? result.payload
        : { ok: result.ok };

    res.status(result.status).json(payload ?? null);
  } catch (error) {
    if (error instanceof HttpFunctionInvocationError) {
      const attemptsSummary = error.attempts.length ? error.attempts.join(" | ") : "<none>";
      console.error("create-order invocation attempts failed", {
        host: hostHeader,
        attempts: error.attempts,
        summary: attemptsSummary,
      });
      sendJson(res, 502, {
        error: "createOrder unavailable",
        code: "http-function-error",
        attempts: error.attempts,
      });
      return;
    }

    console.error("create-order proxy request failed", error);
    sendJson(res, 500, { error: "createOrder failed", code: "proxy-error" });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
