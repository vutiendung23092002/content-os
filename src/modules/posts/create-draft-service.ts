import "server-only";
import { getDatabase } from "@/db/client";
import { PageRepository } from "@/db/repositories/page-repository";
import { PostRepository } from "@/db/repositories/post-repository";
import { DraftService } from "./draft-service";

export function createDraftService(): DraftService {
  const database = getDatabase();
  return new DraftService(
    new PageRepository(database),
    new PostRepository(database),
  );
}
