import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { resolveFacebookPostUrl } from "@/modules/facebook/post-permalink";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  postId: z.string().regex(/^\d+_\d+$/),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    await assertInternalAccess(request);
    const url = new URL(request.url);
    const query = querySchema.parse({
      postId: url.searchParams.get("postId"),
    });
    const target = await resolveFacebookPostUrl(query.postId);
    return NextResponse.redirect(target, 302);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
