import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertFacebookCronAccess } from "@/lib/access/cron-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { FacebookReconciliationCronService } from "@/modules/facebook/facebook-reconciliation-cron";

export const dynamic = "force-dynamic";

async function runReconciliation(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertFacebookCronAccess(request);
    const result = await new FacebookReconciliationCronService().run();
    return NextResponse.json({ result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function GET(request: Request) {
  return runReconciliation(request);
}

export async function POST(request: Request) {
  return runReconciliation(request);
}
