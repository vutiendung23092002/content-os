import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import {
  RemotePostReader,
  remotePostKindSchema,
} from "@/modules/facebook/remote-post-reader";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  pageId: z.uuid(),
  kind: remotePostKindSchema,
  after: z.string().trim().min(1).max(2048).optional(),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    await assertInternalAccess(request);
    const url = new URL(request.url);
    const query = querySchema.parse({
      pageId: url.searchParams.get("pageId"),
      kind: url.searchParams.get("kind"),
      after: url.searchParams.get("after") ?? undefined,
    });
    const result = await new RemotePostReader().list({
      localPageId: query.pageId,
      kind: query.kind,
      after: query.after,
    });

    return NextResponse.json({ ...result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
