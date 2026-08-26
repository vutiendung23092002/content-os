import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertRequestPostAccess } from "@/lib/access/page-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { toErrorResponse } from "@/lib/errors/api-error";
import { RemotePostMutationService } from "@/modules/posts/mutate-remote-post";

type RouteContext = { params: Promise<{ postId: string }> };
const requestSchema = z.object({ message: z.string().max(63_206) }).strict();

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const { postId } = await context.params;
    await assertRequestPostAccess(request, postId);
    const body = requestSchema.parse(await request.json());
    const operation = await new RemotePostMutationService().updateMessage(
      postId,
      body.message,
    );
    return NextResponse.json({ operation, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
