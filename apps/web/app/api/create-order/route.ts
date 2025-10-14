import {
  DEFAULT_FUNCTION_BASE,
  LEGACY_FUNCTION_BASES,
  resolveHostedAppContext,
} from "@/lib/callableEndpoints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_CONTENT_TYPE = "application/json";

const cleanEnv = (value?: string | null) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed && trimmed !== "undefined" ? trimmed : undefined;
};

const projectId =
  cleanEnv(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) ||
  cleanEnv(process.env.FIREBASE_ADMIN_PROJECT_ID) ||
  "pineapple-tapped---portal";
const configuredRegion = cleanEnv(process.env.NEXT_PUBLIC_FUNCTIONS_REGION) || "europe-west2";
const explicitCreateOrderEndpoint = cleanEnv(process.env.CREATE_ORDER_ENDPOINT);

const CALLABLE_ERROR_STATUS: Record<string, number> = {
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

const normaliseCallableError = (payload: Record<string, unknown>) => {
  if (!("error" in payload)) {
    return null;
  }

  const errorValue = (payload as { error?: unknown }).error;
  const details = (payload as { details?: unknown }).details;
  if (typeof errorValue === "string" && errorValue.trim().length > 0) {
    const code =
      typeof (payload as { code?: unknown }).code === "string"
        ? ((payload as { code?: string }).code ?? "callable-error")
        : "callable-error";
    return { code, message: errorValue, details };
  }

  if (errorValue && typeof errorValue === "object") {
    const error = errorValue as Record<string, unknown>;
    const status = typeof error.status === "string" ? error.status : undefined;
    const message = typeof error.message === "string" ? error.message : "Callable request failed";
    const nestedDetails = "details" in error ? (error as { details?: unknown }).details : undefined;
    const code = status ? status.toLowerCase().replace(/_/g, "-") : "callable-error";
    return { code, message, details: nestedDetails ?? details };
  }

  return null;
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

const createErrorResponse = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
) =>
  new Response(
    JSON.stringify({
      error: message,
      code,
      ...(details === undefined ? null : { details }),
    }),
    {
      status,
      headers: { "content-type": JSON_CONTENT_TYPE },
    },
  );

const RETRYABLE_STATUS = new Set([404, 408, 425, 429, 500, 502, 503, 504, 522, 523, 524]);

const isRetryableStatus = (status: number | null | undefined) => {
  if (!status || status < 0) {
    return false;
  }

  return RETRYABLE_STATUS.has(status);
};

const isJsonContentType = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  return value.toLowerCase().includes("json");
};

