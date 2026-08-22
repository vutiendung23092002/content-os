import "server-only";
import { getDatabase, runInTransaction } from "@/db/client";
import { AssetRepository } from "@/db/repositories/asset-repository";
import { PageRepository } from "@/db/repositories/page-repository";
import { PostRepository } from "@/db/repositories/post-repository";
import { DraftService } from "./draft-service";

export function createDraftService(): DraftService {
  const database = getDatabase();
  const posts = new PostRepository(database);
  return new DraftService(
    new PageRepository(database),
    {
      createDraft: (input) =>
        runInTransaction((transaction) =>
          new PostRepository(transaction).createDraft(input),
        ),
      findById: (id) => posts.findById(id),
      listDrafts: (pageId, limit) => posts.listDrafts(pageId, limit),
      updateDraft: (id, input) => posts.updateDraft(id, input),
      deleteDraft: (id) => posts.deleteDraft(id),
    },
    new AssetRepository(database),
  );
}
