import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { getServerEnv } from "@/lib/env/server";
import { toErrorResponse } from "@/lib/errors/api-error";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertInternalAccess(request);
    const env = getServerEnv();

    return NextResponse.json({
      configured: {
        database: Boolean(env.DATABASE_URL),
        graphVersion: Boolean(env.FACEBOOK_GRAPH_API_VERSION),
        metaApp: Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
        userToken: Boolean(env.FACEBOOK_USER_ACCESS_TOKEN),
        tokenEncryption: Boolean(env.TOKEN_ENCRYPTION_KEY),
      },
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
