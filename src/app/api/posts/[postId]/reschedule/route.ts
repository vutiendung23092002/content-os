import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertRequestPostAccess } from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { toErrorResponse } from "@/lib/errors/api-error";
import { ReschedulePostService } from "@/modules/posts/reschedule-post";

type RouteContext = { params: Promise<{ postId: string }> };

const requestSchema = z.object({ scheduledFor: z.iso.datetime() }).strict();

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    await assertRequestPostAccess(request, postId);
    const body = requestSchema.parse(await request.json());
    const result = await new ReschedulePostService().reschedule(
      postId,
      body.scheduledFor,
    );
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
