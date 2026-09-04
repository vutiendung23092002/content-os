import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApprovedViewer } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import { UserFacebookConnectionService } from "@/modules/facebook/user-facebook-connection-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const viewer = await requireApprovedViewer();
    const authorizationUrl = await new UserFacebookConnectionService().begin(
      viewer,
    );
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
