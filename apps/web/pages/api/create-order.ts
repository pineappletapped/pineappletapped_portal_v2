import type { NextApiRequest, NextApiResponse } from "next";

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

const normaliseEndpoint = (value: string | null | undefined): string | null => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "");
  }

  const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+$/, "");
};

const splitEnvList = (value: string | null | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const collectEnvOverrides = (): string[] => {
  const envNames = [
    "NEXT_PUBLIC_CREATE_ORDER_ENDPOINT",
    "CREATE_ORDER_ENDPOINT",
    "NEXT_PUBLIC_ORDER_SERVICE_ENDPOINT",
    "ORDER_SERVICE_ENDPOINT",
  ];

  const endpoints = new Set<string>();

  for (const envName of envNames) {
    const raw = process.env[envName];
    if (!raw) {
      continue;
    }
    for (const entry of splitEnvList(raw)) {
      const normalised = normaliseEndpoint(entry);
      if (normalised) {
        endpoints.add(normalised);
      }
    }
  }

  return Array.from(endpoints);
};

const HOSTED_APP_SUFFIX = ".hosted.app";

const sanitiseHost = (host: string | null | undefined): string | null => {
  if (!host) {
    return null;
  }

  const trimmed = host.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

const extractHostedProjectFragment = (subdomain: string): string | null => {
  if (!subdomain) {
    return null;
  }

  const separator = subdomain.indexOf("--");
  if (separator >= 0) {
    const fragment = subdomain.slice(separator + 2).replace(/^-+/, "");
    return fragment || null;
  }

  return subdomain.replace(/^-+/, "") || null;
};

const buildHostedAppEndpoints = (host: string | null | undefined): string[] => {
  const sanitisedHost = sanitiseHost(host);
  if (!sanitisedHost || !sanitisedHost.endsWith(HOSTED_APP_SUFFIX)) {
    return [];
  }

  const parts = sanitisedHost.split(".");
  if (parts.length < 3) {
    return [];
  }

  const subdomain = parts[0];
  const region = /^[a-z0-9-]+$/.test(parts[1]) ? parts[1] : "europe-west2";
  const fragment = extractHostedProjectFragment(subdomain);

  const endpoints = new Set<string>();

  endpoints.add(`https://${sanitisedHost}/_firebase/functions/v1/createOrder`);
  endpoints.add(`https://${sanitisedHost}/_firebase/functions/v2/createOrder`);
  endpoints.add(`https://${sanitisedHost}/_firebase/functions/v2/${region}/createOrder`);

  if (fragment) {
    endpoints.add(`https://${region}-${fragment}.cloudfunctions.net/createOrder`);
    endpoints.add(`https://${region}-${fragment}.cloudfunctions.app/createOrder`);
  }

  return Array.from(endpoints);
};

const LEGACY_ENDPOINTS = [
  "https://europe-west2-pineapple-tapped---portal.cloudfunctions.net/createOrder",
  "https://europe-west4-pineapple-tapped---portal.cloudfunctions.net/createOrder",
  "https://europe-west2-pineapple-tapped---portal.cloudfunctions.app/createOrder",
  "https://europe-west4-pineapple-tapped---portal.cloudfunctions.app/createOrder",
  "https://europe-west2-ptfbportalbackend.cloudfunctions.net/createOrder",
  "https://europe-west4-ptfbportalbackend.cloudfunctions.net/createOrder",
  "https://europe-west2-ptfbportalbackend.cloudfunctions.app/createOrder",
  "https://europe-west4-ptfbportalbackend.cloudfunctions.app/createOrder",
];

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523]);

interface HttpAttemptResult<T = unknown> {
  ok: boolean;
  status: number;
  payload: T | null;
  endpoint: string;
  attempts: string[];
}

