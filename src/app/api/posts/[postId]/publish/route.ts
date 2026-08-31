import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeRequestPostAccess } from "@/lib/access/page-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { assertEmptyBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { SubmitPostService } from "@/modules/posts/submit-post";

type RouteContext = { params: Promise<{ postId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    const { post, viewer } = await authorizeRequestPostAccess(request, postId);
    await assertMutationRateLimit({
      actor: viewer,
      pageId: post.pageId,
      action: "post:publish",
    });
    await assertEmptyBody(request);
    const result = await new SubmitPostService().publish(postId);
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
