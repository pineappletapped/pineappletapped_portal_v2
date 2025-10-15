import {
  normaliseBaseUrl,
  resolveCallableFunctionIds,
  resolveHostedAppContext,
} from "@/lib/callableEndpoints";

const JSON_CONTENT_TYPE = "application/json";
const VALUE_DELIMITER = /[\s,;]+/;
const JSON_SNIPPET_LENGTH = 512;
const RETRYABLE_STATUSES = new Set([301, 302, 307, 308, 404, 405]);

const cleanEnv = (value?: string | null) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed && trimmed !== "undefined" ? trimmed : undefined;
};

const ensureUrlScheme = (value: string) =>
  /^https?:\/\//i.test(value) ? value : `https://${value}`;

const parseEnvList = (value?: string | null) => {
  if (!value) {
    return [] as string[];
  }

  return value
    .split(VALUE_DELIMITER)
    .map((part) => cleanEnv(part) ?? "")
    .filter((part): part is string => Boolean(part));
};

const projectId =
  cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) ||
  cleanEnv(process.env.FIREBASE_ADMIN_PROJECT_ID) ||
  "pineapple-tapped---portal";
const defaultRegion = cleanEnv(process.env.NEXT_PUBLIC_FUNCTIONS_REGION) || "europe-west2";

const FALLBACK_REGIONS = [defaultRegion, "europe-west4", "us-central1", "europe-west1"];

const baseEnvVars = [
  "CREATE_ORDER_BASE_URL",
  "CREATE_ORDER_BASES",
  "FUNCTIONS_BASE_URL",
  "NEXT_PUBLIC_FUNCTIONS_BASE_URL",
  "FUNCTIONS_ORIGIN",
  "NEXT_PUBLIC_FUNCTIONS_ORIGIN",
  "FUNCTIONS_CUSTOM_DOMAIN",
  "NEXT_PUBLIC_FUNCTIONS_CUSTOM_DOMAIN",
  "FIREBASE_FUNCTIONS_EMULATOR_ORIGIN",
  "NEXT_PUBLIC_FUNCTIONS_EMULATOR_ORIGIN",
  "ORDER_SERVICE_BASE_URL",
  "ORDER_SERVICE_BASES",
];

const endpointEnvVars = [
  "CREATE_ORDER_ENDPOINT",
  "CREATE_ORDER_ENDPOINTS",
  "ORDER_SERVICE_ENDPOINT",
  "ORDER_SERVICE_ENDPOINTS",
];

const functionNameEnvVars = [
  "CREATE_ORDER_FUNCTION",
  "CREATE_ORDER_FUNCTION_NAME",
  "CREATE_ORDER_FUNCTION_NAMES",
  "ORDER_SERVICE_FUNCTION",
  "ORDER_SERVICE_FUNCTIONS",
  "ORDER_FUNCTION",
  "ORDER_FUNCTIONS",
  "FUNCTION_NAME",
  "FUNCTION_NAMES",
];

export const CALLABLE_ERROR_STATUS: Record<string, number> = {
  cancelled: 499,
  unknown: 500,
  "invalid-argument": 400,
  "deadline-exceeded": 504,
  "not-found": 404,
  "already-exists": 409,
  "permission-denied": 403,
  "resource-exhausted": 429,
  "failed-precondition": 412,
  aborted: 409,
  "out-of-range": 400,
  unimplemented: 501,
  internal: 500,
  unavailable: 503,
  "data-loss": 500,
  unauthenticated: 401,
};

const CALLABLE_RETRYABLE_CODES = new Set(["not-found", "unimplemented"]);

const shouldTreatAsCallable = (endpoint: string) => {
  const lower = endpoint.toLowerCase();
  return (
    lower.includes(":call") ||
    lower.includes("/_firebase/functions/") ||
    lower.includes("/functions/")
  );
};

const looksJsonLike = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return true;
  }

  if (trimmed === "null" || trimmed === "true" || trimmed === "false") {
    return true;
  }

  return trimmed.startsWith('"') && trimmed.endsWith('"');
};

const truncateSnippet = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value.length <= JSON_SNIPPET_LENGTH) {
    return value;
  }

  return `${value.slice(0, JSON_SNIPPET_LENGTH)}…`;
};

const normaliseErrorBody = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return body ?? null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return record.error;
  }
  return body;
};

const normaliseCallableError = (payload: Record<string, unknown>) => {
  const error = payload.error as Record<string, unknown> | undefined;
  if (!error) {
    return null;
  }

  const status = typeof error.status === "string" ? error.status : undefined;
  const message = typeof error.message === "string" ? error.message : "Callable request failed";
  const details = "details" in error ? (error as { details?: unknown }).details : undefined;
  const code = status ? status.toLowerCase().replace(/_/g, "-") : "callable-error";
  return { code, message, details };
};

const normaliseCallableSuccess = (payload: Record<string, unknown>) => {
  if ("result" in payload) {
    return payload.result;
  }
  if ("data" in payload) {
    return payload.data;
  }
  return payload;
};

