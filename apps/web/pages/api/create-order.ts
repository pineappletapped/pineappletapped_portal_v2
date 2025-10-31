import path from "node:path";
import { pathToFileURL } from "node:url";

import type { NextApiRequest, NextApiResponse } from "next";

import { resolveCallableFunctionIds } from "@/lib/callableEndpoints";

import {
  PORTAL_FUNCTION_BASE_URLS,
  PORTAL_FUNCTION_HOST_SUFFIXES,
  PORTAL_FUNCTION_REGIONS,
  PORTAL_PRIMARY_REGION,
} from "@shared-config";

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

const buildHostedAppEndpoints = (
  host: string | null | undefined,
  functionNames: string[],
): string[] => {
  const sanitisedHost = sanitiseHost(host);
  if (!sanitisedHost || !sanitisedHost.endsWith(HOSTED_APP_SUFFIX)) {
    return [];
  }

  const parts = sanitisedHost.split(".");
  if (parts.length < 3) {
    return [];
  }

  const subdomain = parts[0];
  const region = /^[a-z0-9-]+$/.test(parts[1]) ? parts[1] : PORTAL_PRIMARY_REGION;
  const fragment = extractHostedProjectFragment(subdomain);

  const endpoints = new Set<string>();

  for (const functionName of functionNames) {
    endpoints.add(`https://${sanitisedHost}/_firebase/functions/v1/${functionName}`);
    endpoints.add(`https://${sanitisedHost}/_firebase/functions/v2/${functionName}`);
    endpoints.add(`https://${sanitisedHost}/_firebase/functions/v2/${region}/${functionName}`);
  }

  if (fragment) {
    const regions = new Set<string>([region, ...PORTAL_FUNCTION_REGIONS]);
    for (const targetRegion of regions) {
      for (const suffix of PORTAL_FUNCTION_HOST_SUFFIXES) {
        for (const functionName of functionNames) {
          endpoints.add(`https://${targetRegion}-${fragment}.${suffix}/${functionName}`);
        }
      }
    }
  }

  return Array.from(endpoints);
};

const LEGACY_BASES = PORTAL_FUNCTION_BASE_URLS;

const collectFunctionNames = (): string[] => {
  const names = new Set<string>();
  const append = (candidate: string | null | undefined) => {
    if (!candidate) {
      return;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      return;
    }
    names.add(trimmed);
  };

  resolveCallableFunctionIds("createOrder").forEach((identifier) => append(identifier));

  append("createOrder");
  append("default-createOrder");
  append("ptfbportal-createOrder");
  append("ptfbportalbackend-createOrder");

  return Array.from(names);
};

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523]);

interface HttpAttemptResult<T = unknown> {
  ok: boolean;
  status: number;
  payload: T | null;
  endpoint: string;
  attempts: string[];
}

interface LocalInvocationResult {
  ok: boolean;
  status: number;
  payload: Record<string, unknown> | null;
  attempts: string[];
}

