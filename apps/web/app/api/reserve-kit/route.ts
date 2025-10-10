import { NextResponse } from "next/server";
import { functionsBaseUrl } from "@/lib/firebase";

type ReserveKitPayload = {
  productId: string;
  date: string;
  spanOverride?: number | null;
  timeWindow?: { start: string; end: string } | null;
  coverage?: Record<string, unknown> | null;
  skipKitCheck?: boolean;
};

type CallableSuccessEnvelope = {
  result?: { data?: unknown };
  data?: unknown;
};

type CallableErrorEnvelope = {
  error?: {
    message?: string;
    status?: string;
    details?: unknown;
  };
};

type CallableEnvelope = (CallableSuccessEnvelope & CallableErrorEnvelope) & { code?: string };

const normaliseBaseUrl = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const baseUrl = normaliseBaseUrl(functionsBaseUrl) ||
  normaliseBaseUrl(process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL) ||
  "https://us-central1-pineapple-tapped---portal.cloudfunctions.net";

const DEFAULT_FUNCTION_URL = `${baseUrl}/reserveKit`;

const functionsEndpoint =
  typeof process.env.RESERVE_KIT_ENDPOINT === "string" && process.env.RESERVE_KIT_ENDPOINT.trim().length > 0
    ? process.env.RESERVE_KIT_ENDPOINT.trim()
    : DEFAULT_FUNCTION_URL;

const JSON_TYPE = "application/json";

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

  try {
    const response = await fetch(functionsEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": JSON_TYPE,
      },
      body,
      cache: "no-store",
    });

    const text = await response.text();
    let json: CallableEnvelope | null = null;
    if (text) {
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

    if (!response.ok) {
      const callableError = (json as CallableErrorEnvelope | null)?.error;
      const errorDetails =
        (callableError && typeof callableError === "object" && typeof callableError.message === "string"
          ? callableError.message
          : typeof callableError === "string"
            ? callableError
            : text || "callable request failed");
      const errorCode =
        (callableError && typeof callableError === "object" && typeof callableError.status === "string"
          ? callableError.status
          : null) ||
        (json && typeof json.code === "string" ? json.code : null) ||
        "reserve-kit-error";
      const errorDetailsPayload =
        callableError && typeof callableError === "object" && "details" in callableError
          ? callableError.details
          : callableError ?? text;
      return createErrorResponse(502, errorCode, errorDetails, errorDetailsPayload);
    }

    const data = (json?.result?.data ?? json?.data) as unknown;
    return NextResponse.json({ data });
  } catch (error) {
    return createErrorResponse(
      502,
      "reserve-kit-request-failed",
      "Failed to contact reserveKit function",
      (error as Error)?.message ?? "Unknown error",
    );
  }
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
