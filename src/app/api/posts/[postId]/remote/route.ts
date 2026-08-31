import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeRequestPostAccess } from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertEmptyBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { RemotePostMutationService } from "@/modules/posts/mutate-remote-post";

type RouteContext = { params: Promise<{ postId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    const { post, viewer } = await authorizeRequestPostAccess(request, postId);
    await assertMutationRateLimit({
      actor: viewer,
      pageId: post.pageId,
      action: "post:remote:delete",
    });
    await assertEmptyBody(request);
    const operation = await new RemotePostMutationService().remove(postId);
    return NextResponse.json({ operation, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
