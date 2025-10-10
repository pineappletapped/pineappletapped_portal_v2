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

const DEFAULT_FUNCTION_BASE = "https://us-central1-pineapple-tapped---portal.cloudfunctions.net";

const resolveHostedAppBase = (host: string | null | undefined) => {
  if (!host) {
    return undefined;
  }

  const trimmed = host.trim().toLowerCase();
  if (!trimmed.endsWith(".hosted.app")) {
    return undefined;
  }

  const [subdomain] = trimmed.split(".");
  if (!subdomain) {
    return undefined;
  }

  const parts = subdomain.split("--");
  if (parts.length < 2) {
    return undefined;
  }

  const appIdCandidate = parts[parts.length - 1];
  if (!appIdCandidate) {
    return undefined;
  }

  return `https://us-central1-${appIdCandidate}.cloudfunctions.net`;
};

const buildEndpointCandidates = (request: Request) => {
  const explicitEndpoint =
    typeof process.env.RESERVE_KIT_ENDPOINT === "string" && process.env.RESERVE_KIT_ENDPOINT.trim().length > 0
      ? process.env.RESERVE_KIT_ENDPOINT.trim()
      : null;

  if (explicitEndpoint) {
    return [explicitEndpoint];
  }

  const candidateBases = [
    normaliseBaseUrl(functionsBaseUrl),
    normaliseBaseUrl(process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL),
    normaliseBaseUrl(process.env.FUNCTIONS_BASE_URL),
    normaliseBaseUrl(process.env.FIREBASE_FUNCTIONS_URL),
    resolveHostedAppBase(request.headers.get("host")),
    DEFAULT_FUNCTION_BASE,
  ];

  const uniqueBases = new Set(candidateBases.filter((value): value is string => Boolean(value)));
  return Array.from(uniqueBases).map((base) => `${base}/reserveKit`);
};

const JSON_TYPE = "application/json";

const MAX_INLINE_DETAILS = 600;

const summariseDetails = (value: string | null | undefined) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > MAX_INLINE_DETAILS ? `${trimmed.slice(0, MAX_INLINE_DETAILS)}…` : trimmed;
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
  const endpoints = buildEndpointCandidates(request);
  const attemptSummaries: string[] = [];

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": JSON_TYPE,
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
          attemptSummaries.push(`${endpoint} → 404`);
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
      attemptSummaries.push(`${endpoint} → ${(error as Error)?.message ?? "request failed"}`);
      if (index < endpoints.length - 1) {
        continue;
      }

      return createErrorResponse(
        502,
        "reserve-kit-request-failed",
        "Failed to contact reserveKit function",
        attemptSummaries,
      );
    }
  }

  return createErrorResponse(
    502,
    "reserve-kit-endpoint-unavailable",
    "No reserveKit endpoints responded successfully",
    attemptSummaries,
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
