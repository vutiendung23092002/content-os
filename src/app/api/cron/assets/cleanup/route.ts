import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertAssetCleanupAccess } from "@/lib/access/cron-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { AssetCleanupService } from "@/modules/assets/asset-cleanup-service";

export const dynamic = "force-dynamic";

async function runCleanup(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertAssetCleanupAccess(request);
    const result = await new AssetCleanupService().cleanup();
    return NextResponse.json({ result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function GET(request: Request) {
  return runCleanup(request);
}

export async function POST(request: Request) {
  return runCleanup(request);
}
