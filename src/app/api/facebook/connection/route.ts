import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApprovedViewer } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { toErrorResponse } from "@/lib/errors/api-error";
import { UserFacebookConnectionService } from "@/modules/facebook/user-facebook-connection-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const viewer = await requireApprovedViewer();
    const env = getServerEnv();
    const configured = Boolean(
      env.FACEBOOK_CONNECT_APP_ID && env.FACEBOOK_CONNECT_APP_SECRET,
    );
    const connection = configured
      ? await new UserFacebookConnectionService().get(viewer)
      : null;
    return NextResponse.json({ configured, connection, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
