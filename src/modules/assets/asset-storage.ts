import "server-only";
import {
  createSupabaseAdminClient,
  getAssetBucketName,
} from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors/app-error";

export class AssetStorage {
  async upload(input: {
    storageKey: string;
    data: ArrayBuffer;
    contentType: string;
  }): Promise<void> {
    const { error } = await createSupabaseAdminClient()
      .storage.from(getAssetBucketName())
      .upload(input.storageKey, input.data, {
        cacheControl: "3600",
        contentType: input.contentType,
        upsert: false,
      });

    if (error) {
      throw new AppError({
        code: "ASSET_UPLOAD_FAILED",
        message: "Không thể tải ảnh lên kho lưu trữ riêng tư.",
        status: 502,
        cause: error,
      });
    }
  }

  async remove(storageKey: string): Promise<void> {
    const { error } = await createSupabaseAdminClient()
      .storage.from(getAssetBucketName())
      .remove([storageKey]);
    if (error) {
      throw new AppError({
        code: "ASSET_DELETE_FAILED",
        message: "Không thể xóa ảnh khỏi kho lưu trữ riêng tư.",
        status: 502,
        cause: error,
      });
    }
  }

  async createSignedUrl(storageKey: string, expiresInSeconds = 3600) {
    const { data, error } = await createSupabaseAdminClient()
      .storage.from(getAssetBucketName())
      .createSignedUrl(storageKey, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new AppError({
        code: "ASSET_SIGNING_FAILED",
        message: "Không thể chuẩn bị ảnh để gửi lên Facebook.",
        status: 502,
        cause: error,
      });
    }
    return data.signedUrl;
  }

  async createSignedUrls(storageKeys: string[], expiresInSeconds = 3600) {
    return Promise.all(
      storageKeys.map((storageKey) =>
        this.createSignedUrl(storageKey, expiresInSeconds),
      ),
    );
  }
}
