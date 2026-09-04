import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertRequestPageAccess } from "@/lib/access/page-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import {
  RemotePostReader,
  remotePostKindSchema,
} from "@/modules/facebook/remote-post-reader";
import { RemotePostWeekCache } from "@/modules/facebook/remote-post-week-cache";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  pageId: z.uuid(),
  kind: remotePostKindSchema,
  after: z.string().trim().min(1).max(2048).optional(),
  weekStart: z.iso.datetime({ offset: true }).optional(),
  refresh: z.enum(["1"]).optional(),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      pageId: url.searchParams.get("pageId"),
      kind: url.searchParams.get("kind"),
      after: url.searchParams.get("after") ?? undefined,
      weekStart: url.searchParams.get("weekStart") ?? undefined,
      refresh: url.searchParams.get("refresh") ?? undefined,
    });
    const viewer = await assertRequestPageAccess(request, query.pageId);
    if (query.weekStart) {
      const result = await new RemotePostWeekCache().list({
        localPageId: query.pageId,
        kind: query.kind,
        weekStart: new Date(query.weekStart),
        forceRefresh: query.refresh === "1",
        actorUserId: viewer?.id,
      });
      return NextResponse.json({ ...result, after: null, requestId });
    }
    const result = await new RemotePostReader().list({
      localPageId: query.pageId,
      kind: query.kind,
      after: query.after,
      actorUserId: viewer?.id,
    });

    return NextResponse.json({ ...result, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
