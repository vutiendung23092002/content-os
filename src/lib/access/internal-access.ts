import "server-only";
import { timingSafeEqual } from "node:crypto";
import { requireApprovedViewer } from "@/lib/auth/session";
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

export async function assertInternalAccess(request: Request): Promise<void> {
  if (hasConfiguredSecretAccess(request)) return;
  await requireApprovedViewer();
}
