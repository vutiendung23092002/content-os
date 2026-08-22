import "server-only";
import { getDatabase } from "@/db/client";
import { PostRepository } from "@/db/repositories/post-repository";
import { AppError } from "@/lib/errors/app-error";
import { PageAccessService } from "@/modules/auth/page-access-service";
import { assertInternalAccess } from "./internal-access";

export async function assertRequestPageAccess(
  request: Request,
  pageId: string,
) {
  const viewer = await assertInternalAccess(request);
  const access = new PageAccessService();
  if (viewer) await access.assertAccess(viewer, pageId);
  else await access.assertPageActive(pageId);
  return viewer;
}

export async function assertRequestPostAccess(
  request: Request,
  postId: string,
) {
  const post = await new PostRepository(getDatabase()).findById(postId);
  if (!post) {
    throw new AppError({
      code: "POST_NOT_FOUND",
      message: "Không tìm thấy bài viết.",
      status: 404,
    });
  }
  await assertRequestPageAccess(request, post.pageId);
  return post;
}
