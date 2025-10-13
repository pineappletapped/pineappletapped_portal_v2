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
const region = cleanEnv(process.env.NEXT_PUBLIC_FUNCTIONS_REGION) || "europe-west2";
const createOrderEndpoint =
  cleanEnv(process.env.CREATE_ORDER_ENDPOINT) ||
  `https://${region}-${projectId}.cloudfunctions.net/createOrder`;

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

  try {
    const response = await fetch(createOrderEndpoint, {
      method: "POST",
      headers: {
        "content-type": JSON_CONTENT_TYPE,
        accept: JSON_CONTENT_TYPE,
        ...(request.headers.get("authorization")
          ? { authorization: request.headers.get("authorization") as string }
          : {}),
      },
      body: JSON.stringify({ data: payload }),
      cache: "no-store",
    });

    const text = await response.text();
    if (!text) {
      if (!response.ok) {
        return createErrorResponse(
          response.status,
          "empty-response",
          `Order service returned status ${response.status}`,
        );
      }

      return new Response(JSON.stringify({ data: null }), {
        status: response.status,
        headers: { "content-type": JSON_CONTENT_TYPE },
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      const status = response.status || 502;
      const code = response.ok ? "invalid-response" : "order-service-error";
      const message = response.ok
        ? "Order service returned invalid JSON"
        : `Order service responded with status ${status}`;

      return createErrorResponse(status, code, message, (error as Error)?.message ?? text);
    }

    const jsonRecord = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    if (!jsonRecord) {
      return createErrorResponse(502, "invalid-response", "Callable returned invalid payload", json);
    }

    const callableError = normaliseCallableError(jsonRecord);
    if (callableError) {
      const status = CALLABLE_ERROR_STATUS[callableError.code] ?? 400;
      return createErrorResponse(status, callableError.code, callableError.message, callableError.details);
    }

    if (!response.ok) {
      return createErrorResponse(
        response.status,
        "order-service-error",
        "Order service request failed",
        jsonRecord,
      );
    }

    const result = normaliseCallableSuccess(jsonRecord);

    return new Response(JSON.stringify({ data: result ?? null }), {
      status: response.status,
      headers: { "content-type": JSON_CONTENT_TYPE },
    });
  } catch (error) {
    return createErrorResponse(
      502,
      "order-service-unreachable",
      "Failed to contact the order service",
      (error as Error)?.message ?? "Unknown error",
    );
  }
}
