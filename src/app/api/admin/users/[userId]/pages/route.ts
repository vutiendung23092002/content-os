import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import {
  PageAccessService,
  pageAssignmentInputSchema,
} from "@/modules/auth/page-access-service";

type RouteContext = { params: Promise<{ userId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const actor = await requireAdmin();
    const { userId } = await context.params;
    const assignment = await new PageAccessService().getAssignmentEditor(
      actor,
      userId,
    );
    return NextResponse.json({ assignment, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const { userId } = await context.params;
    const input = pageAssignmentInputSchema.parse(await request.json());
    const assignment = await new PageAccessService().replaceAssignments({
      actor,
      userId,
      pageIds: input.pageIds,
    });
    return NextResponse.json({ assignment, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
