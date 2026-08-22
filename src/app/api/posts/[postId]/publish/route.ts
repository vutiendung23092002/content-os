import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertRequestPostAccess } from "@/lib/access/page-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { SubmitPostService } from "@/modules/posts/submit-post";

type RouteContext = { params: Promise<{ postId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    await assertRequestPostAccess(request, postId);
    const result = await new SubmitPostService().publish(postId);
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
