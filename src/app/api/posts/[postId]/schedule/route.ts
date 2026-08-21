import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { SubmitPostService } from "@/modules/posts/submit-post";

type RouteContext = { params: Promise<{ postId: string }> };

const scheduleRequestSchema = z.object({ scheduledFor: z.iso.datetime() });

export async function POST(request: Request, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    await assertInternalAccess(request);
    const { postId } = await context.params;
    const body = scheduleRequestSchema.parse(await request.json());
    const result = await new SubmitPostService().schedule(
      postId,
      body.scheduledFor,
    );
    return NextResponse.json({ operation: result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
