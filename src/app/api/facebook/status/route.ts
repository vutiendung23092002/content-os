import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { getServerEnv, requireServerEnv } from "@/lib/env/server";
import { toErrorResponse } from "@/lib/errors/api-error";
import { MetaGraphClient } from "@/modules/facebook/meta-client";

export const dynamic = "force-dynamic";

function toIsoDate(unixSeconds?: number): string | null {
  return unixSeconds && unixSeconds > 0
    ? new Date(unixSeconds * 1000).toISOString()
    : null;
}

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertInternalAccess(request);
    const env = getServerEnv();

    const configured = {
      database: Boolean(env.DATABASE_URL),
      graphVersion: Boolean(env.FACEBOOK_GRAPH_API_VERSION),
      metaApp: Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
      userToken: Boolean(env.FACEBOOK_USER_ACCESS_TOKEN),
      tokenEncryption: Boolean(env.TOKEN_ENCRYPTION_KEY),
    };
    const canInspect =
      configured.graphVersion && configured.metaApp && configured.userToken;

    if (!canInspect) {
      return NextResponse.json({ configured, connection: null, requestId });
    }

    const appId = requireServerEnv("FACEBOOK_APP_ID");
    const client = new MetaGraphClient({
      graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
      accessToken: requireServerEnv("FACEBOOK_USER_ACCESS_TOKEN"),
    });
    const [account, token] = await Promise.all([
      client.getCurrentUser(),
      client.inspectCurrentToken({
        appId,
        appSecret: requireServerEnv("FACEBOOK_APP_SECRET"),
      }),
    ]);

    return NextResponse.json({
      configured,
      connection: {
        account,
        token: {
          isValid: token.isValid,
          type: token.type,
          appMatches: token.appId === appId,
          userMatches: token.userId === account.id,
          scopes: token.scopes,
          expiresAt: toIsoDate(token.expiresAt),
          dataAccessExpiresAt: toIsoDate(token.dataAccessExpiresAt),
        },
      },
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
