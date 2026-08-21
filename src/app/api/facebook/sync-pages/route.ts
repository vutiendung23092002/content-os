import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { requireServerEnv } from "@/lib/env/server";
import { toErrorResponse } from "@/lib/errors/api-error";
import { MetaGraphClient } from "@/modules/facebook/meta-client";
import { syncManagedPages } from "@/modules/facebook/sync-managed-pages";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    await assertInternalAccess(request);
    const client = new MetaGraphClient({
      graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
      accessToken: requireServerEnv("FACEBOOK_USER_ACCESS_TOKEN"),
    });
    const pages = await syncManagedPages({
      client,
      encryptionKey: requireServerEnv("TOKEN_ENCRYPTION_KEY"),
    });

    return NextResponse.json({ pages, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
