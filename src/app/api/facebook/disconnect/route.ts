import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireApprovedViewer } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { UserFacebookConnectionService } from "@/modules/facebook/user-facebook-connection-service";

const requestSchema = z.object({ connectionId: z.uuid() }).strict();

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const viewer = await requireApprovedViewer();
    await assertMutationRateLimit({
      actor: viewer,
      action: "facebook:connection:disconnect",
    });
    const input = await parseJsonBody(request, requestSchema);
    await new UserFacebookConnectionService().disconnect(
      viewer,
      input.connectionId,
    );
    return NextResponse.json({ disconnected: true, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
