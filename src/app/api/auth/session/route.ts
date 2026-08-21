import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const viewer = await requireViewer();
    return NextResponse.json({ viewer, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
