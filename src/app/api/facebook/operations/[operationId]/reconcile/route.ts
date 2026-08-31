import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertEmptyBody, parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import {
  manualResolutionSchema,
  ReconcileFacebookOperationService,
} from "@/modules/facebook/reconcile-operations";

type RouteContext = { params: Promise<{ operationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    await assertMutationRateLimit({
      actor,
      action: "facebook:operation:reconcile",
    });
    await assertEmptyBody(request);
    const { operationId } = await context.params;
    const result = await new ReconcileFacebookOperationService().reconcile(
      operationId,
    );
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    await assertMutationRateLimit({
      actor,
      action: "facebook:operation:resolve",
    });
    const { operationId } = await context.params;
    const resolution = await parseJsonBody(request, manualResolutionSchema);
    const result =
      await new ReconcileFacebookOperationService().resolveManually({
        operationId,
        actorUserId: actor.id,
        resolution,
      });
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
