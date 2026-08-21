import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { requireServerEnv } from "@/lib/env/server";
import { toErrorResponse } from "@/lib/errors/api-error";
import {
  manualPageIdSchema,
  toSafeManualPage,
  verifyManualPage,
} from "@/modules/facebook/manual-page-service";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ pageId: manualPageIdSchema });

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    await assertInternalAccess(request);
    const input = requestSchema.parse(await request.json());
    const verification = await verifyManualPage({
      pageId: input.pageId,
      graphVersion: requireServerEnv("FACEBOOK_GRAPH_API_VERSION"),
      userAccessToken: requireServerEnv("FACEBOOK_USER_ACCESS_TOKEN"),
      appId: requireServerEnv("FACEBOOK_APP_ID"),
      appSecret: requireServerEnv("FACEBOOK_APP_SECRET"),
    });

    return NextResponse.json({
      page: toSafeManualPage(verification),
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
