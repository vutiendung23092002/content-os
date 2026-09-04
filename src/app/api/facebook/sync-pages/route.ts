import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  assertInternalAdminAccess,
  hasConfiguredSecretAccess,
} from "@/lib/access/internal-access";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireServerEnv } from "@/lib/env/server";
import { getTokenKeyring } from "@/lib/crypto/token-keyring";
import { toErrorResponse } from "@/lib/errors/api-error";
import { assertEmptyBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
import { MetaGraphClient } from "@/modules/facebook/meta-client";
import { syncManagedPages } from "@/modules/facebook/sync-managed-pages";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    if (!hasConfiguredSecretAccess(request)) assertSameOrigin(request);
    const actor = await assertInternalAdminAccess(request);
    if (actor) {
      await assertMutationRateLimit({ actor, action: "facebook:pages:sync" });
      await assertEmptyBody(request);
    }
    const client = new MetaGraphClient({
      graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
      accessToken: requireServerEnv("FACEBOOK_USER_ACCESS_TOKEN"),
    });
    const pages = await syncManagedPages({
      client,
      tokenEncryption: getTokenKeyring(),
      metaAppId: requireServerEnv("FACEBOOK_APP_ID"),
    });

    return NextResponse.json({ pages, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
