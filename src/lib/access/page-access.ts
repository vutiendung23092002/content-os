import "server-only";
import { getDatabase } from "@/db/client";
import { PostRepository } from "@/db/repositories/post-repository";
import type { Viewer } from "@/lib/auth/types";
import { AppError } from "@/lib/errors/app-error";
import { PageAccessService } from "@/modules/auth/page-access-service";
import { assertInternalAccess } from "./internal-access";

export async function assertRequestPageAccess(
  request: Request,
  pageId: string,
) {
  const viewer = await assertInternalAccess(request);
  await assertPageAccessForViewer(viewer, pageId);
  return viewer;
}

export async function assertPageAccessForViewer(
  viewer: Viewer | undefined,
  pageId: string,
) {
  const access = new PageAccessService();
  if (viewer) await access.assertAccess(viewer, pageId);
  else await access.assertPageActive(pageId);
}

export async function assertRequestPostAccess(
  request: Request,
  postId: string,
) {
  return (await authorizeRequestPostAccess(request, postId)).post;
}

export async function authorizeRequestPostAccess(
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
  const viewer = await assertRequestPageAccess(request, post.pageId);
  return { post, viewer };
}
