import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { AiRepository } from "@/db/repositories/ai-repository";
import { assertSameOrigin } from "@/lib/access/same-origin";
import { requireAdmin } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/errors/api-error";
import { parseJsonBody } from "@/lib/http/request-body";
import { assertMutationRateLimit } from "@/lib/security/mutation-rate-limit";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    providerId: z.uuid(),
    remoteModelId: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200),
    modality: z.enum(["text", "vision", "image"]),
    enabled: z.boolean().default(false),
    capabilities: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    await requireAdmin();
    return NextResponse.json({
      models: await new AiRepository(getDatabase()).listModels(),
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const input = await parseJsonBody(request, schema);
    await assertMutationRateLimit({ actor, action: "admin:ai:configure" });
    const repo = new AiRepository(getDatabase());
    if (!(await repo.findProvider(input.providerId)))
      throw new Error("Provider missing");
    const model = await repo.upsertModel(input);
    return NextResponse.json({ model, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
