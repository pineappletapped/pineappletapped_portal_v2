import { functionsBaseUrl } from "./firebase";
import { DEFAULT_FUNCTION_BASE, LEGACY_FUNCTION_BASES } from "./callableEndpoints";

const cleanEnv = (value?: string | null) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed && trimmed !== "undefined" ? trimmed : undefined;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const splitListEnv = (value?: string | null) => {
  if (!value) {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const summariseDetails = (value: string | null | undefined) => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
};

const FUNCTION_ENDPOINT_OVERRIDES: Record<string, string | undefined> = {
  createOrder: cleanEnv(process.env.NEXT_PUBLIC_CREATE_ORDER_ENDPOINT),
  analytics_track: cleanEnv(process.env.NEXT_PUBLIC_ANALYTICS_TRACK_ENDPOINT),
  recordLogin: "/api/record-login",
};

const RELATIVE_FALLBACK_ENDPOINTS: Record<string, string[]> = {
  analytics_track: ["/api/analytics-track"],
};

const PRIMARY_BASE_ENVS = [
  "NEXT_PUBLIC_FUNCTIONS_BASE_URL",
  "FUNCTIONS_BASE_URL",
  "FIREBASE_FUNCTIONS_URL",
];

const ADDITIONAL_BASE_ENVS = [
  "NEXT_PUBLIC_FUNCTIONS_FALLBACK_BASES",
  "FUNCTIONS_FALLBACK_BASES",
  "NEXT_PUBLIC_FUNCTIONS_ADDITIONAL_BASES",
  "FUNCTIONS_ADDITIONAL_BASES",
];

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523]);

const buildBaseCandidates = (): string[] => {
  const bases = new Set<string>();

  const addBase = (candidate?: string | null) => {
    if (!candidate) {
      return;
    }
    const normalised = trimTrailingSlash(candidate);
    if (normalised) {
      bases.add(normalised);
    }
  };

  PRIMARY_BASE_ENVS.forEach((envName) => {
    const value = cleanEnv(process.env[envName]);
    if (!value) {
      return;
    }
    addBase(value);
  });

  addBase(DEFAULT_FUNCTION_BASE);

  if (functionsBaseUrl) {
    addBase(functionsBaseUrl);
  }

  ADDITIONAL_BASE_ENVS.forEach((envName) => {
    const value = cleanEnv(process.env[envName]);
    if (!value) {
      return;
    }
    if (value.includes(",") || value.includes(" ")) {
      splitListEnv(value).forEach((entry) => addBase(entry));
      return;
    }
    addBase(value);
  });

  LEGACY_FUNCTION_BASES.forEach((legacy) => addBase(legacy));

  return Array.from(bases);
};

const normaliseEndpoint = (endpoint: string) => {
  if (!endpoint) {
    return null;
  }
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return trimTrailingSlash(endpoint);
  }
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
};

const buildEndpointCandidates = (
  name: string,
  {
    allowRelativeFallback = false,
    includeOverrides = true,
  }: { allowRelativeFallback?: boolean; includeOverrides?: boolean } = {},
): string[] => {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value?: string | null) => {
    const normalised = value ? normaliseEndpoint(value) : null;
    if (!normalised || seen.has(normalised)) {
      return;
    }
    seen.add(normalised);
    candidates.push(normalised);
  };

  const override = includeOverrides ? FUNCTION_ENDPOINT_OVERRIDES[name] : undefined;
  if (override) {
    push(override);
  }

  if (allowRelativeFallback) {
    (RELATIVE_FALLBACK_ENDPOINTS[name] ?? []).forEach((endpoint) => push(endpoint));
  }

  buildBaseCandidates().forEach((base) => push(`${base}/${name}`));

  return candidates;
};

export function resolveHttpFunctionUrl(
  name: string,
  options: { allowRelativeFallback?: boolean; includeOverrides?: boolean } = {},
): string {
  const endpoints = buildEndpointCandidates(name, options);
  if (endpoints.length === 0) {
    throw new Error(`No endpoints are configured for HTTP function ${name}.`);
  }
  return endpoints[0];
}

export interface InvokeHttpFunctionOptions {
  body?: Record<string, unknown> | null;
  idToken?: string | null;
  signal?: AbortSignal;
  allowRelativeFallback?: boolean;
  includeOverrides?: boolean;
}

