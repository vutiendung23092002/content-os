import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";
import { PageRepository } from "@/db/repositories/page-repository";
import { assertInternalAccess } from "@/lib/access/internal-access";
import { toErrorResponse } from "@/lib/errors/api-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    assertInternalAccess(request);
    const records = await new PageRepository(getDatabase()).listActive();
    const pages = records.map((page) => ({
      id: page.id,
      externalPageId: page.externalPageId,
      name: page.name,
      category: page.category,
      timezone: page.timezone,
      connectionStatus: page.connectionStatus,
      lastSyncedAt: page.lastSyncedAt?.toISOString() ?? null,
    }));
    return NextResponse.json({ pages, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
