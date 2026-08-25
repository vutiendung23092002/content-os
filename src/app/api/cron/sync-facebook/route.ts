import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertFacebookCronAccess } from "@/lib/access/cron-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { FacebookSyncCronService } from "@/modules/facebook/facebook-sync-cron";

export const dynamic = "force-dynamic";

async function runSync(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertFacebookCronAccess(request);
    const result = await new FacebookSyncCronService().run();
    return NextResponse.json({ result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function GET(request: Request) {
  return runSync(request);
}

export async function POST(request: Request) {
  return runSync(request);
}
