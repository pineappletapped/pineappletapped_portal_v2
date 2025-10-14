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

export const createOrderEndpoint =
  cleanEnv(process.env.CREATE_ORDER_ENDPOINT) ||
  `https://${region}-${projectId}.cloudfunctions.net/createOrder`;

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

export async function forwardCreateOrderRequest(
  body: unknown,
  authHeader: string | null | undefined,
): Promise<OrderProxyResult> {
  if (!body || typeof body !== "object") {
    throw new OrderProxyError(400, "invalid-argument", "Order payload is required");
  }

  const headers: Record<string, string> = {
    "content-type": JSON_CONTENT_TYPE,
  };

  if (authHeader && authHeader.trim().length > 0) {
    headers.authorization = authHeader;
  }

  try {
    const response = await fetch(createOrderEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await response.text();
    if (!text) {
      if (!response.ok) {
        throw new OrderProxyError(
          response.status,
          "empty-response",
          `Order service returned status ${response.status}`,
        );
      }

      return { status: response.status, body: null };
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new OrderProxyError(
        502,
        "invalid-response",
        "Order service returned invalid JSON",
        error instanceof Error ? error.message : text,
      );
    }

    if (!response.ok) {
      throw new OrderProxyError(
        response.status,
        "order-service-error",
        "Order service request failed",
        normaliseErrorBody(json),
      );
    }

    return { status: response.status, body: json };
  } catch (error) {
    if (error instanceof OrderProxyError) {
      throw error;
    }

    throw new OrderProxyError(
      502,
      "order-service-unreachable",
      "Failed to contact the order service",
      error instanceof Error ? error.message : error,
    );
  }
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