const collectCreateOrderEndpoints = (hostHeader: string | null): string[] => {
  const seen = new Set<string>();
  const functionNames = collectFunctionNames();
  const push = (candidate: string | null | undefined) => {
    const normalised = normaliseEndpoint(candidate);
    if (!normalised || seen.has(normalised)) {
      return;
    }
    seen.add(normalised);
  };

  collectEnvOverrides().forEach((endpoint) => push(endpoint));
  buildHostedAppEndpoints(hostHeader, functionNames).forEach((endpoint) => push(endpoint));
  for (const base of LEGACY_BASES) {
    for (const functionName of functionNames) {
      push(`${base}/${functionName}`);
    }
  }

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

const FUNCTIONS_LIB_ENTRY = pathToFileURL(path.join(process.cwd(), "functions", "lib", "index.js")).href;

type LocalCreateOrderHandler =
  | ((req: Record<string, unknown>, res: Record<string, unknown>) => Promise<unknown> | unknown)
  | null;

let localCreateOrderHandlerPromise: Promise<LocalCreateOrderHandler> | null = null;

const dynamicImport: (specifier: string) => Promise<Record<string, unknown>> = Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<Record<string, unknown>>;

const loadLocalCreateOrderHandler = async (): Promise<LocalCreateOrderHandler> => {
  if (localCreateOrderHandlerPromise) {
    return localCreateOrderHandlerPromise;
  }

  localCreateOrderHandlerPromise = (async () => {
    try {
      const mod = await dynamicImport(FUNCTIONS_LIB_ENTRY);
      const handler = (mod as Record<string, unknown>)?.createOrder;
      return typeof handler === "function" ? (handler as LocalCreateOrderHandler) : null;
    } catch (error) {
      console.error("create-order local handler import failed", { error });
      return null;
    }
  })();

  return localCreateOrderHandlerPromise;
};

const ensureLowercaseHeaders = (headers: Record<string, string>): Record<string, string> => {
  const normalised: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key) {
      continue;
    }
    const trimmedKey = key.trim().toLowerCase();
    if (!trimmedKey) {
      continue;
    }
    normalised[trimmedKey] = value;
  }
  return normalised;
};

class LocalRequestMock {
  method: string;

  headers: Record<string, string>;

  body: Record<string, unknown>;

  rawBody: Buffer;

  url: string;

  path: string;

  query: Record<string, unknown> = {};

  params: Record<string, unknown> = {};

  constructor({
    method,
    headers,
    body,
  }: {
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }) {
    this.method = method;
    this.headers = ensureLowercaseHeaders(headers);
    if (!this.headers["content-type"]) {
      this.headers["content-type"] = "application/json";
    }
    this.body = body;
    this.rawBody = Buffer.from(JSON.stringify(body ?? {}));
    this.url = "/create-order";
    this.path = "/create-order";
  }

  get(name: string): string | undefined {
    if (!name) {
      return undefined;
    }
    return this.headers[name.trim().toLowerCase()];
  }
}

interface LocalResponseResolution {
  status: number;
  payload: unknown;
  headers: Record<string, string>;
}

class LocalResponseMock {
  statusCode = 200;

  private headers = new Map<string, string>();

  private finished = false;

  constructor(private readonly resolve: (result: LocalResponseResolution) => void) {}

  isFinished() {
    return this.finished;
  }

  private normaliseName(name: string): string | null {
    if (!name) {
      return null;
    }
    const trimmed = name.trim().toLowerCase();
    return trimmed.length ? trimmed : null;
  }

  status(code: number) {
    if (Number.isFinite(code)) {
      this.statusCode = Number(code);
    }
    return this;
  }

  set(name: string, value: string) {
    this.setHeader(name, value);
    return this;
  }

  setHeader(name: string, value: string) {
    const key = this.normaliseName(name);
    if (!key) {
      return this;
    }
    this.headers.set(key, value);
    return this;
  }

  append(name: string, value: string) {
    const key = this.normaliseName(name);
    if (!key) {
      return this;
    }
    const existing = this.headers.get(key);
    this.headers.set(key, existing ? `${existing}, ${value}` : value);
    return this;
  }

  getHeader(name: string) {
    const key = this.normaliseName(name);
    return key ? this.headers.get(key) ?? null : null;
  }

  json(payload: unknown) {
    this.finish(payload);
    return this;
  }

  send(payload: unknown) {
    this.finish(payload);
    return this;
  }

  end(payload?: unknown) {
    this.finish(payload);
    return this;
  }

  private finish(payload: unknown) {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.resolve({
      status: this.statusCode,
      payload,
      headers: Object.fromEntries(this.headers.entries()),
    });
  }
}

const LOCAL_HANDLER_TIMEOUT_MS = 10_000;

