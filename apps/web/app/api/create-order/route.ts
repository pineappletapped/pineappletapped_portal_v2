import {
  JSON_HEADERS,
  OrderProxyError,
  createErrorPayload,
  forwardCreateOrderRequest,
} from "@/lib/orderServiceProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    return new Response(
      JSON.stringify(
        createErrorPayload(
          "invalid-json",
          "Failed to parse JSON body",
          error instanceof Error ? error.message : "Failed to parse JSON body",
        ),
      ),
      { status: 400, headers: JSON_HEADERS },
    );
  }

  try {
    const result = await forwardCreateOrderRequest(
      payload,
      request.headers.get("authorization"),
      request.headers.get("host"),
    );

    return new Response(JSON.stringify(result.body ?? null), {
      status: result.status,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    if (error instanceof OrderProxyError) {
      return new Response(
        JSON.stringify(
          createErrorPayload(error.code, error.message, error.details),
        ),
        {
          status: error.status,
          headers: JSON_HEADERS,
        },
      );
    }

    return new Response(
      JSON.stringify(
        createErrorPayload(
          "unexpected-error",
          "Unexpected error while creating order",
          error instanceof Error ? error.message : String(error),
        ),
      ),
      { status: 500, headers: JSON_HEADERS },
    );
  }
}