const collectFunctionNames = () => {
  const baseNames = new Set<string>(["createOrder", "create-order"]);

  for (const envName of functionNameEnvVars) {
    const raw = process.env[envName];
    if (!raw) {
      continue;
    }

    for (const part of raw.split(VALUE_DELIMITER)) {
      const normalised = cleanEnv(part);
      if (normalised) {
        baseNames.add(normalised);
      }
    }
  }

  const names = new Set<string>();
  for (const baseName of baseNames) {
    if (!baseName) {
      continue;
    }

    names.add(baseName);
    for (const variant of resolveCallableFunctionIds(baseName)) {
      names.add(variant);
    }
  }

  return Array.from(names);
};

const collectBaseUrls = (host?: string | null | undefined) => {
  const bases: string[] = [];
  const unique = new Set<string>();

  const appendBase = (candidate?: string | null) => {
    const cleaned = candidate ? ensureUrlScheme(candidate) : undefined;
    const normalised = normaliseBaseUrl(cleaned ?? "");
    if (!normalised || unique.has(normalised)) {
      return;
    }
    unique.add(normalised);
    bases.push(normalised);
  };

  for (const envName of baseEnvVars) {
    const raw = process.env[envName];
    if (!raw) {
      continue;
    }

    const values = envName.endsWith("S") ? parseEnvList(raw) : [cleanEnv(raw)].filter(
      (value): value is string => Boolean(value),
    );

    for (const value of values) {
      appendBase(value);
    }
  }

  const context = resolveHostedAppContext(host ?? null);
  for (const base of context.bases) {
    appendBase(base);
  }

  const regionCandidates = new Set(FALLBACK_REGIONS.filter(Boolean));
  for (const candidate of regionCandidates) {
    appendBase(`https://${candidate}-${projectId}.cloudfunctions.net`);
  }

  appendBase(`https://${projectId}.cloudfunctions.net`);

  for (const fragment of context.projectFragments) {
    for (const candidate of regionCandidates) {
      appendBase(`https://${candidate}-${fragment}.cloudfunctions.net`);
    }
  }

  return bases;
};

const collectExplicitEndpoints = () => {
  const endpoints: string[] = [];
  for (const envName of endpointEnvVars) {
    const raw = process.env[envName];
    if (!raw) {
      continue;
    }

    const values = envName.endsWith("S")
      ? parseEnvList(raw)
      : [cleanEnv(raw)].filter((value): value is string => Boolean(value));

    for (const value of values) {
      if (value) {
        endpoints.push(ensureUrlScheme(value));
      }
    }
  }

  return endpoints;
};

const buildEndpointCandidates = (host?: string | null | undefined) => {
  const endpoints: string[] = [];
  const seen = new Set<string>();

  const append = (candidate?: string | null) => {
    if (!candidate) {
      return;
    }

    const normalised = candidate.trim();
    if (!normalised || seen.has(normalised)) {
      return;
    }
    seen.add(normalised);
    endpoints.push(normalised);
  };

  for (const explicit of collectExplicitEndpoints()) {
    append(explicit);
  }

  const bases = collectBaseUrls(host);
  const functionNames = collectFunctionNames();

  for (const base of bases) {
    const baseUrl = normaliseBaseUrl(base);
    if (!baseUrl) {
      continue;
    }

    for (const functionName of functionNames) {
      append(`${baseUrl}/${functionName}`);
      append(`${baseUrl}/${functionName}:call`);
    }
  }

  return endpoints;
};

const DEFAULT_PRIMARY_ENDPOINT = `https://${defaultRegion}-${projectId}.cloudfunctions.net/createOrder`;

export const createOrderEndpoint =
  cleanEnv(process.env.CREATE_ORDER_ENDPOINT) || DEFAULT_PRIMARY_ENDPOINT;

export class OrderProxyError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface OrderProxyResult {
  status: number;
  body: unknown;
}

export const JSON_HEADERS = { "content-type": JSON_CONTENT_TYPE } as const;

interface EndpointAttemptDetail {
  endpoint: string;
  status?: number;
  contentType?: string | null;
  bodySnippet?: string | null;
  error?: string | null;
  code?: string;
  message?: string;
}

interface EndpointSuccess {
  ok: true;
  status: number;
  body: unknown;
}

interface EndpointFailure {
  ok: false;
  status?: number;
  code: string;
  message: string;
  retryable: boolean;
  attempt: EndpointAttemptDetail;
  details?: unknown;
}

type EndpointOutcome = EndpointSuccess | EndpointFailure;

