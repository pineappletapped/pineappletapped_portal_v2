import { NextResponse } from "next/server";

import {
  JSON_CONTENT_TYPE,
  buildCallableEndpointCandidates,
  createEndpointAttemptLogger,
  summariseDetails,
} from "@/lib/server/callable-proxy";

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523]);

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

  const body = JSON.stringify(payload);
  const { endpoints } = buildCallableEndpointCandidates("createOrder", request, {
    explicitEndpointEnvVar: "CREATE_ORDER_ENDPOINT",
  });
  const attemptLogger = createEndpointAttemptLogger();
  const authorizationHeader = request.headers.get("authorization");

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const isLastAttempt = index >= endpoints.length - 1;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": JSON_CONTENT_TYPE,
          ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
        },
        body,
        cache: "no-store",
      });

      const text = await response.text();
      let json: any = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch (parseError) {
          const summary = (parseError as Error)?.message ?? "invalid JSON";
          attemptLogger.push(`${endpoint} → ${summary}`);
          if (!isLastAttempt) {
            continue;
          }

          return createErrorResponse(502, "invalid-function-response", "Order service response was not valid JSON", {
            endpoint,
            attempts: attemptLogger.attempts,
          });
        }
      }

      if (!response.ok) {
        const message =
          (json && typeof json === "object" && typeof json.error === "string"
            ? json.error
            : summariseDetails(text) || `Order service responded with ${response.status}`) ??
          "Order service failed";
        const code =
          (json && typeof json === "object" && typeof json.code === "string" ? json.code : null) ||
          "order-service-error";

        attemptLogger.push(`${endpoint} → ${response.status} ${message}`);

        if (RETRYABLE_STATUS_CODES.has(response.status) && !isLastAttempt) {
          continue;
        }

        return createErrorResponse(response.status, code, message, {
          endpoint,
          attempts: attemptLogger.attempts,
          details: json && typeof json === "object" ? json.details ?? null : null,
        });
      }

      return NextResponse.json(json ?? null, { status: 200 });
    } catch (error) {
      attemptLogger.push(`${endpoint} → ${(error as Error)?.message ?? "request failed"}`);
      if (!isLastAttempt) {
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

  return createErrorResponse(
    502,
    "create-order-endpoint-unavailable",
    "No createOrder endpoints responded successfully",
    attemptLogger.attempts,
  );
}
