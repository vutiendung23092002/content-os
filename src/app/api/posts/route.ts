import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { assertRequestPageAccess } from "@/lib/access/page-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { createDraftService } from "@/modules/posts/create-draft-service";
import { toDraftDto } from "@/modules/posts/draft-service";
import { createDraftSchema } from "@/modules/posts/draft-service";
import { PageAccessService } from "@/modules/auth/page-access-service";
import { assertSameOrigin } from "@/lib/access/same-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    const viewer = await assertInternalAccess(request);
    const url = new URL(request.url);
    const pageId = url.searchParams.get("pageId") ?? undefined;
    const pageAccess = new PageAccessService();
    if (pageId) {
      if (viewer) await pageAccess.assertAccess(viewer, pageId);
      else await pageAccess.assertPageActive(pageId);
    }
    const records = await createDraftService().list(pageId);
    const allowedIds = viewer
      ? await pageAccess.accessiblePageIds(viewer)
      : null;
    const drafts = allowedIds
      ? records.filter((draft) => allowedIds.has(draft.pageId))
      : records;
    return NextResponse.json({ drafts: drafts.map(toDraftDto), requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    const input = createDraftSchema.parse(await request.json());
    await assertRequestPageAccess(request, input.pageId);
    const draft = await createDraftService().create(input);
    return NextResponse.json(
      { draft: toDraftDto(draft), requestId },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