export interface HttpFunctionResponse<T = unknown> {
  ok: boolean;
  status: number;
  payload: T | null;
  endpoint: string;
  attempts: string[];
}

export class HttpFunctionInvocationError extends Error {
  attempts: string[];

  constructor(message: string, attempts: string[]) {
    super(message);
    this.name = "HttpFunctionInvocationError";
    this.attempts = attempts;
  }
}

export async function invokeHttpFunction<T = unknown>(
  name: string,
  {
    body = null,
    idToken,
    signal,
    allowRelativeFallback,
    includeOverrides = true,
  }: InvokeHttpFunctionOptions = {},
): Promise<HttpFunctionResponse<T>> {
  const endpoints = buildEndpointCandidates(name, { allowRelativeFallback, includeOverrides });
  if (endpoints.length === 0) {
    throw new HttpFunctionInvocationError(`No endpoints configured for ${name}`, []);
  }

  const attempts: string[] = [];
  const payloadText = body ? JSON.stringify(body) : "{}";

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const isLastAttempt = index >= endpoints.length - 1;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: payloadText,
        mode: "cors",
        credentials: "omit",
        signal,
      });

      const text = await response.text();
      const contentType = response.headers.get("content-type") || "";
      const expectsJson = /json/i.test(contentType);
      let payload: T | null = null;

      if (text) {
        if (!expectsJson) {
          try {
            payload = JSON.parse(text) as T;
          } catch {
            payload = text as unknown as T;
          }
        } else {
          try {
            payload = JSON.parse(text) as T;
          } catch (error) {
            attempts.push(`${endpoint} → ${(error as Error)?.message ?? "invalid JSON"}`);
            if (isLastAttempt) {
              throw new HttpFunctionInvocationError(
                `Failed to parse ${name} response as JSON`,
                attempts,
              );
            }
            continue;
          }
        }
      }

      if (!response.ok && !isLastAttempt && (response.status === 404 || RETRYABLE_STATUS_CODES.has(response.status))) {
        const summary =
          (payload && typeof payload === "object" && payload !== null && "error" in payload
            ? String((payload as Record<string, unknown>).error ?? "")
            : summariseDetails(text)) || `HTTP ${response.status}`;
        attempts.push(`${endpoint} → ${summary}`);
        continue;
      }

      if (!response.ok) {
        const summary =
          (payload && typeof payload === "object" && payload !== null && "error" in payload
            ? String((payload as Record<string, unknown>).error ?? "")
            : summariseDetails(text)) || `HTTP ${response.status}`;
        attempts.push(`${endpoint} → ${summary}`);
      }

      return { ok: response.ok, status: response.status, payload, endpoint, attempts: [...attempts] };
    } catch (error) {
      attempts.push(`${endpoint} → ${(error as Error)?.message ?? "request failed"}`);
      if (!isLastAttempt) {
        continue;
      }
      throw new HttpFunctionInvocationError(
        `All HTTP function endpoints for ${name} failed`,
        [...attempts],
      );
    }
  }

  throw new HttpFunctionInvocationError(`No HTTP function endpoints succeeded for ${name}`, attempts);
}

export async function postHttpFunctionOrThrow<T = unknown>(
  name: string,
  options: InvokeHttpFunctionOptions = {},
): Promise<T | null> {
  const result = await invokeHttpFunction<T>(name, options);
  if (!result.ok) {
    const payload = result.payload as Record<string, unknown> | null;
    const isObjectPayload = payload !== null && typeof payload === "object";
    const message =
      (isObjectPayload && typeof payload.error === "string"
        ? payload.error
        : `HTTP function ${name} responded with ${result.status}`) ??
      `HTTP function ${name} failed`;
    const error = new Error(message);
    if (isObjectPayload && typeof payload.code === "string") {
      (error as Error & { code?: string }).code = payload.code;
    }
    if (isObjectPayload && "details" in payload) {
      (error as Error & { details?: unknown }).details = payload.details;
    }
    (error as Error & { endpoint?: string }).endpoint = result.endpoint;
    (error as Error & { attempts?: string[] }).attempts = result.attempts;
    throw error;
  }
  return result.payload;
}
