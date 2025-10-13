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
        ...(request.headers.get("authorization")
          ? { authorization: request.headers.get("authorization") as string }
          : {}),
      },
      body: JSON.stringify(payload),
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
      return new Response(null, {
        status: response.status,
        headers: { "content-type": JSON_CONTENT_TYPE },
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return createErrorResponse(
        502,
        "invalid-response",
        "Order service returned invalid JSON",
        (error as Error)?.message ?? text,
      );
    }

    if (!response.ok) {
      const errorBody =
        json && typeof json === "object" && "error" in (json as Record<string, unknown>)
          ? (json as Record<string, unknown>).error
          : json;
      return createErrorResponse(
        response.status,
        "order-service-error",
        "Order service request failed",
        errorBody,
      );
    }

    return new Response(JSON.stringify(json), {
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
