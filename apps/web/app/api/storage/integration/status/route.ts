import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  const delegatedUser = process.env.GOOGLE_SERVICE_ACCOUNT_DELEGATED_USER;
  const configured = typeof key === "string" && key.trim().length > 0;
  const delegatedUserConfigured = typeof delegatedUser === "string" && delegatedUser.trim().length > 0;

  return NextResponse.json({ configured, delegatedUserConfigured });
}