export async function POST(request: Request) {
  let payload: Record<string, unknown>;

  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    return createErrorResponse(
      400,
      "invalid-json",
      "Failed to parse JSON body",
      (error as Error)?.message ?? "Failed to parse JSON body",
    );
  }

  if (!payload || typeof payload !== "object") {
    return createErrorResponse(400, "invalid-argument", "Order payload is required");
  }

  const normaliseUrl = (value: string | null | undefined) => {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  };

  const endpointCandidates: string[] = [];
  const seen = new Set<string>();
  const addEndpoint = (candidate: string | null | undefined) => {
    const normalised = normaliseUrl(candidate);
    if (!normalised || seen.has(normalised)) {
      return;
    }
    seen.add(normalised);
    endpointCandidates.push(normalised);
  };
  const addBaseEndpoint = (base: string | null | undefined) => {
    const normalisedBase = normaliseUrl(base);
    if (!normalisedBase) {
      return;
    }

    const lowerBase = normalisedBase.toLowerCase();
    if (lowerBase.endsWith("/createorder") || lowerBase.endsWith("/create-order")) {
      addEndpoint(normalisedBase);
      return;
    }

    const variants = new Set<string>(["createOrder", "create-order"]);
    if (lowerBase.includes("/_firebase/functions/") || lowerBase.includes("/functions/")) {
      for (const variant of Array.from(variants)) {
        variants.add(`${variant}:call`);
      }
    }

    for (const variant of variants) {
      addEndpoint(`${normalisedBase}/${variant}`);
    }
  };

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? null;
  const hostContext = resolveHostedAppContext(hostHeader);

  if (explicitCreateOrderEndpoint) {
    addEndpoint(explicitCreateOrderEndpoint);
  }

  const regionCandidates = new Set<string>();
  if (configuredRegion) {
    regionCandidates.add(configuredRegion);
  }
  if (hostContext.region) {
    regionCandidates.add(hostContext.region);
  }
  regionCandidates.add("europe-west2");
  regionCandidates.add("europe-west4");
  regionCandidates.add("us-central1");

  addBaseEndpoint(DEFAULT_FUNCTION_BASE);
  for (const legacyBase of LEGACY_FUNCTION_BASES) {
    addBaseEndpoint(legacyBase);
  }

  const baseEnvVars = [
    "CREATE_ORDER_BASE_URL",
    "NEXT_PUBLIC_CREATE_ORDER_BASE_URL",
    "FUNCTIONS_BASE_URL",
    "NEXT_PUBLIC_FUNCTIONS_BASE_URL",
    "FIREBASE_FUNCTIONS_URL",
  ];

  for (const envVar of baseEnvVars) {
    addBaseEndpoint(cleanEnv(process.env[envVar]));
  }

  for (const base of hostContext.bases) {
    addBaseEndpoint(base);
  }

  for (const region of regionCandidates) {
    addBaseEndpoint(`https://${region}-${projectId}.cloudfunctions.net`);
  }

  if (!explicitCreateOrderEndpoint) {
    const defaultEndpoint = `https://${configuredRegion}-${projectId}.cloudfunctions.net`;
    addBaseEndpoint(defaultEndpoint);
  }

  if (endpointCandidates.length === 0) {
    return createErrorResponse(
      502,
      "order-service-unconfigured",
      "No order service endpoints are configured",
    );
  }

  const attempts: string[] = [];
  const withAttempts = (details: unknown) =>
    attempts.length ? { attempts: [...attempts], response: details } : details;

  for (let index = 0; index < endpointCandidates.length; index += 1) {
    const endpoint = endpointCandidates[index];
    const isLastAttempt = index >= endpointCandidates.length - 1;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": JSON_CONTENT_TYPE,
          accept: JSON_CONTENT_TYPE,
          ...(request.headers.get("authorization")
            ? { authorization: request.headers.get("authorization") as string }
            : {}),
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const text = await response.text();
      const status = response.status || 502;

      if (!text) {
        if (!response.ok) {
          if (!isLastAttempt && isRetryableStatus(status)) {
            attempts.push(`${endpoint} → ${status} (empty response)`);
            continue;
          }

          attempts.push(`${endpoint} → ${status} (empty response)`);
          return createErrorResponse(
            status,
            "empty-response",
            `Order service returned status ${status}`,
            withAttempts(null),
          );
        }

        return new Response(JSON.stringify({ data: null }), {
          status: response.status,
          headers: { "content-type": JSON_CONTENT_TYPE },
        });
      }

      const contentType = response.headers.get("content-type");
      const trimmedText = text.trim();
      const looksJson =
        isJsonContentType(contentType) || trimmedText.startsWith("{") || trimmedText.startsWith("[");

      if (!looksJson) {
        const descriptor = contentType ? `${status} (${contentType})` : `${status} (non-JSON response)`;
        if (!isLastAttempt && (isRetryableStatus(status) || response.ok)) {
          attempts.push(`${endpoint} → ${descriptor}`);
          continue;
        }

        attempts.push(`${endpoint} → ${descriptor}`);
        const failureStatus = response.ok ? 502 : status;
        const code = response.ok ? "invalid-response" : "order-service-error";
        const message = response.ok
          ? "Order service returned non-JSON payload"
          : `Order service responded with status ${status}`;
        const detail = trimmedText ? trimmedText.slice(0, 200) : contentType ?? "non-JSON response";
        return createErrorResponse(failureStatus, code, message, withAttempts(detail));
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        const code = response.ok ? "invalid-response" : "order-service-error";
        const message = response.ok
          ? "Order service returned invalid JSON"
          : `Order service responded with status ${status}`;

        if (!isLastAttempt && (isRetryableStatus(status) || response.ok)) {
          const reason = (error as Error)?.message ?? "invalid JSON";
          attempts.push(`${endpoint} → ${status} (${reason})`);
          continue;
        }

        attempts.push(
          `${endpoint} → ${status} (${(error as Error)?.message ?? "invalid JSON"})`,
        );
        const failureStatus = response.ok ? 502 : status;
        return createErrorResponse(
          failureStatus,
          code,
          message,
          withAttempts((error as Error)?.message ?? text),
        );
      }

      const jsonRecord = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      if (!jsonRecord) {
        if (!isLastAttempt && (isRetryableStatus(status) || response.ok)) {
          attempts.push(`${endpoint} → ${status} (non-object payload)`);
          continue;
        }

        attempts.push(`${endpoint} → ${status} (non-object payload)`);
        return createErrorResponse(
          502,
          "invalid-response",
          "Callable returned invalid payload",
          withAttempts(json),
        );
      }

      const callableError = normaliseCallableError(jsonRecord);
      if (callableError) {
        const callableStatus = response.status || CALLABLE_ERROR_STATUS[callableError.code] || 400;
        if (!isLastAttempt && isRetryableStatus(callableStatus)) {
          attempts.push(`${endpoint} → ${callableStatus} (${callableError.message})`);
          continue;
        }

        attempts.push(`${endpoint} → ${callableStatus} (${callableError.message})`);
        return createErrorResponse(
          callableStatus,
          callableError.code,
          callableError.message,
          withAttempts(callableError.details ?? jsonRecord),
        );
      }

      if (!response.ok) {
        if (!isLastAttempt && isRetryableStatus(status)) {
          attempts.push(`${endpoint} → ${status} (error response)`);
          continue;
        }

        attempts.push(`${endpoint} → ${status} (error response)`);
        return createErrorResponse(
          status,
          "order-service-error",
          "Order service request failed",
          withAttempts(jsonRecord),
        );
      }

      const result = normaliseCallableSuccess(jsonRecord);

      return new Response(JSON.stringify({ data: result ?? null }), {
        status: response.status,
        headers: { "content-type": JSON_CONTENT_TYPE },
      });
    } catch (error) {
      const message = (error as Error)?.message ?? "Unknown error";
      attempts.push(`${endpoint} → ${message}`);
      if (!isLastAttempt) {
        continue;
      }

      return createErrorResponse(502, "order-service-unreachable", "Failed to contact the order service", attempts);
    }
  }

  return createErrorResponse(
    502,
    "order-service-unreachable",
    "Failed to contact the order service",
    attempts,
  );
}