const executeEndpoint = async (
  endpoint: string,
  body: Record<string, unknown>,
  authHeader: string | null | undefined,
): Promise<EndpointOutcome> => {
  const headers: Record<string, string> = {
    "content-type": JSON_CONTENT_TYPE,
    accept: JSON_CONTENT_TYPE,
  };

  if (authHeader && authHeader.trim().length > 0) {
    headers.authorization = authHeader;
  }

  const callable = shouldTreatAsCallable(endpoint);
  const attempt: EndpointAttemptDetail = { endpoint };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(callable ? { data: body } : body),
      cache: "no-store",
    });

    const rawContentType = response.headers.get("content-type");
    const contentType = rawContentType?.split(";")[0]?.trim().toLowerCase() ?? null;
    const text = await response.text();

    attempt.status = response.status;
    attempt.contentType = rawContentType ?? null;
    attempt.bodySnippet = truncateSnippet(text);

    const shouldParseJson =
      Boolean(text) && (contentType?.includes("json") || looksJsonLike(text));

    let parsed: unknown = null;
    let parseError: Error | null = null;

    if (text && shouldParseJson) {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parseError = error instanceof Error ? error : new Error(String(error));
      }
    }

    const ensureDetails = (value: unknown) =>
      shouldParseJson && parsed ? normaliseErrorBody(parsed) : value;

    if (response.ok) {
      if (callable) {
        if (!parsed || typeof parsed !== "object") {
          attempt.error = parseError?.message ?? "Callable response was not JSON";
          return {
            ok: false,
            status: 502,
            code: "invalid-response",
            message: "Callable order service returned invalid payload",
            retryable: true,
            attempt,
            details: text || null,
          };
        }

        const payload = parsed as Record<string, unknown>;
        const callableError = normaliseCallableError(payload);
        if (callableError) {
          const status = CALLABLE_ERROR_STATUS[callableError.code] ?? response.status ?? 400;
          const retryable =
            RETRYABLE_STATUSES.has(status) || CALLABLE_RETRYABLE_CODES.has(callableError.code);
          attempt.code = callableError.code;
          attempt.message = callableError.message;

          return {
            ok: false,
            status,
            code: callableError.code,
            message: callableError.message,
            retryable,
            attempt,
            details: callableError.details ?? payload,
          };
        }

        return {
          ok: true,
          status: response.status,
          body: normaliseCallableSuccess(payload) ?? null,
        };
      }

      if (!text) {
        return { ok: true, status: response.status, body: null };
      }

      if (parseError) {
        attempt.error = parseError.message;
        return { ok: true, status: response.status, body: text };
      }

      return { ok: true, status: response.status, body: parsed ?? text };
    }

    if (callable && parsed && typeof parsed === "object") {
      const payload = parsed as Record<string, unknown>;
      const callableError = normaliseCallableError(payload);
      if (callableError) {
        const status = CALLABLE_ERROR_STATUS[callableError.code] ?? response.status ?? 400;
        const retryable =
          RETRYABLE_STATUSES.has(status) || CALLABLE_RETRYABLE_CODES.has(callableError.code);
        attempt.code = callableError.code;
        attempt.message = callableError.message;

        return {
          ok: false,
          status,
          code: callableError.code,
          message: callableError.message,
          retryable,
          attempt,
          details: callableError.details ?? payload,
        };
      }
    }

    const status = response.status;
    const retryable = RETRYABLE_STATUSES.has(status);
    return {
      ok: false,
      status,
      code: "order-service-error",
      message: `Order service responded with status ${status}`,
      retryable,
      attempt,
      details: ensureDetails(text || null),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attempt.error = message;
    return {
      ok: false,
      code: "order-service-unreachable",
      message: "Failed to contact the order service",
      retryable: true,
      attempt,
      details: message,
    };
  }
};

export async function forwardCreateOrderRequest(
  body: unknown,
  authHeader: string | null | undefined,
  host?: string | null | undefined,
): Promise<OrderProxyResult> {
  if (!body || typeof body !== "object") {
    throw new OrderProxyError(400, "invalid-argument", "Order payload is required");
  }

  const orderBody = body as Record<string, unknown>;
  const attempts: EndpointAttemptDetail[] = [];
  let lastFailure: EndpointFailure | null = null;

  const endpoints = buildEndpointCandidates(host);
  if (!endpoints.length) {
    endpoints.push(createOrderEndpoint);
  }

  for (const endpoint of endpoints) {
    const result = await executeEndpoint(endpoint, orderBody, authHeader);
    if (result.ok) {
      return { status: result.status, body: result.body };
    }

    attempts.push(result.attempt);
    lastFailure = result;

    if (!result.retryable) {
      throw new OrderProxyError(
        result.status ?? 502,
        result.code,
        result.message,
        { attempts },
      );
    }
  }

  const fallbackError =
    lastFailure ??
    ({
      ok: false,
      status: 502,
      code: "order-service-unreachable",
      message: "Unable to locate a createOrder endpoint",
      retryable: false,
      attempt: { endpoint: createOrderEndpoint },
    } satisfies EndpointFailure);

  throw new OrderProxyError(
    fallbackError.status ?? 502,
    fallbackError.code,
    fallbackError.message,
    { attempts },
  );
}

export const createErrorPayload = (
  code: string,
  message: string,
  details?: unknown,
) => ({
  error: message,
  code,
  ...(details === undefined ? null : { details }),
});
