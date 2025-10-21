import { functionsBaseUrl } from "./firebase";

const cleanEnv = (value?: string | null) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed && trimmed !== "undefined" ? trimmed : undefined;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const FUNCTION_ENDPOINT_OVERRIDES: Record<string, string | undefined> = {
  createOrder: cleanEnv(process.env.NEXT_PUBLIC_CREATE_ORDER_ENDPOINT),
  recordLogin: cleanEnv(process.env.NEXT_PUBLIC_RECORD_LOGIN_ENDPOINT),
  analytics_track: cleanEnv(process.env.NEXT_PUBLIC_ANALYTICS_TRACK_ENDPOINT),
};

const baseUrl = functionsBaseUrl ? trimTrailingSlash(functionsBaseUrl) : undefined;

export function resolveHttpFunctionUrl(name: string): string {
  const override = FUNCTION_ENDPOINT_OVERRIDES[name];
  if (override) {
    return override;
  }
  if (!baseUrl) {
    throw new Error(`Firebase functions base URL is not configured for ${name}.`);
  }
  return `${baseUrl}/${name}`;
}

export interface InvokeHttpFunctionOptions {
  body?: Record<string, unknown> | null;
  idToken?: string | null;
  signal?: AbortSignal;
}

export interface HttpFunctionResponse<T = unknown> {
  ok: boolean;
  status: number;
  payload: T | null;
}

export async function invokeHttpFunction<T = unknown>(
  name: string,
  { body = null, idToken, signal }: InvokeHttpFunctionOptions = {},
): Promise<HttpFunctionResponse<T>> {
  const endpoint = resolveHttpFunctionUrl(name);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : "{}",
    mode: "cors",
    credentials: "omit",
    signal,
  });

  const text = await response.text();
  let payload: T | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as T;
    } catch (error) {
      throw new Error(
        `Failed to parse ${name} response as JSON: ${(error as Error)?.message ?? "unknown error"}`,
      );
    }
  }

  return { ok: response.ok, status: response.status, payload };
}

export async function postHttpFunctionOrThrow<T = unknown>(
  name: string,
  options: InvokeHttpFunctionOptions = {},
): Promise<T | null> {
  const result = await invokeHttpFunction<T>(name, options);
  if (!result.ok) {
    const payload = result.payload as Record<string, unknown> | null;
    const message =
      (payload && typeof payload.error === "string"
        ? payload.error
        : `HTTP function ${name} responded with ${result.status}`) ??
      `HTTP function ${name} failed`;
    const error = new Error(message);
    if (payload && typeof payload.code === "string") {
      (error as Error & { code?: string }).code = payload.code;
    }
    if (payload && "details" in payload) {
      (error as Error & { details?: unknown }).details = payload.details;
    }
    throw error;
  }
  return result.payload;
}
