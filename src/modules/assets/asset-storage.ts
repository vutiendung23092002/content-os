import "server-only";
import {
  createSupabaseAdminClient,
  getAssetBucketName,
} from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors/app-error";

export class AssetStorage {
  async createSignedUploadUrl(storageKey: string) {
    const { data, error } = await createSupabaseAdminClient()
      .storage.from(getAssetBucketName())
      .createSignedUploadUrl(storageKey);
    if (error || !data?.token) {
      throw new AppError({
        code: "ASSET_UPLOAD_INTENT_FAILED",
        message: "Không thể chuẩn bị phiên tải video bảo mật.",
        status: 502,
        cause: error,
      });
    }
    return data.token;
  }

  async info(storageKey: string) {
    const { data, error } = await createSupabaseAdminClient()
      .storage.from(getAssetBucketName())
      .info(storageKey);
    if (error || !data) {
      throw new AppError({
        code: "ASSET_UPLOAD_NOT_FOUND",
        message: "Không tìm thấy video vừa tải lên kho lưu trữ.",
        status: 404,
        cause: error,
      });
    }
    return data;
  }

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
