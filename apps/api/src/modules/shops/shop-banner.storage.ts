import {
  Injectable,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isStorageConflict } from '../../common/storage/upload-errors.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ASSETS_BUCKET,
  brandingFolder,
  brandingImagePath,
} from '../../common/storage/media-paths.js';
export const SHOP_BANNER_BUCKET = ASSETS_BUCKET;
@Injectable()
export class ShopBannerStorage {
  private client?: SupabaseClient;
  private readonly logger = new Logger(ShopBannerStorage.name);
  constructor(private readonly config: ConfigService) {}
  private admin() {
    if (!this.client) {
      const url = this.config.get<string>('SUPABASE_URL'),
        key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key)
        throw new ServiceUnavailableException({
          code: 'SHOP_BANNER_STORAGE_UNAVAILABLE',
          message: 'Banner uploads are unavailable. Please try again later.',
        });
      this.client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client;
  }
  async upload(shopId: string, buffer: Buffer) {
    const storagePath = brandingImagePath(shopId, 'banner');
    const bucket = this.admin().storage.from(SHOP_BANNER_BUCKET);
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
        code: 'SHOP_BANNER_STORAGE_UNAVAILABLE',
        message:
          'The banner could not be uploaded. Your current banner is kept.',
      });
    }
    return {
      storagePath,
      bannerUrl: bucket.getPublicUrl(storagePath).data.publicUrl,
    };
  }
  async removePrevious(shopId: string, bannerUrl: string | null) {
    if (!bannerUrl) return;
    // Never delete external media or objects owned by a different shop.
    for (const [bucketName, folder] of [
      [SHOP_BANNER_BUCKET, brandingFolder(shopId, 'banner')],
      ['shop-media', `${shopId}/banner/`],
    ]) {
      const prefix = this.admin().storage.from(bucketName).getPublicUrl(folder)
        .data.publicUrl;
      if (!bannerUrl.startsWith(prefix)) continue;
      const filename = bannerUrl.slice(prefix.length);
      if (!/^[0-9a-f-]{36}\.webp$/.test(filename)) return;
      await this.remove(folder + filename, bucketName);
      return;
    }
  }

  async remove(storagePath: string, bucketName = SHOP_BANNER_BUCKET) {
    try {
      const { error } = await this.admin()
        .storage.from(bucketName)
        .remove([storagePath]);
      if (error) this.logger.warn('Shop banner cleanup needs retry.');
    } catch {
      this.logger.warn('Shop banner cleanup needs retry.');
    }
  }
}
