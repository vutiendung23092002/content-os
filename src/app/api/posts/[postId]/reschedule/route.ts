import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequestPostAccess } from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { toErrorResponse } from "@/lib/errors/api-error";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { ReschedulePostService } from "@/modules/posts/reschedule-post";

type RouteContext = { params: Promise<{ postId: string }> };

const requestSchema = z.object({ scheduledFor: z.iso.datetime() }).strict();

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    const { post, viewer } = await authorizeRequestPostAccess(request, postId);
    await assertMutationRateLimit({
      actor: viewer,
      pageId: post.pageId,
      action: "post:reschedule",
    });
    const body = await parseJsonBody(request, requestSchema);
    const result = await new ReschedulePostService().reschedule(
      postId,
      body.scheduledFor,
    );
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
