import { NextResponse } from "next/server";
import {
  JSON_CONTENT_TYPE,
  buildCallableEndpointCandidates,
  createEndpointAttemptLogger,
  summariseDetails,
  type CallableEnvelope,
  type CallableErrorEnvelope,
} from "@/lib/server/callable-proxy";

type ReserveKitPayload = {
  productId: string;
  date: string;
  spanOverride?: number | null;
  timeWindow?: { start: string; end: string } | null;
  coverage?: Record<string, unknown> | null;
  skipKitCheck?: boolean;
};

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

export async function POST(request: Request) {
  let payload: ReserveKitPayload;
  try {
    payload = (await request.json()) as ReserveKitPayload;
  } catch (error) {
    return createErrorResponse(
      400,
      "invalid-json",
      "Failed to parse JSON body",
      (error as Error)?.message ?? "Failed to parse JSON body",
    );
  }

  if (!payload || typeof payload.productId !== "string" || typeof payload.date !== "string") {
    return createErrorResponse(400, "invalid-argument", "productId and date are required");
  }

  const body = JSON.stringify({ data: payload });
  const endpoints = buildCallableEndpointCandidates("reserveKit", request, {
    explicitEndpointEnvVar: "RESERVE_KIT_ENDPOINT",
  });
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
          "reserve-kit-error";
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
        "reserve-kit-request-failed",
        "Failed to contact reserveKit function",
        attemptLogger.attempts,
      );
    }
  }

  return createErrorResponse(
    502,
    "reserve-kit-endpoint-unavailable",
    "No reserveKit endpoints responded successfully",
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
