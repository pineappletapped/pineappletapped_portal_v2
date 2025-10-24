import { NextResponse } from "next/server";

import {
  HttpFunctionInvocationError,
  invokeHttpFunction,
  type HttpFunctionResponse,
} from "@/lib/httpFunctions";

const JSON_CONTENT_TYPE = "application/json";

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

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = sanitisePayload(await request.json());
  } catch (error) {
    return createErrorResponse(
      400,
      "invalid-json",
      "Failed to parse JSON body",
      (error as Error)?.message ?? "invalid JSON",
    );
  }

  const authHeader = request.headers.get("authorization");
  const idToken = parseBearerToken(authHeader);

  try {
    const result = await invokeHttpFunction<Record<string, unknown> | null>("recordLogin", {
      body: payload,
      idToken,
      allowRelativeFallback: false,
    });

    if (!result.ok) {
      const data = normaliseResultPayload(result);
      return NextResponse.json(
        {
          error: typeof data?.error === "string" ? data.error : "Failed to record login",
          code: typeof data?.code === "string" ? data.code : "record-login-error",
          details: data?.details ?? null,
          attempts: result.attempts,
        },
        { status: result.status },
      );
    }

    const data = normaliseResultPayload(result);
    return NextResponse.json(data ?? { ok: true }, {
      status: 200,
      headers: { "Content-Type": JSON_CONTENT_TYPE },
    });
  } catch (error) {
    if (error instanceof HttpFunctionInvocationError) {
      return NextResponse.json(
        { error: error.message, code: "record-login-endpoint-failure", attempts: error.attempts },
        { status: 502 },
      );
    }
    return createErrorResponse(502, "record-login-error", "Failed to contact recordLogin function", {
      message: (error as Error)?.message ?? "unknown error",
    });
  }
}

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
