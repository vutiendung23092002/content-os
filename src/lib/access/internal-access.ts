import "server-only";
import { timingSafeEqual } from "node:crypto";
import { requireApprovedViewer } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/session";
import type { Viewer } from "@/lib/auth/types";
import { getServerEnv } from "@/lib/env/server";

export const INTERNAL_ACCESS_HEADER = "x-han-access-secret";

function secretsMatch(expected: string, received: string | null): boolean {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function hasConfiguredSecretAccess(request: Request): boolean {
  const expected = getServerEnv().APP_ACCESS_SECRET;
  return Boolean(
    expected &&
    secretsMatch(expected, request.headers.get(INTERNAL_ACCESS_HEADER)),
  );
}

export async function assertInternalAccess(
  request: Request,
): Promise<Viewer | undefined> {
  if (hasConfiguredSecretAccess(request)) return;
  return requireApprovedViewer();
}

export async function assertInternalAdminAccess(
  request: Request,
): Promise<Viewer | undefined> {
  if (hasConfiguredSecretAccess(request)) return;
  return requireAdmin();
}
