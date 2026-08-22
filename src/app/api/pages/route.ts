import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { toErrorResponse } from "@/lib/errors/api-error";
import { PageAccessService } from "@/modules/auth/page-access-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    const viewer = await assertInternalAccess(request);
    const records = viewer
      ? await new PageAccessService().listForViewer(viewer)
      : await new PageAccessService().listForViewer({
          id: "automation",
          externalUserId: "automation",
          email: "automation@internal",
          name: "Automation",
          role: "super_admin",
          approvalStatus: "approved",
          isBootstrapSuperAdmin: false,
        });
    const pages = records.map(({ page, canAccess, accessReason }) => ({
      id: page.id,
      externalPageId: page.externalPageId,
      name: page.name,
      avatarUrl: page.avatarUrl,
      category: page.category,
      timezone: page.timezone,
      connectionStatus: page.connectionStatus,
      lastSyncedAt: page.lastSyncedAt?.toISOString() ?? null,
      canAccess,
      accessReason,
    }));
    return NextResponse.json({ pages, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
