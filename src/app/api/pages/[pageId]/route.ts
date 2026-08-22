import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runInTransaction } from "@/db/client";
import { PageRepository } from "@/db/repositories/page-repository";
import { UserPageAssignmentRepository } from "@/db/repositories/user-page-assignment-repository";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/errors/app-error";
import { toErrorResponse } from "@/lib/errors/api-error";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ pageId: z.uuid() });

export async function DELETE(
  request: Request,
  context: { params: Promise<{ pageId: string }> },
) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertSameOrigin(request);
    await requireAdmin();
    const { pageId } = paramsSchema.parse(await context.params);

    const removedPage = await runInTransaction(async (transaction) => {
      const pageRepository = new PageRepository(transaction);
      const page = await pageRepository.deactivate(pageId);
      if (!page) {
        throw new AppError({
          code: "PAGE_NOT_FOUND",
          message: "Page không tồn tại hoặc đã được gỡ khỏi hệ thống.",
          status: 404,
        });
      }
      await new UserPageAssignmentRepository(transaction).deleteForPage(pageId);
      return page;
    });

    return NextResponse.json({
      removedPage: {
        id: removedPage.id,
        externalPageId: removedPage.externalPageId,
        name: removedPage.name,
      },
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