const parseJsonLike = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normaliseLocalPayload = (payload: unknown): Record<string, unknown> | null => {
  if (payload == null) {
    return null;
  }

  if (Buffer.isBuffer(payload)) {
    const text = payload.toString("utf8");
    if (!text.trim()) {
      return null;
    }
    const parsed = parseJsonLike(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed } as Record<string, unknown>;
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = parseJsonLike(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { message: payload } as Record<string, unknown>;
  }

  if (typeof payload === "object") {
    if (Array.isArray(payload)) {
      return { value: payload } as Record<string, unknown>;
    }
    return payload as Record<string, unknown>;
  }

  return { value: payload } as Record<string, unknown>;
};

const invokeLocalCreateOrderFallback = async ({
  body,
  idToken,
  host,
  priorAttempts = [],
}: {
  body: Record<string, unknown>;
  idToken: string | null;
  host: string | null;
  priorAttempts?: string[];
}): Promise<LocalInvocationResult | null> => {
  const handler = await loadLocalCreateOrderHandler();
  if (!handler) {
    return null;
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (idToken) {
    headers.authorization = `Bearer ${idToken}`;
  }

  if (host) {
    headers.host = host;
    headers["x-forwarded-host"] = host;
  }

  const request = new LocalRequestMock({ method: "POST", headers, body });

  try {
    const result = await Promise.race<LocalResponseResolution>([
      new Promise((resolve, reject) => {
        const response = new LocalResponseMock(resolve);
        Promise.resolve(handler(request as unknown as Record<string, unknown>, response as unknown as Record<string, unknown>))
          .then(() => {
            // If the handler resolved without writing a response, ensure we resolve to avoid hanging.
            if (!response.isFinished()) {
              response.end();
            }
          })
          .catch(reject);
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("local createOrder timeout")), LOCAL_HANDLER_TIMEOUT_MS);
      }),
    ]);

    const payload = normaliseLocalPayload(result.payload);
    const status = Number.isFinite(result.status) ? Number(result.status) : 500;
    const ok = status >= 200 && status < 300;
    const summary = payload?.error ? String(payload.error) : `HTTP ${status}`;
    return {
      ok,
      status,
      payload,
      attempts: [...priorAttempts, `local:createOrder → ${summary}`],
    };
  } catch (error) {
    console.error("create-order local fallback failed", { error, host });
    return {
      ok: false,
      status: 503,
      payload: { error: "Local createOrder execution failed", code: "local-handler-error" },
      attempts: [...priorAttempts, `local:createOrder → ${(error as Error)?.message ?? "error"}`],
    };
  }
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
      const fallback = await invokeLocalCreateOrderFallback({
        body,
        idToken,
        host: hostHeader,
        priorAttempts: result.attempts,
      });

      if (fallback) {
        if (!fallback.ok) {
          const payload = fallback.payload ?? { error: "createOrder unavailable" };
          console.error("create-order remote invocation failed; local fallback responded with error", {
            host: hostHeader,
            attempts: fallback.attempts,
            status: fallback.status,
          });
          sendJson(res, fallback.status, payload);
          return;
        }

        console.warn("create-order remote invocation failed; satisfied via local fallback", {
          host: hostHeader,
          attempts: fallback.attempts,
          status: fallback.status,
        });
        res.status(fallback.status).json(fallback.payload ?? null);
        return;
      }

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
    const fallback = await invokeLocalCreateOrderFallback({
      body,
      idToken,
      host: hostHeader,
      priorAttempts: attempts,
    });

    if (fallback) {
      if (!fallback.ok) {
        const payload = fallback.payload ?? { error: "createOrder unavailable" };
        console.error("create-order remote attempts failed; local fallback responded with error", {
          host: hostHeader,
          attempts: fallback.attempts,
          status: fallback.status,
        });
        sendJson(res, fallback.status, payload);
        return;
      }

      console.warn("create-order remote attempts failed; satisfied via local fallback", {
        host: hostHeader,
        attempts: fallback.attempts,
        status: fallback.status,
      });
      res.status(fallback.status).json(fallback.payload ?? null);
      return;
    }

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
