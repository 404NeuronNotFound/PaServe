import {
  Injectable,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { boundedFetch } from '../../common/http/request-context.js';
import { isStorageConflict } from '../../common/storage/upload-errors.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ASSETS_BUCKET,
  productImageFolder,
  productImagePath,
} from '../../common/storage/media-paths.js';
export const PRODUCT_IMAGE_BUCKET = ASSETS_BUCKET;
@Injectable()
export class ProductImageStorage {
  private client?: SupabaseClient;
  private readonly logger = new Logger(ProductImageStorage.name);
  constructor(private readonly config: ConfigService) {}
  private admin() {
    if (!this.client) {
      const url = this.config.get<string>('SUPABASE_URL'),
        key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key)
        throw new ServiceUnavailableException({
          code: 'PRODUCT_STORAGE_UNAVAILABLE',
          message: 'Image uploads are unavailable. Please try again later.',
        });
      this.client = createClient(url, key, {
        global: { fetch: boundedFetch },
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client;
  }
  async upload(shopId: string, productId: string, buffer: Buffer) {
    const storagePath = productImagePath(shopId, productId);
    const bucket = this.admin().storage.from(PRODUCT_IMAGE_BUCKET);
    try {
      const { error } = await bucket.upload(storagePath, buffer, {
        contentType: 'image/webp',
        upsert: false,
        cacheControl: '31536000',
      });
      if (error) throw error;
    } catch (error) {
      // A conflict means this attempt never owned the existing object.
      if (!isStorageConflict(error)) await this.remove(storagePath);
      throw new ServiceUnavailableException({
        code: 'PRODUCT_STORAGE_UNAVAILABLE',
        message: 'The image could not be uploaded. Your current image is kept.',
      });
    }
    return {
      storagePath,
      imageUrl: bucket.getPublicUrl(storagePath).data.publicUrl,
    };
  }
  ownedReference(shopId: string, productId: string, imageUrl: string) {
    for (const [bucketName, folder] of [
      [PRODUCT_IMAGE_BUCKET, productImageFolder(shopId, productId)],
      ['product-media', `${shopId}/${productId}/`],
    ]) {
      const prefix = this.admin().storage.from(bucketName).getPublicUrl(folder)
        .data.publicUrl;
      if (!imageUrl.startsWith(prefix)) continue;
      const filename = imageUrl.slice(prefix.length);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(
          filename,
        )
      )
        return null;
      return { bucketName, storagePath: folder + filename };
    }
    return null;
  }
  async remove(storagePath: string) {
    try {
      const { error } = await this.admin()
        .storage.from(PRODUCT_IMAGE_BUCKET)
        .remove([storagePath]);
      if (error) this.logger.warn('Product image cleanup needs retry.');
    } catch {
      this.logger.warn('Product image cleanup needs retry.');
    }
  }
}
