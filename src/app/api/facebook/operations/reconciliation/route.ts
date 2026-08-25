import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import { ReconcileFacebookOperationService } from "@/modules/facebook/reconcile-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .parse(url.searchParams.get("limit") ?? undefined);
    const operations = await new ReconcileFacebookOperationService().list(
      limit,
    );
    return NextResponse.json({ operations, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
