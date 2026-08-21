import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import {
  AdminUserService,
  approvalInputSchema,
} from "@/modules/auth/admin-user-service";

type RouteContext = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { userId } = await context.params;
    const input = approvalInputSchema.parse(await request.json());
    const user = await new AdminUserService().setApproval({
      actor,
      userId,
      status: input.status,
    });
    return NextResponse.json({ user, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