const collectCreateOrderEndpoints = (hostHeader: string | null): string[] => {
  const seen = new Set<string>();
  const push = (candidate: string | null | undefined) => {
    const normalised = normaliseEndpoint(candidate);
    if (!normalised || seen.has(normalised)) {
      return;
    }
    seen.add(normalised);
  };

  collectEnvOverrides().forEach((endpoint) => push(endpoint));
  buildHostedAppEndpoints(hostHeader).forEach((endpoint) => push(endpoint));
  LEGACY_ENDPOINTS.forEach((endpoint) => push(endpoint));

  return Array.from(seen);
};

const attemptCreateOrder = async <T = unknown>(
  endpoint: string,
  {
    body,
    idToken,
    signal,
  }: { body: Record<string, unknown>; idToken: string | null; signal?: AbortSignal },
): Promise<HttpAttemptResult<T>> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    mode: "cors",
    credentials: "omit",
    signal,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const expectsJson = /json/i.test(contentType);

  let payload: T | null = null;

  if (text) {
    if (expectsJson) {
      try {
        payload = JSON.parse(text) as T;
      } catch (error) {
        throw new Error((error as Error)?.message ?? "invalid JSON");
      }
    } else {
      try {
        payload = JSON.parse(text) as T;
      } catch {
        payload = text as unknown as T;
      }
    }
  }

  return { ok: response.ok, status: response.status, payload, endpoint, attempts: [] };
};

const invokeCreateOrder = async <T = unknown>(
  endpoints: string[],
  options: { body: Record<string, unknown>; idToken: string | null; signal?: AbortSignal },
): Promise<HttpAttemptResult<T>> => {
  if (!endpoints.length) {
    throw new Error("No createOrder endpoints configured");
  }

  const attempts: string[] = [];

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const isLastAttempt = index === endpoints.length - 1;

    try {
      const result = await attemptCreateOrder<T>(endpoint, options);
      if (result.ok) {
        result.attempts = [...attempts];
        return result;
      }

      const summary =
        result.payload && typeof result.payload === "object" && result.payload !== null
          ? String((result.payload as Record<string, unknown>).error ?? `HTTP ${result.status}`)
          : `HTTP ${result.status}`;

      attempts.push(`${endpoint} → ${summary}`);

      if (!isLastAttempt && (result.status === 404 || RETRYABLE_STATUS_CODES.has(result.status))) {
        continue;
      }

      result.attempts = [...attempts];
      return result;
    } catch (error) {
      const message = (error as Error)?.message ?? "request failed";
      attempts.push(`${endpoint} → ${message}`);
      if (!isLastAttempt) {
        continue;
      }
      throw Object.assign(new Error("createOrder invocation failed"), { attempts: [...attempts] });
    }
  }

  throw Object.assign(new Error("createOrder invocation failed"), { attempts });
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

  const endpoints = collectCreateOrderEndpoints(hostHeader);

  try {
    const result = await invokeCreateOrder<Record<string, unknown> | null>(endpoints, {
      body,
      idToken,
    });

    if (!result.ok) {
      const payload =
        result.payload && typeof result.payload === "object"
          ? (result.payload as Record<string, unknown>)
          : { error: `HTTP ${result.status}` };

      const summary = result.attempts.length ? result.attempts.join(" | ") : "<none>";
      console.error("create-order invocation responded with failure", {
        host: hostHeader,
        attempts: result.attempts,
        summary,
        status: result.status,
      });

      sendJson(res, result.status, payload);
      return;
    }

    const payload =
      result.payload && typeof result.payload === "object"
        ? (result.payload as Record<string, unknown>)
        : { ok: result.ok };

    res.status(result.status).json(payload ?? null);
  } catch (error) {
    const attempts = (error as Error & { attempts?: string[] }).attempts ?? [];
    const summary = attempts.length ? attempts.join(" | ") : "<none>";
    console.error("create-order invocation attempts failed", {
      host: hostHeader,
      attempts,
      summary,
    });
    sendJson(res, 502, {
      error: "createOrder unavailable",
      code: "http-function-error",
      attempts,
    });
  }
}

export const config = {
  api: {
    bodyParser: true,
  },
};
