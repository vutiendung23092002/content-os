import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { createDraftService } from "@/modules/posts/create-draft-service";
import { toDraftDto } from "@/modules/posts/draft-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    await assertInternalAccess(request);
    const url = new URL(request.url);
    const pageId = url.searchParams.get("pageId") ?? undefined;
    const drafts = await createDraftService().list(pageId);
    return NextResponse.json({ drafts: drafts.map(toDraftDto), requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    await assertInternalAccess(request);
    const draft = await createDraftService().create(await request.json());
    return NextResponse.json(
      { draft: toDraftDto(draft), requestId },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
