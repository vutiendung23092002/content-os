import "server-only";
import { z } from "zod";
import type { PageRecord } from "@/db/repositories/page-repository";
import type { PostRecord } from "@/db/repositories/post-repository";
import { AppError } from "@/lib/errors/app-error";

export const draftMessageSchema = z
  .string()
  .min(1)
  .max(100_000)
  .refine(
    (message) => message.trim().length > 0,
    "Nội dung không được chỉ chứa khoảng trắng.",
  );

export const createDraftSchema = z.object({
  pageId: z.uuid(),
  message: draftMessageSchema,
});

export const updateDraftSchema = z.object({
  message: draftMessageSchema,
  expectedUpdatedAt: z.iso.datetime().optional(),
});

export type PageReader = {
  findById(id: string): Promise<PageRecord | undefined>;
};

export type DraftStore = {
  createDraft(input: { pageId: string; message: string }): Promise<PostRecord>;
  findById(id: string): Promise<PostRecord | undefined>;
  listDrafts(pageId?: string, limit?: number): Promise<PostRecord[]>;
  updateDraft(
    id: string,
    input: { message: string; expectedUpdatedAt?: Date },
  ): Promise<PostRecord | undefined>;
  deleteDraft(id: string): Promise<boolean>;
};

export class DraftService {
  constructor(
    private readonly pages: PageReader,
    private readonly drafts: DraftStore,
  ) {}

  async create(input: unknown): Promise<PostRecord> {
    const parsed = createDraftSchema.parse(input);
    const page = await this.pages.findById(parsed.pageId);

    if (!page) {
      throw new AppError({
        code: "PAGE_NOT_FOUND",
        message: "Không tìm thấy Page.",
        status: 404,
      });
    }
    if (!page.isActive || page.connectionStatus !== "active") {
      throw new AppError({
        code: "PAGE_NOT_ACTIVE",
        message: "Page chưa sẵn sàng để tạo nội dung.",
        status: 409,
      });
    }

    return this.drafts.createDraft(parsed);
  }

  async get(id: string): Promise<PostRecord> {
    const draft = await this.drafts.findById(z.uuid().parse(id));
    if (!draft || draft.status !== "draft") {
      throw new AppError({
        code: "DRAFT_NOT_FOUND",
        message: "Không tìm thấy draft.",
        status: 404,
      });
    }
    return draft;
  }

  async list(pageId?: string, limit?: number): Promise<PostRecord[]> {
    const validPageId = pageId ? z.uuid().parse(pageId) : undefined;
    return this.drafts.listDrafts(validPageId, limit);
  }

  async update(id: string, input: unknown): Promise<PostRecord> {
    const validId = z.uuid().parse(id);
    const parsed = updateDraftSchema.parse(input);
    const updated = await this.drafts.updateDraft(validId, {
      message: parsed.message,
      expectedUpdatedAt: parsed.expectedUpdatedAt
        ? new Date(parsed.expectedUpdatedAt)
        : undefined,
    });

    if (!updated) {
      throw new AppError({
        code: "DRAFT_CONFLICT",
        message: "Draft không còn tồn tại hoặc đã được thay đổi.",
        status: 409,
      });
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.drafts.deleteDraft(z.uuid().parse(id));
    if (!deleted) {
      throw new AppError({
        code: "DRAFT_NOT_FOUND",
        message: "Không tìm thấy draft.",
        status: 404,
      });
    }
  }
}

export function toDraftDto(draft: PostRecord) {
  return {
    id: draft.id,
    pageId: draft.pageId,
    type: draft.type,
    message: draft.message,
    status: draft.status,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}
