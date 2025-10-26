import { NextResponse } from "next/server";

import {
  HttpFunctionInvocationError,
  invokeHttpFunction,
  type HttpFunctionResponse,
} from "@/lib/httpFunctions";
import { applyCorsHeaders, buildCorsHeaders } from "../_lib/cors";

const JSON_CONTENT_TYPE = "application/json";

const createErrorResponse = (
  request: Request,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) =>
  applyCorsHeaders(
    NextResponse.json(
      {
        error: message,
        code,
        ...(details === undefined ? null : { details }),
      },
      { status },
    ),
    request,
  );

const sanitisePayload = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const parseBearerToken = (header: string | null): string | null => {
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }
  const prefix = "Bearer ";
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const token = trimmed.slice(prefix.length).trim();
  return token || null;
};

const normaliseResultPayload = (result: HttpFunctionResponse<Record<string, unknown> | null>) =>
  (result.payload && typeof result.payload === "object"
    ? (result.payload as Record<string, unknown>)
    : null);

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = sanitisePayload(await request.json());
  } catch (error) {
    return createErrorResponse(
      request,
      400,
      "invalid-json",
      "Failed to parse JSON body",
      (error as Error)?.message ?? "invalid JSON",
    );
  }

  const authHeader = request.headers.get("authorization");
  const idToken = parseBearerToken(authHeader);

  try {
    const result = await invokeHttpFunction<Record<string, unknown> | null>("analytics_track", {
      body: payload,
      idToken,
      allowRelativeFallback: false,
    });

    if (!result.ok) {
      const data = normaliseResultPayload(result);
      return applyCorsHeaders(
        NextResponse.json(
          {
            error:
              typeof data?.error === "string" ? data.error : "Failed to record analytics events",
            code: typeof data?.code === "string" ? data.code : "analytics-track-error",
            details: data?.details ?? null,
            attempts: result.attempts,
          },
          { status: result.status },
        ),
        request,
      );
    }

    const data = normaliseResultPayload(result);
    return applyCorsHeaders(
      NextResponse.json(data ?? { ok: true }, {
        status: 200,
        headers: { "Content-Type": JSON_CONTENT_TYPE },
      }),
      request,
    );
  } catch (error) {
    if (error instanceof HttpFunctionInvocationError) {
      return applyCorsHeaders(
        NextResponse.json(
          { error: error.message, code: "analytics-track-endpoint-failure", attempts: error.attempts },
          { status: 502 },
        ),
        request,
      );
    }
    return createErrorResponse(request, 502, "analytics-track-error", "Failed to contact analytics_track", {
      message: (error as Error)?.message ?? "unknown error",
    });
  }
}

export const dynamic = "force-dynamic";
