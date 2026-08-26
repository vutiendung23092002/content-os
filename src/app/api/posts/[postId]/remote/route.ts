import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertRequestPostAccess } from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { toErrorResponse } from "@/lib/errors/api-error";
import { RemotePostMutationService } from "@/modules/posts/mutate-remote-post";

type RouteContext = { params: Promise<{ postId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    await assertRequestPostAccess(request, postId);
    const operation = await new RemotePostMutationService().remove(postId);
    return NextResponse.json({ operation, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
