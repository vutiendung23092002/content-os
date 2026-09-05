import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApprovedViewer } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { toErrorResponse } from "@/lib/errors/api-error";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import {
  captionInputSchema,
  CaptionService,
} from "@/modules/ai/caption-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireApprovedViewer();
    const input = await parseJsonBody(request, captionInputSchema);
    await assertMutationRateLimit({
      actor,
      pageId: input.pageId,
      action: "ai:caption:generate",
    });
    const output = await new CaptionService().generate(actor, input);
    return NextResponse.json({ ...output, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
