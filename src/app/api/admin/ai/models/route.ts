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
import { AppError } from "@/lib/errors/app-error";
export const dynamic = "force-dynamic";
function isSafeCapabilities(value: Record<string, unknown>): boolean {
  const containsSensitiveKey = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return false;
    return Object.entries(item).some(
      ([key, child]) =>
        /(?:api[_-]?key|secret|password|token|credential)/i.test(key) ||
        containsSensitiveKey(child),
    );
  };
  return !containsSensitiveKey(value) && JSON.stringify(value).length <= 16_000;
}
const schema = z
  .object({
    providerId: z.uuid(),
    remoteModelId: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(200),
    modality: z.enum(["text", "vision", "image"]),
    enabled: z.boolean().default(false),
    capabilities: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .refine((value) => isSafeCapabilities(value.capabilities), {
    message: "Capabilities must be a bounded non-sensitive object.",
  });
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
      throw new AppError({
        code: "AI_PROVIDER_NOT_FOUND",
        message: "AI provider was not found.",
        status: 404,
      });
    const model = await repo.createModel(input);
    return NextResponse.json({ model, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
const updateSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string().trim().min(1).max(200).optional(),
    modality: z.enum(["text", "vision", "image"]).optional(),
    enabled: z.boolean().optional(),
    capabilities: z.record(z.string().max(100), z.unknown()).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "id"), {
    message: "At least one model field must be supplied.",
  })
  .refine(
    (value) => !value.capabilities || isSafeCapabilities(value.capabilities),
    { message: "Capabilities must be a bounded non-sensitive object." },
  );
export async function PATCH(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin();
    const input = await parseJsonBody(request, updateSchema);
    await assertMutationRateLimit({ actor, action: "admin:ai:configure" });
    const repo = new AiRepository(getDatabase());
    const existing = await repo.findModel(input.id);
    if (!existing)
      throw new AppError({
        code: "AI_MODEL_NOT_FOUND",
        message: "AI model was not found.",
        status: 404,
      });
    const { id, ...changes } = input;
    const model = await repo.updateModel(id, changes);
    return NextResponse.json({ model, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
