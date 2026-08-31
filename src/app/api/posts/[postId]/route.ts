import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  assertRequestPostAccess,
  authorizeRequestPostAccess,
} from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertEmptyBody, parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { createDraftService } from "@/modules/posts/create-draft-service";
import { toDraftDto, updateDraftSchema } from "@/modules/posts/draft-service";

type RouteContext = { params: Promise<{ postId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    const { postId } = await context.params;
    await assertRequestPostAccess(request, postId);
    const draft = await createDraftService().get(postId);
    return NextResponse.json({ draft: toDraftDto(draft), requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    const { post, viewer } = await authorizeRequestPostAccess(request, postId);
    await assertMutationRateLimit({
      actor: viewer,
      pageId: post.pageId,
      action: "post:draft:update",
    });
    const draft = await createDraftService().update(
      postId,
      await parseJsonBody(request, updateDraftSchema),
    );
    return NextResponse.json({ draft: toDraftDto(draft), requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    const { post, viewer } = await authorizeRequestPostAccess(request, postId);
    await assertMutationRateLimit({
      actor: viewer,
      pageId: post.pageId,
      action: "post:draft:delete",
    });
    await assertEmptyBody(request);
    await createDraftService().delete(postId);
    return new NextResponse(null, {
      status: 204,
      headers: { "x-request-id": requestId },
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
