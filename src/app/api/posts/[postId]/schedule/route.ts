import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequestPostAccess } from "@/lib/access/page-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { SubmitPostService } from "@/modules/posts/submit-post";

type RouteContext = { params: Promise<{ postId: string }> };

const scheduleRequestSchema = z
  .object({ scheduledFor: z.iso.datetime() })
  .strict();

export async function POST(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    const { post, viewer } = await authorizeRequestPostAccess(request, postId);
    await assertMutationRateLimit({
      actor: viewer,
      pageId: post.pageId,
      action: "post:schedule",
    });
    const body = await parseJsonBody(request, scheduleRequestSchema);
    const result = await new SubmitPostService().schedule(
      postId,
      body.scheduledFor,
      viewer?.id,
    );
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
