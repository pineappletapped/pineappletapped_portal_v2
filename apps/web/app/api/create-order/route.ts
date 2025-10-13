import { NextResponse } from "next/server";
import {
  JSON_CONTENT_TYPE,
  buildCallableEndpointCandidates,
  collectCallableApiTargets,
  createEndpointAttemptLogger,
  summariseDetails,
  type CallableEnvelope,
  type CallableErrorEnvelope,
} from "@/lib/server/callable-proxy";
import { resolveCallableFunctionIds } from "@/lib/callableEndpoints";
import { getFirebaseAdminApp } from "@/lib/firebase-admin";

const createErrorResponse = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
) =>
  NextResponse.json(
    {
      error: message,
      code,
      ...(details === undefined ? null : { details }),
    },
    { status },
  );

const invokeCallableViaGoogleApi = async (
  functionName: string,
  payload: Record<string, unknown>,
  target: { projectId: string; location: string },
) => {
  const app = getFirebaseAdminApp();
  const credential = app.options?.credential as
    | { getAccessToken?: () => Promise<{ access_token?: string | null } | null> }
    | undefined;

  if (!credential || typeof credential.getAccessToken !== "function") {
    throw Object.assign(
      new Error("Admin credentials are unavailable for callable invocation."),
      { details: { target } },
    );
  }

  const tokenResponse = await credential.getAccessToken();
  const accessToken = tokenResponse?.access_token;
  if (!accessToken) {
    throw Object.assign(
      new Error("Failed to obtain access token for callable invocation."),
      { details: { target } },
    );
  }

  const functionPath = `projects/${target.projectId}/locations/${target.location}/functions/${functionName}`;
  const url = `https://cloudfunctions.googleapis.com/v1/${functionPath}:call`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ data: payload }),
    cache: "no-store",
  });

  const text = await response.text();
  let json: CallableEnvelope | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as CallableEnvelope;
    } catch (error) {
      throw Object.assign(
        new Error("Callable API response was not valid JSON."),
        { details: { target, raw: summariseDetails(text) } },
      );
    }
  }

  const callableError = (json as CallableErrorEnvelope | null)?.error ?? null;
  if (!response.ok || callableError) {
    const message =
      (callableError && typeof callableError === "object" && typeof callableError.message === "string"
        ? callableError.message
        : summariseDetails(text) || `Callable API request failed (${response.status})`) ??
      "Callable API request failed.";
    throw Object.assign(new Error(message), {
      details: {
        target,
        status: response.status,
        code:
          (callableError && typeof callableError === "object" && typeof callableError.status === "string"
            ? callableError.status
            : null) || (json && typeof json.code === "string" ? json.code : null),
        response: summariseDetails(text),
      },
    });
  }

  let data: unknown = json?.result ?? json?.data ?? null;
  if (
    data &&
    typeof data === "object" &&
    data !== null &&
    "data" in (data as Record<string, unknown>) &&
    (data as Record<string, unknown>).data !== undefined
  ) {
    data = (data as Record<string, unknown>).data;
  }
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // Leave as-is if parsing fails; the callable may legitimately return a string.
    }
  }

  return data;
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

  const body = JSON.stringify({ data: payload });
  const { endpoints, bases, hostContext } = buildCallableEndpointCandidates(
    "createOrder",
    request,
    {
      explicitEndpointEnvVar: "CREATE_ORDER_ENDPOINT",
    },
  );
  const functionIds = resolveCallableFunctionIds("createOrder");
  const apiTargets = collectCallableApiTargets(bases, hostContext, [
    process.env.CREATE_ORDER_FUNCTION_PROJECT,
  ]);
  const attemptLogger = createEndpointAttemptLogger();

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": JSON_CONTENT_TYPE,
          ...(request.headers.get("authorization")
            ? { Authorization: request.headers.get("authorization") as string }
            : {}),
        },
        body,
        cache: "no-store",
      });

      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.toLowerCase().includes("application/json");
      let json: CallableEnvelope | null = null;
      if (text && isJson) {
        try {
          json = JSON.parse(text) as CallableEnvelope;
        } catch (parseError) {
          return createErrorResponse(
            502,
            "invalid-function-response",
            "Callable response was not valid JSON",
            (parseError as Error)?.message ?? "Callable response was not valid JSON",
          );
        }
      }

      if (response.ok && !isJson) {
        return createErrorResponse(
          502,
          "invalid-function-response",
          "Callable response was not JSON",
          summariseDetails(text),
        );
      }

      if (!response.ok) {
        const callableError = (json as CallableErrorEnvelope | null)?.error;
        const errorDetails =
          (callableError && typeof callableError === "object" && typeof callableError.message === "string"
            ? callableError.message
            : typeof callableError === "string"
              ? callableError
              : summariseDetails(text) || `callable request failed (${response.status})`);
        const errorCode =
          (callableError && typeof callableError === "object" && typeof callableError.status === "string"
            ? callableError.status
            : null) ||
          (json && typeof json.code === "string" ? json.code : null) ||
          "create-order-error";
        const errorDetailsPayload =
          callableError && typeof callableError === "object" && "details" in callableError
            ? callableError.details
            : callableError ?? summariseDetails(text) ?? null;

        if (response.status === 404) {
          attemptLogger.push(`${endpoint} → 404`);
          if (index < endpoints.length - 1) {
            continue;
          }
        }

        return createErrorResponse(502, errorCode, errorDetails, {
          endpoint,
          responseStatus: response.status,
          details: errorDetailsPayload,
        });
      }

      const data = (json?.result?.data ?? json?.data) as unknown;
      return NextResponse.json({ data });
    } catch (error) {
      attemptLogger.push(`${endpoint} → ${(error as Error)?.message ?? "request failed"}`);
      if (index < endpoints.length - 1) {
        continue;
      }

      return createErrorResponse(
        502,
        "create-order-request-failed",
        "Failed to contact createOrder function",
        attemptLogger.attempts,
      );
    }
  }

  const describeTarget = (target: { projectId: string; location: string }) =>
    `${target.projectId}/${target.location}`;

  let lastApiError: unknown = null;

  for (let index = 0; index < apiTargets.length; index += 1) {
    const target = apiTargets[index];

    for (const functionId of functionIds.length ? functionIds : ["createOrder"]) {
      try {
        const data = await invokeCallableViaGoogleApi(functionId, payload, target);
        return NextResponse.json({ data });
      } catch (error) {
        lastApiError = error;
        attemptLogger.push(
          `gcf://${describeTarget(target)}/${functionId} → ${(error as Error)?.message ?? "request failed"}`,
        );
      }
    }

    if (index < apiTargets.length - 1) {
      continue;
    }
  }

  if (lastApiError instanceof Error) {
    const errorDetails =
      "details" in lastApiError
        ? (lastApiError as Error & { details?: unknown }).details
        : null;
    return createErrorResponse(
      502,
      "create-order-api-call-failed",
      lastApiError.message ?? "Callable API invocation failed",
      {
        target: apiTargets.length ? describeTarget(apiTargets[apiTargets.length - 1]) : null,
        details: errorDetails,
      },
    );
  }

  return createErrorResponse(
    502,
    "create-order-endpoint-unavailable",
    "No createOrder endpoints responded successfully",
    attemptLogger.attempts,
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "3600",
    },
  });
}
