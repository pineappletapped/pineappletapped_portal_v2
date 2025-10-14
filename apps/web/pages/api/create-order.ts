import type { NextApiRequest, NextApiResponse } from "next";

import {
  OrderProxyError,
  createErrorPayload,
  forwardCreateOrderRequest,
} from "@/lib/orderServiceProxy";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res
      .status(405)
      .json(createErrorPayload("method-not-allowed", "Method not allowed"));
    return;
  }

  try {
    const result = await forwardCreateOrderRequest(
      req.body,
      req.headers.authorization,
    );

    res.status(result.status).json(result.body ?? null);
  } catch (error) {
    if (error instanceof OrderProxyError) {
      res
        .status(error.status)
        .json(createErrorPayload(error.code, error.message, error.details));
      return;
    }

    res
      .status(500)
      .json(
        createErrorPayload(
          "unexpected-error",
          "Unexpected error while creating order",
          error instanceof Error ? error.message : String(error),
        ),
      );
  }
}
