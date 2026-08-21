import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import {
  AdminUserService,
  allowlistInputSchema,
} from "@/modules/auth/admin-user-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    await requireAdmin();
    const users = await new AdminUserService().list();
    return NextResponse.json({ users, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const input = allowlistInputSchema.parse(await request.json());
    const user = await new AdminUserService().allowEmail({ actor, ...input });
    return NextResponse.json({ user, requestId }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
